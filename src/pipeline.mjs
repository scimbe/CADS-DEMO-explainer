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
import { generateStoryboard, generateStoryboardFromSource } from "./script/generate.mjs";
import { fetchWikipediaSummary } from "./source/wikipedia.mjs";
import { synthesizeScenes } from "./tts/generate.mjs";
import { buildSlides } from "./render/slides.mjs";
import { renderScenes } from "./render/engine.mjs";
import { finalizeVideo } from "./mux/finalize.mjs";

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "topic";
}

/** Shared downstream: storyboard scenes -> narrated final.mp4. Non-LLM, deterministic. */
async function produceVideo({ projectDir, markdown, scenes, model, provenance }) {
  fs.writeFileSync(path.join(projectDir, "teleprompter.md"), markdown);
  if (provenance) {
    fs.writeFileSync(path.join(projectDir, "provenance.json"), JSON.stringify(provenance, null, 2));
  }
  console.error(`      ${scenes.length} scenes, model=${model}`);

  console.error(`[2/5] Synthesizing narration (Piper, stock voice)`);
  const ttsManifest = await synthesizeScenes({ scenes, outDir: projectDir });

  console.error(`[3/5] Building scene compositions`);
  buildSlides({ scenesManifest: ttsManifest, projectDir });

  console.error(`[4/5] Rendering scenes (headless Chrome)`);
  await renderScenes({ projectDir });

  console.error(`[5/5] Muxing + concatenating final video`);
  const { outFile, scenes: muxReport } = finalizeVideo({ projectDir });
  return { outFile, scenes: muxReport };
}

export async function runPipeline(topic, outDir) {
  const t0 = Date.now();
  const projectDir = path.resolve(outDir || path.join("projects", `${slugify(topic)}-${Date.now()}`));
  fs.mkdirSync(projectDir, { recursive: true });
  console.error(`[1/5] Generating storyboard for: "${topic}"`);
  const { markdown, scenes, model } = await generateStoryboard({ topic });

  const { outFile, scenes: muxReport } = await produceVideo({ projectDir, markdown, scenes, model });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(`\nDone in ${elapsed}s -> ${outFile}`);
  return { projectDir, outFile, scenes: muxReport, model };
}

/**
 * Wikipedia-grounded variant: `title` names a German-Wikipedia article; its verbatim
 * lead paragraph is the fact source for the storyboard (see script/generate.mjs).
 * Same downstream (TTS -> render -> mux -> final.mp4) as runPipeline.
 */
export async function runPipelineFromWikipedia(title, outDir, { lang = "de", fetchImpl } = {}) {
  const t0 = Date.now();
  const projectDir = path.resolve(outDir || path.join("projects", `wiki-${slugify(title)}-${Date.now()}`));
  fs.mkdirSync(projectDir, { recursive: true });

  console.error(`[1/5] Fetching Wikipedia summary (${lang}): "${title}"`);
  const source = await fetchWikipediaSummary(title, { lang, fetchImpl });
  console.error(`      article="${source.title}" (${source.extract.length} chars), ${source.url}`);

  const { markdown, scenes, model, grounding, provenance, guard } = await generateStoryboardFromSource({ source });
  if (grounding === "verbatim-fallback") {
    console.error(`      storyboard grounding=verbatim-fallback (${guard.reason})`);
  } else {
    console.error(`      storyboard grounding=llm, number-guard passed`);
  }

  const { outFile, scenes: muxReport } = await produceVideo({
    projectDir, markdown, scenes, model, provenance,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(`\nDone in ${elapsed}s -> ${outFile}`);
  return { projectDir, outFile, scenes: muxReport, model, grounding, provenance, guard, source };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const argv = process.argv.slice(2);
  const wikiFlagIdx = argv.findIndex((a) => a === "--wikipedia" || a === "--wiki");
  if (wikiFlagIdx !== -1) {
    const title = argv[wikiFlagIdx + 1];
    const outDir = argv.filter((_, i) => i !== wikiFlagIdx && i !== wikiFlagIdx + 1)[0];
    if (!title) {
      process.stderr.write('Usage: node src/pipeline.mjs --wikipedia "<Artikeltitel>" [outDir]\n');
      process.exit(2);
    }
    runPipelineFromWikipedia(title, outDir)
      .then((r) => process.stdout.write(JSON.stringify(r, null, 2) + "\n"))
      .catch((e) => {
        process.stderr.write(`FAILED: ${e.stack || e.message}\n`);
        process.exit(1);
      });
  } else {
    const topic = argv[0];
    const outDir = argv[1];
    if (!topic) {
      process.stderr.write('Usage: node src/pipeline.mjs "<topic>" [outDir]\n' +
        '   or: node src/pipeline.mjs --wikipedia "<Artikeltitel>" [outDir]\n');
      process.exit(2);
    }
    runPipeline(topic, outDir)
      .then((r) => process.stdout.write(JSON.stringify(r, null, 2) + "\n"))
      .catch((e) => {
        process.stderr.write(`FAILED: ${e.stack || e.message}\n`);
        process.exit(1);
      });
  }
}
