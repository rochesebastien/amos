import { describe, expect, it } from "vitest";
import { dict } from "@/lib/dictionaries";
import { LANGUAGES } from "@/lib/lang";

// The dictionaries are hand-maintained, and a missing key does not throw at
// runtime — `translate()` silently falls back to English, or to the raw key.
// That is exactly the kind of regression nobody notices until a French user
// reports seeing `project.brokenTitle` on screen, so the parity check lives in
// the test suite rather than in a review checklist.

const LANGS = ["en", "fr"] as const;

/** `{var}` placeholders a string interpolates, in a stable order. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe("i18n dictionaries", () => {
  it("ships exactly the languages the picker offers", () => {
    expect(Object.keys(dict).sort()).toEqual([...LANGS].sort());
    expect(LANGUAGES.map((l) => l.value).sort()).toEqual([...LANGS].sort());
  });

  it("has identical key sets in en and fr", () => {
    const en = Object.keys(dict.en).sort();
    const fr = Object.keys(dict.fr).sort();

    // Report the two directions separately: "missing in fr" and "extra in fr"
    // are different mistakes, and a bare set diff makes them hard to tell apart.
    expect(en.filter((k) => !(k in dict.fr))).toEqual([]);
    expect(fr.filter((k) => !(k in dict.en))).toEqual([]);
    expect(fr).toEqual(en);
  });

  it("interpolates the same variables in both languages", () => {
    for (const key of Object.keys(dict.en)) {
      expect(placeholders(dict.fr[key] ?? ""), `placeholders of "${key}"`).toEqual(
        placeholders(dict.en[key]),
      );
    }
  });

  it("has no empty translation", () => {
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(dict[lang])) {
        expect(value.trim(), `${lang}."${key}"`).not.toBe("");
      }
    }
  });
});
