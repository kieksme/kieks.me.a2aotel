import { animate } from "animejs";
import { reducedMotion } from "./motion";
import { SERVICE_LABEL, type Trace, type TraceSpan } from "./scenarios";

export type SpanState = "pending" | "final";

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Spans in der Reihenfolge eines Waterfalls: Eltern vor Kindern, nach Startzeit. */
function ordered(spans: TraceSpan[]): { span: TraceSpan; depth: number }[] {
  const result: { span: TraceSpan; depth: number }[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    spans
      .filter((s) => s.parent === parent)
      .sort((a, b) => a.start - b.start)
      .forEach((span) => {
        result.push({ span, depth });
        walk(span.key, depth + 1);
      });
  };
  walk(undefined, 0);
  return result;
}

function attributeRows(record: Record<string, string | number>): string {
  return Object.entries(record)
    .map(([key, value]) => `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(String(value))}</td></tr>`)
    .join("");
}

function detailsMarkup(span: TraceSpan): string {
  const events = span.events.length
    ? `<ul class="event-list">${span.events
        .map(
          (event) => `<li><strong>${escapeHtml(event.name)}</strong> <span class="muted">bei +${event.at} ms</span>
            <table class="attr-table"><tbody>${attributeRows(event.attributes)}</tbody></table></li>`,
        )
        .join("")}</ul>`
    : `<p class="muted">Keine Events.</p>`;
  return `
    <dl class="span-meta">
      <div><dt>Span-ID</dt><dd><code>${span.spanId}</code></dd></div>
      <div><dt>Eltern-Span-ID</dt><dd>${span.parentSpanId ? `<code>${span.parentSpanId}</code>` : "keine (Wurzel)"}</dd></div>
      <div><dt>Start</dt><dd>+${span.start} ms</dd></div>
      <div><dt>Dauer</dt><dd>${span.end - span.start} ms</dd></div>
      <div><dt>Dienst</dt><dd>${SERVICE_LABEL[span.service]}</dd></div>
      <div><dt>Art</dt><dd>${span.kind}</dd></div>
    </dl>
    <h4>Attribute</h4>
    <table class="attr-table"><tbody>${attributeRows(span.attributes)}</tbody></table>
    <h4>Events</h4>
    ${events}`;
}

