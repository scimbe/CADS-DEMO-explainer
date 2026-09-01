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
  assert.deepEqual(scenes[0], {
    num: 1, title: "Intro", narration: "First sentence. Second sentence on its own line.",
    layout: "animated", template: null, templateParams: null,
  });
  assert.equal(scenes[1].num, 2);
  assert.equal(scenes[1].title, "Middle");
  assert.equal(scenes[1].narration, "Only one line here.");
});

test("parseTeleprompter recognizes optional Layout:/Template: lines before narration starts", () => {
  const md = `## Scene 1 — Photo
Layout: photo
A striking standalone photo.

## Scene 2 — Animated
Template: hub-orbit
A structured animation.

## Scene 3 — Plain
No metadata lines here.
`;
  const scenes = parseTeleprompter(md);
  assert.equal(scenes[0].layout, "photo");
  assert.equal(scenes[0].template, null);
  assert.equal(scenes[1].layout, "animated");
  assert.equal(scenes[1].template, "hub-orbit");
  assert.equal(scenes[2].layout, "animated");
  assert.equal(scenes[2].template, null);
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

test("validateScenes accepts a well-formed storyboard and fills in Layout/Template defaults", () => {
  const scenes = parseTeleprompter("## Scene 1 — A\nText one.\n\n## Scene 2 — B\nText two.\n");
  assert.deepEqual(validateScenes(scenes), [
    { num: 1, title: "A", narration: "Text one.", layout: "animated", template: "text-reveal", templateParams: null },
    { num: 2, title: "B", narration: "Text two.", layout: "animated", template: "text-reveal", templateParams: null },
  ]);
});

test("validateScenes rejects Layout: photo combined with a Template line", () => {
  const md = "## Scene 1 — A\nLayout: photo\nTemplate: hub-orbit\nText.\n\n## Scene 2 — B\nText two.\n";
  assert.throws(() => validateScenes(parseTeleprompter(md)), /Template is only valid when Layout is animated/);
});

test("validateScenes rejects a Template name outside the allowed enum", () => {
  const md = "## Scene 1 — A\nTemplate: not-a-real-template\nText.\n\n## Scene 2 — B\nText two.\n";
  assert.throws(() => validateScenes(parseTeleprompter(md)), /invalid Template/);
});

test("validateScenes rejects an invalid Layout value", () => {
  const scenes = [
    { num: 1, title: "A", narration: "x", layout: "bogus" },
    { num: 2, title: "B", narration: "y" },
  ];
  assert.throws(() => validateScenes(scenes), /invalid Layout/);
});

test("cleanScript strips code fences and any preamble before the first scene", () => {
  const raw = "Sure, here is the storyboard:\n\n```markdown\n## Scene 1 — A\nText.\n```";
  assert.equal(cleanScript(raw), "## Scene 1 — A\nText.\n");
});

test("cleanScript is a no-op on already-clean output", () => {
  const raw = "## Scene 1 — A\nText.\n";
  assert.equal(cleanScript(raw), raw);
});
