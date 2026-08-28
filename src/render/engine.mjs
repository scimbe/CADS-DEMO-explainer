/**
 * Frame-by-frame render: scene-NN.html -> scene-NN.mp4 (silent), via headless Chrome
 * (puppeteer-core) driving a paused GSAP timeline, screenshotting each frame, and piping
 * JPEGs into ffmpeg.
 *
 * This is the real, local-only equivalent of scimbe/SlideCreator's render.mjs / the
 * MyExplainAnimator "HyperFrames" engine (per CADS-agent-marketplace#31: local rendering
 * only, no HAW-ICC cluster dependency — this never needed one, it's plain Puppeteer+ffmpeg).
 * Simplified vs. the original: no word-anchor-sync warp (we don't have per-word timestamps
 * from Piper), no MyExplainAnimator path hacks. The timeline is scaled uniformly to the
 * scene's audio duration via `tl.totalDuration()`, matching the original's own fallback
 * path for scenes without word timestamps.
 *
 * IMPORTANT (learned the hard way while building this): page.evaluate(fn, args) hangs
 * under some CDP conditions in this Puppeteer/Chrome combination. Every per-frame call
 * below uses page.evaluate(<string>) with values inlined, exactly as SlideCreator's
 * render.mjs documents and works around.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const WIDTH = 1920;
const HEIGHT = 1080;

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  for (const p of ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"]) {
    if (existsSync(p)) return p;
  }
  throw new Error("No Chrome binary found. Set CHROME_PATH, or install google-chrome/chromium.");
}

async function renderScene(browser, scene, compositionsDir, outputDir, fps) {
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error(`    [page error] ${err.message}`));
  page.on("requestfailed", (req) => console.error(`    [request failed] ${req.url()} :: ${req.failure()?.errorText}`));
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => { window.__hyperframesRender = true; });

  const sceneFile = path.join(compositionsDir, `${scene.id}.html`);
  await page.goto(`file://${sceneFile}`, { waitUntil: "domcontentloaded", timeout: 60000 });

  await page.waitForFunction(() => typeof window.gsap !== "undefined", { timeout: 20000, polling: 100 });

  const sid = scene.id;
  const checkExpr = `!!(window.__timelines && window.__timelines[${JSON.stringify(sid)}])`;
  const deadline = Date.now() + 10000;
  let registered = false;
  while (Date.now() < deadline) {
    registered = await page.evaluate(checkExpr);
    if (registered) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!registered) throw new Error(`Timeline ${sid} did not register in time.`);

  await new Promise((r) => setTimeout(r, 400)); // let webfonts settle

  // Scale the (short, authored) timeline to the scene's real narration duration.
  await page.evaluate(`void (function(){
    const tl = window.__timelines[${JSON.stringify(sid)}];
    if (tl && ${scene.duration} > 0.5 && Math.abs(tl.totalDuration() - ${scene.duration}) > 0.05) {
      tl.totalDuration(${scene.duration});
    }
    if (tl) tl.pause(0);
  })()`);

  const outFile = path.join(outputDir, `${scene.id}.mp4`);
  const totalFrames = Math.max(1, Math.round(scene.duration * fps));

  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "20",
    outFile,
  ], { stdio: ["pipe", "ignore", "inherit"] });

  for (let f = 0; f < totalFrames; f++) {
    const t = f / fps;
    await page.evaluate(`void window.__timelines[${JSON.stringify(sid)}].pause(${t})`);
    const buf = await page.screenshot({ type: "jpeg", quality: 92, optimizeForSpeed: true });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await new Promise((resolve) => ff.on("close", resolve));
  await page.close();
  return outFile;
}

/**
 * @param {{projectDir:string, fps?:number, chromePath?:string}} opts
 * @returns {Promise<Array<{scene:string, file:string}>>}
 */
export async function renderScenes({ projectDir, fps = 30, chromePath }) {
  const puppeteer = (await import("puppeteer-core")).default;
  const compositionsDir = path.join(projectDir, "compositions");
  const outputDir = path.join(projectDir, "renders");
  mkdirSync(outputDir, { recursive: true });

  const scenes = readdirSync(compositionsDir)
    .filter((n) => /^scene-\d+\.html$/.test(n))
    .sort()
    .map((n) => ({ id: n.replace(/\.html$/, "") }));
  if (scenes.length === 0) throw new Error(`No scene-NN.html files in ${compositionsDir}`);

  // Duration per scene comes from the TTS manifest (assets/scenes.json), matched by id.
  const manifestPath = path.join(projectDir, "assets", "scenes.json");
  const manifest = JSON.parse((await import("node:fs")).readFileSync(manifestPath, "utf8"));
  const byNum = Object.fromEntries(manifest.scenes.map((s) => [s.scene, s]));
  for (const s of scenes) {
    const num = Number((s.id.match(/scene-(\d+)/) || [])[1]);
    s.duration = byNum[num]?.duration || 5;
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath || findChrome(),
    headless: "shell",
    protocolTimeout: 180000,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--allow-file-access-from-files"],
  });

  const results = [];
  try {
    for (const scene of scenes) {
      console.error(`  render ${scene.id} (${scene.duration.toFixed(1)}s, ${Math.round(scene.duration * fps)} frames)`);
      const file = await renderScene(browser, scene, compositionsDir, outputDir, fps);
      results.push({ scene: scene.id, file });
    }
  } finally {
    await browser.close();
  }
  return results;
}
