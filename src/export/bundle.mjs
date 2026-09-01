/**
 * Package a rendered project's *editable source* — everything a human or a later LLM pass
 * would need to hand-edit a scene and re-render it — into one self-contained deliverable:
 * a `<projectDir>-source.tar.gz` next to the project directory, plus a generated
 * `bundle-manifest.json` and `README.md` written into the project directory so they also
 * remain readable there without unpacking anything.
 *
 * Deliberately excludes `renders/` (the compiled *output* — scene-NN.mp4 / final.mp4):
 * this bundle is for going back to source and re-rendering, not for re-shipping the video.
 *
 * Written against the pipeline as it exists TODAY (topic -> one-call storyboard -> Piper
 * TTS -> optional Pexels/Pixabay images -> GSAP slide compositions -> sequential Chrome
 * render -> ffmpeg mux/concat). Two files this bundle knows how to describe don't exist
 * yet on disk: `assets/review.json` (a second, fact-checking LLM pass) and
 * `assets/render-plan.json` (a resolved layout/template/duration plan for richer animated
 * templates + a duration slider) — both are planned follow-on work in this same repo, not
 * yet implemented. This module never requires either: it inspects the real project
 * directory and only mentions what it actually finds, so it works today and keeps working,
 * unchanged, once those files start showing up.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Top-level project entries this bundle packages, in the order they get documented. */
const SOURCE_ENTRIES = ["teleprompter.md", "assets", "compositions", "vendor"];

function gitShortCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null; // fine to bundle from a dirty/detached/non-git checkout -- this is informational only.
  }
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`bundleProjectSource: ${file} exists but is not valid JSON: ${e.message}`);
  }
}

function fileSizeSync(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}

/**
 * @param {{projectDir:string}} o
 * @returns {{scenesJson: object|null, reviewJson: object|null, renderPlanJson: object|null,
 *            compositionFiles: string[], imageFiles: string[], hasVendor: boolean}}
 */
function inspectProject({ projectDir }) {
  const teleprompterPath = path.join(projectDir, "teleprompter.md");
  if (!fs.existsSync(teleprompterPath)) {
    throw new Error(`bundleProjectSource: ${teleprompterPath} not found -- is this a real pipeline project directory?`);
  }
  const scenesJsonPath = path.join(projectDir, "assets", "scenes.json");
  const scenesJson = readJsonIfExists(scenesJsonPath);
  if (!scenesJson) {
    throw new Error(`bundleProjectSource: ${scenesJsonPath} not found -- has synthesizeScenes run yet?`);
  }

  const compositionsDir = path.join(projectDir, "compositions");
  const compositionFiles = fs.existsSync(compositionsDir)
    ? fs.readdirSync(compositionsDir).filter((n) => /^scene-\d+\.html$/.test(n)).sort()
    : [];
  if (compositionFiles.length === 0) {
    throw new Error(`bundleProjectSource: no scene-NN.html files in ${compositionsDir} -- has buildSlides run yet?`);
  }

  const assetsDir = path.join(projectDir, "assets");
  const imageFiles = fs.readdirSync(assetsDir).filter((n) => /-image\.\w+$/.test(n)).sort();

  // §1 (script review) and §4 (duration slider / render plan) are planned follow-on work in
  // this repo that had not landed as of this bundle step -- included here only if present.
  const reviewJson = readJsonIfExists(path.join(assetsDir, "review.json"));
  const renderPlanJson = readJsonIfExists(path.join(assetsDir, "render-plan.json"));

  return {
    scenesJson,
    reviewJson,
    renderPlanJson,
    compositionFiles,
    imageFiles,
    hasVendor: fs.existsSync(path.join(projectDir, "vendor")),
  };
}

