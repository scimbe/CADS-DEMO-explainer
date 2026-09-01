import { test } from "node:test";
import assert from "node:assert/strict";
import { validateScenes, parseTeleprompter } from "../src/script/generate.mjs";
import {
  buildReviewPrompt,
  parseReview,
  validateReview,
  applyReviewFixes,
  generateReviewedStoryboard,
} from "../src/script/review.mjs";

function scenes2(overrides = {}) {
  return validateScenes(
    parseTeleprompter("## Scene 1 — A\nFirst narration.\n\n## Scene 2 — B\nSecond narration.\n"),
  ).map((s) => ({ ...s, ...overrides }));
}

function okBlock(num) {
  return `## Scene ${num} — Verdict: OK\n\`\`\`json\n{"templateOverride": null, "templateParams": null, "severity": null, "issue": null, "fix": null}\n\`\`\``;
}

function flagBlock(num, { severity = "major", issue = "Doubtful claim.", fix = "A safer replacement sentence." } = {}) {
  return `## Scene ${num} — Verdict: FLAG\n\`\`\`json\n{"templateOverride": null, "templateParams": null, "severity": "${severity}", "issue": "${issue}", "fix": "${fix}"}\n\`\`\``;
}

// --- buildReviewPrompt -----------------------------------------------------------

