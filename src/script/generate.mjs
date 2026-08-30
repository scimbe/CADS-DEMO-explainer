/**
 * Topic -> storyboard/teleprompter script (LLM-authored, deterministically parsed).
 *
 * Scene format (credit: adapted from scimbe/SlideCreator's teleprompter contract,
 * `## Szene NN — Titel` -> renamed to English `## Scene N — Title` for this public demo):
 *
 *   ## Scene 1 — Title
 *   Narration text for this scene, one to three short sentences.
 *
 *   ## Scene 2 — Title
 *   ...
 *
 * Everything past script generation (TTS, slide rendering, muxing) is non-LLM,
 * deterministic code — the LLM's only job is this markdown.
 */
import { createLLM } from "../llm/client.mjs";
import { stripPronunciation } from "../text/sanitize.mjs";

const SCENE_RE = /^##\s+Scene\s+(\d+)\s*[—-]\s*(.+?)\s*$/i;

const SYSTEM_PROMPT = `You write short narrated-video storyboards for a technical explainer-video demo.

Given a topic, output a storyboard as Markdown with 4 to 6 scenes. Output ONLY the
Markdown below — no preamble, no code fences, no commentary.

Format (repeat per scene):
## Scene N — Short Title
One to three short sentences of narration (plain prose, no markdown, no bullet points,
no abbreviations that a text-to-speech engine would mispronounce). Each sentence should
be easy to read aloud. Keep each scene's narration under 50 words.

Rules:
- Exactly one blank line between the header and the narration, and between scenes.
- Scene numbers start at 1 and increase by 1.
- The FIRST scene introduces the topic; the LAST scene is a short summary/takeaway.
- Be factually careful: state only things you are reasonably confident are true; prefer
  general, defensible statements over specific unverifiable claims.
- No emoji, no markdown formatting inside the narration text.`;

/** Strip code fences / preamble a model might add despite instructions. */
export function cleanScript(text) {
  let s = text.trim();
  // A fence wrapping the whole response.
  const fence = s.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) s = fence[1].trim();
  // Any preamble before the first scene header ("Sure, here's the storyboard:" etc.).
  const idx = s.indexOf("## Scene");
  if (idx > 0) s = s.slice(idx).trim();
  // A stray trailing fence marker left over when the fence wrapped the preamble too
  // (so the leading ``` was outside the sliced region and never matched above).
  s = s.replace(/\n?```\s*$/, "").trim();
  return `${s}\n`;
}

/** Markdown -> [{num, title, narration}]. Pure, deterministic, no I/O. */
export function parseTeleprompter(mdContent) {
  const lines = mdContent.split(/\r?\n/);
  const scenes = [];
  let cur = null;
  let inFence = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = raw.match(SCENE_RE);
    if (m) {
      cur = { num: Number(m[1]), title: m[2].trim(), bodyLines: [] };
      scenes.push(cur);
      continue;
    }
    if (!cur || !line) continue;
    if (/^(#|>|\||---)/.test(line)) continue;
    cur.bodyLines.push(line);
  }
  return scenes.map((s) => ({
    num: s.num,
    title: s.title,
    narration: s.bodyLines.join(" ").replace(/\s+/g, " ").trim(),
  }));
}

/** Validate a parsed storyboard is usable downstream. Throws with a specific reason. */
export function validateScenes(scenes) {
  if (scenes.length < 2) throw new Error(`Storyboard has ${scenes.length} scene(s), need at least 2.`);
  for (const s of scenes) {
    if (!s.title) throw new Error(`Scene ${s.num} has no title.`);
    if (!s.narration) throw new Error(`Scene ${s.num} ("${s.title}") has no narration text.`);
  }
  const nums = scenes.map((s) => s.num);
  const expected = nums.map((_, i) => i + 1);
  if (JSON.stringify(nums) !== JSON.stringify(expected)) {
    throw new Error(`Scene numbers are not sequential starting at 1: got [${nums.join(",")}]`);
  }
  return scenes;
}

/**
 * @param {{topic:string, llm?:object, model?:string}} opts
 * @returns {Promise<{markdown:string, scenes:Array, model:string}>}
 */
export async function generateStoryboard({ topic, llm, model } = {}) {
  const cleanTopic = (topic ?? "").trim();
  if (!cleanTopic) throw new Error("generateStoryboard: 'topic' is empty.");

  const client = llm ?? createLLM();
  const result = await client.chat({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Topic: ${cleanTopic}` },
    ],
    temperature: 0.4,
    maxTokens: 1500,
  });

  const markdown = cleanScript(result.text);
  const scenes = validateScenes(parseTeleprompter(markdown));
  return { markdown, scenes, model: result.model };
}

