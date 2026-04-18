import type { BaseStore } from "@langchain/langgraph";
import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import { L4_KEY, L4_NAMESPACE } from "../memory/constants.ts";
import { formatHistory, type LogEntry } from "./history-format.ts";

export interface LayerEntry {
  content: string;
  windowStart: string;
  windowEnd: string;
}

export interface MemoryContext {
  l4Content: string | null;
  l3Entries: LayerEntry[];
  l2Entries: LayerEntry[];
  l1Entries: LogEntry[] | undefined;
}

export interface MemoryContextDeps {
  store?: BaseStore;
  fs?: FilesystemAdapter;
  logDir?: string;
  l2DelayHours?: number;
  now?: () => Date;
}

export async function loadMemoryContext(deps: MemoryContextDeps): Promise<MemoryContext> {
  const now = deps.now ?? (() => new Date());
  const currentTime = now();
  const l2DelayHours = deps.l2DelayHours ?? 1;

  const l4Item = deps.store
    ? await deps.store.get(L4_NAMESPACE as unknown as string[], L4_KEY)
    : null;
  const l4Content = (l4Item?.value as { content?: string } | null)?.content ?? null;

  const allL3Items = deps.store ? await deps.store.search(["memory", "L3"], { limit: 10000 }) : [];
  const l3Entries = allL3Items
    .map((item) => item.value as LayerEntry)
    .sort((a, b) => a.windowStart.localeCompare(b.windowStart));

  const latestL3WindowEnd = l3Entries.reduce<string | null>((max, e) => {
    if (max === null) return e.windowEnd;
    return e.windowEnd > max ? e.windowEnd : max;
  }, null);

  const allL2Items = deps.store ? await deps.store.search(["memory", "L2"], { limit: 10000 }) : [];
  const l2Entries = allL2Items
    .map((item) => item.value as LayerEntry)
    .filter((e) => latestL3WindowEnd === null || e.windowStart >= latestL3WindowEnd)
    .sort((a, b) => a.windowStart.localeCompare(b.windowStart));

  const latestL2WindowEnd = l2Entries.reduce<string | null>((max, e) => {
    if (max === null) return e.windowEnd;
    return e.windowEnd > max ? e.windowEnd : max;
  }, null);

  let l1Entries: LogEntry[] | undefined;
  if (deps.fs && deps.logDir) {
    const cutoff =
      latestL2WindowEnd !== null
        ? latestL2WindowEnd
        : new Date(currentTime.getTime() - (1 + l2DelayHours) * 3600000).toISOString();
    try {
      l1Entries = (await deps.fs.readEntriesSince(deps.logDir, cutoff)) as LogEntry[];
    } catch {
      // History is best-effort; continue without it
    }
  }

  return { l4Content, l3Entries, l2Entries, l1Entries };
}

export function formatMemoryContext(ctx: MemoryContext): string {
  let out = "";

  const trimmedL4 = ctx.l4Content?.trim() ?? "";
  if (trimmedL4.length > 0) {
    out += `\nPersistent memory:\n${trimmedL4}\n`;
  }

  if (ctx.l3Entries.length > 0) {
    out += "\n6-hour overview:\n";
    out += ctx.l3Entries.map((e) => `[${e.windowStart}..${e.windowEnd}] ${e.content}`).join("\n");
    out += "\n";
  }

  if (ctx.l2Entries.length > 0) {
    out += "\nHourly overview:\n";
    out += ctx.l2Entries.map((e) => `[${e.windowStart}] ${e.content}`).join("\n");
    out += "\n";
  }

  if (ctx.l1Entries && ctx.l1Entries.length > 0) {
    const { history } = formatHistory(ctx.l1Entries);
    if (history) {
      out += `\nRecent history:\n${history}\n`;
    }
  }

  return out;
}
