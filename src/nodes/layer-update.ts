import type { OllamaAdapter } from "../adapters/ollama.ts";
import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import type { BaseStore } from "@langchain/langgraph";
import type { LogEntry } from "./history-format.ts";
import { summarizeLayer } from "../memory/summarize-layer.ts";

export interface LayerUpdateNodeDeps {
  ollama: OllamaAdapter;
  fs: FilesystemAdapter;
  logDir: string;
  store: BaseStore;
  l2DelayHours: number;
  l3DelayHours: number;
  now?: () => Date;
}

function toLocalHourKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}`;
}

/** Return the UTC Date of the 6-hour bucket start (HH ∈ {00,06,12,18}) for a given UTC date. */
function toL3BucketStart(date: Date): Date {
  const h = date.getUTCHours();
  const bucketHour = L3_BUCKET_HOURS.filter((bh) => bh <= h).at(-1) ?? 0;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), bucketHour));
}

/** Key for an L3 bucket: YYYY-MM-DDTHH using the bucket's UTC start. */
function toL3BucketKey(bucketStart: Date): string {
  const y = bucketStart.getUTCFullYear();
  const m = String(bucketStart.getUTCMonth() + 1).padStart(2, '0');
  const d = String(bucketStart.getUTCDate()).padStart(2, '0');
  const h = String(bucketStart.getUTCHours()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}`;
}

const L2_NAMESPACE = ["memory", "L2"] as const;
const L3_NAMESPACE = ["memory", "L3"] as const;
const L3_BUCKET_MS = 6 * 3600000;
const L3_BUCKET_HOURS = [0, 6, 12, 18];
const MAX_SCAN_DAYS = 7;

export function createLayerUpdateNode(deps: LayerUpdateNodeDeps) {
  return async (): Promise<Record<string, never>> => {
    const now = (deps.now ?? (() => new Date()))();

    // Fetch existing L2 keys to skip
    const existingL2 = await deps.store.search(L2_NAMESPACE as unknown as string[], { limit: 10000 });
    const existingKeys = new Set(existingL2.map((item: { key: string }) => item.key));

    // Cutoff: latest UTC hour H such that H + 1h + l2DelayHours*h <= now
    // i.e. H <= now - (1 + l2DelayHours) * 3600000, then floored to hour start
    const cutoffMs = now.getTime() - (1 + deps.l2DelayHours) * 3600000;
    const cutoff = new Date(cutoffMs);
    // Floor to hour
    cutoff.setMinutes(0, 0, 0);

    // Scan start: MAX_SCAN_DAYS ago, floored to hour
    const scanStart = new Date(now.getTime() - MAX_SCAN_DAYS * 86400000);
    scanStart.setMinutes(0, 0, 0);

    for (let h = new Date(scanStart); h <= cutoff; h = new Date(h.getTime() + 3600000)) {
      const key = toLocalHourKey(h);
      if (existingKeys.has(key)) continue;

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

      if (entries.length === 0) continue;

      const content = await summarizeLayer(deps.ollama, entries, key);

      await deps.store.put(L2_NAMESPACE as unknown as string[], key, {
        content,
        windowStart: hStart,
        windowEnd: hEnd,
        sourceCount: entries.length,
      });
    }

    // --- L3: 6-hour bucket rollup ---
    const existingL3 = await deps.store.search(L3_NAMESPACE as unknown as string[], { limit: 10000 });
    const existingL3Keys = new Set(existingL3.map((item: { key: string }) => item.key));

    // L3 cutoff: latest bucket B such that B + 6h + l3DelayHours*h <= now
    const l3CutoffMs = now.getTime() - (L3_BUCKET_MS + deps.l3DelayHours * 3600000);
    const l3Cutoff = toL3BucketStart(new Date(l3CutoffMs));

    // L3 scan start: MAX_SCAN_DAYS ago, aligned to a bucket
    const l3ScanStart = toL3BucketStart(new Date(now.getTime() - MAX_SCAN_DAYS * 86400000));

    for (let b = new Date(l3ScanStart); b <= l3Cutoff; b = new Date(b.getTime() + L3_BUCKET_MS)) {
      const bucketKey = toL3BucketKey(b);
      if (existingL3Keys.has(bucketKey)) continue;

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
        .map((item: { value: unknown }) => item.value as { content: string; windowStart: string; windowEnd: string; sourceCount: number });

      if (l2Items.length === 0) continue;

      const content = await summarizeLayer(deps.ollama, l2Items as unknown as Parameters<typeof summarizeLayer>[1], bucketKey);

      await deps.store.put(L3_NAMESPACE as unknown as string[], bucketKey, {
        content,
        windowStart: bStart,
        windowEnd: bEnd,
        sourceCount: l2Items.length,
      });
    }

    return {};
  };
}
