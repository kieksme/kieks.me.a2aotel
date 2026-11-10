import type { Trace, TraceSpan } from "./scenarios.js";

/**
 * Wandelt den gemockten Trace in das JSON-Format von OTLP um
 * (resourceSpans / scopeSpans / spans). Damit lässt er sich an einen
 * OTLP-Endpunkt schicken, z. B. POST /v1/traces.
 */

type AnyValue = { stringValue: string } | { intValue: string } | { boolValue: boolean };
type KeyValue = { key: string; value: AnyValue };

const SPAN_KIND = { SERVER: 2, CLIENT: 3 } as const;
const STATUS_ERROR = 2;

function attributes(record: Record<string, string | number | boolean>): KeyValue[] {
  return Object.entries(record).map(([key, value]) => ({
    key,
    value:
      typeof value === "number"
        ? { intValue: String(value) }
        : typeof value === "boolean"
          ? { boolValue: value }
          : { stringValue: value },
  }));
}

/** Millisekunden als Nanosekunden-String, wie OTLP-JSON es verlangt. */
const nanos = (ms: number) => `${Math.round(ms)}000000`;

function span(trace: Trace, s: TraceSpan) {
  const denied = s.decision === "denied";
  return {
    traceId: trace.traceId,
    spanId: s.spanId,
    ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
    name: s.name,
    kind: SPAN_KIND[s.kind],
    startTimeUnixNano: nanos(trace.startedAt + s.start),
    endTimeUnixNano: nanos(trace.startedAt + s.end),
    attributes: attributes(s.attributes),
    events: s.events.map((event) => ({
      timeUnixNano: nanos(trace.startedAt + event.at),
      name: event.name,
      attributes: attributes(event.attributes),
    })),
    status: denied
      ? { code: STATUS_ERROR, message: String(s.attributes["app.authz.reason"] ?? "") }
      : {},
  };
}

export function toOtlpJson(trace: Trace) {
  const services = [...new Set(trace.spans.map((s) => s.service))];
  return {
    resourceSpans: services.map((service) => ({
      resource: {
        // Das Kennzeichen macht klar, dass der Trace aus der Simulation stammt.
        attributes: attributes({ "service.name": service, "app.demo.simulated": true }),
      },
      scopeSpans: [
        {
          scope: { name: "kieks.me.a2aotel-demo" },
          spans: trace.spans.filter((s) => s.service === service).map((s) => span(trace, s)),
        },
      ],
    })),
  };
}
