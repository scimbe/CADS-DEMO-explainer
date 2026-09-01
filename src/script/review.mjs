/**
 * Stage 2: LLM fact-check / review pass over a generated storyboard.
 *
 * Runs as a SEPARATE, independent `client.chat()` call — a fresh message list, never
 * appended to stage 1's own conversation — so it can't just rubber-stamp its own prior
 * output. Per scene it returns a structured verdict (OK/FLAG); a FLAG carries
 * replacement narration (never a diff). It may also override the scene's chosen
 * animation template and must supply that template's parameters, but it never invents
 * new narration content beyond a factual fix and never writes code.
 *
 * Everything here is deterministic parsing/validation around the LLM call — the LLM's
 * only job is the fenced-JSON-per-scene review format below.
 */
import { createLLM } from "../llm/client.mjs";
import { generateStoryboard, validateScenes, ALLOWED_TEMPLATES } from "./generate.mjs";

const REVIEW_HEADER_RE = /^##\s+Scene\s+(\d+)\s*[—-]\s*Verdict:\s*(OK|FLAG)\s*$/i;
const JSON_BLOCK_RE = /```json\s*\n([\s\S]*?)\n```/;

const REVIEW_SYSTEM_PROMPT = `You are fact-checking a narrated-video storyboard, scene by scene, and may fine-tune
each scene's chosen animation template. You do NOT write narration from scratch and
you NEVER write code — only prose fixes and small structured JSON.

For EACH scene, in order, output exactly one block:

## Scene N — Verdict: OK
\`\`\`json
{"templateOverride": null, "templateParams": null, "severity": null, "issue": null, "fix": null}
\`\`\`

or, if the scene has a concrete problem:

## Scene N — Verdict: FLAG
\`\`\`json
{"templateOverride": null, "templateParams": null, "severity": "major", "issue": "...", "fix": "..."}
\`\`\`

Field rules:
- "templateOverride": null to keep the storyboard's own Template choice, or the name
  of a better-suited template if you have a clear reason — one of: ${ALLOWED_TEMPLATES.join(", ")}.
  Only meaningful for a scene whose Layout is animated; leave null for a photo scene.
- "templateParams": REQUIRED (a non-null JSON object) whenever the scene's effective
  template (your templateOverride, or the storyboard's own Template if you leave
  templateOverride null) is anything other than "text-reveal". Must be null for
  "text-reveal" and for a photo-layout scene. Keep it small: short label strings taken
  from the scene's own content, small counts, named presets — never raw code.
- "severity": "major" if the claim is actively misleading or false, "minor" if merely
  imprecise. Required (non-null) when Verdict is FLAG.
- "issue": one short sentence naming the concrete problem. Required when Verdict is FLAG.
- "fix": the FULL replacement narration for the scene (never a diff), following the
  same rules as the original narration: one to three short plain-prose sentences,
  friendly to a text-to-speech engine, under 50 words. Required when Verdict is FLAG.

Use FLAG only for a concrete problem: a doubted fact, a contradiction with an earlier
scene, or an overstated/unverifiable claim. Never use FLAG for a phrasing preference.

Output ONLY the "## Scene N — Verdict: ..." blocks, one per scene, in order — no
preamble, no commentary, no extra blocks.`;

/** Render the storyboard for the review prompt. Pure, deterministic. */
export function buildReviewPrompt(topic, scenes) {
  const sceneBlocks = scenes
    .map((s) => {
      const lines = [`## Scene ${s.num} — ${s.title}`, `Layout: ${s.layout}`];
      if (s.layout === "animated") lines.push(`Template: ${s.template}`);
      lines.push(`Narration: ${s.narration}`);
      return lines.join("\n");
    })
    .join("\n\n");
  return `Topic: ${topic}\n\nStoryboard to review (${scenes.length} scenes):\n\n${sceneBlocks}`;
}

/**
 * Review response text -> [{num, verdict, templateOverride, templateParams, severity,
 * issue, fix}], in the order the blocks appeared. Pure, deterministic. Throws a
 * specific, named-scene reason on a missing header, missing fenced JSON, or invalid
 * JSON — this is a FORMAT failure, distinct from a content FLAG.
 */
