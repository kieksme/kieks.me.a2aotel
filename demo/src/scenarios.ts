/**
 * Gemockte Szenarien der Demo. Hier laufen keine Agenten: Schritte und
 * Spans sind fest hinterlegt und orientieren sich am echten Beispiel in src/.
 * Dieses Modul kommt ohne DOM aus und wird von den Tests mitgeprüft.
 */

import type { MessageKey } from "./i18n/de.js";

export type ServiceId = "supportagent" | "dokumentenagent" | "dokumenten-api";
export type NodeId = "sachbearbeitung" | ServiceId;
export type EdgeId = "order" | "a2a" | "back" | "data";
export type FlowRef = { type: "node"; id: NodeId } | { type: "edge"; id: EdgeId };
export type FileId = "supportagent" | "dokumentenagent" | "wrapper" | "policy" | "matrix" | "setup";
/** Pfade der angezeigten Dateien im Repository. */
export const FILE_PATHS: Record<FileId, string> = {
  supportagent: "src/agents/supportagent.ts",
  dokumentenagent: "src/agents/dokumentenagent.ts",
  wrapper: "src/telemetry/wrapper.ts",
  policy: "src/authz/policy.ts",
  matrix: "src/authz/matrix.json",
  setup: "src/telemetry/setup.ts",
};

export type ScenarioId = "allowed" | "foreign-case" | "third-level" | "injection" | "no-case";
export type Decision = "allowed" | "denied";

export interface SpanDef {
  key: string;
  name: string;
  service: ServiceId;
  parent?: string;
  /** Start und Ende in Millisekunden ab Trace-Beginn. */
  start: number;
  end: number;
  kind: "SERVER" | "CLIENT";
  decision?: Decision;
  attributes: Record<string, string | number>;
  events: { name: string; at: number; attributes: Record<string, string | number> }[];
  /** Zu welchem Teil der Flow-Grafik der Span gehört. */
  flow: FlowRef;
}

export interface StepDef {
  kind: "send" | "check" | "work" | "data" | "flag";
  /** Schlüssel des Textes in den Übersetzungen. */
  text: MessageKey;
  edge?: EdgeId;
  reverse?: boolean;
  node?: NodeId;
  tone?: "request" | "result" | "denied" | "leak";
  result?: Decision;
  /** Kante, die bei einer Ablehnung als verweigert markiert wird. */
  denyEdge?: EdgeId;
  code?: { file: FileId; region: string };
  /** Spans, die mit diesem Schritt im Trace erscheinen. */
  reveal?: string[];
  /** Spans, deren Entscheidung mit diesem Schritt feststeht. */
  settle?: string[];
}

export interface Outcome {
  kind: "ok" | "denied" | "ignored" | "leak" | "untraced";
  title: MessageKey;
  text: MessageKey;
}

export interface ScenarioRun {
  id: ScenarioId;
  wrapper: boolean;
  steps: StepDef[];
  spans: SpanDef[];
  outcome: Outcome;
}

export interface ScenarioInfo {
  id: ScenarioId;
  title: MessageKey;
  /** Die vorgefertigte Nachricht zum Anklicken. */
  message: MessageKey;
  hint: MessageKey;
}

export const scenarioList: ScenarioInfo[] = [
  {
    id: "allowed",
    title: "sc.allowed.title",
    message: "sc.allowed.message",
    hint: "sc.allowed.hint",
  },
  {
    id: "foreign-case",
    title: "sc.foreign.title",
    message: "sc.foreign.message",
    hint: "sc.foreign.hint",
  },
  {
    id: "third-level",
    title: "sc.third.title",
    message: "sc.third.message",
    hint: "sc.third.hint",
  },
  {
    id: "injection",
    title: "sc.injection.title",
    message: "sc.injection.message",
    hint: "sc.injection.hint",
  },
];

/** Regelversion und Freigabereferenz wie im echten Beispiel. */
export const POLICY_VERSION = "2026-11-09.1";
const APPROVAL = "FRG-2026-0001";

/** Pseudonymisierte Fallreferenzen. Im Trace steht nie die echte Fall-ID. */
const CASE_REF: Record<string, string> = {
  "0042": "case_7386c99320fd",
  "0043": "case_c41e09ab57d2",
  "0099": "case_1f0b6c2d9a44",
};

