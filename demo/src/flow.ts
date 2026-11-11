import { t, type MessageKey } from "./i18n";
import { createMotion, reducedMotion } from "./motion";
import type { EdgeId, FlowRef, NodeId, StepDef } from "./scenarios";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  title: MessageKey;
  subtitle?: MessageKey;
  wrapped: boolean;
}

interface Line {
  from: [number, number];
  to: [number, number];
  /** Fester Text oder Schlüssel einer Übersetzung. */
  label?: MessageKey;
  fixedLabel?: string;
  labelAt: [number, number];
  name: MessageKey;
}

interface Layout {
  viewBox: string;
  nodes: Record<NodeId, Box>;
  edges: Record<EdgeId, Line>;
}

/** Breite Anordnung: die Agenten stehen nebeneinander. */
const WIDE: Layout = {
  viewBox: "0 0 760 284",
  nodes: {
    sachbearbeitung: { x: 16, y: 62, w: 124, h: 46, title: "node.sachbearbeitung", wrapped: false },
    supportagent: { x: 204, y: 40, w: 186, h: 90, title: "svc.supportagent", subtitle: "node.agent", wrapped: true },
    dokumentenagent: { x: 550, y: 40, w: 194, h: 90, title: "svc.dokumentenagent", subtitle: "node.agent", wrapped: true },
    "dokumenten-api": { x: 567, y: 204, w: 160, h: 64, title: "svc.api", subtitle: "node.datasource", wrapped: false },
  },
  edges: {
    order: { from: [140, 85], to: [196, 85], labelAt: [168, 76], name: "edge.order.aria" },
    a2a: { from: [398, 68], to: [542, 68], fixedLabel: "A2A SendMessage", labelAt: [470, 58], name: "edge.a2a.aria" },
    back: { from: [542, 104], to: [398, 104], label: "edge.back", labelAt: [470, 124], name: "edge.back.aria" },
    data: { from: [647, 138], to: [647, 204], label: "edge.data", labelAt: [657, 172], name: "edge.data.aria" },
  },
};

/**
 * Hohe Anordnung für schmale Bildschirme: alles steht untereinander.
 * So passt die Grafik aufs Handy, ohne dass man seitlich scrollen muss.
 */
const TALL: Layout = {
  viewBox: "0 0 340 484",
  nodes: {
    sachbearbeitung: { x: 108, y: 12, w: 124, h: 42, title: "node.sachbearbeitung", wrapped: false },
    supportagent: { x: 62, y: 104, w: 216, h: 80, title: "svc.supportagent", subtitle: "node.agent", wrapped: true },
    dokumentenagent: { x: 62, y: 276, w: 216, h: 80, title: "svc.dokumentenagent", subtitle: "node.agent", wrapped: true },
    "dokumenten-api": { x: 90, y: 412, w: 160, h: 64, title: "svc.api", subtitle: "node.datasource", wrapped: false },
  },
  edges: {
    order: { from: [170, 54], to: [170, 96], labelAt: [246, 88], name: "edge.order.aria" },
    a2a: { from: [146, 192], to: [146, 268], fixedLabel: "A2A SendMessage", labelAt: [74, 236], name: "edge.a2a.aria" },
    back: { from: [218, 268], to: [218, 192], label: "edge.back", labelAt: [276, 226], name: "edge.back.aria" },
    data: { from: [170, 364], to: [170, 412], label: "edge.data", labelAt: [180, 386], name: "edge.data.aria" },
  },
};

const NODE_IDS = Object.keys(WIDE.nodes) as NodeId[];
const EDGE_IDS = Object.keys(WIDE.edges) as EdgeId[];

/** Ab dieser Breite abwärts gilt die hohe Anordnung. */
const narrow = window.matchMedia("(max-width: 700px)");

const SVG_NS = "http://www.w3.org/2000/svg";

function nodeMarkup(id: NodeId, b: Box): string {
  const cx = b.x + b.w / 2;
  const ring = b.wrapped
    ? `<rect class="wrapper-ring" x="${b.x - 7}" y="${b.y - 7}" width="${b.w + 14}" height="${b.h + 14}" rx="16"/>
       <text class="wrapper-label" x="${b.x - 2}" y="${b.y - 13}">${t("wrapper.label")}</text>`
    : "";
  return `
  <g class="node${b.wrapped ? " is-agent" : ""}" data-node="${id}" tabindex="0" role="button"
     aria-pressed="false" aria-label="${t(b.title)}${b.subtitle ? ", " + t(b.subtitle) : ""}">
    ${ring}
    <rect class="select-ring" x="${b.x - 13}" y="${b.y - 13}" width="${b.w + 26}" height="${b.h + 26}" rx="21"/>
    <rect class="node-box" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="11"/>
    <text class="node-title" x="${cx}" y="${b.y + (b.h > 60 ? 30 : b.h / 2 + 5)}">${t(b.title)}</text>
    ${b.subtitle ? `<text class="node-subtitle" x="${cx}" y="${b.y + 48}">${t(b.subtitle)}</text>` : ""}
    <text class="node-status" x="${cx}" y="${b.y + b.h - 12}"></text>
    <g class="node-badge" transform="translate(${b.x + b.w - 4} ${b.y + 4})">
      <circle r="12"/><text y="5"></text>
    </g>
  </g>`;
}

