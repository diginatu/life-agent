import { ChatOllama } from "@langchain/ollama";
import { HumanMessage } from "@langchain/core/messages";

export interface OllamaAdapter {
  generate(prompt: string): Promise<string>;
  generateWithImage(prompt: string, imageBase64: string): Promise<string>;
}

export interface LlmInvoker {
  invoke(messages: unknown[]): Promise<{ content: unknown }>;
}

export function createOllamaAdapterFromConfig(config: {
  ollamaModel: string;
  ollamaBaseUrl: string;
}): OllamaAdapter {
  const llm = new ChatOllama({
    model: config.ollamaModel,
    baseUrl: config.ollamaBaseUrl,
  });
  return createOllamaAdapter(llm as unknown as LlmInvoker);
}

export function createOllamaAdapter(invoker: LlmInvoker): OllamaAdapter {
  return {
    async generate(prompt) {
      const message = new HumanMessage({ content: prompt });
      const response = await invoker.invoke([message]);
      return String(response.content);
    },

    async generateWithImage(prompt, imageBase64) {
      const message = new HumanMessage({
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: `data:image/jpeg;base64,${imageBase64}`,
          },
        ],
      });
      const response = await invoker.invoke([message]);
      return String(response.content);
    },
  };
}