function invokeSpan(o: {
  key: string;
  parent?: string;
  service: ServiceId;
  target: ServiceId;
  caller: string;
  kind: "SERVER" | "CLIENT";
  action: string;
  resource: string;
  caseKey: string;
  depth: number;
  start: number;
  end: number;
  decision: Decision;
  reason?: string;
  flow: FlowRef;
  events?: SpanDef["events"];
}): SpanDef {
  const attributes: Record<string, string | number> = {
    "gen_ai.operation.name": "invoke_agent",
    "gen_ai.agent.id": o.target,
    "gen_ai.agent.name": o.target,
    "app.caller.agent_id": o.caller,
    "app.target.agent_id": o.target,
    "app.authz.action": o.action,
    "app.authz.resource": o.resource,
    "app.case.ref": CASE_REF[o.caseKey]!,
    "app.delegation.depth": o.depth,
    "app.approval.ref": APPROVAL,
    "app.authz.decision": o.decision,
  };
  if (o.reason) {
    attributes["app.authz.reason"] = o.reason;
    attributes["app.authz.policy_version"] = POLICY_VERSION;
  }
  if (o.decision === "denied" && o.reason) attributes["error.type"] = o.reason;

  const events = [...(o.events ?? [])];
  if (o.kind === "SERVER" && o.reason) {
    events.unshift({
      name: "authz.decision",
      at: o.start + 1,
      attributes: { "app.authz.decision": o.decision, "app.authz.reason": o.reason },
    });
  }
  return {
    key: o.key,
    name: `invoke_agent ${o.target}`,
    service: o.service,
    parent: o.parent,
    start: o.start,
    end: o.end,
    kind: o.kind,
    decision: o.decision,
    attributes,
    events,
    flow: o.flow,
  };
}

const node = (id: NodeId): FlowRef => ({ type: "node", id });
const edge = (id: EdgeId): FlowRef => ({ type: "edge", id });

/** Wurzel-Span: der Auftrag kommt beim Supportagenten an. */
function rootSpan(caseKey: string, end: number, o: Partial<Parameters<typeof invokeSpan>[0]> = {}) {
  return invokeSpan({
    key: "root",
    service: "supportagent",
    target: "supportagent",
    caller: "sachbearbeitung",
    kind: "SERVER",
    action: "cases.assess",
    resource: "support-case",
    caseKey,
    depth: 1,
    start: 0,
    end,
    decision: "allowed",
    reason: "rule_match",
    flow: node("supportagent"),
    ...o,
  });
}

/** Aufruf des Dokumentenagenten: Client-Span (Kante) und Server-Span (Agent). */
function documentCall(o: {
  caseKey: string;
  action?: string;
  end: number;
  decision: Decision;
  reason: string;
  events?: SpanDef["events"];
}): SpanDef[] {
  const action = o.action ?? "documents.read";
  const base = {
    target: "dokumentenagent" as const,
    caller: "supportagent",
    action,
    resource: "case-documents",
    caseKey: o.caseKey,
    depth: 2,
    decision: o.decision,
  };
  return [
    invokeSpan({
      ...base,
      key: "call",
      parent: "root",
      service: "supportagent",
      kind: "CLIENT",
      start: 12,
      end: o.end + 8,
      reason: o.decision === "denied" ? o.reason : undefined,
      flow: edge("a2a"),
    }),
    invokeSpan({
      ...base,
      key: "inbound",
      parent: "call",
      service: "dokumentenagent",
      kind: "SERVER",
      start: 20,
      end: o.end,
      reason: o.reason,
      flow: node("dokumentenagent"),
      events: o.events,
    }),
  ];
}

const apiSpan = (caseKey: string, count: number): SpanDef => ({
  key: "api",
  name: "documents.list",
  service: "dokumenten-api",
  parent: "inbound",
  start: 30,
  end: 62,
  kind: "SERVER",
  attributes: {
    "app.authz.resource": "case-documents",
    "app.case.ref": CASE_REF[caseKey]!,
    "app.documents.count": count,
  },
  events: [],
  flow: node("dokumenten-api"),
});

const modelSpan = (start: number, end: number): SpanDef => ({
  key: "model",
  name: "chat mock-model",
  service: "supportagent",
  parent: "root",
  start,
  end,
  kind: "CLIENT",
  attributes: {
    "gen_ai.operation.name": "chat",
    "gen_ai.provider.name": "mock",
    "gen_ai.request.model": "mock-model",
  },
  events: [],
  flow: node("supportagent"),
});