test("buildReviewPrompt includes topic, scene headers, layout/template, and narration", () => {
  const scenes = scenes2();
  const prompt = buildReviewPrompt("Zero-trust tunnels", scenes);
  assert.match(prompt, /Topic: Zero-trust tunnels/);
  assert.match(prompt, /## Scene 1 — A/);
  assert.match(prompt, /Layout: animated/);
  assert.match(prompt, /Template: text-reveal/);
  assert.match(prompt, /Narration: First narration\./);
  assert.match(prompt, /## Scene 2 — B/);
});

test("buildReviewPrompt omits the Template line for a photo-layout scene", () => {
  const scenes = [{ num: 1, title: "A", narration: "x", layout: "photo", template: null, templateParams: null }];
  const prompt = buildReviewPrompt("Topic", scenes);
  assert.doesNotMatch(prompt, /Template:/);
});

// --- parseReview -------------------------------------------------------------------

test("parseReview parses one OK block per scene, in order", () => {
  const text = `${okBlock(1)}\n\n${okBlock(2)}`;
  const entries = parseReview(text);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { num: 1, verdict: "OK", templateOverride: null, templateParams: null, severity: null, issue: null, fix: null });
  assert.equal(entries[1].num, 2);
});

test("parseReview parses a FLAG block with severity/issue/fix", () => {
  const entries = parseReview(flagBlock(1, { severity: "minor", issue: "Slightly overstated.", fix: "A calmer sentence." }));
  assert.equal(entries[0].verdict, "FLAG");
  assert.equal(entries[0].severity, "minor");
  assert.equal(entries[0].issue, "Slightly overstated.");
  assert.equal(entries[0].fix, "A calmer sentence.");
});

test("parseReview throws when no scene headers are found", () => {
  assert.throws(() => parseReview("no headers here, just prose"), /no "## Scene/);
});

test("parseReview throws a scene-specific error when the fenced JSON body is missing", () => {
  assert.throws(() => parseReview("## Scene 1 — Verdict: OK\nno json here"), /Scene 1: review block has no fenced/);
});

test("parseReview throws a scene-specific error on invalid JSON", () => {
  assert.throws(
    () => parseReview("## Scene 1 — Verdict: OK\n```json\n{not valid json\n```"),
    /Scene 1: review JSON is invalid/,
  );
});

// --- validateReview ------------------------------------------------------------------

test("validateReview accepts matching scene numbers and passes entries through", () => {
  const scenes = scenes2();
  const entries = parseReview(`${okBlock(1)}\n\n${okBlock(2)}`);
  const result = validateReview(entries, scenes);
  assert.equal(result.length, 2);
});

test("validateReview rejects a scene-number mismatch", () => {
  const scenes = scenes2();
  const entries = parseReview(okBlock(1)); // only one block for a 2-scene storyboard
  assert.throws(() => validateReview(entries, scenes), /don't match storyboard/);
});

test("validateReview rejects an unknown templateOverride", () => {
  const scenes = scenes2();
  const entries = parseReview(`${okBlock(1)}\n\n${okBlock(2)}`);
  entries[0].templateOverride = "not-a-real-template";
  assert.throws(() => validateReview(entries, scenes), /bad templateOverride/);
});

test("validateReview requires templateParams when the effective template is not text-reveal", () => {
  const scenes = scenes2();
  const entries = parseReview(`${okBlock(1)}\n\n${okBlock(2)}`);
  entries[0].templateOverride = "hub-orbit";
  assert.throws(() => validateReview(entries, scenes), /templateParams required/);
});

test("validateReview accepts templateParams supplied alongside a templateOverride", () => {
  const scenes = scenes2();
  const entries = parseReview(`${okBlock(1)}\n\n${okBlock(2)}`);
  entries[0].templateOverride = "hub-orbit";
  entries[0].templateParams = { hub: "Edge", satellites: ["Origin A", "Origin B"] };
  const result = validateReview(entries, scenes);
  assert.equal(result[0].templateOverride, "hub-orbit");
});

test("validateReview rejects templateParams on a text-reveal (default) scene", () => {
  const scenes = scenes2();
  const entries = parseReview(`${okBlock(1)}\n\n${okBlock(2)}`);
  entries[0].templateParams = { anything: true };
  assert.throws(() => validateReview(entries, scenes), /templateParams must be null/);
});

test("validateReview fails closed to major severity when a FLAG has no/bad severity", () => {
  const scenes = scenes2();
  const entries = parseReview(`${flagBlock(1)}\n\n${okBlock(2)}`);
  entries[0].severity = "unspecified";
  const result = validateReview(entries, scenes);
  assert.equal(result[0].severity, "major");
});

test("validateReview rejects a FLAG missing issue/fix text", () => {
  const scenes = scenes2();
  const entries = parseReview(`${flagBlock(1)}\n\n${okBlock(2)}`);
  entries[0].fix = "   ";
  assert.throws(() => validateReview(entries, scenes), /FLAG missing issue\/fix/);
});

// --- applyReviewFixes ----------------------------------------------------------------

test("applyReviewFixes replaces narration only on a FLAG, keeps OK narration untouched", () => {
  const scenes = scenes2();
  const entries = [
    { num: 1, verdict: "FLAG", templateOverride: null, templateParams: null, severity: "major", issue: "x", fix: "Replacement text." },
    { num: 2, verdict: "OK", templateOverride: null, templateParams: null, severity: null, issue: null, fix: null },
  ];
  const result = applyReviewFixes(scenes, entries);
  assert.equal(result[0].narration, "Replacement text.");
  assert.equal(result[1].narration, "Second narration.");
});

test("applyReviewFixes resolves the effective template from an override", () => {
  const scenes = scenes2();
  const entries = [
    { num: 1, verdict: "OK", templateOverride: "hub-orbit", templateParams: { hub: "Edge", satellites: ["A", "B"] }, severity: null, issue: null, fix: null },
    { num: 2, verdict: "OK", templateOverride: null, templateParams: null, severity: null, issue: null, fix: null },
  ];
  const result = applyReviewFixes(scenes, entries);
  assert.equal(result[0].template, "hub-orbit");
  assert.deepEqual(result[0].templateParams, { hub: "Edge", satellites: ["A", "B"] });
  assert.equal(result[1].template, "text-reveal");
  assert.equal(result[1].templateParams, null);
});

test("applyReviewFixes keeps template null for a photo-layout scene regardless of override", () => {
  const scenes = [
    { num: 1, title: "A", narration: "x", layout: "photo", template: null, templateParams: null },
    { num: 2, title: "B", narration: "y", layout: "animated", template: "text-reveal", templateParams: null },
  ];
  const entries = [
    // Even if the review LLM mistakenly set a templateOverride on a photo scene, the
    // photo layout wins — no template, no params.
    { num: 1, verdict: "OK", templateOverride: "hub-orbit", templateParams: { hub: "x", satellites: ["a", "b"] }, severity: null, issue: null, fix: null },
    { num: 2, verdict: "OK", templateOverride: null, templateParams: null, severity: null, issue: null, fix: null },
  ];
  const result = applyReviewFixes(scenes, entries);
  assert.equal(result[0].template, null);
  assert.equal(result[0].templateParams, null);
});

// --- generateReviewedStoryboard (orchestration, mocked LLM) --------------------------

function storyboardResponse() {
  return "## Scene 1 — A\nFirst narration.\n\n## Scene 2 — B\nSecond narration.\n";
}

test("generateReviewedStoryboard returns scenes unchanged when the review is all-OK on the first round", async () => {
  let call = 0;
  const llm = {
    async chat() {
      call += 1;
      if (call === 1) return { text: storyboardResponse(), model: "mock-model" };
      return { text: `${okBlock(1)}\n\n${okBlock(2)}`, model: "mock-model" };
    },
  };
  const result = await generateReviewedStoryboard({ topic: "Zero-trust tunnels", llm });
  assert.equal(result.scenes.length, 2);
  assert.equal(result.scenes[0].narration, "First narration.");
  assert.equal(result.genAttempts, 1);
  assert.equal(result.reviewRounds, 1);
  assert.equal(result.notes.length, 0);
  assert.equal(call, 2);
});

test("generateReviewedStoryboard applies a FLAG's fix and records minor notes", async () => {
  let call = 0;
  const llm = {
    async chat() {
      call += 1;
      if (call === 1) return { text: storyboardResponse(), model: "mock-model" };
      return {
        text: `${flagBlock(1, { severity: "minor", issue: "Slightly vague.", fix: "A sharper first sentence." })}\n\n${okBlock(2)}`,
        model: "mock-model",
      };
    },
  };
  const result = await generateReviewedStoryboard({ topic: "Zero-trust tunnels", llm });
  assert.equal(result.scenes[0].narration, "A sharper first sentence.");
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].scene, 1);
});

test("generateReviewedStoryboard retries review rounds until a major FLAG clears", async () => {
  let call = 0;
  const llm = {
    async chat() {
      call += 1;
      if (call === 1) return { text: storyboardResponse(), model: "mock-model" };
      if (call === 2) {
        // First review round: scene 1 is majorly wrong.
        return { text: `${flagBlock(1, { severity: "major", issue: "False claim.", fix: "A corrected sentence." })}\n\n${okBlock(2)}`, model: "mock-model" };
      }
      // Second review round (re-reviewing the corrected scene): now OK.
      return { text: `${okBlock(1)}\n\n${okBlock(2)}`, model: "mock-model" };
    },
  };
  const result = await generateReviewedStoryboard({ topic: "Zero-trust tunnels", llm });
  assert.equal(result.scenes[0].narration, "A corrected sentence.");
  assert.equal(result.reviewRounds, 2);
  assert.equal(call, 3);
});

test("generateReviewedStoryboard gives up with an explicit error after exhausting generations", async () => {
  const llm = {
    async chat({ messages }) {
      const isReview = messages[0].content.includes("fact-checking");
      if (!isReview) return { text: storyboardResponse(), model: "mock-model" };
      // Always flags scene 1 as majorly wrong, every round, every generation.
      return { text: `${flagBlock(1, { severity: "major", issue: "Still wrong.", fix: "Still not good enough." })}\n\n${okBlock(2)}`, model: "mock-model" };
    },
  };
  await assert.rejects(
    () => generateReviewedStoryboard({ topic: "Zero-trust tunnels", llm }),
    /gave up after 2 generation/,
  );
});

test("generateReviewedStoryboard rejects an empty topic", async () => {
  await assert.rejects(() => generateReviewedStoryboard({ topic: "  ", llm: { chat: async () => ({ text: "", model: "x" }) } }), /empty/);
});
