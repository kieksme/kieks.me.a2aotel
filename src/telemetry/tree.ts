import { hrTimeToMilliseconds } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

/** Gibt die Spans eines Laufs als eingerückten Baum aus, ähnlich einem Waterfall. */
export function formatTraceTree(spans: ReadableSpan[]): string {
  const ids = new Set(spans.map((s) => s.spanContext().spanId));
  const childrenOf = (parentId?: string) =>
    spans
      .filter((s) =>
        parentId ? s.parentSpanContext?.spanId === parentId : !ids.has(s.parentSpanContext?.spanId ?? ""),
      )
      .sort((a, b) => hrTimeToMilliseconds(a.startTime) - hrTimeToMilliseconds(b.startTime));

  const lines: string[] = [];
  const walk = (span: ReadableSpan, depth: number) => {
    const decision = span.attributes["app.authz.decision"];
    const reason = span.attributes["app.authz.reason"];
    const mark = decision === "denied" ? "✗" : "✓";
    lines.push(
      `${"  ".repeat(depth)}${mark} [${span.resource.attributes[ATTR_SERVICE_NAME]}] ${span.name}` +
        ` (${hrTimeToMilliseconds(span.duration).toFixed(1)} ms)` +
        (decision ? ` ${decision}${reason ? `: ${reason}` : ""}` : ""),
    );
    for (const child of childrenOf(span.spanContext().spanId)) walk(child, depth + 1);
  };
  for (const root of childrenOf()) {
    lines.push(`Trace-ID ${root.spanContext().traceId}`);
    walk(root, 0);
  }
  return lines.join("\n");
}
