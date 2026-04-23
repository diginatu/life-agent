import { HumanMessage } from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";

export interface OllamaAdapter {
  generate(prompt: string, options?: { format?: Record<string, unknown> }): Promise<string>;
  generateWithImage(prompt: string, imageBase64: string | string[]): Promise<string>;
}

export interface LlmInvoker {
  invoke(messages: unknown[], options?: Record<string, unknown>): Promise<{ content: unknown }>;
}

export function createOllamaAdapterFromConfig(config: {
  ollamaModel: string;
  ollamaBaseUrl: string;
  ollamaThink: boolean;
}, createInvoker: (fields: { model: string; baseUrl: string; think: boolean }) => LlmInvoker = (fields) =>
  new ChatOllama(fields) as unknown as LlmInvoker): OllamaAdapter {
  const llm = createInvoker({
    model: config.ollamaModel,
    baseUrl: config.ollamaBaseUrl,
    think: config.ollamaThink,
  });
  return createOllamaAdapter(llm as unknown as LlmInvoker);
}

export function createOllamaAdapter(invoker: LlmInvoker): OllamaAdapter {
  return {
    async generate(prompt, options) {
      console.log(`[LLM prompt]\n${prompt}`);
      const message = new HumanMessage({ content: prompt });
      const response = await invoker.invoke(
        [message],
        options?.format ? { format: options.format } : undefined,
      );
      const result = String(response.content);
      console.log(`[LLM response]\n${result}`);
      return result;
    },

    async generateWithImage(prompt, imageBase64) {
      const images = Array.isArray(imageBase64) ? imageBase64 : [imageBase64];
      console.log(
        `[LLM prompt] (with ${images.length} image${images.length === 1 ? "" : "s"})\n${prompt}`,
      );
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