// --- Wikipedia-grounded storyboard ---------------------------------------------
// A second entry path: instead of letting the LLM free-associate about a topic, we
// hand it a verbatim Wikipedia lead paragraph as the ONLY facts it may use. Two
// guards keep the output honest: a strict "ground only in this text" system prompt,
// and a deterministic number-guard below. If the LLM drops or alters any number
// from the source, we discard its rewrite and fall back to a storyboard built
// verbatim from the source sentences — so a factual number is never silently
// changed on the way to narration.

const SOURCE_SYSTEM_PROMPT = `You turn a single encyclopedic source text into a short narrated-video storyboard.

You are given a SOURCE (a verbatim Wikipedia lead paragraph) and a TITLE. Write a
storyboard with 4 to 6 scenes that a viewer could watch to understand the topic.

Absolute rules:
- Use ONLY facts stated in the SOURCE. Do not add facts, examples, dates, numbers,
  names, or claims that are not in the SOURCE. If the SOURCE does not say it, you must not say it.
- Copy every number, year, percentage, and proper name EXACTLY as written in the SOURCE.
  Never round, convert, translate, or reformat a number.
- Write the narration in the SAME language as the SOURCE.
- You may split, shorten, and re-order the SOURCE's information across scenes, and add
  short connective phrasing, but the factual content must stay within the SOURCE.

Output ONLY the Markdown below — no preamble, no code fences, no commentary.

Format (repeat per scene):
## Scene N — Short Title
One to three short sentences of narration (plain prose, no markdown, no bullet points).
Keep each scene's narration under 50 words and easy to read aloud.

Structure rules:
- Exactly one blank line between the header and the narration, and between scenes.
- Scene numbers start at 1 and increase by 1.
- The FIRST scene introduces the topic; the LAST scene is a short summary/takeaway drawn only from the SOURCE.
- No emoji, no markdown formatting inside the narration text.`;

/**
 * Extract number-like tokens (years, decimals, thousands groups, percentages'
 * numeric part) as verbatim strings. Maximal runs of digits with embedded
 * `.`/`,` separators, trailing separators trimmed. Used only for the guard —
 * comparison is done on the exact source spelling, never a reformatted form.
 */
export function extractNumbers(text) {
  const matches = String(text ?? "").match(/\d[\d.,]*/g) || [];
  return matches.map((t) => t.replace(/[.,]+$/, "")).filter(Boolean);
}

/**
 * Number-guard: every distinct number in `sourceText` must appear verbatim in
 * `outputText`. Both sides are tokenized with the same maximal-run extractor, so
 * comparison is exact and boundary-safe — "20" is not satisfied by "2020", and a
 * reformatted number ("1.000" -> "1000") counts as missing. That strictness makes
 * the caller fall back to the verbatim source rather than ship an altered figure.
 * @returns {{ok:boolean, missing:string[]}}
 */
export function checkNumberGuard(sourceText, outputText) {
  const present = new Set(extractNumbers(outputText));
  const seen = new Set();
  const missing = [];
  for (const n of extractNumbers(sourceText)) {
    if (seen.has(n)) continue;
    seen.add(n);
    if (!present.has(n)) missing.push(n);
  }
  return { ok: missing.length === 0, missing };
}