// --- Schritte, die in mehreren Szenarien vorkommen -------------------------

const orderIn = (text: MessageKey): StepDef => ({ kind: "send", edge: "order", tone: "request", text });

const rootCheck: StepDef[] = [
  {
    kind: "check",
    node: "supportagent",
    text: "st.rootSpan",
    code: { file: "wrapper", region: "span-start" },
    reveal: ["root"],
  },
  {
    kind: "check",
    node: "supportagent",
    result: "allowed",
    text: "st.rootAllowed",
    code: { file: "policy", region: "authz-rule" },
    settle: ["root"],
  },
];

const toDocuments: StepDef[] = [
  {
    kind: "work",
    node: "supportagent",
    text: "st.needDocs",
    code: { file: "supportagent", region: "call-documents" },
  },
  {
    kind: "send",
    edge: "a2a",
    tone: "request",
    text: "st.callDocs",
    code: { file: "wrapper", region: "trace-inject" },
    reveal: ["call"],
  },
  {
    kind: "check",
    node: "dokumentenagent",
    text: "st.docsExtract",
    code: { file: "wrapper", region: "trace-extract" },
    reveal: ["inbound"],
  },
];

const documentsAllowed: StepDef = {
  kind: "check",
  node: "dokumentenagent",
  result: "allowed",
  text: "st.docsAllowed",
  code: { file: "policy", region: "authz-case" },
  settle: ["inbound"],
};

const readData: StepDef = {
  kind: "data",
  edge: "data",
  text: "st.readData",
  code: { file: "dokumentenagent", region: "read-documents" },
  reveal: ["api"],
  settle: ["api"],
};

const documentsBack: StepDef = {
  kind: "send",
  edge: "a2a",
  reverse: true,
  tone: "result",
  text: "st.docsBack",
  code: { file: "wrapper", region: "agent-run" },
  settle: ["call"],
};

const callModel: StepDef = {
  kind: "work",
  node: "supportagent",
  text: "st.callModel",
  code: { file: "supportagent", region: "call-model" },
  reveal: ["model"],
  settle: ["model"],
};

const orderOut = (text: MessageKey, tone: StepDef["tone"] = "result"): StepDef => ({
  kind: "send",
  edge: "order",
  reverse: true,
  tone,
  text,
});

// --- Szenarien mit Wrapper -------------------------------------------------

