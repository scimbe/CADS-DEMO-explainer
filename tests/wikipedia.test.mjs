import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summaryUrl,
  fetchWikipediaSummary,
  normalizeExtract,
  WikipediaSourceError,
} from "../src/source/wikipedia.mjs";
import {
  extractNumbers,
  checkNumberGuard,
  buildVerbatimStoryboard,
  scenesToMarkdown,
  generateStoryboardFromSource,
} from "../src/script/generate.mjs";

// --- Wikipedia source module ---------------------------------------------------

/** A fake fetch returning a canned Response-like object. */
function fakeFetch({ status = 200, body = {} } = {}) {
  return async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });
}

test("summaryUrl encodes spaces as underscores and percent-encodes", () => {
  assert.equal(
    summaryUrl("Edge Computing"),
    "https://de.wikipedia.org/api/rest_v1/page/summary/Edge_Computing",
  );
  assert.equal(summaryUrl("Föderiertes Lernen").includes("F%C3%B6deriertes_Lernen"), true);
});

test("normalizeExtract collapses whitespace but keeps wording verbatim", () => {
  assert.equal(normalizeExtract("Edge   Computing\nist  ein\tBegriff."), "Edge Computing ist ein Begriff.");
});

test("fetchWikipediaSummary returns a clean fact source on a standard article", async () => {
  const body = {
    type: "standard",
    title: "Edge Computing",
    description: "Begriff für dezentrales Computermanagement",
    extract: "Edge Computing bezeichnet die dezentrale Datenverarbeitung am Rand des Netzwerks.",
    revision: "270011726",
    pageid: 9940142,
    content_urls: { desktop: { page: "https://de.wikipedia.org/wiki/Edge_Computing" } },
  };
  const s = await fetchWikipediaSummary("Fog Computing", { fetchImpl: fakeFetch({ body }) });
  assert.equal(s.title, "Edge Computing");
  assert.equal(s.url, "https://de.wikipedia.org/wiki/Edge_Computing");
  assert.equal(s.lang, "de");
  assert.match(s.extract, /dezentrale Datenverarbeitung/);
});

test("fetchWikipediaSummary rejects an empty topic", async () => {
  await assert.rejects(
    () => fetchWikipediaSummary("   ", { fetchImpl: fakeFetch() }),
    (e) => e instanceof WikipediaSourceError && e.kind === "input",
  );
});

test("fetchWikipediaSummary rejects a 404 with a not-found error", async () => {
  await assert.rejects(
    () => fetchWikipediaSummary("Zzxqwv", { fetchImpl: fakeFetch({ status: 404 }) }),
    (e) => e instanceof WikipediaSourceError && e.kind === "not-found",
  );
});

test("fetchWikipediaSummary rejects a disambiguation page", async () => {
  const body = { type: "disambiguation", title: "Merkur", extract: "Merkur steht für: …" };
  await assert.rejects(
    () => fetchWikipediaSummary("Merkur", { fetchImpl: fakeFetch({ body }) }),
    (e) => e instanceof WikipediaSourceError && e.kind === "disambiguation",
  );
});

test("fetchWikipediaSummary rejects an article with an empty extract", async () => {
  const body = { type: "standard", title: "Stub", extract: "   " };
  await assert.rejects(
    () => fetchWikipediaSummary("Stub", { fetchImpl: fakeFetch({ body }) }),
    (e) => e instanceof WikipediaSourceError && e.kind === "empty",
  );
});

// --- Number guard --------------------------------------------------------------

test("extractNumbers finds years, decimals and thousands groups, trims trailing separators", () => {
  assert.deepEqual(
    extractNumbers("Gegründet 1998, Anteil 1,5 Prozent, rund 1.000 Knoten."),
    ["1998", "1,5", "1.000"],
  );
});

test("checkNumberGuard passes when every source number is present verbatim", () => {
  const r = checkNumberGuard("1998 und 1,5 Prozent", "Im Jahr 1998 lag der Wert bei 1,5 Prozent.");
  assert.deepEqual(r, { ok: true, missing: [] });
});

test("checkNumberGuard flags a dropped number", () => {
  const r = checkNumberGuard("1998 und 1,5 Prozent", "Es geschah 1998.");
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["1,5"]);
});

test("checkNumberGuard flags a reformatted number (1.000 -> 1000) as missing", () => {
  const r = checkNumberGuard("rund 1.000 Knoten", "rund 1000 Knoten");
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["1.000"]);
});

