import { describe, expect, it } from "vitest";
import { de, type MessageKey } from "../demo/src/i18n/de.js";
import { pickLanguage, toLang } from "../demo/src/i18n/detect.js";
import { en } from "../demo/src/i18n/en.js";
import { zh } from "../demo/src/i18n/zh.js";

const keys = Object.keys(de) as MessageKey[];
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tags = (text: string) => [...text.matchAll(/<\/?(\w+)>/g)].map((m) => m[0]).sort();

describe("Übersetzungen", () => {
  it.each([
    ["en", en],
    ["zh", zh],
  ] as const)("%s hat dieselben Schlüssel, Platzhalter und Auszeichnungen wie Deutsch", (_, messages) => {
    expect(Object.keys(messages).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(placeholders(messages[key]), key).toEqual(placeholders(de[key]));
      expect(tags(messages[key]), key).toEqual(tags(de[key]));
    }
  });

  it("lässt keinen Text leer, außer den Hinweisen, die es nur in den Fremdsprachen gibt", () => {
    const onlyForeign = ["card.contentNote", "code.commentsNote"];
    for (const key of keys) {
      if (!onlyForeign.includes(key)) expect(de[key], key).not.toBe("");
      expect(en[key], key).not.toBe("");
      expect(zh[key], key).not.toBe("");
    }
  });

  it("übersetzt wirklich: Englisch und Chinesisch weichen vom Deutschen ab", () => {
    const same = (messages: Record<MessageKey, string>) =>
      keys.filter((key) => messages[key] === de[key] && de[key].length > 25);
    expect(same(en)).toEqual([]);
    expect(same(zh)).toEqual([]);
  });
});

describe("Sprachwahl", () => {
  it("erkennt Sprachcodes mit Region", () => {
    expect(toLang("zh-CN")).toBe("zh");
    expect(toLang("zh-Hant-TW")).toBe("zh");
    expect(toLang("de-AT")).toBe("de");
    expect(toLang("EN_us")).toBe("en");
    expect(toLang("fr")).toBeUndefined();
  });

  it("nimmt die erste unterstützte Sprache des Browsers", () => {
    expect(pickLanguage({ browser: ["fr-FR", "zh-CN", "en"] })).toBe("zh");
    expect(pickLanguage({ browser: ["de-DE", "en"] })).toBe("de");
  });

  it("fällt auf Englisch zurück", () => {
    expect(pickLanguage({ browser: ["fr", "es"] })).toBe("en");
    expect(pickLanguage({})).toBe("en");
  });

  it("stellt die eigene Wahl vor den Browser und die Adresse vor alles", () => {
    expect(pickLanguage({ stored: "en", browser: ["de"] })).toBe("en");
    expect(pickLanguage({ param: "zh", stored: "en", browser: ["de"] })).toBe("zh");
    expect(pickLanguage({ param: "xx", stored: "en", browser: ["de"] })).toBe("en");
  });
});