function buildReadme({ topic, generatedAt, sceneCount, hasImages, hasReview, hasRenderPlan, pipelineCommit }) {
  return `# Explainer-video source bundle

Topic: **${topic}**
Generated: ${generatedAt}
Scenes: ${sceneCount}
Pipeline commit: ${pipelineCommit || "(unknown -- not built from a git checkout)"}

This is the **editable source** behind a rendered explainer video: everything the pipeline
used or produced *before* the final render/mux step, packaged so a human or a later LLM
pass can hand-edit a scene and re-render it without starting over. It deliberately does
**not** include \`renders/\` (the compiled MP4 output) -- re-derive that by re-running the
render/mux steps described below.

## File map

- \`teleprompter.md\` -- the accepted storyboard script, one \`## Scene N — Title\` header
  per scene followed by its narration. This is the top-level source of truth for *what the
  video says*. Hand-editing this alone does nothing by itself -- narration audio and the
  compositions below are derived from it and need re-generating (see "Round-trip" below).
- \`assets/scenes.json\` -- the narration/timing ground truth: per scene, the exact
  narration text that was actually synthesized, the path to its \`.wav\` audio, and the
  audio's measured duration in seconds. This is what \`renders/scene-NN.mp4\`'s length was
  scaled to match -- if you edit narration text without re-running TTS, this file (and the
  audio) will no longer match \`teleprompter.md\`.
- \`assets/scene-NN.wav\` -- the real synthesized narration audio per scene (Piper,
  generic stock voice, not a cloned voice). Regenerating a \`.wav\` changes its scene's
  duration, which desyncs \`assets/scenes.json\`${hasRenderPlan ? " (and `assets/render-plan.json`)" : ""} until they're regenerated too.
${hasImages ? `- \`assets/scene-NN-image.jpg\` -- stock photo(s) fetched per scene (Pexels or Pixabay,
  attribution recorded in \`assets/scenes.json\`'s \`imageCredit\` field and rendered
  on-screen as a photo credit).\n` : ""}${hasRenderPlan ? `- \`assets/render-plan.json\` -- the resolved per-scene layout/template/duration plan
  (which animation template each scene uses, and how narration-floor vs. animation-hold
  time were split). Needed to reproduce a hand-edited scene's exact timing.\n` : ""}${hasReview ? `- \`assets/review.json\` -- the full fact-check pass: per scene, the reviewing LLM
  call's verdict (OK/FLAG), any narration fix it applied, and why. This is the audit trail
  for later LLM-assisted post-processing -- read it before trusting a claim in the
  narration at face value.\n` : ""}- \`compositions/scene-NN.html\` -- the actual visual source: one self-contained HTML file
  per scene (GSAP-animated). **This is what you hand-edit to change how a scene looks.**
- \`vendor/\` -- the JS libraries the compositions load locally (e.g. \`gsap.min.js\`), so
  every \`compositions/scene-NN.html\` opens standalone via \`file://\` with no network
  dependency, in a plain browser or in \`render/engine.mjs\`.
- \`bundle-manifest.json\` -- machine-readable version of the header above.

## The composition contract

Every \`compositions/scene-NN.html\` registers a **paused GSAP timeline** on
\`window.__timelines["scene-NN"]\` (see the inline \`<script>\` at the bottom of the file).
If you hand-edit a scene's HTML and want to feed it back through the render engine
(\`src/render/engine.mjs\`), the edited file must still satisfy this contract:

- \`window.__timelines[sid]\` must be a real \`gsap.timeline()\` (or fully duck-type one),
  exposing a settable \`.totalDuration(seconds)\` and a seekable, deterministic
  \`.pause(atSeconds)\` -- never a \`requestAnimationFrame\`/wall-clock-driven animation.
  This is what makes frame-exact, non-realtime capture possible: the render engine pauses
  the timeline at each frame's timestamp and screenshots it, rather than recording in real
  time.
- The top-level \`.composition\` element carries \`data-composition-id\`, \`data-duration\`
  and \`data-fps\` attributes, but only for a human reading the HTML source -- this build
  of \`render/engine.mjs\` does **not** read any of them. It gets the scene id from the
  filename (\`scene-NN.html\`), the duration from ${hasRenderPlan ? "\`assets/render-plan.json\`" : "\`assets/scenes.json\`"},
  and the frame rate from its own \`fps\` option (default 30) -- never from the DOM. Feel
  free to keep these attributes in sync out of habit, but nothing in the render path
  depends on it.
- Guard live playback exactly as today: \`if (!window.__hyperframesRender) { tl.play(); }\`
  -- the render engine sets \`window.__hyperframesRender = true\` before your script runs,
  so a scene opened directly in a browser still plays on its own, but a scene loaded by the
  render engine stays paused until scrubbed.

## Round-trip: re-rendering after an edit

From a checkout of the \`CADS-DEMO-explainer\` pipeline repo (the code that made this
bundle -- not included here, this bundle is data, not code):

1. Unpack this bundle into a project directory, e.g. \`projects/my-edit/\`:
   \`tar -xzf <name>-source.tar.gz -C projects/my-edit\`
2. Edit \`compositions/scene-NN.html\` (visuals) and/or \`teleprompter.md\` +
   \`assets/scenes.json\` (script/timing) as needed, preserving the contract above.
   - If you only touched a composition's visuals/animation (not its duration), no other
     file needs to change.
   - If you changed narration text, re-run TTS for that scene
     (\`node src/tts/generate.mjs\`) so \`assets/scene-NN.wav\` and \`assets/scenes.json\`'s
     duration stay truthful -- a stale duration will desync video from narration length.
3. Re-render: \`node -e "import('./src/render/engine.mjs').then(m => m.renderScenes({projectDir: 'projects/my-edit'}))"\`
   -- produces \`renders/scene-NN.mp4\` for every \`compositions/scene-NN.html\` present.
4. Re-mux: \`node -e "import('./src/mux/finalize.mjs').then(m => m.finalizeVideo({projectDir: 'projects/my-edit'}))"\`
   -- muxes each scene's video with its \`assets/scene-NN.wav\` and concatenates
   \`renders/final.mp4\`.

Only steps 3-4 are required for a pure visual edit; nothing here needs the LLM, Piper, or
network access -- the whole round-trip is local and deterministic.

## What NOT to blindly regenerate

- \`assets/scene-NN.wav\` is real recorded speech, not a cheap-to-redo placeholder --
  regenerating it changes that scene's duration and desyncs \`assets/scenes.json\`${hasRenderPlan ? " (and `assets/render-plan.json`)" : ""} until you re-run the steps above.
- \`teleprompter.md\`, \`assets/scenes.json\`${hasRenderPlan ? ", `assets/render-plan.json`" : ""} are kept in sync with each
  other **by convention** (this pipeline's own discipline), not automatically enforced --
  if you edit one, check the others still agree before re-rendering.

## Versioning

\`bundle-manifest.json\`'s \`pipelineCommit\` field records the exact commit of the
\`CADS-DEMO-explainer\` pipeline that produced this bundle -- check it out at that commit
if the composition contract or file layout above seems to have drifted from what you see.
`;
}

