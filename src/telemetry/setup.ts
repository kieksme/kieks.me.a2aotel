import type { Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type SpanExporter,
} from "@opentelemetry/sdk-trace";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

export interface Telemetry {
  tracer: Tracer;
  shutdown(): Promise<void>;
}

// #region telemetry-setup
/**
 * Ein eigener TracerProvider pro Dienst. So trägt jeder Span den richtigen
 * Dienstnamen (service.name), auch wenn im Beispiel alles in einem Prozess läuft.
 * In Produktion läuft jeder Agent in seinem eigenen Prozess mit einem Provider.
 */
export function createTelemetry(serviceName: string, exporters: SpanExporter[]): Telemetry {
  const provider = new TracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    // SimpleSpanProcessor exportiert sofort. Gut für ein Beispiel,
    // in Produktion nimmt man den BatchSpanProcessor.
    spanProcessors: exporters.map((exporter) => new SimpleSpanProcessor({ exporter })),
  });
  return {
    tracer: provider.getTracer("kieks.me.a2aotel"),
    shutdown: () => provider.shutdown(),
  };
}
// #endregion telemetry-setup

/**
 * Wählt den Exporter über TRACE_EXPORTER:
 *   console (Standard)  Spans auf die Konsole
 *   otlp                per OTLP/HTTP, z. B. an Jaeger (OTEL_EXPORTER_OTLP_ENDPOINT)
 *   none                kein Export
 */
export function exporterFromEnv(env: NodeJS.ProcessEnv = process.env): SpanExporter | undefined {
  switch (env.TRACE_EXPORTER ?? "console") {
    case "otlp":
      return new OTLPTraceExporter();
    case "none":
      return undefined;
    case "console":
      return new ConsoleSpanExporter();
    default:
      throw new Error(`Unbekannter TRACE_EXPORTER: ${env.TRACE_EXPORTER}`);
  }
}
