import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTeleprompter, validateScenes, cleanScript } from "../src/script/generate.mjs";

test("parseTeleprompter splits scenes and joins multi-line narration", () => {
  const md = `## Scene 1 — Intro
First sentence.
Second sentence on its own line.

## Scene 2 — Middle
Only one line here.
`;
  const scenes = parseTeleprompter(md);
  assert.equal(scenes.length, 2);
  assert.deepEqual(scenes[0], { num: 1, title: "Intro", narration: "First sentence. Second sentence on its own line." });
  assert.equal(scenes[1].num, 2);
  assert.equal(scenes[1].title, "Middle");
  assert.equal(scenes[1].narration, "Only one line here.");
});

test("parseTeleprompter ignores markdown noise lines (headers, blockquotes, tables, fences, rules)", () => {
  const md = `## Scene 1 — Intro
> a quote should be ignored
| table | row |
\`\`\`
code fence content ignored
\`\`\`
---
Real narration line.
`;
  const scenes = parseTeleprompter(md);
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].narration, "Real narration line.");
});

test("parseTeleprompter accepts both em-dash and hyphen after the scene number", () => {
  const emdash = parseTeleprompter("## Scene 1 — Em Dash\nText.\n");
  const hyphen = parseTeleprompter("## Scene 1 - Hyphen\nText.\n");
  assert.equal(emdash[0].title, "Em Dash");
  assert.equal(hyphen[0].title, "Hyphen");
});

test("validateScenes rejects fewer than 2 scenes", () => {
  assert.throws(() => validateScenes(parseTeleprompter("## Scene 1 — Only\nText.\n")), /at least 2/);
});

test("validateScenes rejects a scene with empty narration", () => {
  assert.throws(
    () => validateScenes(parseTeleprompter("## Scene 1 — A\nText.\n\n## Scene 2 — B\n")),
    /no narration/,
  );
});

test("validateScenes rejects non-sequential scene numbers", () => {
  const scenes = [
    { num: 1, title: "A", narration: "x" },
    { num: 3, title: "B", narration: "y" },
  ];
  assert.throws(() => validateScenes(scenes), /sequential/);
});

test("validateScenes accepts a well-formed storyboard and returns it unchanged", () => {
  const scenes = parseTeleprompter("## Scene 1 — A\nText one.\n\n## Scene 2 — B\nText two.\n");
  assert.deepEqual(validateScenes(scenes), scenes);
});

test("cleanScript strips code fences and any preamble before the first scene", () => {
  const raw = "Sure, here is the storyboard:\n\n```markdown\n## Scene 1 — A\nText.\n```";
  assert.equal(cleanScript(raw), "## Scene 1 — A\nText.\n");
});

test("cleanScript is a no-op on already-clean output", () => {
  const raw = "## Scene 1 — A\nText.\n";
  assert.equal(cleanScript(raw), raw);
});
