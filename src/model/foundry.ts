import type { ModelProvider } from "./provider.js";

/**
 * Optionale Variante: Microsoft Foundry mit Anmeldung über Microsoft Entra ID.
 * Es gibt keinen API-Key. DefaultAzureCredential nutzt z. B. die Anmeldung
 * aus `az login` oder eine Managed Identity.
 *
 * Voraussetzung: Rolle "Foundry User" auf dem Foundry-Projekt.
 * Die Pakete sind optionale Abhängigkeiten und werden erst hier geladen.
 */
export async function foundryModel(options: {
  projectEndpoint: string;
  deploymentName: string;
}): Promise<ModelProvider> {
  const { AIProjectClient } = await import("@azure/ai-projects");
  const { DefaultAzureCredential } = await import("@azure/identity");

  const project = new AIProjectClient(options.projectEndpoint, new DefaultAzureCredential());
  const openAIClient = project.getOpenAIClient();

  return {
    // Annahme: Der Aufruf läuft über den OpenAI-Client des Foundry-Projekts.
    providerName: "azure.ai.openai",
    modelName: options.deploymentName,
    async complete({ system, prompt }) {
      const response = await openAIClient.responses.create({
        model: options.deploymentName,
        instructions: system,
        input: prompt,
      });
      return response.output_text;
    },
  };
}
