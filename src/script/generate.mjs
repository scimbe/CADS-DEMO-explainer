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
