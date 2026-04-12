import { ChatOllama } from "@langchain/ollama";
import { HumanMessage } from "@langchain/core/messages";

export interface OllamaAdapter {
  generate(prompt: string): Promise<string>;
  generateWithImage(prompt: string, imageBase64: string | string[]): Promise<string>;
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
      console.log(`[LLM prompt]\n${prompt}`);
      const message = new HumanMessage({ content: prompt });
      const response = await invoker.invoke([message]);
      const result = String(response.content);
      console.log(`[LLM response]\n${result}`);
      return result;
    },

    async generateWithImage(prompt, imageBase64) {
      const images = Array.isArray(imageBase64) ? imageBase64 : [imageBase64];
      console.log(`[LLM prompt] (with ${images.length} image${images.length === 1 ? "" : "s"})\n${prompt}`);
      const message = new HumanMessage({
        content: [
          { type: "text", text: prompt },
          ...images.map((b64) => ({
            type: "image_url" as const,
            image_url: `data:image/jpeg;base64,${b64}`,
          })),
        ],
      });
      const response = await invoker.invoke([message]);
      const result = String(response.content);
      console.log(`[LLM response]\n${result}`);
      return result;
    },
  };
}
