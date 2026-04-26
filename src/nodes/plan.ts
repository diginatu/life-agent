import type { BaseStore } from "@langchain/langgraph";
import { z } from "zod/v4";
import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import type { OllamaAdapter } from "../adapters/ollama.ts";
import type { Config } from "../config.ts";
import type { Plan } from "../schemas/plan.ts";
import { PlanSchema } from "../schemas/plan.ts";
import type { SceneSummary } from "../schemas/summary.ts";
import { formatTime } from "./format-time.ts";
import { formatUserFeedback, type UserFeedbackEntry } from "./history-format.ts";
import { formatMemoryContext, loadMemoryContext } from "./memory-context.ts";

const PLAN_NAMESPACE = ["memory", "plan"] as const;
const PLAN_KEY = "current";
const PLAN_TTL_MS = 24 * 60 * 60 * 1000;

interface PlanNodeDeps {
  ollama: OllamaAdapter;
  actionsConfig: Config;
  fs?: FilesystemAdapter;
  logDir?: string;
  store?: BaseStore;
  l2DelayHours?: number;
  now?: () => Date;
}

interface PlanNodeState {
  summary?: SceneSummary;
  userFeedback?: UserFeedbackEntry[];
}

interface PlanNodeResult {
  plan?: Plan;
  errors?: string[];
}

const PlanDraftSchema = z.object({
  items: PlanSchema.shape.items,
});

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1]!.trim();
  }
  return text.trim();
}

function isPlanFresh(plan: Plan, now: Date): boolean {
  const validUntil = new Date(plan.validUntil);
  if (Number.isNaN(validUntil.getTime())) return false;
  return now.getTime() < validUntil.getTime();
}

function buildPrompt(
  summary: SceneSummary,
  actionsConfig: Config,
  currentTime: Date,
  memorySection: string,
  userFeedback?: UserFeedbackEntry[],
): string {
  const allActions = actionsConfig.getActionNames();
  const actionDescriptions = allActions
    .map((a) => {
      const desc = actionsConfig.getDescription(a);
      return desc ? `  - ${a}: ${desc}` : `  - ${a}`;
    })
    .join("\n");

  const historySections = formatUserFeedback(userFeedback, currentTime) + memorySection;

  return `You are a personal assistant. Create a practical plan for the next 24 hours.
The plan should describe likely timings and actions the assistant will take over the next day.
Use current scene context, user feedback, and memory to keep it realistic and useful.

Scene analysis:
- Person present: ${summary.personPresent}
- Posture: ${summary.posture}
- Scene: ${summary.scene}
- Activity: ${summary.activityGuess ?? "unknown"}
- Confidence: ${summary.confidence}

Current time:
- ${formatTime(currentTime)}

${historySections}

Available actions:
${actionDescriptions}

Rules:
- Use only actions from the available actions list.
- Include concrete, time-oriented items for the next 24 hours.
- Keep the plan concise and actionable.

Return a JSON object with exactly these fields:
{
  "items": [
    {
      "time": string,
      "action": one of ${JSON.stringify(allActions)},
      "reason": string
    }
  ]
}

Return ONLY the JSON object, no other text.`;
}

export function createPlanNode(deps: PlanNodeDeps) {
  return async (state: PlanNodeState): Promise<PlanNodeResult> => {
    const now = deps.now ?? (() => new Date());
    const currentTime = now();

    const stored = deps.store
      ? await deps.store.get(PLAN_NAMESPACE as unknown as string[], PLAN_KEY)
      : null;
    const parsedStored = PlanSchema.safeParse(stored?.value);
    const cachedPlan = parsedStored.success ? parsedStored.data : undefined;

    if (cachedPlan && isPlanFresh(cachedPlan, currentTime)) {
      return { plan: cachedPlan };
    }

    if (!state.summary) {
      return {
        plan: cachedPlan,
        errors: ["plan: no summary data in state and no fresh cached plan"],
      };
    }

    const memory = await loadMemoryContext({
      store: deps.store,
      fs: deps.fs,
      logDir: deps.logDir,
      l2DelayHours: deps.l2DelayHours,
      now,
    });

    const prompt = buildPrompt(
      state.summary,
      deps.actionsConfig,
      currentTime,
      formatMemoryContext(memory, currentTime),
      state.userFeedback,
    );

    let rawResponse: string;
    try {
      rawResponse = await deps.ollama.generate(prompt);
    } catch (err) {
      const msg = `plan: ollama error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg);
      return { plan: cachedPlan, errors: [msg] };
    }

    const jsonStr = extractJson(rawResponse);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      const msg = `plan: failed to parse JSON from ollama response: ${jsonStr.slice(0, 200)}`;
      console.error(msg);
      return { plan: cachedPlan, errors: [msg] };
    }

    const result = PlanDraftSchema.safeParse(parsed);
    if (!result.success) {
      const msg = `plan: schema validation failed: ${JSON.stringify(result.error.issues)}`;
      console.error(msg);
      return { plan: cachedPlan, errors: [msg] };
    }

    const generatedAt = currentTime.toISOString();
    const validUntil = new Date(currentTime.getTime() + PLAN_TTL_MS).toISOString();
    const plan: Plan = {
      generatedAt,
      validUntil,
      items: result.data.items,
    };

    if (deps.store) {
      await deps.store.put(PLAN_NAMESPACE as unknown as string[], PLAN_KEY, plan);
    }

    return { plan };
  };
}