export function parseReview(text) {
  const lines = (text ?? "").trim().split(/\r?\n/);
  const blocks = [];
  let cur = null;
  for (const raw of lines) {
    const m = raw.match(REVIEW_HEADER_RE);
    if (m) {
      cur = { num: Number(m[1]), verdict: m[2].toUpperCase(), lines: [] };
      blocks.push(cur);
      continue;
    }
    if (cur) cur.lines.push(raw);
  }
  if (blocks.length === 0) {
    throw new Error('parseReview: no "## Scene N — Verdict: OK|FLAG" headers found.');
  }
  return blocks.map((b) => {
    const blockText = b.lines.join("\n");
    const jm = blockText.match(JSON_BLOCK_RE);
    if (!jm) {
      throw new Error(`Scene ${b.num}: review block has no fenced \`\`\`json ... \`\`\` body.`);
    }
    let data;
    try {
      data = JSON.parse(jm[1]);
    } catch (e) {
      throw new Error(`Scene ${b.num}: review JSON is invalid: ${e.message}`);
    }
    return {
      num: b.num,
      verdict: b.verdict,
      templateOverride: data.templateOverride ?? null,
      templateParams: data.templateParams ?? null,
      severity: data.severity ?? null,
      issue: data.issue ?? null,
      fix: data.fix ?? null,
    };
  });
}

/**
 * Validate parsed review entries against the storyboard they reviewed. Throws with a
 * specific reason on a structural problem (wrong scene set, bad template name, missing
 * templateParams where required, a FLAG missing issue/fix text). Mutates entries only
 * to fail-closed an out-of-range severity on a FLAG to "major". Returns entries.
 *
 * `templates` is an optional `{ [name]: { paramSchema } }` registry (the shape
 * `src/render/templates.mjs`, §2 of the pipeline plan, is expected to export) used for
 * deeper per-template shape checks via `paramSchema.validate(params, sceneNum)` when
 * present. Without it, validation is bounded but generic: templateParams must simply
 * be a non-null object when required, and null otherwise.
 */
export function validateReview(entries, scenes, { templates } = {}) {
  const expected = scenes.map((s) => s.num);
  const got = entries.map((e) => e.num);
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    throw new Error(`Review scene numbers [${got.join(",")}] don't match storyboard [${expected.join(",")}].`);
  }
  entries.forEach((e, i) => {
    const s = scenes[i];
    if (e.templateOverride && !ALLOWED_TEMPLATES.includes(e.templateOverride)) {
      throw new Error(
        `Scene ${e.num}: bad templateOverride "${e.templateOverride}" (expected one of ${ALLOWED_TEMPLATES.join(", ")}).`,
      );
    }
    const effTemplate = s.layout === "photo" ? null : (e.templateOverride ?? s.template ?? "text-reveal");
    if (effTemplate && effTemplate !== "text-reveal") {
      if (e.templateParams == null || typeof e.templateParams !== "object") {
        throw new Error(`Scene ${e.num}: templateParams required for template "${effTemplate}".`);
      }
      const schema = templates?.[effTemplate]?.paramSchema;
      if (schema && typeof schema.validate === "function") {
        schema.validate(e.templateParams, e.num);
      }
    } else if (e.templateParams != null) {
      throw new Error(`Scene ${e.num}: templateParams must be null for template "${effTemplate ?? "photo"}".`);
    }
    if (e.verdict === "FLAG") {
      if (!["minor", "major"].includes(e.severity)) e.severity = "major"; // fail closed
      if (!e.issue?.trim() || !e.fix?.trim()) {
        throw new Error(`Scene ${e.num}: FLAG missing issue/fix text.`);
      }
    }
  });
  return entries;
}

/**
 * Merge validated review entries back into the storyboard's scenes: replace narration
 * on a FLAG, and resolve the final template/templateParams for each scene. The result
 * still needs `validateScenes` re-run over it (the caller does this) since narration
 * text just changed.
 */
export function applyReviewFixes(scenes, entries) {
  return scenes.map((s, i) => {
    const e = entries[i];
    const template = s.layout === "photo" ? null : (e.templateOverride ?? s.template ?? "text-reveal");
    return {
      ...s,
      narration: e.verdict === "FLAG" ? e.fix : s.narration,
      template,
      templateParams: template && template !== "text-reveal" ? e.templateParams : null,
    };
  });
}

/**
 * One review round: ask the LLM, parse, validate. On a FORMAT failure (missing
 * header/fence/bad JSON/wrong scene count/bad enum — never a content FLAG) it gets
 * exactly one automatic re-ask in the same round, with the exact error appended to the
 * prompt, before giving up.
 */