export function createTraceView(
  host: HTMLElement,
  options: { idPrefix: string; onSelect?: (key: string | null) => void },
) {
  host.innerHTML = `
    <div class="trace-summary" aria-live="polite"></div>
    <div class="trace-axis" aria-hidden="true"></div>
    <ol class="span-list"></ol>
    <p class="trace-empty" hidden></p>`;
  const summary = host.querySelector<HTMLElement>(".trace-summary")!;
  const axis = host.querySelector<HTMLElement>(".trace-axis")!;
  const list = host.querySelector<HTMLOListElement>(".span-list")!;
  const empty = host.querySelector<HTMLElement>(".trace-empty")!;

  let trace: Trace | null = null;
  let states = new Map<string, SpanState>();
  let selected: string | null = null;

  const row = (key: string) => list.querySelector<HTMLLIElement>(`[data-key="${key}"]`);

  function render(next: Trace | null, emptyText = "") {
    trace = next;
    states = new Map();
    selected = null;
    list.innerHTML = "";
    const has = !!next && next.spans.length > 0;
    empty.hidden = has;
    empty.textContent = emptyText;
    axis.hidden = !has;
    summary.hidden = !has;
    if (!next || !has) return;

    const total = next.durationMs || 1;
    axis.innerHTML = [0, 0.25, 0.5, 0.75, 1]
      .map((f) => `<span style="left:${f * 100}%">${Math.round(total * f)} ms</span>`)
      .join("");

    for (const { span, depth } of ordered(next.spans)) {
      const li = document.createElement("li");
      li.className = `span-row svc-${span.service}`;
      li.dataset.key = span.key;
      li.hidden = true;
      const detailsId = `${options.idPrefix}-details-${span.key}`;
      const left = (span.start / total) * 100;
      const width = Math.max(((span.end - span.start) / total) * 100, 1.2);
      li.innerHTML = `
        <button type="button" class="span-head" aria-expanded="false" aria-controls="${detailsId}">
          <span class="span-label" style="--depth:${depth}">
            <span class="link-mark" aria-hidden="true">◆</span>
            <span class="svc-name">${SERVICE_LABEL[span.service]}</span>
            <span class="span-name">${escapeHtml(span.name)}</span>
          </span>
          <span class="span-track"><span class="span-bar" style="left:${left}%;width:${width}%"></span></span>
          <span class="span-state"></span>
          <span class="span-duration">${span.end - span.start} ms</span>
        </button>
        <div class="span-details" id="${detailsId}" hidden>${detailsMarkup(span)}</div>`;
      list.append(li);
    }
    updateSummary();
  }

  function updateSummary() {
    if (!trace) return;
    const visible = trace.spans.filter((s) => states.has(s.key));
    const duration = Math.max(0, ...visible.map((s) => s.end));
    summary.innerHTML = `
      <span><span class="muted">Trace-ID</span> <code>${trace.traceId}</code></span>
      <span><span class="muted">Dauer</span> <strong>${duration} ms</strong></span>
      <span><span class="muted">Spans</span> <strong>${visible.length}</strong></span>`;
  }

  /** Zeigt einen Span an. Solange die Entscheidung offen ist, bleibt er neutral. */
  function setState(key: string, state: SpanState) {
    const li = row(key);
    const span = trace?.spans.find((s) => s.key === key);
    if (!li || !span) return;
    const first = !states.has(key);
    states.set(key, state);
    li.hidden = false;
    const decision = state === "final" ? (span.decision ?? "neutral") : "pending";
    li.dataset.state = decision;
    li.querySelector(".span-state")!.textContent = {
      pending: "läuft",
      allowed: "✓ erlaubt",
      denied: "✗ verweigert",
      neutral: "",
    }[decision];
    if (first && !reducedMotion()) {
      animate(li.querySelector(".span-bar")!, { scaleX: [0, 1], duration: 450, ease: "outQuad" });
    }
    updateSummary();
  }

  function revealAll() {
    trace?.spans.forEach((span) => setState(span.key, "final"));
  }

  function setExpanded(key: string, expanded: boolean) {
    const li = row(key);
    if (!li) return;
    li.querySelector(".span-head")!.setAttribute("aria-expanded", String(expanded));
    li.querySelector<HTMLElement>(".span-details")!.hidden = !expanded;
  }

  function setSelected(key: string | null) {
    selected = key;
    list.querySelectorAll<HTMLLIElement>(".span-row").forEach((li) => {
      li.classList.toggle("is-selected", li.dataset.key === key);
    });
  }

  /** Markiert Spans, die zu einem im Flow gewählten Element gehören. */
  function setLinked(keys: Set<string>) {
    list.querySelectorAll<HTMLLIElement>(".span-row").forEach((li) => {
      const linked = keys.has(li.dataset.key!);
      li.classList.toggle("is-linked", linked);
      const name = li.querySelector(".span-name")!;
      name.setAttribute("aria-description", linked ? "gehört zur Auswahl im Ablauf" : "");
    });
  }

  list.addEventListener("click", (event) => {
    const head = (event.target as HTMLElement).closest<HTMLButtonElement>(".span-head");
    if (!head) return;
    const key = head.closest<HTMLLIElement>(".span-row")!.dataset.key!;
    const expand = head.getAttribute("aria-expanded") !== "true";
    setExpanded(key, expand);
    // Ein Klick wählt den Span aus. Ein zweiter klappt ihn zu und hebt die Auswahl auf.
    const next = expand ? key : selected === key ? null : key;
    setSelected(next);
    options.onSelect?.(next);
  });

  // Pfeiltasten springen zwischen den Spans.
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const heads = [...list.querySelectorAll<HTMLButtonElement>(".span-row:not([hidden]) .span-head")];
    const index = heads.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    heads[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
  });

  return { render, setState, revealAll, setSelected, setLinked, getTrace: () => trace };
}
