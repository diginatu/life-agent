import type { OllamaAdapter } from "../adapters/ollama.ts";
import { SceneSummarySchema, type SceneSummary } from "../schemas/summary.ts";
import type { CaptureResult } from "../schemas/capture.ts";

interface SummarizeNodeDeps {
  ollama: OllamaAdapter;
  readFileBase64: (path: string) => Promise<string>;
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

function extractJson(text: string): string {
  // Strip markdown code block wrapper if present
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1]!.trim();
  }
  return text.trim();
}

export function createSummarizeNode(deps: SummarizeNodeDeps) {
  return async (state: SummarizeNodeState): Promise<SummarizeNodeResult> => {
    if (!state.capture) {
      return { errors: ["summarize: no capture data in state"] };
    }

    let rawResponse: string;
    try {
      const imageBase64 = await deps.readFileBase64(state.capture.imagePath);
      rawResponse = await deps.ollama.generateWithImage(
        SUMMARIZE_PROMPT,
        imageBase64,
      );
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
