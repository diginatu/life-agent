import type { OllamaAdapter } from "../adapters/ollama.ts";
import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import { SceneSummarySchema, type SceneSummary } from "../schemas/summary.ts";
import type { CaptureResult } from "../schemas/capture.ts";

interface SummarizeNodeDeps {
  ollama: OllamaAdapter;
  readFileBase64: (path: string) => Promise<string>;
  fs: FilesystemAdapter;
  logDir: string;
  now?: () => Date;
  fileExists?: (path: string) => Promise<boolean>;
}

interface SummarizeNodeState {
  capture?: CaptureResult;
}

interface SummarizeNodeResult {
  summary?: SceneSummary;
  errors?: string[];
}

const SUMMARIZE_PROMPT = `Analyze this webcam image and return a JSON object with exactly these fields:
{
  "personPresent": boolean,
  "posture": string (e.g. "sitting", "standing", "lying down", "unknown"),
  "scene": string (brief description of the environment),
  "activityGuess": string or null (what the person appears to be doing),
  "confidence": number between 0 and 1
}

Return ONLY the JSON object, no other text.`;

const SUMMARIZE_PROMPT_WITH_PREVIOUS = `You are given TWO webcam images. The FIRST image is the previous capture (~15 minutes ago). The SECOND image is the current capture. Use the previous image only as context for what changed; describe the CURRENT scene.

Return a JSON object with exactly these fields:
{
  "personPresent": boolean,
  "posture": string (e.g. "sitting", "standing", "lying down", "unknown"),
  "scene": string (brief description of the environment),
  "activityGuess": string or null (what the person appears to be doing; you may reference what changed since the previous image),
  "confidence": number between 0 and 1
}

Return ONLY the JSON object, no other text.`;

function extractJson(text: string): string {
  // Strip markdown code block wrapper if present
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1]!.trim();
  }
  return text.trim();
}

async function loadPreviousCaptureBase64(
  deps: SummarizeNodeDeps,
): Promise<string | undefined> {
  const now = deps.now ?? (() => new Date());
  const fileExists = deps.fileExists ?? ((p: string) => Bun.file(p).exists());
  try {
    const dateStr = now().toISOString().slice(0, 10);
    const lastEntries = await deps.fs.readLastNLines(deps.logDir, dateStr, 1);
    if (lastEntries.length === 0) return undefined;
    const prevEntry = lastEntries[lastEntries.length - 1] as Record<string, unknown>;
    const capture = prevEntry.capture as { imagePath?: unknown } | undefined;
    const prevPath = typeof capture?.imagePath === "string" ? capture.imagePath : undefined;
    if (!prevPath) return undefined;
    if (!(await fileExists(prevPath))) {
      console.warn(`summarize: previous capture file missing, falling back to single image: ${prevPath}`);
      return undefined;
    }
    return await deps.readFileBase64(prevPath);
  } catch (err) {
    console.warn(
      `summarize: failed to load previous capture, falling back to single image: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

export function createSummarizeNode(deps: SummarizeNodeDeps) {
  return async (state: SummarizeNodeState): Promise<SummarizeNodeResult> => {
    if (!state.capture) {
      return { errors: ["summarize: no capture data in state"] };
    }

    let rawResponse: string;
    try {
      const currentBase64 = await deps.readFileBase64(state.capture.imagePath);
      const previousBase64 = await loadPreviousCaptureBase64(deps);
      const images = previousBase64
        ? [previousBase64, currentBase64]
        : [currentBase64];
      const prompt = previousBase64 ? SUMMARIZE_PROMPT_WITH_PREVIOUS : SUMMARIZE_PROMPT;
      rawResponse = await deps.ollama.generateWithImage(prompt, images);
    } catch (err) {
      const msg = `summarize: ollama error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg);
      return { errors: [msg] };
    }

    const jsonStr = extractJson(rawResponse);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      const msg = `summarize: failed to parse JSON from ollama response: ${jsonStr.slice(0, 200)}`;
      console.error(msg);
      return { errors: [msg] };
    }

    const result = SceneSummarySchema.safeParse(parsed);
    if (!result.success) {
      const msg = `summarize: schema validation failed: ${JSON.stringify(result.error.issues)}`;
      console.error(msg);
      return { errors: [msg] };
    }

    return { summary: result.data };
  };
}
