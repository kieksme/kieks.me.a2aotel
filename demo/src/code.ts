import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import supportagentSource from "../../src/agents/supportagent.ts?raw";
import dokumentenagentSource from "../../src/agents/dokumentenagent.ts?raw";
import wrapperSource from "../../src/telemetry/wrapper.ts?raw";
import setupSource from "../../src/telemetry/setup.ts?raw";
import policySource from "../../src/authz/policy.ts?raw";
import matrixSource from "../../src/authz/matrix.json?raw";
import { isMarkerLine, parseRegions, type Region } from "./regions";
import { reducedMotion } from "./motion";
import { FILE_PATHS, type FileId } from "./scenarios";

export const REPO_URL = "https://github.com/kieksme/kieks.me.a2aotel";

interface SourceFile {
  label: string;
  lang: "typescript" | "json";
  source: string;
  about: string;
}

/**
 * Die angezeigten Dateien. Der Quelltext kommt per ?raw-Import direkt aus
 * dem Repository. Es gibt keine zweite Kopie, die veralten könnte.
 */
export const FILES: Record<FileId, SourceFile> = {
  supportagent: {
    label: "Supportagent",
    lang: "typescript",
    source: supportagentSource,
    about: "Agentendefinition und Agent Card. Enthält keine Berechtigungsprüfung.",
  },
  dokumentenagent: {
    label: "Dokumentenagent",
    lang: "typescript",
    source: dokumentenagentSource,
    about: "Agentendefinition und Agent Card. Enthält keine Berechtigungsprüfung.",
  },
  wrapper: {
    label: "Wrapper",
    lang: "typescript",
    source: wrapperSource,
    about: "Legt Trace-Kontext, Berechtigungsprüfung und Span um jeden Agenten.",
  },
  policy: {
    label: "Berechtigungsprüfung",
    lang: "typescript",
    source: policySource,
    about: "Prüft jeden Aufruf. Standard ist ablehnen.",
  },
  matrix: {
    label: "Matrix",
    lang: "json",
    source: matrixSource,
    about: "Wer darf bei wem was. Konfiguration mit Regelversion, kein Code.",
  },
  setup: {
    label: "Tracing-Setup",
    lang: "typescript",
    source: setupSource,
    about: "Tracer pro Dienst und Auswahl des Exporters.",
  },
};

let highlighterPromise: Promise<HighlighterCore> | undefined;

/** Lädt die Syntax-Hervorhebung nur einmal und nur mit den nötigen Sprachen. */
export function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
    langs: [import("shiki/langs/typescript.mjs"), import("shiki/langs/json.mjs")],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

/** Rendert Quelltext als Zeilenliste, damit einzelne Zeilen markiert werden können. */
export async function renderCode(target: HTMLElement, source: string, lang: "typescript" | "json") {
  const text = source.replace(/\n$/, "");
  const lines = text.split("\n");
  const fill = (htmlLines: string[]) => {
    target.innerHTML = "";
    const code = document.createElement("code");
    htmlLines.forEach((html, index) => {
      const line = document.createElement("span");
      line.className = "line";
      if (isMarkerLine(lines[index] ?? "")) line.classList.add("marker-line");
      line.dataset.line = String(index + 1);
      line.innerHTML = html || " ";
      code.append(line);
    });
    target.append(code);
  };

  // Erst als reiner Text, damit sofort etwas zu sehen ist.
  fill(lines.map((line) => line.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)));

  const highlighter = await getHighlighter();
  const html = highlighter.codeToHtml(text, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
  const parsed = new DOMParser().parseFromString(html, "text/html");
  fill([...parsed.querySelectorAll(".line")].map((line) => line.innerHTML));
}

export function createCodeView(host: HTMLElement) {
  const ids = Object.keys(FILES) as FileId[];
  host.innerHTML = `
    <div class="file-tabs" role="tablist" aria-label="Dateien">
      ${ids
        .map(
          (id) =>
            `<button type="button" role="tab" id="file-tab-${id}" aria-controls="code-panel" aria-selected="false" tabindex="-1" data-file="${id}">${FILES[id].label}</button>`,
        )
        .join("")}
    </div>
    <div class="code-panel" id="code-panel" role="tabpanel">
      <div class="code-meta">
        <div>
          <code class="code-path"></code>
          <p class="code-about muted"></p>
        </div>
        <a class="code-link" target="_blank" rel="noopener">Datei auf GitHub</a>
      </div>
      <p class="code-active" aria-live="polite" hidden></p>
      <pre class="code-scroll shiki" tabindex="0" aria-label="Quelltext"></pre>
    </div>`;

  const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panel = host.querySelector<HTMLElement>(".code-panel")!;
  const pre = host.querySelector<HTMLPreElement>(".code-scroll")!;
  const link = host.querySelector<HTMLAnchorElement>(".code-link")!;
  const active = host.querySelector<HTMLElement>(".code-active")!;
  const regions = new Map(ids.map((id) => [id, parseRegions(FILES[id].source)]));

  let current: FileId | null = null;
  let token = 0;

  function mark(region: Region | undefined) {
    pre.querySelectorAll(".active-line").forEach((el) => el.classList.remove("active-line"));
    if (!region) return;
    let first: HTMLElement | null = null;
    for (let n = region.start; n <= region.end; n++) {
      const line = pre.querySelector<HTMLElement>(`[data-line="${n}"]`);
      line?.classList.add("active-line");
      first ??= line;
    }
    // Nur innerhalb des Code-Fensters scrollen, die Seite bleibt stehen.
    if (first) {
      pre.scrollTo({
        top: Math.max(0, first.offsetTop - 48),
        behavior: reducedMotion() ? "auto" : "smooth",
      });
    }
  }

  /** Zeigt eine Datei und markiert optional einen Bereich darin. */
  async function show(file: FileId, regionName?: string, note?: string) {
    const mine = ++token;
    const info = FILES[file];
    const region = regionName ? regions.get(file)?.get(regionName) : undefined;

    tabs.forEach((tab) => {
      const selected = tab.dataset.file === file;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panel.setAttribute("aria-labelledby", `file-tab-${file}`);
    host.querySelector(".code-path")!.textContent = FILE_PATHS[file];
    host.querySelector(".code-about")!.textContent = info.about;
    link.href = `${REPO_URL}/blob/main/${FILE_PATHS[file]}${region ? `#L${region.start}-L${region.end}` : ""}`;
    link.textContent = region ? "Diese Stelle auf GitHub" : "Datei auf GitHub";
    active.hidden = !note;
    active.textContent = note ? `Aktiver Schritt: ${note}` : "";

    if (current !== file) {
      current = file;
      await renderCode(pre, info.source, info.lang);
      if (mine !== token) return;
    }
    mark(region);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => show(tab.dataset.file as FileId));
    tab.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = tabs[(index + step + tabs.length) % tabs.length]!;
      next.focus();
      show(next.dataset.file as FileId);
    });
  });

  return { show };
}
