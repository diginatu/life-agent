import type { BaseStore } from "@langchain/langgraph";
import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import type { OllamaAdapter } from "../adapters/ollama.ts";
import {
  DEFAULT_L4_MAX_CHARS,
  DEFAULT_L4_PROMPT,
  L4_KEY,
  L4_NAMESPACE,
} from "../memory/constants.ts";
import { summarizeL3, summarizeLayer } from "../memory/summarize-layer.ts";
import { type EvictedL3Entry, updateL4 } from "../memory/update-l4.ts";
import type { LogEntry } from "./history-format.ts";

export interface LayerUpdateNodeDeps {
  ollama: OllamaAdapter;
  fs: FilesystemAdapter;
  logDir: string;
  store: BaseStore;
  l2DelayHours: number;
  l3DelayHours: number;
  l2MaxRetention: number;
  l3MaxRetention: number;
  l4MaxChars?: number;
  l4UpdatePrompt?: string;
  maxScanDays?: number;
  now?: () => Date;
}

function toLocalHourKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}`;
}

/** Return the UTC Date of the 6-hour bucket start (HH ∈ {00,06,12,18}) for a given UTC date. */
function toL3BucketStart(date: Date): Date {
  const h = date.getUTCHours();
  const bucketHour = L3_BUCKET_HOURS.filter((bh) => bh <= h).at(-1) ?? 0;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), bucketHour),
  );
}

/** Key for an L3 bucket: YYYY-MM-DDTHH using the bucket's UTC start. */
function toL3BucketKey(bucketStart: Date): string {
  const y = bucketStart.getUTCFullYear();
  const m = String(bucketStart.getUTCMonth() + 1).padStart(2, "0");
  const d = String(bucketStart.getUTCDate()).padStart(2, "0");
  const h = String(bucketStart.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}`;
}

const L2_NAMESPACE = ["memory", "L2"] as const;
const L3_NAMESPACE = ["memory", "L3"] as const;
const L3_BUCKET_MS = 6 * 3600000;
const L3_BUCKET_HOURS = [0, 6, 12, 18];
const DEFAULT_MAX_SCAN_DAYS = 14;

