import { BaseStore } from "@langchain/langgraph-checkpoint";
import type {
  Operation,
  OperationResults,
  Item,
  SearchItem,
  PutOperation,
  SearchOperation,
  ListNamespacesOperation,
  MatchCondition,
} from "@langchain/langgraph-checkpoint";

interface SerializedItem {
  namespace: string[];
  key: string;
  value: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export class FileStore extends BaseStore {
  private data: Map<string, Map<string, Item>>;
  private readonly dir: string;

  private constructor(dir: string) {
    super();
    this.dir = dir;
    this.data = new Map();
  }

  static async create(opts: { dir: string }): Promise<FileStore> {
    const store = new FileStore(opts.dir);
    await store.loadFromDisk();
    return store;
  }

  private async loadFromDisk(): Promise<void> {
    const filePath = `${this.dir}/store.json`;
    const file = Bun.file(filePath);

    const exists = await file.exists();
    if (!exists) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        console.warn(`[FileStore] store.json is not an array, starting fresh`);
        this.data = new Map();
        return;
      }
      for (const raw of parsed as SerializedItem[]) {
        const item: Item = {
          namespace: raw.namespace,
          key: raw.key,
          value: raw.value,
          createdAt: new Date(raw.createdAt),
          updatedAt: new Date(raw.updatedAt),
        };
        const nsKey = item.namespace.join(":");
        if (!this.data.has(nsKey)) {
          this.data.set(nsKey, new Map());
        }
        this.data.get(nsKey)!.set(item.key, item);
      }
    } catch (err) {
      console.warn(`[FileStore] Failed to load store.json, starting fresh:`, err);
      this.data = new Map();
    }
  }

  private async persist(): Promise<void> {
    const items: SerializedItem[] = [];
    for (const [, nsMap] of this.data) {
      for (const [, item] of nsMap) {
        items.push({
          namespace: item.namespace,
          key: item.key,
          value: item.value,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        });
      }
    }
    await Bun.write(`${this.dir}/store.json`, JSON.stringify(items, null, 2));
  }

  async batch<Op extends readonly Operation[]>(
    operations: Op
  ): Promise<OperationResults<Op>> {
    const results: unknown[] = [];
    let needsPersist = false;

    for (const op of operations) {
      if ("key" in op && "namespace" in op && !("value" in op) && !("matchConditions" in op)) {
        // GetOperation
        const nsKey = (op as { namespace: string[]; key: string }).namespace.join(":");
        const found = this.data.get(nsKey)?.get((op as { key: string }).key) ?? null;
        results.push(found ? { ...found } : null);
      } else if ("namespacePrefix" in op) {
        // SearchOperation
        results.push(this.searchOperation(op as SearchOperation));
      } else if ("value" in op) {
        // PutOperation
        this.putOperation(op as PutOperation);
        needsPersist = true;
        results.push(undefined);
      } else if ("matchConditions" in op || ("limit" in op && "offset" in op)) {
        // ListNamespacesOperation
        results.push(this.listNamespacesOperation(op as ListNamespacesOperation));
      }
    }

    if (needsPersist) await this.persist();
    return results as OperationResults<Op>;
  }

  private searchOperation(op: SearchOperation): SearchItem[] {
    const prefixKey = op.namespacePrefix.join(":");
    const limit = op.limit ?? 10;
    const offset = op.offset ?? 0;

    const matched: SearchItem[] = [];

    for (const [nsKey, nsMap] of this.data) {
      // Empty prefix matches all, otherwise nsKey must start with prefix
      const prefixMatches =
        prefixKey === "" ||
        nsKey === prefixKey ||
        nsKey.startsWith(`${prefixKey}:`);

      if (!prefixMatches) continue;

      for (const [, item] of nsMap) {
        if (op.filter) {
          let passes = true;
          for (const [filterKey, filterVal] of Object.entries(op.filter)) {
            if (item.value[filterKey] !== filterVal) {
              passes = false;
              break;
            }
          }
          if (!passes) continue;
        }
        matched.push({ ...item, score: undefined });
      }
    }

    return matched.slice(offset, offset + limit);
  }

  private putOperation(op: PutOperation): void {
    const nsKey = op.namespace.join(":");

    if (op.value === null) {
      // Delete
      this.data.get(nsKey)?.delete(op.key);
      if (this.data.get(nsKey)?.size === 0) {
        this.data.delete(nsKey);
      }
      return;
    }

    if (!this.data.has(nsKey)) {
      this.data.set(nsKey, new Map());
    }

    const nsMap = this.data.get(nsKey)!;
    const existing = nsMap.get(op.key);
    const now = new Date();

    if (existing) {
      existing.value = op.value;
      existing.updatedAt = now;
    } else {
      const item: Item = {
        namespace: op.namespace,
        key: op.key,
        value: op.value,
        createdAt: now,
        updatedAt: now,
      };
      nsMap.set(op.key, item);
    }
  }

  private listNamespacesOperation(op: ListNamespacesOperation): string[][] {
    const limit = op.limit ?? 100;
    const offset = op.offset ?? 0;
    const maxDepth = op.maxDepth;

    const allNamespaces: string[][] = [];
    const seen = new Set<string>();

    for (const [nsKey] of this.data) {
      const parts = nsKey === "" ? [] : nsKey.split(":");
      const truncated = maxDepth != null ? parts.slice(0, maxDepth) : parts;
      const key = truncated.join(":");
      if (!seen.has(key)) {
        seen.add(key);
        allNamespaces.push(truncated);
      }
    }

    let filtered = allNamespaces;

    if (op.matchConditions && op.matchConditions.length > 0) {
      filtered = allNamespaces.filter((ns) =>
        op.matchConditions!.every((cond) => matchesCondition(ns, cond))
      );
    }

    filtered.sort((a, b) => a.join(":").localeCompare(b.join(":")));

    return filtered.slice(offset, offset + limit);
  }
}

function matchesCondition(namespace: string[], condition: MatchCondition): boolean {
  const path = condition.path;

  if (condition.matchType === "prefix") {
    if (path.length > namespace.length) return false;
    return path.every((seg, i) => seg === "*" || seg === namespace[i]);
  }

  if (condition.matchType === "suffix") {
    if (path.length > namespace.length) return false;
    const offset = namespace.length - path.length;
    return path.every((seg, i) => seg === "*" || seg === namespace[offset + i]);
  }

  return false;
}
