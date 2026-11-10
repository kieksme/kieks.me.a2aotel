import type { ModelProvider } from "./provider.js";

/**
 * Standard-Anbieter: antwortet fest und ohne Netzwerk.
 * Damit laufen Beispiel, Tests und CI ohne Modell und ohne Kosten.
 */
export const mockModel: ModelProvider = {
  providerName: "mock",
  modelName: "mock-model",
  async complete({ prompt }) {
    const documents = prompt.split("\n").filter((line) => line.startsWith("- ")).length;
    return `Einschätzung auf Basis von ${documents} Dokument(en): Der Fall kann bearbeitet werden.`;
  },
};
