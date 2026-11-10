import { createMotion, reducedMotion } from "./motion";
import type { EdgeId, FlowRef, NodeId, StepDef } from "./scenarios";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  subtitle: string;
  wrapped: boolean;
}

const NODES: Record<NodeId, Box> = {
  sachbearbeitung: { x: 16, y: 62, w: 124, h: 46, title: "Sachbearbeitung", subtitle: "", wrapped: false },
  supportagent: { x: 204, y: 40, w: 186, h: 90, title: "Supportagent", subtitle: "Agent", wrapped: true },
  dokumentenagent: { x: 550, y: 40, w: 194, h: 90, title: "Dokumentenagent", subtitle: "Agent", wrapped: true },
  "dokumenten-api": { x: 567, y: 204, w: 160, h: 64, title: "Dokumenten-API", subtitle: "Datenquelle", wrapped: false },
};

interface Line {
  from: [number, number];
  to: [number, number];
  label: string;
  labelAt: [number, number];
  name: string;
}

const EDGES: Record<EdgeId, Line> = {
  order: { from: [140, 85], to: [196, 85], label: "", labelAt: [168, 76], name: "Auftrag der Sachbearbeitung an den Supportagenten" },
  a2a: { from: [398, 68], to: [542, 68], label: "A2A SendMessage", labelAt: [470, 58], name: "Aufruf vom Supportagenten zum Dokumentenagenten" },
  back: { from: [542, 104], to: [398, 104], label: "Rückfrage", labelAt: [470, 124], name: "Rückfrage vom Dokumentenagenten zum Supportagenten" },
  data: { from: [647, 138], to: [647, 204], label: "liest", labelAt: [657, 172], name: "Zugriff des Dokumentenagenten auf die Dokumenten-API" },
};

const SVG_NS = "http://www.w3.org/2000/svg";

function nodeMarkup(id: NodeId, b: Box): string {
  const cx = b.x + b.w / 2;
  const ring = b.wrapped
    ? `<rect class="wrapper-ring" x="${b.x - 7}" y="${b.y - 7}" width="${b.w + 14}" height="${b.h + 14}" rx="16"/>
       <text class="wrapper-label" x="${b.x - 2}" y="${b.y - 13}">Wrapper</text>`
    : "";
  return `
  <g class="node${b.wrapped ? " is-agent" : ""}" data-node="${id}" tabindex="0" role="button"
     aria-pressed="false" aria-label="${b.title}${b.subtitle ? ", " + b.subtitle : ""}">
    ${ring}
    <rect class="select-ring" x="${b.x - 13}" y="${b.y - 13}" width="${b.w + 26}" height="${b.h + 26}" rx="21"/>
    <rect class="node-box" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="11"/>
    <text class="node-title" x="${cx}" y="${b.y + (b.h > 60 ? 30 : b.h / 2 + 5)}">${b.title}</text>
    ${b.subtitle ? `<text class="node-subtitle" x="${cx}" y="${b.y + 48}">${b.subtitle}</text>` : ""}
    <text class="node-status" x="${cx}" y="${b.y + b.h - 12}"></text>
    <g class="node-badge" transform="translate(${b.x + b.w - 4} ${b.y + 4})">
      <circle r="12"/><text y="5"></text>
    </g>
  </g>`;
}

function edgeMarkup(id: EdgeId, e: Line): string {
  const d = `M${e.from[0]} ${e.from[1]} L${e.to[0]} ${e.to[1]}`;
  return `
  <g class="edge" data-edge="${id}" tabindex="0" role="button" aria-pressed="false" aria-label="${e.name}">
    <path class="edge-hit" d="${d}"/>
    <path class="edge-halo" d="${d}"/>
    <path class="edge-line" d="${d}" marker-end="url(#arrow)"/>
    <text class="edge-label" x="${e.labelAt[0]}" y="${e.labelAt[1]}"${id === "data" ? ' text-anchor="start"' : ""}>${e.label}</text>
    <text class="edge-state" x="${e.labelAt[0]}" y="${e.labelAt[1] + (id === "a2a" || id === "order" ? -14 : 14)}"${id === "data" ? ' text-anchor="start"' : ""}></text>
  </g>`;
}

