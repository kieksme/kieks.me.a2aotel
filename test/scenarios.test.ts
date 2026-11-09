import { InMemorySpanExporter, type ReadableSpan } from "@opentelemetry/sdk-trace";
import { SpanStatusCode } from "@opentelemetry/api";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fetchAgentCard, sendMessage } from "../src/a2a/client.js";
import { buildMessage } from "../src/a2a/envelope.js";
import { scenarios } from "../src/scenarios.js";
import { startSystem, type System } from "../src/system.js";

const exporter = new InMemorySpanExporter();
let system: System;

beforeAll(async () => {
  system = await startSystem({ exporters: [exporter] });
});
afterAll(() => system.stop());
beforeEach(() => exporter.reset());

const spans = () => exporter.getFinishedSpans();
const service = (span: ReadableSpan) => span.resource.attributes["service.name"];
const find = (serviceName: string, name: string) =>
  spans().find((s) => service(s) === serviceName && s.name === name);
const run = (key: string) => system.submit(scenarios[key]!.order);

function expectSingleTrace() {
  const traceIds = new Set(spans().map((s) => s.spanContext().traceId));
  expect(traceIds.size).toBe(1);
}

describe("erlaubter Aufruf", () => {
  it("liefert ein Ergebnis und einen durchgehenden Trace über alle Dienste", async () => {
    const result = await run("allowed");
    expect(result).toMatchObject({ status: "ok", data: { documentCount: 2 } });

    expectSingleTrace();
    expect(new Set(spans().map(service))).toEqual(
      new Set(["supportagent", "dokumentenagent", "dokumenten-api"]),
    );

    // Die Eltern-Kette: Supportagent -> Aufruf -> Dokumentenagent -> Dokumenten-API
    const root = find("supportagent", "invoke_agent supportagent")!;
    const call = find("supportagent", "invoke_agent dokumentenagent")!;
    const inbound = find("dokumentenagent", "invoke_agent dokumentenagent")!;
    const api = find("dokumenten-api", "documents.list")!;
    expect(call.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(inbound.parentSpanContext?.spanId).toBe(call.spanContext().spanId);
    expect(inbound.parentSpanContext?.isRemote).toBe(true);
    expect(api.parentSpanContext?.spanId).toBe(inbound.spanContext().spanId);

    expect(inbound.attributes).toMatchObject({
      "gen_ai.operation.name": "invoke_agent",
      "app.caller.agent_id": "supportagent",
      "app.authz.action": "documents.read",
      "app.authz.resource": "case-documents",
      "app.authz.decision": "allowed",
      "app.authz.reason": "rule_match",
      "app.authz.policy_version": "2026-11-09.1",
      "app.approval.ref": "FRG-2026-0001",
      "app.delegation.depth": 2,
    });
  });
});

describe("Negativfall: fremde Fall-ID", () => {
  it("wird verweigert, ist im Trace sichtbar und erreicht die Datenquelle nicht", async () => {
    const result = await run("foreign-case");
    expect(result).toMatchObject({
      status: "ok",
      data: { assessment: null, documentAccess: { status: "denied", reasonCategory: "case_mismatch" } },
    });

    expectSingleTrace();
    const inbound = find("dokumentenagent", "invoke_agent dokumentenagent")!;
    expect(inbound.attributes).toMatchObject({
      "app.authz.decision": "denied",
      "app.authz.reason": "case_mismatch",
      "error.type": "case_mismatch",
    });
    expect(inbound.status.code).toBe(SpanStatusCode.ERROR);
    expect(inbound.events.map((e) => e.name)).toContain("authz.decision");

    // Die Ablehnung ist auch auf der Aufruferseite sichtbar.
    const call = find("supportagent", "invoke_agent dokumentenagent")!;
    expect(call.attributes["app.authz.decision"]).toBe("denied");

    // Weder Datenquelle noch Modell wurden angefasst.
    expect(spans().some((s) => service(s) === "dokumenten-api")).toBe(false);
    expect(spans().some((s) => s.name.startsWith("chat "))).toBe(false);
  });
});

describe("Negativfall: dritte Delegationsstufe", () => {
  it("wird beim Supportagenten verweigert", async () => {
    const result = await run("third-level");
    expect(result).toMatchObject({
      status: "ok",
      data: { clarification: { status: "denied", reasonCategory: "delegation_depth_exceeded" } },
    });

    expectSingleTrace();
    const denied = spans().find(
      (s) => service(s) === "supportagent" && s.attributes["app.delegation.depth"] === 3,
    )!;
    expect(denied.attributes).toMatchObject({
      "app.caller.agent_id": "dokumentenagent",
      "app.authz.action": "cases.clarify",
      "app.authz.decision": "denied",
      "app.authz.reason": "delegation_depth_exceeded",
    });
    expect(denied.status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe("Dokument mit Anweisung zur Rechteausweitung", () => {
  it("markiert das Dokument und gibt es nicht ans Modell", async () => {
    const result = await run("injection");
    expect(result).toMatchObject({
      status: "ok",
      data: { documentCount: 1, ignoredDocuments: 1 },
    });
    const inbound = find("dokumentenagent", "invoke_agent dokumentenagent")!;
    expect(inbound.events.map((e) => e.name)).toContain("untrusted_content.flagged");
    const root = find("supportagent", "invoke_agent supportagent")!;
    expect(root.events.map((e) => e.name)).toContain("untrusted_content.ignored");
  });

  it("gewährt keine Rechte, die nicht in der Matrix stehen", async () => {
    // Selbst wenn ein Agent der Anweisung folgen wollte: Die Aktion steht
    // nicht in der Matrix, also wird sie verweigert.
    const card = await fetchAgentCard(system.urls.dokumentenagent);
    const result = await sendMessage(
      card,
      buildMessage(
        { action: "documents.read-all", resource: { type: "case-documents", caseId: "SUP-2026-0043" } },
        {
          callerAgentId: "supportagent",
          caseId: "SUP-2026-0043",
          delegationChain: ["sachbearbeitung", "supportagent"],
        },
      ),
    );
    expect(result).toMatchObject({ status: "denied", reasonCategory: "no_matching_rule" });
  });
});

describe("ohne Fallbezug", () => {
  it("wird abgelehnt", async () => {
    expect(await run("no-case")).toMatchObject({
      status: "denied",
      reasonCategory: "missing_case_context",
    });
  });
});

describe("Datenschutz im Trace", () => {
  it("enthält keine Fall-IDs im Klartext und keine Dokumentinhalte", async () => {
    await run("allowed");
    await run("foreign-case");
    await run("injection");
    const dump = JSON.stringify(
      spans().map((s) => ({ name: s.name, attributes: s.attributes, events: s.events })),
    );
    expect(dump).not.toMatch(/SUP-2026-/);
    expect(dump).not.toMatch(/Deployment|Admin-Rechte|ANWEISUNG/);
    expect(dump).toContain(system.pseudonymize("SUP-2026-0042"));
  });
});

describe("Agent Card", () => {
  it("liegt unter der Well-Known-Adresse und hat die Pflichtfelder", async () => {
    const card = await fetchAgentCard(system.urls.dokumentenagent);
    expect(card).toMatchObject({
      name: "Dokumentenagent",
      version: expect.any(String),
      description: expect.any(String),
      capabilities: expect.any(Object),
      defaultInputModes: expect.any(Array),
      defaultOutputModes: expect.any(Array),
    });
    expect(card.supportedInterfaces[0]?.url).toBe(system.urls.dokumentenagent);
    expect(card.skills.map((s) => s.id)).toContain("documents.read");
  });
});

describe("ungültige Eingaben", () => {
  it("beantwortet eine Nachricht ohne Aufrufkontext mit einem Fehler", async () => {
    const card = await fetchAgentCard(system.urls.dokumentenagent);
    const message = buildMessage(
      { action: "documents.read", resource: { type: "case-documents", caseId: "SUP-2026-0042" } },
      { callerAgentId: "supportagent", delegationChain: [] },
    );
    delete message.metadata;
    await expect(sendMessage(card, message)).rejects.toThrow(/-32602/);
  });
});
