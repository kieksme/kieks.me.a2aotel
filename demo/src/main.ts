import { dokumentenagentCard } from "../../src/agents/dokumentenagent.ts";
import { supportagentCard } from "../../src/agents/supportagent.ts";
import { createCodeView, renderCode, REPO_URL } from "./code";
import { createFlow } from "./flow";
import { createMotion } from "./motion";
import { toOtlpJson } from "./otlp";
import {
  buildRun,
  materialize,
  POLICY_VERSION,
  scenarioList,
  SERVICE_LABEL,
  type FileId,
  type FlowRef,
  type ScenarioId,
  type ScenarioRun,
  type Trace,
  type TraceSpan,
} from "./scenarios";
import { createTraceView } from "./trace";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

// --- Zustand ---------------------------------------------------------------

let scenario: ScenarioId = "allowed";
let wrapper = true;
let run: ScenarioRun = buildRun(scenario, wrapper);
let trace: Trace | null = null;
/** Zählt die Läufe. Ein neuer Lauf macht alle älteren ungültig. */
let generation = 0;
let finished = false;

// --- Bausteine -------------------------------------------------------------

const flow = createFlow($("#flow"), selectFlow);
const traceView = createTraceView($("#trace"), { idPrefix: "main", onSelect: selectSpan });
const code = createCodeView($("#code"));

const AGENT_CARDS = {
  supportagent: supportagentCard("https://supportagent.example"),
  dokumentenagent: dokumentenagentCard("https://dokumentenagent.example"),
};
type AgentId = keyof typeof AGENT_CARDS;

// --- Nachrichten zum Anklicken ---------------------------------------------

const messages = $("#messages");
messages.innerHTML = scenarioList
  .map(
    (s) => `
    <button type="button" class="message" data-scenario="${s.id}" aria-pressed="false">
      <span class="message-title">${s.title}</span>
      <span class="message-text">„${s.message}“</span>
      <span class="message-hint">${s.hint}</span>
    </button>`,
  )
  .join("");
messages.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".message");
  if (!button) return;
  scenario = button.dataset.scenario as ScenarioId;
  play();
});

// --- Wrapper-Schalter ------------------------------------------------------

const wrapperSwitch = $("#wrapper-switch");
wrapperSwitch.addEventListener("click", () => {
  wrapper = !wrapper;
  wrapperSwitch.setAttribute("aria-checked", String(wrapper));
  $("#wrapper-state").textContent = wrapper
    ? "an: Berechtigungsprüfung und Tracing aktiv"
    : "aus: keine Prüfung, kein Trace";
  play();
});

// --- Umschalter Visualisierung / Code --------------------------------------

const viewTabs = [$("#tab-visual"), $("#tab-code")];
function setView(view: "visual" | "code", focus = false) {
  viewTabs.forEach((tab) => {
    const selected = tab.id === `tab-${view}`;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(`#${tab.getAttribute("aria-controls")}`).hidden = !selected;
    if (selected && focus) tab.focus();
  });
}
viewTabs.forEach((tab) => {
  const view = tab.id === "tab-visual" ? "visual" : "code";
  tab.addEventListener("click", () => setView(view));
  tab.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      setView(view === "visual" ? "code" : "visual", true);
    }
  });
});

function openCode(file: FileId, region?: string) {
  setView("code");
  void code.show(file, region);
  $("#tab-code").focus();
}

// --- Abspielen -------------------------------------------------------------

$("#replay").addEventListener("click", () => play());

const stepsList = $("#steps");
const outcome = $("#outcome");
const download = $<HTMLButtonElement>("#download");

const NO_TRACE_TEXT =
  "Kein Trace. Ohne Wrapper schreibt niemand Spans: Der Ablauf oben ist passiert, hier fehlt aber jede Spur.";

