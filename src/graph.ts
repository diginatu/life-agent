import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphState } from "./state.ts";

const helloNode: typeof GraphState.Node = (_state) => {
  return { greeting: `Hello from life-agent at ${new Date().toISOString()}` };
};

const goodbyeNode: typeof GraphState.Node = (state) => {
  return { farewell: `Goodbye! Greeted with: "${state.greeting}"` };
};

export function buildGraph() {
  return new StateGraph(GraphState)
    .addNode("hello", helloNode)
    .addNode("goodbye", goodbyeNode)
    .addEdge(START, "hello")
    .addEdge("hello", "goodbye")
    .addEdge("goodbye", END)
    .compile();
}