test("checkNumberGuard does not match a number embedded in a larger one", () => {
  const r = checkNumberGuard("20 Prozent", "im Jahr 2020");
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["20"]);
});

// --- Verbatim fallback storyboard ----------------------------------------------

const SOURCE = {
  title: "Edge Computing",
  extract:
    "Edge Computing bezeichnet die dezentrale Datenverarbeitung am Rand des Netzwerks. " +
    "Der Begriff entstand um 1998. Er reduziert die Latenz gegenüber zentralen Rechenzentren. " +
    "Anwendungen finden sich im Internet der Dinge.",
  description: "Begriff für dezentrales Computermanagement",
  url: "https://de.wikipedia.org/wiki/Edge_Computing",
  lang: "de",
  revision: "270011726",
};

test("buildVerbatimStoryboard makes >=2 scenes of verbatim source sentences", () => {
  const scenes = buildVerbatimStoryboard(SOURCE);
  assert.ok(scenes.length >= 2);
  assert.equal(scenes[0].title, "Edge Computing");
  const joined = scenes.map((s) => s.narration).join(" ");
  // Every source number survives verbatim in the fallback (it's copied, not rewritten).
  assert.deepEqual(checkNumberGuard(SOURCE.extract, joined).missing, []);
});

test("buildVerbatimStoryboard throws when the source is a single sentence with no description", () => {
  assert.throws(
    () => buildVerbatimStoryboard({ title: "X", extract: "Nur ein Satz ohne Ende", description: "" }),
    /too short/,
  );
});

test("scenesToMarkdown emits a Wikipedia provenance comment header", () => {
  const md = scenesToMarkdown(
    [{ num: 1, title: "A", narration: "Text." }, { num: 2, title: "B", narration: "More." }],
    { lang: "de", title: "Edge Computing", url: SOURCE.url, revision: "270011726", grounding: "llm" },
  );
  assert.match(md, /^<!-- source: Wikipedia \(de\) — "Edge Computing" .*grounding=llm -->/);
  assert.match(md, /## Scene 1 — A/);
});

// --- generateStoryboardFromSource (LLM path + guarded fallback) -----------------

/** A stub LLM whose chat() returns fixed text. */
function stubLLM(text, model = "stub-model") {
  return { async chat() { return { text, model }; } };
}

test("generateStoryboardFromSource uses the LLM rewrite when the number-guard passes", async () => {
  const good =
    "## Scene 1 — Edge Computing\nEdge Computing verarbeitet Daten dezentral am Rand des Netzwerks.\n\n" +
    "## Scene 2 — Ursprung\nDer Begriff entstand um 1998 und reduziert die Latenz.\n\n" +
    "## Scene 3 — Zusammenfassung\nAnwendungen finden sich im Internet der Dinge.";
  const r = await generateStoryboardFromSource({ source: SOURCE, llm: stubLLM(good) });
  assert.equal(r.grounding, "llm");
  assert.equal(r.guard.ok, true);
  assert.equal(r.provenance.kind, "wikipedia");
  assert.equal(r.provenance.grounding, "llm");
  assert.match(r.markdown, /grounding=llm/);
});

test("generateStoryboardFromSource falls back to verbatim when the LLM drops a number", async () => {
  const dropped =
    "## Scene 1 — Edge Computing\nEdge Computing verarbeitet Daten dezentral.\n\n" +
    "## Scene 2 — Nutzen\nEs reduziert die Latenz und wird im Internet der Dinge genutzt.";
  const r = await generateStoryboardFromSource({ source: SOURCE, llm: stubLLM(dropped) });
  assert.equal(r.grounding, "verbatim-fallback");
  assert.equal(r.guard.ok, false);
  assert.deepEqual(r.guard.missing, ["1998"]);
  // Fallback narration is verbatim source, so the number is back.
  const joined = r.scenes.map((s) => s.narration).join(" ");
  assert.deepEqual(checkNumberGuard(SOURCE.extract, joined).missing, []);
});

test("generateStoryboardFromSource falls back to verbatim when the LLM output is unusable", async () => {
  const r = await generateStoryboardFromSource({ source: SOURCE, llm: stubLLM("garbage, no scenes here") });
  assert.equal(r.grounding, "verbatim-fallback");
  assert.match(r.guard.reason, /llm-error/);
});

test("generateStoryboardFromSource rejects an empty source extract", async () => {
  await assert.rejects(
    () => generateStoryboardFromSource({ source: { title: "X", extract: "" }, llm: stubLLM("x") }),
    /extract' is empty/,
  );
});