async function play() {
  const mine = ++generation;
  finished = false;
  run = buildRun(scenario, wrapper);
  trace = run.spans.length ? materialize(run) : null;

  messages.querySelectorAll<HTMLButtonElement>(".message").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.scenario === scenario));
  });
  document.body.classList.toggle("wrapper-off", !wrapper);

  flow.reset(wrapper);
  flow.setSelection(null);
  renderInspector(null);
  traceView.render(trace, NO_TRACE_TEXT);
  download.disabled = true;
  outcome.innerHTML = "";
  outcome.className = "outcome";
  $("#auditor").innerHTML = `<p class="muted">Erscheint, sobald der Ablauf durchgelaufen ist.</p>`;
  stepsList.innerHTML = run.steps
    .map((step, index) => `<li data-step="${index}" data-state="todo">${step.text}</li>`)
    .join("");

  for (const [index, step] of run.steps.entries()) {
    const item = stepsList.querySelector<HTMLLIElement>(`[data-step="${index}"]`)!;
    item.dataset.state = "active";
    item.setAttribute("aria-current", "step");
    // Nur die Liste scrollen, nicht die ganze Seite.
    stepsList.scrollTo({ top: Math.max(0, item.offsetTop - stepsList.offsetTop - 60) });
    step.reveal?.forEach((key) => traceView.setState(key, "pending"));
    // Im Code-Modus wird die Stelle markiert, die gerade ausgeführt wird.
    if (step.code) void code.show(step.code.file, step.code.region, step.text);

    await flow.playStep(step);
    if (mine !== generation) return;

    step.settle?.forEach((key) => traceView.setState(key, "final"));
    item.dataset.state = "done";
    item.removeAttribute("aria-current");
    await flow.wait(250);
    if (mine !== generation) return;
  }

  finished = true;
  traceView.revealAll();
  download.disabled = !trace;
  outcome.className = `outcome is-${run.outcome.kind}`;
  outcome.innerHTML = `<strong>${run.outcome.title}.</strong> ${run.outcome.text}`;
  renderAuditor();
}

// --- Verknüpfung von Trace und Flow ----------------------------------------

const sameRef = (a: FlowRef, b: FlowRef) => a.type === b.type && a.id === b.id;

/** Klick im Flow: zugehörige Spans im Trace markieren. */
function selectFlow(ref: FlowRef) {
  const linked = new Set(
    (trace?.spans ?? []).filter((span) => sameRef(span.flow, ref)).map((span) => span.key),
  );
  flow.setSelection(ref);
  traceView.setSelected(null);
  traceView.setLinked(linked);
  renderInspector(ref, linked.size);
}

/** Klick auf einen Span: zugehörigen Teil im Flow hervorheben. */
function selectSpan(key: string | null) {
  const span = trace?.spans.find((s) => s.key === key);
  traceView.setLinked(new Set());
  flow.setSelection(span?.flow ?? null);
  renderInspector(span?.flow ?? null);
}

const NODE_INFO: Record<string, { title: string; text: string }> = {
  sachbearbeitung: {
    title: "Sachbearbeitung",
    text: "Löst den Auftrag aus und gibt Fallbezug und Freigabereferenz mit. Schreibt selbst keine Spans.",
  },
  supportagent: {
    title: "Supportagent",
    text: "Bearbeitet den Supportfall und holt dafür Dokumente vom Dokumentenagenten.",
  },
  dokumentenagent: {
    title: "Dokumentenagent",
    text: "Liefert die Dokumente zu einem Fall aus der Dokumenten-API.",
  },
  "dokumenten-api": {
    title: "Dokumenten-API",
    text: "Datenquelle mit erfundenen Beispieldaten. Wird nur erreicht, wenn der Aufruf erlaubt war.",
  },
};

const EDGE_INFO: Record<string, { title: string; text: string }> = {
  order: { title: "Auftrag", text: "Die Sachbearbeitung beauftragt den Supportagenten (Stufe 1)." },
  a2a: {
    title: "Aufruf Supportagent → Dokumentenagent",
    text: "A2A-Aufruf mit traceparent-Header (Stufe 2). Im Trace ist das der Client-Span des Supportagenten.",
  },
  back: {
    title: "Rückfrage Dokumentenagent → Supportagent",
    text: "Wäre die dritte Delegationsstufe. Mit Wrapper wird sie verweigert.",
  },
  data: { title: "Datenzugriff", text: "Der Dokumentenagent liest aus der Dokumenten-API." },
};

