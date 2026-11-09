import type { ModelProvider } from "./provider.js";

/**
 * Anbieter mit OpenAI-kompatibler Schnittstelle (/chat/completions).
 * Deckt ein lokales Ollama (http://localhost:11434/v1) und API-Anbieter ab.
 * Ein API-Key kommt nur aus der Umgebung und wird nie protokolliert.
 */
export function openAiCompatibleModel(options: {
  providerName: string;
  baseUrl: string;
  modelName: string;
  apiKey?: string;
}): ModelProvider {
  return {
    providerName: options.providerName,
    modelName: options.modelName,
    async complete({ system, prompt }) {
      const response = await fetch(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: options.modelName,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`Modellaufruf fehlgeschlagen (HTTP ${response.status})`);
      }
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return body.choices?.[0]?.message?.content ?? "";
    },
  };
}