const sameRef = (a: FlowRef | null, b: FlowRef) => a?.type === b.type && a.id === b.id;

export function createFlow(host: HTMLElement, onSelect: (ref: FlowRef) => void) {
  host.innerHTML = `
  <svg viewBox="0 0 760 284" role="group" aria-label="Ablauf zwischen den Agenten">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/>
      </marker>
    </defs>
    ${(Object.keys(EDGES) as EdgeId[]).map((id) => edgeMarkup(id, EDGES[id])).join("")}
    ${(Object.keys(NODES) as NodeId[]).map((id) => nodeMarkup(id, NODES[id])).join("")}
    <g class="token" aria-hidden="true">
      <rect x="-13" y="-9" width="26" height="18" rx="3"/>
      <path d="M-13 -9 L0 2 L13 -9"/>
      <text y="5"></text>
    </g>
  </svg>`;

  const svg = host.querySelector("svg")!;
  const token = svg.querySelector<SVGGElement>(".token")!;
  const motion = createMotion();
  const nodeEl = (id: NodeId) => svg.querySelector<SVGGElement>(`[data-node="${id}"]`)!;
  const edgeEl = (id: EdgeId) => svg.querySelector<SVGGElement>(`[data-edge="${id}"]`)!;
  const refEl = (ref: FlowRef) => (ref.type === "node" ? nodeEl(ref.id) : edgeEl(ref.id));

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
    el.querySelector(".edge-state")!.textContent = state === "denied" ? "✗ verweigert" : "! ungeprüft";
  }

  async function fly(edge: EdgeId, reverse: boolean, tone: NonNullable<StepDef["tone"]>) {
    const { from, to } = EDGES[edge];
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
        setStatus(id, step.result ? "prüft Berechtigung" : "öffnet Span");
        await pulse(id, ".wrapper-ring", 700);
        if (step.result) {
          setBadge(id, step.result);
          setStatus(id, step.result === "allowed" ? "erlaubt" : "verweigert");
          // Verweigert wurde der Aufruf, also die Kante, über die er kam.
          if (step.denyEdge) markEdge(step.denyEdge, "denied");
        } else {
          setStatus(id, "Span geöffnet");
        }
        break;
      }
      case "work": {
        setStatus(step.node!, "arbeitet");
        await pulse(step.node!, ".node-box", 700);
        setStatus(step.node!, "");
        break;
      }
      case "data": {
        const tone = step.tone ?? "request";
        setStatus("dokumentenagent", "liest Dokumente");
        await fly("data", false, tone);
        await pulse("dokumenten-api", ".node-box", 400);
        await fly("data", true, tone === "leak" ? "leak" : "result");
        if (tone === "leak") markEdge("data", "leak");
        setStatus("dokumentenagent", "");
        break;
      }
      case "flag": {
        setBadge(step.node!, "flag");
        setStatus(step.node!, "Anweisung markiert");
        await pulse(step.node!, ".node-box", 600);
        break;
      }
    }
  }

  function reset(wrapper: boolean) {
    motion.cancelAll();
    svg.classList.toggle("no-wrapper", !wrapper);
    token.setAttribute("class", "token");
    (Object.keys(NODES) as NodeId[]).forEach((id) => {
      setStatus(id, "");
      setBadge(id, null);
      nodeEl(id).classList.remove("is-busy");
      nodeEl(id).querySelectorAll<SVGElement>("rect").forEach((r) => r.style.removeProperty("stroke-width"));
    });
    (Object.keys(EDGES) as EdgeId[]).forEach((id) => {
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

  return { playStep, reset, setSelection, wait: motion.wait, refEl };
}