function renderInspector(ref: FlowRef | null, linkedCount?: number) {
  const host = $("#inspector");
  if (!ref) {
    host.innerHTML = "";
    return;
  }
  const info = ref.type === "node" ? NODE_INFO[ref.id]! : EDGE_INFO[ref.id]!;
  const isAgent = ref.type === "node" && ref.id in AGENT_CARDS;
  const count =
    linkedCount === undefined
      ? ""
      : `<p class="muted">${
          linkedCount === 0
            ? "Dazu gibt es im aktuellen Trace keinen Span."
            : `${linkedCount} zugehörige${linkedCount === 1 ? "r Span ist" : " Spans sind"} im Trace mit ◆ markiert.`
        }</p>`;
  host.innerHTML = `
    <h3>${info.title}</h3>
    <p>${info.text}</p>
    ${count}
    ${
      isAgent
        ? `<div class="inspector-actions">
            <button type="button" class="button" data-action="card">Agent Card anzeigen</button>
            <button type="button" class="button" data-action="code">Code des Agenten</button>
            <button type="button" class="button" data-action="wrapper">Wrapper</button>
            <button type="button" class="button" data-action="policy">Berechtigungsprüfung</button>
          </div>`
        : ""
    }`;
  if (!isAgent) return;
  const agent = ref.id as AgentId;
  host.querySelector('[data-action="card"]')!.addEventListener("click", () => openCard(agent));
  host
    .querySelector('[data-action="code"]')!
    .addEventListener("click", () => openCode(agent, "agent-definition"));
  host
    .querySelector('[data-action="wrapper"]')!
    .addEventListener("click", () => openCode("wrapper", "wrapper-inbound"));
  host
    .querySelector('[data-action="policy"]')!
    .addEventListener("click", () => openCode("policy", "authz-check"));
}

// --- Agent Card ------------------------------------------------------------

const cardDialog = $<HTMLDialogElement>("#card-dialog");
let cardAgent: AgentId = "supportagent";

function openCard(agent: AgentId) {
  cardAgent = agent;
  const card = AGENT_CARDS[agent];
  $("#card-title").textContent = `Agent Card: ${card.name}`;
  $("#card-intro").textContent =
    `So beschreibt sich der ${card.name} gegenüber anderen Agenten. ` +
    "Ein echter Agent liefert diese Karte unter /.well-known/agent-card.json aus.";
  void renderCode($("#card-json"), JSON.stringify(card, null, 2), "json");
  cardDialog.showModal();
}
$("#card-close").addEventListener("click", () => cardDialog.close());
$("#card-code").addEventListener("click", () => {
  cardDialog.close();
  openCode(cardAgent, "agent-card");
});

// --- Download --------------------------------------------------------------