/** Split a paragraph into sentences without fabricating text (verbatim chunks). */
function splitSentences(text) {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Deterministic fallback: a storyboard whose narration is verbatim source text,
 * so it invents nothing. Sentences from the extract are distributed across up to
 * `maxScenes` scenes; every scene reuses the article title (a title is structural,
 * not a factual claim). Throws if the source can't yield at least two scenes.
 */
export function buildVerbatimStoryboard(source, { maxScenes = 5 } = {}) {
  const title = (source?.title || "").trim() || "Topic";
  let chunks = splitSentences(source?.extract || "");
  // If the lead is a single sentence, use the short Wikipedia description (also
  // source-provided) as a second, distinct chunk so we can form two scenes.
  if (chunks.length < 2 && (source?.description || "").trim()) {
    const desc = source.description.trim();
    const descSentence = /[.!?]$/.test(desc) ? desc : `${desc}.`;
    chunks = [descSentence, ...chunks];
  }
  if (chunks.length < 2) {
    throw new Error(
      `Wikipedia source for "${title}" is too short to build a grounded storyboard (need at least two sentences).`,
    );
  }
  const sceneCount = Math.min(maxScenes, chunks.length);
  const buckets = Array.from({ length: sceneCount }, () => []);
  chunks.forEach((sentence, i) => buckets[i % sceneCount].push(sentence));
  const scenes = buckets.map((sentences, i) => ({
    num: i + 1,
    title,
    narration: sentences.join(" ").replace(/\s+/g, " ").trim(),
  }));
  return validateScenes(scenes);
}

/** Render parsed scenes back to teleprompter markdown, with a provenance header comment. */
export function scenesToMarkdown(scenes, provenance) {
  const header = provenance
    ? `<!-- source: Wikipedia (${provenance.lang}) — "${provenance.title}" ${provenance.url}` +
      `${provenance.revision ? ` rev ${provenance.revision}` : ""} grounding=${provenance.grounding} -->\n\n`
    : "";
  const body = scenes
    .map((s) => `## Scene ${s.num} — ${s.title}\n${s.narration}`)
    .join("\n\n");
  return `${header}${body}\n`;
}

/**
 * Wikipedia-grounded storyboard. Tries the LLM rewrite of the source extract; if
 * that fails to parse/validate or trips the number-guard, falls back to a verbatim
 * storyboard built straight from the source sentences.
 *
 * @param {{source:{title:string,extract:string,description?:string,url:string,lang:string,revision?:string},
 *          llm?:object, model?:string}} opts
 * @returns {Promise<{markdown:string, scenes:Array, model:string,
 *          grounding:"llm"|"verbatim-fallback", provenance:object, guard:object}>}
 */
export async function generateStoryboardFromSource({ source, llm, model } = {}) {
  if (!source || !String(source.extract ?? "").trim()) {
    throw new Error("generateStoryboardFromSource: 'source.extract' is empty.");
  }
  const provenanceBase = {
    kind: "wikipedia",
    title: source.title,
    url: source.url,
    lang: source.lang,
    revision: source.revision || "",
  };

  // Strip IPA pronunciation glosses up front, so every downstream consumer -- the
  // LLM prompt, the number-guard, and the verbatim fallback -- sees the same clean
  // text. Sanitizing the guard's source side here keeps it symmetric with the
  // sanitized narration below, so the number comparison never breaks over an IPA edit.
  const cleanExtract = stripPronunciation(source.extract);
  const cleanSource = {
    ...source,
    extract: cleanExtract,
    description: stripPronunciation(source.description || ""),
  };

  let llmScenes = null;
  let usedModel = model || "verbatim-fallback";
  let guard = { ok: false, missing: [], reason: "not-run" };

  try {
    const client = llm ?? createLLM();
    const result = await client.chat({
      messages: [
        { role: "system", content: SOURCE_SYSTEM_PROMPT },
        { role: "user", content: `TITLE: ${cleanSource.title}\n\nSOURCE:\n${cleanExtract}` },
      ],
      model,
      temperature: 0.2,
      maxTokens: 1500,
    });
    usedModel = result.model;
    const parsed = validateScenes(parseTeleprompter(cleanScript(result.text)))
      .map((s) => ({ ...s, narration: stripPronunciation(s.narration) }));
    const narration = parsed.map((s) => s.narration).join(" ");
    const g = checkNumberGuard(cleanExtract, narration);
    guard = { ok: g.ok, missing: g.missing, reason: g.ok ? "passed" : "numbers-missing" };
    if (g.ok) llmScenes = parsed;
  } catch (e) {
    guard = { ok: false, missing: [], reason: `llm-error: ${e.message}` };
  }

  const grounding = llmScenes ? "llm" : "verbatim-fallback";
  const scenes = llmScenes ?? buildVerbatimStoryboard(cleanSource);
  const provenance = { ...provenanceBase, grounding, model: usedModel };
  const markdown = scenesToMarkdown(scenes, provenance);
  return { markdown, scenes, model: usedModel, grounding, provenance, guard };
}

// --- CLI -----------------------------------------------------------------------
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const topic = process.argv.slice(2).join(" ");
  if (!topic) {
    process.stderr.write("Usage: node src/script/generate.mjs <topic...>\n");
    process.exit(2);
  }
  generateStoryboard({ topic })
    .then((r) => {
      process.stdout.write(r.markdown);
      process.stderr.write(`\n[model: ${r.model}, ${r.scenes.length} scenes]\n`);
    })
    .catch((e) => {
      process.stderr.write(`FAILED: ${e.message}\n`);
      process.exit(1);
    });
}
