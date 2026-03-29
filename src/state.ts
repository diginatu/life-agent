import { z } from "zod/v4";
import { StateSchema, ReducedValue } from "@langchain/langgraph";

export const GraphState = new StateSchema({
  greeting: z.string().default(""),
  farewell: z.string().default(""),
  errors: new ReducedValue(z.array(z.string()).default(() => []), {
    inputSchema: z.array(z.string()),
    reducer: (current, next) => [...current, ...next],
  }),
});

export type GraphStateValue = typeof GraphState.State;
export type GraphStateUpdate = typeof GraphState.Update;
