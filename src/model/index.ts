import { foundryModel } from "./foundry.js";
import { mockModel } from "./mock.js";
import { openAiCompatibleModel } from "./openai-compatible.js";
import type { ModelProvider } from "./provider.js";

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Umgebungsvariable ${name} fehlt`);
  return value;
}

/**
 * Wählt den Modellanbieter über MODEL_PROVIDER:
 *   mock (Standard)     ohne Modell, feste Antwort
 *   ollama              lokales Ollama über dessen OpenAI-kompatible Schnittstelle
 *   openai-compatible   beliebiger API-Anbieter mit /chat/completions
 *   foundry             Microsoft Foundry mit Entra-Anmeldung, ohne API-Key
 */
export async function modelFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<ModelProvider> {
  switch (env.MODEL_PROVIDER ?? "mock") {
    case "mock":
      return mockModel;
    case "ollama":
      return openAiCompatibleModel({
        providerName: "ollama",
        baseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
        modelName: required(env, "MODEL_NAME"),
      });
    case "openai-compatible":
      return openAiCompatibleModel({
        providerName: env.MODEL_PROVIDER_NAME ?? "openai",
        baseUrl: required(env, "MODEL_BASE_URL"),
        modelName: required(env, "MODEL_NAME"),
        apiKey: required(env, "MODEL_API_KEY"),
      });
    case "foundry":
      return foundryModel({
        projectEndpoint: required(env, "FOUNDRY_PROJECT_ENDPOINT"),
        deploymentName: required(env, "FOUNDRY_MODEL_NAME"),
      });
    default:
      throw new Error(`Unbekannter MODEL_PROVIDER: ${env.MODEL_PROVIDER}`);
  }
}

export type { ModelProvider } from "./provider.js";