function withWrapper(id: ScenarioId): Omit<ScenarioRun, "id" | "wrapper"> {
  switch (id) {
    case "allowed":
      return {
        steps: [
          orderIn("st.allowed.in"),
          ...rootCheck,
          ...toDocuments,
          documentsAllowed,
          readData,
          documentsBack,
          callModel,
          orderOut("st.allowed.out"),
        ],
        spans: [
          rootSpan("0042", 182),
          ...documentCall({ caseKey: "0042", end: 88, decision: "allowed", reason: "rule_match" }),
          apiSpan("0042", 2),
          modelSpan(104, 176),
        ],
        outcome: {
          kind: "ok",
          title: "out.allowed.title",
          text: "out.allowed.text",
        },
      };

    case "foreign-case":
      return {
        steps: [
          orderIn("st.order0042"),
          ...rootCheck,
          {
            ...toDocuments[0]!,
            text: "st.foreign.ask",
          },
          ...toDocuments.slice(1),
          {
            kind: "check",
            node: "dokumentenagent",
            result: "denied",
            denyEdge: "a2a",
            text: "st.foreign.denied",
            code: { file: "policy", region: "authz-case" },
            settle: ["inbound"],
          },
          {
            kind: "send",
            edge: "a2a",
            reverse: true,
            tone: "denied",
            text: "st.foreign.back",
            code: { file: "wrapper", region: "authz-enforce" },
            settle: ["call"],
          },
          {
            kind: "work",
            node: "supportagent",
            text: "st.foreign.report",
            code: { file: "supportagent", region: "handle-denied" },
          },
          orderOut("st.foreign.out", "denied"),
        ],
        spans: [
          rootSpan("0042", 58),
          ...documentCall({ caseKey: "0099", end: 24, decision: "denied", reason: "case_mismatch" }),
        ],
        outcome: {
          kind: "denied",
          title: "out.denied.title",
          text: "out.foreign.text",
        },
      };

    case "third-level":
      return {
        steps: [
          orderIn("st.third.in"),
          ...rootCheck,
          ...toDocuments.map((s, i): StepDef =>
            i === 1 ? { ...s, text: "st.third.call" } : s,
          ),
          documentsAllowed,
          readData,
          {
            kind: "send",
            edge: "back",
            tone: "request",
            text: "st.third.clarify",
            code: { file: "dokumentenagent", region: "clarify" },
            reveal: ["clarify-call"],
          },
          {
            kind: "check",
            node: "supportagent",
            result: "denied",
            denyEdge: "back",
            text: "st.third.denied",
            code: { file: "policy", region: "authz-depth" },
            reveal: ["clarify-inbound"],
            settle: ["clarify-inbound", "clarify-call"],
          },
          {
            ...documentsBack,
            text: "st.third.back",
          },
          callModel,
          orderOut("st.third.out"),
        ],
        spans: [
          rootSpan("0042", 210),
          ...documentCall({
            caseKey: "0042",
            action: "documents.verify",
            end: 120,
            decision: "allowed",
            reason: "rule_match",
          }),
          apiSpan("0042", 2),
          invokeSpan({
            key: "clarify-call",
            parent: "inbound",
            service: "dokumentenagent",
            target: "supportagent",
            caller: "dokumentenagent",
            kind: "CLIENT",
            action: "cases.clarify",
            resource: "support-case",
            caseKey: "0042",
            depth: 3,
            start: 70,
            end: 112,
            decision: "denied",
            reason: "delegation_depth_exceeded",
            flow: edge("back"),
          }),
          invokeSpan({
            key: "clarify-inbound",
            parent: "clarify-call",
            service: "supportagent",
            target: "supportagent",
            caller: "dokumentenagent",
            kind: "SERVER",
            action: "cases.clarify",
            resource: "support-case",
            caseKey: "0042",
            depth: 3,
            start: 78,
            end: 82,
            decision: "denied",
            reason: "delegation_depth_exceeded",
            flow: node("supportagent"),
          }),
          modelSpan(136, 204),
        ],
        outcome: {
          kind: "denied",
          title: "out.third.title",
          text: "out.third.text",
        },
      };

    case "injection":
      return {
        steps: [
          orderIn("st.order0043"),
          ...rootCheck,
          ...toDocuments,
          documentsAllowed,
          readData,
          {
            kind: "flag",
            node: "dokumentenagent",
            text: "st.inj.flag",
            code: { file: "dokumentenagent", region: "flag-untrusted" },
          },
          documentsBack,
          {
            kind: "flag",
            node: "supportagent",
            text: "st.inj.ignore",
            code: { file: "supportagent", region: "ignore-untrusted" },
          },
          callModel,
          orderOut("st.inj.out"),
        ],
        spans: [
          rootSpan("0043", 182, {
            events: [
              { name: "untrusted_content.ignored", at: 100, attributes: { "app.documents.ignored": 1 } },
            ],
          }),
          ...documentCall({
            caseKey: "0043",
            end: 88,
            decision: "allowed",
            reason: "rule_match",
            events: [
              { name: "untrusted_content.flagged", at: 66, attributes: { "app.document.id": "doc-0043-2" } },
            ],
          }),
          apiSpan("0043", 2),
          modelSpan(104, 176),
        ],
        outcome: {
          kind: "ignored",
          title: "out.inj.title",
          text: "out.inj.text",
        },
      };

    case "no-case":
      return {
        steps: [
          orderIn("st.nocase.in"),
          { ...rootCheck[0]! },
          {
            kind: "check",
            node: "supportagent",
            result: "denied",
            denyEdge: "order",
            text: "st.nocase.denied",
            code: { file: "policy", region: "authz-case" },
            settle: ["root"],
          },
          orderOut("st.nocase.out", "denied"),
        ],
        spans: [rootSpan("0042", 4, { decision: "denied", reason: "missing_case_context" })],
        outcome: {
          kind: "denied",
          title: "out.denied.title",
          text: "out.nocase.text",
        },
      };
  }
}

// --- Szenarien ohne Wrapper ------------------------------------------------

const plainCall: StepDef[] = [
  {
    kind: "work",
    node: "supportagent",
    text: "st.off.start",
    code: { file: "supportagent", region: "call-documents" },
  },
  {
    kind: "send",
    edge: "a2a",
    tone: "request",
    text: "st.off.call",
  },
];