function edgeMarkup(id: EdgeId, e: Line): string {
  const d = `M${e.from[0]} ${e.from[1]} L${e.to[0]} ${e.to[1]}`;
  return `
  <g class="edge" data-edge="${id}" tabindex="0" role="button" aria-pressed="false" aria-label="${t(e.name)}">
    <path class="edge-hit" d="${d}"/>
    <path class="edge-halo" d="${d}"/>
    <path class="edge-line" d="${d}" marker-end="url(#arrow)"/>
    <text class="edge-label" x="${e.labelAt[0]}" y="${e.labelAt[1]}"${id === "data" ? ' text-anchor="start"' : ""}>${e.label ? t(e.label) : (e.fixedLabel ?? "")}</text>
    <text class="edge-state" x="${e.labelAt[0]}" y="${e.labelAt[1] + (id === "a2a" || id === "order" ? -14 : 14)}"${id === "data" ? ' text-anchor="start"' : ""}></text>
  </g>`;
}

const sameRef = (a: FlowRef | null, b: FlowRef) => a?.type === b.type && a.id === b.id;

export function createFlow(
  host: HTMLElement,
  onSelect: (ref: FlowRef) => void,
  /** Wird aufgerufen, wenn die Grafik wegen der Bildschirmbreite neu aufgebaut wurde. */
  onLayoutChange?: () => void,
) {
  let layout: Layout = narrow.matches ? TALL : WIDE;
  let svg!: SVGSVGElement;
  let token!: SVGGElement;
  const motion = createMotion();

  /** Baut die Grafik auf. Wird beim Sprachwechsel erneut aufgerufen. */
  function mount() {
    host.innerHTML = `
    <svg viewBox="${layout.viewBox}" class="${layout === TALL ? "is-tall" : "is-wide"}" role="group" aria-label="${t("flow.aria")}">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/>
        </marker>
      </defs>
      ${EDGE_IDS.map((id) => edgeMarkup(id, layout.edges[id])).join("")}
      ${NODE_IDS.map((id) => nodeMarkup(id, layout.nodes[id])).join("")}
      <g class="token" aria-hidden="true">
        <rect x="-13" y="-9" width="26" height="18" rx="3"/>
        <path d="M-13 -9 L0 2 L13 -9"/>
        <text y="5"></text>
      </g>
    </svg>`;

    svg = host.querySelector("svg")!;
    token = svg.querySelector<SVGGElement>(".token")!;

    // Knoten und Kanten sind per Maus und Tastatur (Enter, Leertaste) auswählbar.
    svg.querySelectorAll<SVGGElement>(".node, .edge").forEach((el) => {
      const ref: FlowRef = el.dataset.node
        ? { type: "node", id: el.dataset.node as NodeId }
        : { type: "edge", id: el.dataset.edge as EdgeId };
      el.addEventListener("click", () => onSelect(ref));
      el.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(ref);
        }
      });
    });
  }
  mount();

  // Dreht man das Gerät oder ändert die Fensterbreite, wechselt die Anordnung.
  narrow.addEventListener("change", () => {
    motion.cancelAll();
    layout = narrow.matches ? TALL : WIDE;
    mount();
    onLayoutChange?.();
  });

  const nodeEl = (id: NodeId) => svg.querySelector<SVGGElement>(`[data-node="${id}"]`)!;
  const edgeEl = (id: EdgeId) => svg.querySelector<SVGGElement>(`[data-edge="${id}"]`)!;
  const refEl = (ref: FlowRef) => (ref.type === "node" ? nodeEl(ref.id) : edgeEl(ref.id));

  function setStatus(id: NodeId, text: string) {
    nodeEl(id).querySelector(".node-status")!.textContent = text;
  }

  function setBadge(id: NodeId, kind: "allowed" | "denied" | "flag" | null) {
    const el = nodeEl(id);
    el.classList.remove("badge-allowed", "badge-denied", "badge-flag");
    if (!kind) return;
    el.classList.add(`badge-${kind}`);
    el.querySelector(".node-badge text")!.textContent = { allowed: "✓", denied: "✗", flag: "!" }[kind];
  }

  function markEdge(id: EdgeId, state: "denied" | "leak") {
    const el = edgeEl(id);
    el.classList.add(`is-${state}`);
    el.querySelector(".edge-state")!.textContent = t(state === "denied" ? "edge.denied" : "edge.unchecked");
  }

  async function fly(edge: EdgeId, reverse: boolean, tone: NonNullable<StepDef["tone"]>) {
    const { from, to } = layout.edges[edge];
    const [a, b] = reverse ? [to, from] : [from, to];
    token.setAttribute("class", `token is-visible tone-${tone}`);
    token.querySelector("text")!.textContent = tone === "denied" ? "✗" : tone === "leak" ? "!" : "";
    const place = (p: number) =>
      token.setAttribute("transform", `translate(${a[0] + (b[0] - a[0]) * p} ${a[1] + (b[1] - a[1]) * p})`);
    place(0);
    edgeEl(edge).classList.add("is-active");
    if (reducedMotion()) {
      place(0.5);
      await motion.wait(500);
    } else {
      await motion.tween(750, place);
    }
    edgeEl(edge).classList.remove("is-active");
    token.setAttribute("class", "token");
  }

  /** Lässt einen Knoten kurz pulsieren, solange er arbeitet oder prüft. */
  async function pulse(id: NodeId, selector: string, duration: number) {
    const el = nodeEl(id);
    const target = el.querySelector<SVGElement>(selector) ?? el.querySelector<SVGElement>(".node-box")!;
    el.classList.add("is-busy");
    if (reducedMotion()) {
      await motion.wait(450);
    } else {
      await motion.tween(
        duration,
        (p) => target.style.setProperty("stroke-width", String(2 + 3 * Math.sin(p * Math.PI * 2) ** 2)),
        "linear",
      );
      target.style.removeProperty("stroke-width");
    }
    el.classList.remove("is-busy");
  }

  async function playStep(step: StepDef) {
    switch (step.kind) {
      case "send": {
        const tone = step.tone ?? "request";
        await fly(step.edge!, step.reverse ?? false, tone);
        if (tone === "leak" && step.edge !== "order") markEdge(step.edge!, "leak");
        break;
      }
      case "check": {
        const id = step.node!;
        setStatus(id, t(step.result ? "status.checking" : "status.opening"));
        await pulse(id, ".wrapper-ring", 700);
        if (step.result) {
          setBadge(id, step.result);
          setStatus(id, t(step.result === "allowed" ? "status.allowed" : "status.denied"));
          // Verweigert wurde der Aufruf, also die Kante, über die er kam.
          if (step.denyEdge) markEdge(step.denyEdge, "denied");
        } else {
          setStatus(id, t("status.opened"));
        }
        break;
      }
      case "work": {
        setStatus(step.node!, t("status.working"));
        await pulse(step.node!, ".node-box", 700);
        setStatus(step.node!, "");
        break;
      }
      case "data": {
        const tone = step.tone ?? "request";
        setStatus("dokumentenagent", t("status.reading"));
        await fly("data", false, tone);
        await pulse("dokumenten-api", ".node-box", 400);
        await fly("data", true, tone === "leak" ? "leak" : "result");
        if (tone === "leak") markEdge("data", "leak");
        setStatus("dokumentenagent", "");
        break;
      }
      case "flag": {
        setBadge(step.node!, "flag");
        setStatus(step.node!, t("status.flagged"));
        await pulse(step.node!, ".node-box", 600);
        break;
      }
    }
  }

  function reset(wrapper: boolean) {
    motion.cancelAll();
    svg.classList.toggle("no-wrapper", !wrapper);
    token.setAttribute("class", "token");
    NODE_IDS.forEach((id) => {
      setStatus(id, "");
      setBadge(id, null);
      nodeEl(id).classList.remove("is-busy");
      nodeEl(id).querySelectorAll<SVGElement>("rect").forEach((r) => r.style.removeProperty("stroke-width"));
    });
    EDGE_IDS.forEach((id) => {
      const el = edgeEl(id);
      el.classList.remove("is-denied", "is-leak", "is-active");
      el.querySelector(".edge-state")!.textContent = "";
    });
  }

  /** Hebt hervor, was im Flow ausgewählt wurde oder zu einem gewählten Span gehört. */
  function setSelection(ref: FlowRef | null) {
    svg.querySelectorAll<SVGGElement>(".node, .edge").forEach((el) => {
      const own: FlowRef = el.dataset.node
        ? { type: "node", id: el.dataset.node as NodeId }
        : { type: "edge", id: el.dataset.edge as EdgeId };
      const selected = sameRef(ref, own);
      el.classList.toggle("is-selected", selected);
      el.setAttribute("aria-pressed", String(selected));
    });
  }

  return { playStep, reset, setSelection, wait: motion.wait, refEl, remount: mount };
}
