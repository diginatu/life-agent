import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import type { OllamaAdapter } from "../adapters/ollama.ts";
import type { CaptureResult } from "../schemas/capture.ts";
import { type SceneSummary, SceneSummarySchema } from "../schemas/summary.ts";

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

interface PreviousContext {
  imageBase64?: string;
  summary?: SceneSummary;
}

const JSON_FIELDS = `{
  "personPresent": boolean,
  "posture": string (e.g. "sitting", "standing", "lying down", "unknown"),
  "scene": string (brief description of the environment),
  "activityGuess": string or null (what the person appears to be doing),
  "confidence": number between 0 and 1
}`;

const JSON_FIELDS_WITH_TRANSITION = `{
  "personPresent": boolean,
  "posture": string (e.g. "sitting", "standing", "lying down", "unknown"),
  "scene": string (brief description of the environment),
  "activityGuess": string or null (what the person appears to be doing; you may reference what changed since the previous capture),
  "confidence": number between 0 and 1
}`;

function buildPrompt(prev: PreviousContext): string {
  const hasPrevImage = !!prev.imageBase64;
  const hasPrevSummary = !!prev.summary;
  const hasAnyPrev = hasPrevImage || hasPrevSummary;

  const parts: string[] = [];

  if (hasPrevImage) {
    parts.push(
      "You are given TWO webcam images. The FIRST image is the previous capture (~15 minutes ago). The SECOND image is the current capture. Use the previous image only as context for what changed; describe the CURRENT scene.",
    );
  } else {
    parts.push("Analyze this webcam image.");
  }

  if (hasPrevSummary) {
    const s = prev.summary!;
    parts.push(
      `\nPrevious analysis (~15 minutes ago):\n- Person present: ${s.personPresent}\n- Posture: ${s.posture}\n- Scene: ${s.scene}\n- Activity: ${s.activityGuess ?? "unknown"}\n\nUse this as context for what may have changed. Describe the CURRENT scene.`,
    );
  }

  const fields = hasAnyPrev ? JSON_FIELDS_WITH_TRANSITION : JSON_FIELDS;
  parts.push(
    `\nReturn a JSON object with exactly these fields:\n${fields}\n\nReturn ONLY the JSON object, no other text.`,
  );

  return parts.join("\n");
}

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1]!.trim();
  }
  return text.trim();
}

async function loadPreviousContext(deps: SummarizeNodeDeps): Promise<PreviousContext> {
  const now = deps.now ?? (() => new Date());
  const fileExists = deps.fileExists ?? ((p: string) => Bun.file(p).exists());
  try {
    const dateStr = now().toISOString().slice(0, 10);
    const lastEntries = await deps.fs.readLastNLinesAcrossDays(deps.logDir, dateStr, 1);
    if (lastEntries.length === 0) return {};
    const prevEntry = lastEntries[lastEntries.length - 1] as Record<string, unknown>;

    const prevSummaryResult = SceneSummarySchema.safeParse(prevEntry.summary);
    const prevSummary = prevSummaryResult.success ? prevSummaryResult.data : undefined;

    const capture = prevEntry.capture as { imagePath?: unknown } | undefined;
    const prevPath = typeof capture?.imagePath === "string" ? capture.imagePath : undefined;
    if (!prevPath) return { summary: prevSummary };
    if (!(await fileExists(prevPath))) {
      console.warn(
        `summarize: previous capture file missing, falling back to single image: ${prevPath}`,
      );
      return { summary: prevSummary };
    }
    const imageBase64 = await deps.readFileBase64(prevPath);
    return { imageBase64, summary: prevSummary };
  } catch (err) {
    console.warn(
      `summarize: failed to load previous context, falling back to single image: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {};
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
      const prev = await loadPreviousContext(deps);
      const images = prev.imageBase64 ? [prev.imageBase64, currentBase64] : [currentBase64];
      const prompt = buildPrompt(prev);
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
