import { z } from "zod/v4";
import { StateSchema, ReducedValue } from "@langchain/langgraph";
import { CaptureResultSchema } from "./schemas/capture.ts";
import { SceneSummarySchema } from "./schemas/summary.ts";
import { ActionSelectionSchema } from "./schemas/action.ts";
import { DraftMessageSchema } from "./schemas/message.ts";

export const GraphState = new StateSchema({
  capture: CaptureResultSchema.optional(),
  summary: SceneSummarySchema.optional(),
  decision: ActionSelectionSchema.optional(),
  message: DraftMessageSchema.nullable().optional(),
  errors: new ReducedValue(z.array(z.string()).default(() => []), {
    inputSchema: z.array(z.string()),
    reducer: (current, next) => [...current, ...next],
  }),
});

export type GraphStateValue = typeof GraphState.State;
export type GraphStateUpdate = typeof GraphState.Update;