export function createLayerUpdateNode(deps: LayerUpdateNodeDeps) {
  return async (): Promise<Record<string, never>> => {
    const now = (deps.now ?? (() => new Date()))();
    const maxScanDays = deps.maxScanDays ?? DEFAULT_MAX_SCAN_DAYS;

    // Fetch existing L2 keys to skip
    const existingL2 = await deps.store.search(L2_NAMESPACE as unknown as string[], {
      limit: 10000,
    });
    const existingKeys = new Set(existingL2.map((item: { key: string }) => item.key));

    // Cutoff: latest UTC hour H such that H + 1h + l2DelayHours*h <= now
    // i.e. H <= now - (1 + l2DelayHours) * 3600000, then floored to hour start
    const cutoffMs = now.getTime() - (1 + deps.l2DelayHours) * 3600000;
    const cutoff = new Date(cutoffMs);
    // Floor to hour
    cutoff.setMinutes(0, 0, 0);

    // Scan start: maxScanDays ago, floored to hour
    const scanStart = new Date(now.getTime() - maxScanDays * 86400000);
    scanStart.setMinutes(0, 0, 0);

    // --- Phase 1: Create all missing L2 entries (no eviction yet) ---
    for (let h = new Date(scanStart); h <= cutoff; h = new Date(h.getTime() + 3600000)) {
      const key = toLocalHourKey(h);
      if (existingKeys.has(key)) {
        console.log(`[layer-update] L2 skip "${key}" (already exists)`);
        continue;
      }

      const hStart = h.toISOString();
      const hEnd = new Date(h.getTime() + 3600000).toISOString();

      // Read day file(s) for this UTC hour
      const dateStr = h.toISOString().slice(0, 10);
      const allEntries = await deps.fs.readAllLinesForDay(deps.logDir, dateStr);

      // If the hour crosses UTC midnight (rare), also check next day
      const hEndDate = new Date(h.getTime() + 3600000).toISOString().slice(0, 10);
      let extra: unknown[] = [];
      if (hEndDate !== dateStr) {
        extra = await deps.fs.readAllLinesForDay(deps.logDir, hEndDate);
      }

      // Filter to entries in [hStart, hEnd)
      const entries = ([...allEntries, ...extra] as LogEntry[]).filter((e) => {
        if (!e.timestamp) return false;
        return e.timestamp >= hStart && e.timestamp < hEnd;
      });

      if (entries.length === 0) {
        continue;
      }

      const content = await summarizeLayer(deps.ollama, entries, key);

      await deps.store.put(L2_NAMESPACE as unknown as string[], key, {
        content,
        windowStart: hStart,
        windowEnd: hEnd,
        sourceCount: entries.length,
      });
    }

    // --- Phase 2: L3 6-hour bucket rollup (consumes L2 before eviction) ---
    const existingL3 = await deps.store.search(L3_NAMESPACE as unknown as string[], {
      limit: 10000,
    });
    const existingL3Keys = new Set(existingL3.map((item: { key: string }) => item.key));

    // L3 cutoff: latest bucket B such that B + 6h + l3DelayHours*h <= now
    const l3CutoffMs = now.getTime() - (L3_BUCKET_MS + deps.l3DelayHours * 3600000);
    const l3Cutoff = toL3BucketStart(new Date(l3CutoffMs));

    // L3 scan start: maxScanDays ago, aligned to a bucket
    const l3ScanStart = toL3BucketStart(new Date(now.getTime() - maxScanDays * 86400000));

    for (let b = new Date(l3ScanStart); b <= l3Cutoff; b = new Date(b.getTime() + L3_BUCKET_MS)) {
      const bucketKey = toL3BucketKey(b);
      if (existingL3Keys.has(bucketKey)) {
        console.log(`[layer-update] L3 skip "${bucketKey}" (already exists)`);
        continue;
      }

      const bStart = b.toISOString();
      const bEnd = new Date(b.getTime() + L3_BUCKET_MS).toISOString();

      // Gather L2 entries whose windowStart falls in [bStart, bEnd)
      const allL2 = await deps.store.search(L2_NAMESPACE as unknown as string[], { limit: 10000 });
      const l2Items = allL2
        .filter((item: { value: { windowStart?: string } }) => {
          const ws = item.value?.windowStart;
          if (!ws) return false;
          return ws >= bStart && ws < bEnd;
        })
        .map(
          (item: { value: unknown }) =>
            item.value as {
              content: string;
              windowStart: string;
              windowEnd: string;
              sourceCount: number;
            },
        );

      if (l2Items.length === 0) {
        continue;
      }

      const content = await summarizeL3(deps.ollama, l2Items, bucketKey);

      await deps.store.put(L3_NAMESPACE as unknown as string[], bucketKey, {
        content,
        windowStart: bStart,
        windowEnd: bEnd,
        sourceCount: l2Items.length,
      });

      const allL3AfterWrite = await deps.store.search(L3_NAMESPACE as unknown as string[], {
        limit: 10000,
      });
      if (allL3AfterWrite.length > deps.l3MaxRetention) {
        const sorted = [...allL3AfterWrite].sort((a, b) => {
          const aWs = (a.value as { windowStart?: string }).windowStart ?? "";
          const bWs = (b.value as { windowStart?: string }).windowStart ?? "";
          return aWs < bWs ? -1 : aWs > bWs ? 1 : 0;
        });
        const toEvict = sorted.slice(0, allL3AfterWrite.length - deps.l3MaxRetention);

        const existingL4 = await deps.store.get(L4_NAMESPACE as unknown as string[], L4_KEY);
        let l4Content = (existingL4?.value as { content?: string } | null)?.content ?? "";
        let l4SourceCount =
          (existingL4?.value as { sourceCount?: number } | null)?.sourceCount ?? 0;

        for (const item of toEvict) {
          const evicted = item.value as EvictedL3Entry;
          const newContent = await updateL4(
            deps.ollama,
            l4Content,
            evicted,
            deps.l4UpdatePrompt ?? DEFAULT_L4_PROMPT,
            deps.l4MaxChars ?? DEFAULT_L4_MAX_CHARS,
          );

          if (newContent !== l4Content) {
            l4Content = newContent;
            l4SourceCount += 1;
            await deps.store.put(L4_NAMESPACE as unknown as string[], L4_KEY, {
              content: l4Content,
              updatedAt: now.toISOString(),
              sourceCount: l4SourceCount,
            });
          }

          await deps.store.delete(L3_NAMESPACE as unknown as string[], item.key);
        }
      }
    }

    // --- Phase 3: L2 eviction (safe — L3 has already consumed what it needs) ---
    const allL2Final = await deps.store.search(L2_NAMESPACE as unknown as string[], {
      limit: 10000,
    });
    if (allL2Final.length > deps.l2MaxRetention) {
      const sorted = [...allL2Final].sort((a, b) => {
        const aWs = (a.value as { windowStart?: string }).windowStart ?? "";
        const bWs = (b.value as { windowStart?: string }).windowStart ?? "";
        return aWs < bWs ? -1 : aWs > bWs ? 1 : 0;
      });
      const toEvict = sorted.slice(0, allL2Final.length - deps.l2MaxRetention);
      for (const item of toEvict) {
        await deps.store.delete(L2_NAMESPACE as unknown as string[], item.key);
      }
    }

    return {};
  };
}
