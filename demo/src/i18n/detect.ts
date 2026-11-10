export const LANGUAGES = ["de", "en", "zh"] as const;
export type Lang = (typeof LANGUAGES)[number];

/** Namen der Sprachen in der jeweils eigenen Sprache. */
export const LANGUAGE_NAMES: Record<Lang, string> = {
  de: "Deutsch",
  en: "English",
  zh: "中文",
};

/** Macht aus einem Sprachcode wie "zh-CN" oder "de-AT" eine unterstützte Sprache. */
export function toLang(code: string | null | undefined): Lang | undefined {
  const base = code?.toLowerCase().split(/[-_]/)[0];
  return LANGUAGES.find((lang) => lang === base);
}

/**
 * Wählt die Sprache in dieser Reihenfolge:
 *   1. ausdrücklich gesetzt über die Adresse (?lang=en)
 *   2. zuletzt selbst gewählt (im Browser gespeichert)
 *   3. die bevorzugten Sprachen des Browsers, in dessen Reihenfolge
 *   4. Englisch als Rückfall
 */
export function pickLanguage(sources: {
  param?: string | null;
  stored?: string | null;
  browser?: readonly string[];
}): Lang {
  return (
    toLang(sources.param) ??
    toLang(sources.stored) ??
    (sources.browser ?? []).map(toLang).find((lang) => lang !== undefined) ??
    "en"
  );
}
