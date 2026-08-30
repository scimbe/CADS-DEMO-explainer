import { test } from "node:test";
import assert from "node:assert/strict";
import { stripPronunciation } from "../src/text/sanitize.mjs";
import { checkNumberGuard, buildVerbatimStoryboard } from "../src/script/generate.mjs";

test("strips a bracketed IPA gloss and tidies the surrounding spaces", () => {
  assert.equal(stripPronunciation("Hannover [haˈnoːfɐ] ist eine Stadt."), "Hannover ist eine Stadt.");
});

test("strips an (IPA: [...]) labelled gloss, inner phonetics and wrapper both", () => {
  assert.equal(stripPronunciation("Kiel (IPA: [kiːl]) liegt am Meer."), "Kiel liegt am Meer.");
});

test("removes a space stranded before punctuation after a mid-sentence gloss", () => {
  assert.equal(stripPronunciation("Hannover [haˈnoːfɐ], die Stadt."), "Hannover, die Stadt.");
});

test("keeps ordinary parentheticals and numbers untouched", () => {
  assert.equal(
    stripPronunciation("Hamburg (Hansestadt) wurde 2023 (im Jahr) erwähnt."),
    "Hamburg (Hansestadt) wurde 2023 (im Jahr) erwähnt.",
  );
});

test("is idempotent — a second pass changes nothing", () => {
  const once = stripPronunciation("Kiel (IPA: [kiːl]) und Hannover [haˈnoːfɐ].");
  assert.equal(stripPronunciation(once), once);
});

test("handles empty / nullish input without throwing", () => {
  assert.equal(stripPronunciation(""), "");
  assert.equal(stripPronunciation(undefined), "");
  assert.equal(stripPronunciation(null), "");
});

test("does not touch a number that sits inside brackets without an IPA marker", () => {
  // "(2023)" has no phonetic marker and no IPA label -> left as-is, numbers preserved.
  const cleaned = stripPronunciation("Gegründet (2023) mit 1.000 Knoten.");
  assert.equal(cleaned, "Gegründet (2023) mit 1.000 Knoten.");
  assert.deepEqual(checkNumberGuard("2023 1.000", cleaned).missing, []);
});

test("number-guard stays symmetric when both sides are sanitized (IPA carries no fact)", () => {
  const source = "Kiel (IPA: [kiːl]) hat 246.601 Einwohner.";
  const generated = "Kiel hat 246.601 Einwohner.";
  const r = checkNumberGuard(stripPronunciation(source), stripPronunciation(generated));
  assert.deepEqual(r, { ok: true, missing: [] });
});

test("buildVerbatimStoryboard yields IPA-free narration when fed a sanitized source", () => {
  const source = {
    title: "Kiel",
    extract: stripPronunciation(
      "Kiel [kiːl] ist die Landeshauptstadt Schleswig-Holsteins. " +
        "Die Stadt hat rund 246.601 Einwohner. Sie liegt an der Ostsee.",
    ),
    description: "Landeshauptstadt von Schleswig-Holstein",
    url: "https://de.wikipedia.org/wiki/Kiel",
    lang: "de",
  };
  const scenes = buildVerbatimStoryboard(source);
  const joined = scenes.map((s) => s.narration).join(" ");
  assert.doesNotMatch(joined, /[ˈˌːˑ]/); // no leftover IPA markers
  assert.deepEqual(checkNumberGuard("246.601", joined).missing, []); // fact number survives
});
