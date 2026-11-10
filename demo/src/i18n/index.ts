import { de, type MessageKey } from "./de.js";
import { LANGUAGES, LANGUAGE_NAMES, pickLanguage, toLang, type Lang } from "./detect.js";
import { en } from "./en.js";
import { zh } from "./zh.js";

export type { MessageKey, Lang };

const MESSAGES: Record<Lang, Record<MessageKey, string>> = { de, en, zh };
const STORAGE_KEY = "a2aotel-lang";
/** Wert für das lang-Attribut der Seite. */
const HTML_LANG: Record<Lang, string> = { de: "de", en: "en", zh: "zh-Hans" };

// Der Browserspeicher kann gesperrt sein, z. B. im privaten Modus.
function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let current: Lang = pickLanguage({
  param: new URLSearchParams(location.search).get("lang"),
  stored: readStored(),
  browser: navigator.languages?.length ? navigator.languages : [navigator.language],
});

const listeners = new Set<() => void>();

export const getLang = () => current;

/** Liefert den Text zu einem Schlüssel und setzt Platzhalter wie {name} ein. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  return MESSAGES[current][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Übersetzt alle Elemente, die im HTML mit data-i18n markiert sind. */
export function applyStaticTexts() {
  document.documentElement.lang = HTML_LANG[current];
  document.title = t("meta.title");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("meta.description"));
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    element.innerHTML = t(element.dataset.i18n as MessageKey);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAria as MessageKey));
  });
}

export function onLanguageChange(listener: () => void) {
  listeners.add(listener);
}

export function setLang(next: Lang) {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Ohne Speicher gilt die Wahl nur für diesen Besuch.
  }
  applyStaticTexts();
  listeners.forEach((listener) => listener());
}

/** Baut die Sprachwahl. Jede Sprache steht in ihrer eigenen Sprache da. */
export function mountLanguageSwitch(select: HTMLSelectElement) {
  select.innerHTML = LANGUAGES.map(
    (lang) => `<option value="${lang}" lang="${HTML_LANG[lang]}">${LANGUAGE_NAMES[lang]}</option>`,
  ).join("");
  select.value = current;
  select.addEventListener("change", () => {
    const lang = toLang(select.value);
    if (lang) setLang(lang);
  });
}
