#!/usr/bin/env node
/**
 * End-to-end pipeline: topic -> narrated explainer video.
 *   1. LLM writes the storyboard (script/generate.mjs)          -- the only LLM step
 *   2. Piper synthesizes narration audio per scene (tts/generate.mjs)
 *   3. GSAP/HTML scene compositions are built (render/slides.mjs)
 *   4. Headless Chrome renders each scene to a silent MP4 (render/engine.mjs)
 *   5. Scene audio+video are muxed and concatenated (mux/finalize.mjs)
 *
 * Usage: node src/pipeline.mjs "<topic>" [outDir]
 */
import fs from "node:fs";
import path from "node:path";
import { generateStoryboard } from "./script/generate.mjs";
import { synthesizeScenes } from "./tts/generate.mjs";
import { buildSlides } from "./render/slides.mjs";
import { renderScenes } from "./render/engine.mjs";
import { finalizeVideo } from "./mux/finalize.mjs";

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "topic";
}

export async function runPipeline(topic, outDir) {
  const t0 = Date.now();
  const projectDir = path.resolve(outDir || path.join("projects", `${slugify(topic)}-${Date.now()}`));
  fs.mkdirSync(projectDir, { recursive: true });
  console.error(`[1/5] Generating storyboard for: "${topic}"`);
  const { markdown, scenes, model } = await generateStoryboard({ topic });
  fs.writeFileSync(path.join(projectDir, "teleprompter.md"), markdown);
  console.error(`      ${scenes.length} scenes, model=${model}`);

  console.error(`[2/5] Synthesizing narration (Piper, stock voice)`);
  const ttsManifest = await synthesizeScenes({ scenes, outDir: projectDir });

  console.error(`[3/5] Building scene compositions`);
  buildSlides({ scenesManifest: ttsManifest, projectDir });

  console.error(`[4/5] Rendering scenes (headless Chrome)`);
  await renderScenes({ projectDir });

  console.error(`[5/5] Muxing + concatenating final video`);
  const { outFile, scenes: muxReport } = finalizeVideo({ projectDir });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(`\nDone in ${elapsed}s -> ${outFile}`);
  return { projectDir, outFile, scenes: muxReport, model };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const topic = process.argv[2];
  const outDir = process.argv[3];
  if (!topic) {
    process.stderr.write('Usage: node src/pipeline.mjs "<topic>" [outDir]\n');
    process.exit(2);
  }
  runPipeline(topic, outDir)
    .then((r) => process.stdout.write(JSON.stringify(r, null, 2) + "\n"))
    .catch((e) => {
      process.stderr.write(`FAILED: ${e.stack || e.message}\n`);
      process.exit(1);
    });
}
