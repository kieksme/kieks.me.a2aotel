import { SpanKind, SpanStatusCode, trace, type Context, type Tracer } from "@opentelemetry/api";

/** Austauschbare Modellanbindung. Jeder Anbieter implementiert nur diese Schnittstelle. */
export interface ModelProvider {
  /** Wert für gen_ai.provider.name, z. B. "ollama" oder "openai". */
  readonly providerName: string;
  readonly modelName: string;
  complete(input: { system: string; prompt: string }): Promise<string>;
}

// #region model-span
/**
 * Ruft das Modell auf und legt einen Span darum. Es werden nur Anbieter und
 * Modellname festgehalten. Prompt und Antwort kommen nicht in den Span.
 */
export async function tracedCompletion(
  tracer: Tracer,
  parent: Context,
  model: ModelProvider,
  input: { system: string; prompt: string },
): Promise<string> {
  const span = tracer.startSpan(
    `chat ${model.modelName}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": model.providerName,
        "gen_ai.request.model": model.modelName,
      },
    },
    parent,
  );
  try {
    return await model.complete(input);
  } catch (error) {
    span.recordException(error as Error);
    span.setAttribute("error.type", (error as Error).name);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
}
// #endregion model-span
