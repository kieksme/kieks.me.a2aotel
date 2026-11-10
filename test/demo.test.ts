import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toOtlpJson } from "../demo/src/otlp.js";
import { parseRegions } from "../demo/src/regions.js";
import {
  buildRun,
  FILE_PATHS,
  materialize,
  POLICY_VERSION,
  type FileId,
  type ScenarioId,
} from "../demo/src/scenarios.js";
import { loadMatrix } from "../src/authz/policy.js";

const ids: ScenarioId[] = ["allowed", "foreign-case", "third-level", "injection", "no-case"];
const regions = Object.fromEntries(
  (Object.keys(FILE_PATHS) as FileId[]).map((file) => [
    file,
    parseRegions(readFileSync(new URL(`../${FILE_PATHS[file]}`, import.meta.url), "utf8")),
  ]),
);

describe("Demo-Szenarien", () => {
  it.each(ids)("%s: Schritte, Spans und Code-Stellen passen zusammen", (id) => {
    for (const wrapper of [true, false]) {
      const run = buildRun(id, wrapper);
      const keys = new Set(run.spans.map((s) => s.key));
      expect(keys.size).toBe(run.spans.length);

      for (const span of run.spans) {
        if (span.parent) expect(keys).toContain(span.parent);
        expect(span.end).toBeGreaterThan(span.start);
      }
      for (const step of run.steps) {
        for (const key of [...(step.reveal ?? []), ...(step.settle ?? [])]) {
          expect(keys).toContain(key);
        }
        // Jede markierte Code-Stelle muss es im echten Quelltext geben.
        if (step.code) {
          expect(regions[step.code.file]!.has(step.code.region), JSON.stringify(step.code)).toBe(true);
        }
      }
      // Jeder Span wird im Ablauf auch gezeigt.
      const revealed = new Set(run.steps.flatMap((s) => s.reveal ?? []));
      expect(revealed).toEqual(keys);
    }
  });

  it("ohne Wrapper gibt es keine Spans", () => {
    for (const id of ids) expect(buildRun(id, false).spans).toHaveLength(0);
  });

  it("mit Wrapper werden die Negativfälle verweigert", () => {
    const denied = (id: ScenarioId) =>
      buildRun(id, true)
        .spans.filter((s) => s.decision === "denied" && s.kind === "SERVER")
        .map((s) => s.attributes["app.authz.reason"]);
    expect(denied("allowed")).toEqual([]);
    expect(denied("foreign-case")).toEqual(["case_mismatch"]);
    expect(denied("third-level")).toEqual(["delegation_depth_exceeded"]);
    expect(denied("no-case")).toEqual(["missing_case_context"]);
    // Bei einer fremden Fall-ID wird die Datenquelle nicht erreicht.
    expect(buildRun("foreign-case", true).spans.some((s) => s.service === "dokumenten-api")).toBe(false);
  });

  it("nutzt dieselbe Regelversion wie die echte Matrix", () => {
    expect(POLICY_VERSION).toBe(loadMatrix().version);
  });
});

describe("Trace-Export", () => {
  const trace = materialize(buildRun("third-level", true), 1_700_000_000_000);
  const otlp = toOtlpJson(trace);
  const spans = otlp.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans));

  it("hat das OTLP-Format mit einem Eintrag pro Dienst", () => {
    expect(otlp.resourceSpans).toHaveLength(3);
    expect(spans).toHaveLength(trace.spans.length);
    for (const span of spans) {
      expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(BigInt(span.endTimeUnixNano)).toBeGreaterThan(BigInt(span.startTimeUnixNano));
    }
    expect(new Set(spans.map((s) => s.traceId)).size).toBe(1);
  });

  it("verknüpft Kinder mit ihren Eltern und markiert Ablehnungen als Fehler", () => {
    const spanIds = new Set(spans.map((s) => s.spanId));
    const roots = spans.filter((s) => !("parentSpanId" in s));
    expect(roots).toHaveLength(1);
    for (const span of spans) {
      if ("parentSpanId" in span) expect(spanIds).toContain(span.parentSpanId);
    }
    const errors = spans.filter((s) => "code" in s.status && s.status.code === 2);
    expect(errors).toHaveLength(2);
  });

  it("enthält keine Fall-IDs im Klartext und ist als Simulation gekennzeichnet", () => {
    const text = JSON.stringify(otlp);
    expect(text).not.toMatch(/SUP-2026-/);
    expect(text).toContain("app.demo.simulated");
  });
});