const plainRead: StepDef = {
  kind: "data",
  edge: "data",
  text: "st.off.read",
  code: { file: "dokumentenagent", region: "read-documents" },
};

const plainModel: StepDef = { ...callModel, reveal: undefined, settle: undefined };
const plainBack: StepDef = { ...documentsBack, code: undefined, settle: undefined };

function withoutWrapper(id: ScenarioId): Omit<ScenarioRun, "id" | "wrapper"> {
  const spans: SpanDef[] = [];
  switch (id) {
    case "allowed":
      return {
        spans,
        steps: [
          orderIn("st.off.order"),
          ...plainCall,
          plainRead,
          plainBack,
          plainModel,
          orderOut("st.off.out"),
        ],
        outcome: {
          kind: "untraced",
          title: "out.off.allowed.title",
          text: "out.off.allowed.text",
        },
      };
    case "foreign-case":
      return {
        spans,
        steps: [
          orderIn("st.order0042"),
          { ...plainCall[0]!, text: "st.off.foreign.ask" },
          plainCall[1]!,
          { ...plainRead, tone: "leak", text: "st.off.foreign.read" },
          { ...plainBack, tone: "leak", text: "st.off.foreign.back" },
          plainModel,
          orderOut("st.off.foreign.out", "leak"),
        ],
        outcome: {
          kind: "leak",
          title: "out.off.foreign.title",
          text: "out.off.foreign.text",
        },
      };
    case "third-level":
      return {
        spans,
        steps: [
          orderIn("st.off.order"),
          ...plainCall,
          plainRead,
          {
            kind: "send",
            edge: "back",
            tone: "leak",
            text: "st.off.third.clarify",
            code: { file: "dokumentenagent", region: "clarify" },
          },
          {
            kind: "work",
            node: "supportagent",
            text: "st.off.third.answer",
          },
          plainBack,
          plainModel,
          orderOut("st.off.out"),
        ],
        outcome: {
          kind: "leak",
          title: "out.off.third.title",
          text: "out.off.third.text",
        },
      };
    case "injection":
      return {
        spans,
        steps: [
          orderIn("st.order0043"),
          ...plainCall,
          plainRead,
          {
            kind: "flag",
            node: "dokumentenagent",
            text: "st.off.inj.flag",
            code: { file: "dokumentenagent", region: "flag-untrusted" },
          },
          plainBack,
          {
            kind: "flag",
            node: "supportagent",
            text: "st.off.inj.ignore",
            code: { file: "supportagent", region: "ignore-untrusted" },
          },
          plainModel,
          orderOut("st.off.out"),
        ],
        outcome: {
          kind: "untraced",
          title: "out.off.inj.title",
          text: "out.off.inj.text",
        },
      };
    case "no-case":
      return {
        spans,
        steps: [
          orderIn("st.off.nocase.in"),
          ...plainCall,
          plainRead,
          plainBack,
          plainModel,
          orderOut("st.off.out"),
        ],
        outcome: {
          kind: "leak",
          title: "out.off.nocase.title",
          text: "out.off.nocase.text",
        },
      };
  }
}

export function buildRun(id: ScenarioId, wrapper: boolean): ScenarioRun {
  return { id, wrapper, ...(wrapper ? withWrapper(id) : withoutWrapper(id)) };
}

// --- Trace mit IDs und Zeiten ----------------------------------------------

export interface TraceSpan extends SpanDef {
  spanId: string;
  parentSpanId?: string;
}

export interface Trace {
  traceId: string;
  /** Startzeit in Millisekunden seit 1970. */
  startedAt: number;
  durationMs: number;
  spans: TraceSpan[];
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Gibt den Spans eines Laufs zufällige IDs im OpenTelemetry-Format. */
export function materialize(run: ScenarioRun, startedAt: number = Date.now()): Trace {
  const ids = new Map(run.spans.map((span) => [span.key, randomHex(8)]));
  const spans = run.spans.map((span) => ({
    ...span,
    spanId: ids.get(span.key)!,
    parentSpanId: span.parent ? ids.get(span.parent) : undefined,
  }));
  return {
    traceId: randomHex(16),
    startedAt,
    durationMs: Math.max(0, ...spans.map((span) => span.end)),
    spans,
  };
}

export const SERVICE_LABEL: Record<ServiceId, MessageKey> = {
  supportagent: "svc.supportagent",
  dokumentenagent: "svc.dokumentenagent",
  "dokumenten-api": "svc.api",
};
