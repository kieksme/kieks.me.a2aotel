import { dokumentenagentCard } from "../../src/agents/dokumentenagent.ts";
import { supportagentCard } from "../../src/agents/supportagent.ts";
import { createCodeView, renderCode, REPO_URL } from "./code";
import { createFlow } from "./flow";
import {
  applyStaticTexts,
  mountLanguageSwitch,
  onLanguageChange,
  t,
  type MessageKey,
} from "./i18n";
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
function renderMessages() {
  messages.innerHTML = scenarioList
    .map(
      (s) => `
    <button type="button" class="message" data-scenario="${s.id}" aria-pressed="${s.id === scenario}">
      <span class="message-title" data-selected-label="${t("message.selected")}">${t(s.title)}</span>
      <span class="message-text">${t(s.message)}</span>
      <span class="message-hint">${t(s.hint)}</span>
    </button>`,
    )
    .join("");
}
messages.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".message");
  if (!button) return;
  scenario = button.dataset.scenario as ScenarioId;
  play();
});

// --- Wrapper-Schalter ------------------------------------------------------

const wrapperSwitch = $("#wrapper-switch");
function renderWrapperState() {
  wrapperSwitch.setAttribute("aria-checked", String(wrapper));
  $("#wrapper-state").textContent = t(wrapper ? "wrapper.on" : "wrapper.off");
}
wrapperSwitch.addEventListener("click", () => {
  wrapper = !wrapper;
  renderWrapperState();
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
  traceView.render(trace, t("trace.none"));
  download.disabled = true;
  outcome.innerHTML = "";
  outcome.className = "outcome";
  $("#auditor").innerHTML = `<p class="muted">${t("auditor.pending")}</p>`;
  stepsList.innerHTML = run.steps
    .map((step, index) => `<li data-step="${index}" data-state="todo">${t(step.text)}</li>`)
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
  outcome.innerHTML = `<strong>${t(run.outcome.title)}</strong> ${t(run.outcome.text)}`;
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

const NODE_INFO: Record<string, { title: MessageKey; text: MessageKey }> = {
  sachbearbeitung: { title: "node.sachbearbeitung", text: "info.sachbearbeitung" },
  supportagent: { title: "svc.supportagent", text: "info.supportagent" },
  dokumentenagent: { title: "svc.dokumentenagent", text: "info.dokumentenagent" },
  "dokumenten-api": { title: "svc.api", text: "info.api" },
};

const EDGE_INFO: Record<string, { title: MessageKey; text: MessageKey }> = {
  order: { title: "info.order.title", text: "info.order" },
  a2a: { title: "info.a2a.title", text: "info.a2a" },
  back: { title: "info.back.title", text: "info.back" },
  data: { title: "info.data.title", text: "info.data" },
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
            ? t("linked.none")
            : linkedCount === 1
              ? t("linked.one")
              : t("linked.many", { n: linkedCount })
        }</p>`;
  host.innerHTML = `
    <h3>${t(info.title)}</h3>
    <p>${t(info.text)}</p>
    ${count}
    ${
      isAgent
        ? `<div class="inspector-actions">
            <button type="button" class="button" data-action="card">${t("action.card")}</button>
            <button type="button" class="button" data-action="code">${t("action.code")}</button>
            <button type="button" class="button" data-action="wrapper">${t("action.wrapper")}</button>
            <button type="button" class="button" data-action="policy">${t("action.policy")}</button>
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
  $("#card-title").textContent = t("card.titleFor", { name: card.name });
  $("#card-intro").textContent = t("card.intro", { name: card.name });
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
      <p>${t("auditor.none.lead")}</p>
      <ul>
        <li>${t("auditor.none.who")}</li>
        <li>${t("auditor.none.what")}</li>
        <li>${t("auditor.none.rule")}</li>
        <li>${t("auditor.none.when")}</li>
      </ul>
      <p class="muted">${t("auditor.none.retry")}</p>`;
    return;
  }

  // Der Span, an dem sich das Szenario entscheidet: die erste Ablehnung, sonst die Wurzel.
  const server = trace.spans.filter((s) => s.kind === "SERVER" && s.decision);
  const key = server.find((s) => s.decision === "denied") ?? server[0]!;
  const a = key.attributes;
  const denied = key.decision === "denied";
  const when = new Date(trace.startedAt + key.start).toISOString();
  const path = chain(key, trace.spans)
    .map((s) => `${t(SERVICE_LABEL[s.service])}: ${s.name}`)
    .join(" › ");
  const events = trace.spans.flatMap((s) => s.events).filter((e) => e.name !== "authz.decision");

  const code = (value: unknown) => `<code>${value}</code>`;
  host.innerHTML = `
    <dl class="audit-list">
      <div><dt>${t("auditor.who")}</dt><dd>${t("auditor.who.text", {
        caller: code(a["app.caller.agent_id"]),
        target: code(a["app.target.agent_id"]),
        approval: code(a["app.approval.ref"]),
      })}</dd></div>
      <div><dt>${t("auditor.what")}</dt><dd>${t("auditor.what.text", {
        action: code(a["app.authz.action"]),
        resource: code(a["app.authz.resource"]),
        caseRef: code(a["app.case.ref"]),
      })}</dd></div>
      <div><dt>${t("auditor.rule")}</dt><dd>${t("auditor.rule.text", {
        version: code(POLICY_VERSION),
        reason: code(a["app.authz.reason"]),
      })}</dd></div>
      <div><dt>${t("auditor.decision")}</dt><dd class="${denied ? "is-denied" : "is-allowed"}">${t(
        denied ? "decision.denied" : "decision.allowed",
      )}</dd></div>
      <div><dt>${t("auditor.when")}</dt><dd>${t("auditor.when.text", {
        time: code(when),
        traceId: code(trace.traceId),
      })}</dd></div>
      <div><dt>${t("auditor.chain")}</dt><dd>${path}</dd></div>
      ${
        events.length
          ? `<div><dt>${t("auditor.anomalies")}</dt><dd>${t("auditor.anomalies.text", {
              events: events.map((e) => code(e.name)).join(", "),
            })}</dd></div>`
          : ""
      }
    </dl>
    <p class="audit-note">${t("auditor.note")}</p>`;
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
  { id: "with", title: "compare.with" as MessageKey, scenario: "allowed" as const, context: CONTEXT_WITH },
  { id: "without", title: "compare.without" as MessageKey, scenario: "no-case" as const, context: CONTEXT_WITHOUT },
].map((side) => {
  const element = document.createElement("article");
  element.className = "compare-side";
  element.innerHTML = `
    <h3 data-i18n="${side.title}">${t(side.title)}</h3>
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
        .map((step, index) => `<li data-step="${index}" data-state="todo">${t(step.text)}</li>`)
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
      result.innerHTML = `<strong>${t(sideRun.outcome.title)}</strong> ${t(sideRun.outcome.text)}`;
    }),
  );
}
$("#compare-play").addEventListener("click", () => void playCompare());

// --- Sprache und Start ----------------------------------------------------

/** Baut alles neu auf, was Text enthält, und spielt das aktuelle Szenario erneut ab. */
function renderTexts() {
  applyStaticTexts();
  renderMessages();
  renderWrapperState();
  flow.remount();
  void code.remount();
  void playCompare();
  void play();
}

mountLanguageSwitch($<HTMLSelectElement>("#lang-select"));
onLanguageChange(renderTexts);
renderTexts();

// Für Neugierige in der Konsole.
console.info(`Simulation. Das echte Beispiel: ${REPO_URL}`);