/**
 * @param {{projectDir:string, topic:string, model?:string, archive?:boolean, tarBin?:string}} o
 *   projectDir: an already-rendered pipeline project dir (must contain teleprompter.md,
 *     assets/scenes.json, and at least one compositions/scene-NN.html).
 *   topic: the topic string the storyboard was generated for (for the manifest/README header).
 *   model: the storyboard LLM's model id, if known (informational only).
 *   archive: set false to only write bundle-manifest.json/README.md into projectDir and
 *     skip the tar.gz step (e.g. for a dry run, or when the caller wants to tar it itself).
 * @returns {{manifestPath:string, readmePath:string, archivePath:string|null, entries:string[],
 *            manifest:object}}
 */
export function bundleProjectSource({ projectDir, topic, model, archive = true, tarBin = "tar" }) {
  const absProjectDir = path.resolve(projectDir);
  const { scenesJson, reviewJson, renderPlanJson, compositionFiles, imageFiles, hasVendor } =
    inspectProject({ projectDir: absProjectDir });

  const generatedAt = new Date().toISOString();
  const pipelineCommit = gitShortCommit();
  const sceneCount = scenesJson.scenes.length;
  const hasImages = imageFiles.length > 0;
  const hasReview = Boolean(reviewJson);
  const hasRenderPlan = Boolean(renderPlanJson);

  const manifest = {
    topic: topic ?? null,
    generatedAt,
    pipelineCommit,
    storyboardModel: model ?? null,
    sceneCount,
    compositionCount: compositionFiles.length,
    hasImages,
    hasReview,
    hasRenderPlan,
    files: {
      teleprompter: "teleprompter.md",
      scenesManifest: "assets/scenes.json",
      compositions: compositionFiles.map((f) => `compositions/${f}`),
      vendor: hasVendor,
      images: imageFiles.map((f) => `assets/${f}`),
      review: hasReview ? "assets/review.json" : null,
      renderPlan: hasRenderPlan ? "assets/render-plan.json" : null,
    },
  };

  const readme = buildReadme({ topic: topic ?? "(unknown)", generatedAt, sceneCount, hasImages, hasReview, hasRenderPlan, pipelineCommit });

  const manifestPath = path.join(absProjectDir, "bundle-manifest.json");
  const readmePath = path.join(absProjectDir, "README.md");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(readmePath, readme);

  const entries = SOURCE_ENTRIES.filter((e) => fs.existsSync(path.join(absProjectDir, e))).concat(["README.md", "bundle-manifest.json"]);

  let archivePath = null;
  if (archive) {
    archivePath = `${absProjectDir}-source.tar.gz`;
    execFileSync(tarBin, ["-czf", archivePath, "-C", absProjectDir, ...entries]);
  }

  return { manifestPath, readmePath, archivePath, entries, manifest, archiveSize: archivePath ? fileSizeSync(archivePath) : null };
}

// --- CLI -----------------------------------------------------------------------
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const projectDir = process.argv[2];
  const topic = process.argv[3] || path.basename(projectDir || "");
  if (!projectDir) {
    process.stderr.write("Usage: node src/export/bundle.mjs <projectDir> [topic]\n");
    process.exit(2);
  }
  try {
    const result = bundleProjectSource({ projectDir, topic });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (e) {
    process.stderr.write(`FAILED: ${e.message}\n`);
    process.exit(1);
  }
}