download.addEventListener("click", () => {
  if (!trace || !finished) return;
  const blob = new Blob([JSON.stringify(toOtlpJson(trace), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `trace-${scenario}-${trace.traceId.slice(0, 8)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

// --- Auditor-Hinweis -------------------------------------------------------

function chain(span: TraceSpan, spans: TraceSpan[]): TraceSpan[] {
  const parent = spans.find((s) => s.key === span.parent);
  return parent ? [...chain(parent, spans), span] : [span];
}

function renderAuditor() {
  const host = $("#auditor");
  if (!trace) {
    host.innerHTML = `
      <p><strong>Nichts.</strong> Ohne Wrapper gibt es keinen Span, also auch keine Belege:</p>
      <ul>
        <li><strong>Wer?</strong> Nicht zuordenbar. Kein Aufrufer, keine Freigabereferenz.</li>
        <li><strong>Was?</strong> Unbekannt. Aktion und Ressource wurden nirgends festgehalten.</li>
        <li><strong>Welche Regel?</strong> Keine. Es wurde nicht geprüft.</li>
        <li><strong>Wann und in welcher Kette?</strong> Nicht rekonstruierbar.</li>
      </ul>
      <p class="muted">Schalte den Wrapper wieder ein und spiele dasselbe Szenario noch einmal ab.</p>`;
    return;
  }

  // Der Span, an dem sich das Szenario entscheidet: die erste Ablehnung, sonst die Wurzel.
  const server = trace.spans.filter((s) => s.kind === "SERVER" && s.decision);
  const key = server.find((s) => s.decision === "denied") ?? server[0]!;
  const a = key.attributes;
  const denied = key.decision === "denied";
  const when = new Date(trace.startedAt + key.start).toISOString();
  const path = chain(key, trace.spans)
    .map((s) => `${SERVICE_LABEL[s.service]}: ${s.name}`)
    .join(" › ");
  const events = trace.spans.flatMap((s) => s.events).filter((e) => e.name !== "authz.decision");

  host.innerHTML = `
    <dl class="audit-list">
      <div><dt>Wer</dt><dd><code>${a["app.caller.agent_id"]}</code> ruft <code>${a["app.target.agent_id"]}</code> auf, Freigabe <code>${a["app.approval.ref"]}</code>.</dd></div>
      <div><dt>Was</dt><dd>Aktion <code>${a["app.authz.action"]}</code> auf <code>${a["app.authz.resource"]}</code>, Fallreferenz <code>${a["app.case.ref"]}</code> (pseudonymisiert).</dd></div>
      <div><dt>Welche Regel</dt><dd>Regelversion <code>${POLICY_VERSION}</code>, Begründung <code>${a["app.authz.reason"]}</code>.</dd></div>
      <div><dt>Entscheidung</dt><dd class="${denied ? "is-denied" : "is-allowed"}">${denied ? "✗ verweigert" : "✓ erlaubt"}</dd></div>
      <div><dt>Wann</dt><dd><code>${when}</code> in Trace <code>${trace.traceId}</code>.</dd></div>
      <div><dt>Aufrufkette</dt><dd>${path}</dd></div>
      ${
        events.length
          ? `<div><dt>Auffälligkeiten</dt><dd>${events.map((e) => `<code>${e.name}</code>`).join(", ")} als Events im Trace.</dd></div>`
          : ""
      }
    </dl>
    <p class="audit-note">
      Damit sind drei typische Audit-Anforderungen abgedeckt: <strong>Zuordenbarkeit</strong>
      (Aufrufer und Freigabe stehen im Span), <strong>Rekonstruierbarkeit</strong> der Aufrufkette
      (eine Trace-ID, jeder Span kennt seinen Eltern-Span) und die <strong>Regelversion</strong>,
      nach der entschieden wurde.
    </p>`;
}

// --- Vergleich mit und ohne Fallbezug --------------------------------------

const compareMotion = createMotion();
const CONTEXT_WITH = {
  callerAgentId: "sachbearbeitung",
  caseId: "SUP-2026-0042",
  approvalRef: "FRG-2026-0001",
  delegationChain: ["sachbearbeitung"],
};
const { caseId: _omitted, ...CONTEXT_WITHOUT } = CONTEXT_WITH;

const compareSides = [
  { id: "with", title: "Mit Fallbezug", scenario: "allowed" as const, context: CONTEXT_WITH },
  { id: "without", title: "Ohne Fallbezug", scenario: "no-case" as const, context: CONTEXT_WITHOUT },
].map((side) => {
  const element = document.createElement("article");
  element.className = "compare-side";
  element.innerHTML = `
    <h3>${side.title}</h3>
    <pre class="context-json">${JSON.stringify(side.context, null, 2)}</pre>
    <ol class="steps compare-steps"></ol>
    <div class="outcome" role="status"></div>
    <div class="compare-trace"></div>`;
  $("#compare").append(element);
  const view = createTraceView(element.querySelector<HTMLElement>(".compare-trace")!, {
    idPrefix: `compare-${side.id}`,
  });
  return { ...side, element, view };
});

let compareGeneration = 0;
async function playCompare() {
  const mine = ++compareGeneration;
  compareMotion.cancelAll();
  await Promise.all(
    compareSides.map(async (side) => {
      const sideRun = buildRun(side.scenario, true);
      const list = side.element.querySelector<HTMLElement>(".steps")!;
      const result = side.element.querySelector<HTMLElement>(".outcome")!;
      side.view.render(materialize(sideRun));
      result.className = "outcome";
      result.innerHTML = "";
      list.innerHTML = sideRun.steps
        .map((step, index) => `<li data-step="${index}" data-state="todo">${step.text}</li>`)
        .join("");
      for (const [index, step] of sideRun.steps.entries()) {
        const item = list.querySelector<HTMLElement>(`[data-step="${index}"]`)!;
        item.dataset.state = "active";
        step.reveal?.forEach((key) => side.view.setState(key, "pending"));
        await compareMotion.wait(450);
        if (mine !== compareGeneration) return;
        step.settle?.forEach((key) => side.view.setState(key, "final"));
        item.dataset.state = "done";
      }
      side.view.revealAll();
      result.className = `outcome is-${sideRun.outcome.kind}`;
      result.innerHTML = `<strong>${sideRun.outcome.title}.</strong> ${sideRun.outcome.text}`;
    }),
  );
}
$("#compare-play").addEventListener("click", () => void playCompare());

// --- Start -----------------------------------------------------------------

void code.show("wrapper");
void playCompare();
void play();

// Für Neugierige in der Konsole.
console.info(`Simulation. Das echte Beispiel: ${REPO_URL}`);