async function reviewOnce({ topic, scenes, client, model, templates }) {
  let lastErr;
  let extraNote = "";
  for (let attempt = 0; attempt <= 1; attempt++) {
    const userContent = buildReviewPrompt(topic, scenes) + extraNote;
    const result = await client.chat({
      messages: [
        { role: "system", content: REVIEW_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      model,
      temperature: 0.2,
      maxTokens: 3000,
    });
    try {
      const entries = parseReview(result.text);
      return validateReview(entries, scenes, { templates });
    } catch (e) {
      lastErr = e;
      extraNote = `\n\nYour previous response was invalid: ${e.message}\nRe-output ALL ${scenes.length} scene blocks in the exact required format, one "## Scene N — Verdict: OK|FLAG" block each.`;
    }
  }
  throw new Error(`reviewOnce: review response invalid after one retry: ${lastErr?.message}`);
}

/**
 * topic -> generate (stage 1) -> review (stage 2) -> apply fixes -> re-validate, with
 * bounded retries on both stages. Worst case: 2 generations x (1 gen + 2 review
 * rounds) = 6 LLM calls before an honest, explicit failure — this never silently ships
 * a storyboard with a still-flagged major-severity claim.
 *
 * @param {{topic:string, llm?:object, model?:string, templates?:object}} opts
 * @returns {Promise<{scenes:Array, entries:Array, notes:Array, model:string, genAttempts:number, reviewRounds:number}>}
 */
export async function generateReviewedStoryboard({ topic, llm, model, templates } = {}) {
  const cleanTopic = (topic ?? "").trim();
  if (!cleanTopic) throw new Error("generateReviewedStoryboard: 'topic' is empty.");

  const client = llm ?? createLLM();
  const MAX_GENERATIONS = 2;
  const MAX_REVIEW_ROUNDS = 2;
  let lastError;

  for (let gen = 1; gen <= MAX_GENERATIONS; gen++) {
    let storyboard;
    try {
      storyboard = await generateStoryboard({ topic: cleanTopic, llm: client, model });
    } catch (e) {
      lastError = e;
      continue;
    }

    let scenes = storyboard.scenes;
    let entries = [];
    let notes = [];
    let converged = false;

    for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
      try {
        entries = await reviewOnce({ topic: cleanTopic, scenes, client, model, templates });
      } catch (e) {
        lastError = e;
        break; // give up on this generation, try a fresh storyboard
      }
      const flags = entries.filter((e) => e.verdict === "FLAG");
      const major = flags.filter((f) => f.severity === "major");
      const minor = flags.filter((f) => f.severity === "minor");
      scenes = validateScenes(applyReviewFixes(scenes, entries));
      notes = notes.concat(minor.map((f) => ({ scene: f.num, issue: f.issue })));
      if (major.length === 0) {
        converged = true;
        return { scenes, entries, notes, model: storyboard.model, genAttempts: gen, reviewRounds: round };
      }
      lastError = new Error(`Review round ${round}: ${major.length} scene(s) still flagged major.`);
    }
    if (!converged && !lastError) {
      lastError = new Error(`Review did not converge after ${MAX_REVIEW_ROUNDS} round(s).`);
    }
  }
  throw new Error(`generateReviewedStoryboard: gave up after ${MAX_GENERATIONS} generation(s). ${lastError?.message ?? ""}`);
}

// --- CLI -----------------------------------------------------------------------
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const topic = process.argv.slice(2).join(" ");
  if (!topic) {
    process.stderr.write("Usage: node src/script/review.mjs <topic...>\n");
    process.exit(2);
  }
  generateReviewedStoryboard({ topic })
    .then((r) => {
      for (const s of r.scenes) {
        process.stdout.write(`## Scene ${s.num} — ${s.title}\nLayout: ${s.layout}${s.template ? ` / Template: ${s.template}` : ""}\n${s.narration}\n\n`);
      }
      process.stderr.write(
        `\n[model: ${r.model}, ${r.scenes.length} scenes, ${r.genAttempts} generation(s), ${r.reviewRounds} review round(s), ${r.notes.length} minor note(s)]\n`,
      );
    })
    .catch((e) => {
      process.stderr.write(`FAILED: ${e.message}\n`);
      process.exit(1);
    });
}
