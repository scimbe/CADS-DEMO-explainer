/**
 * Scene narration -> real speech audio, via Piper (local, offline neural TTS) with a
 * generic stock voice. This deliberately does NOT reuse SlideCreator's TTS worker: that
 * engine performs voice-cloning of the operator's own voice (MOSS-TTS + a personal LoRA),
 * which is explicitly excluded from this public multi-tenant demo (operator decision,
 * CADS-agent-marketplace#31). Piper with a stock model is a different, real, local TTS
 * engine — same contract (narration text in, audio + duration out), no cloned voice.
 *
 * Setup: scripts/setup-voice.sh (creates .venv, installs piper-tts, downloads the voice).
 */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { stripPronunciation } from "../text/sanitize.mjs";
import { mapLimit, resolveConcurrency } from "../util/concurrency.mjs";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const DEFAULT_PIPER_BIN = path.join(REPO_ROOT, ".venv", "bin", "piper");
const DEFAULT_VOICE_MODEL = path.join(REPO_ROOT, "voices", "en_US-lessac-medium.onnx");

/**
 * Synthesize one line of narration to a WAV file. Async (spawn, not spawnSync) so callers
 * can run several scenes concurrently — a synchronous child_process would block the event
 * loop and serialize them regardless of any concurrency limit. Throws with a setup hint if
 * piper/voice are missing.
 */
export async function synthesizeOne(text, outWavPath, opts = {}) {
  const piperBin = opts.piperBin || process.env.PIPER_BIN || DEFAULT_PIPER_BIN;
  const model = opts.model || process.env.PIPER_VOICE_MODEL || DEFAULT_VOICE_MODEL;
  if (!fs.existsSync(piperBin)) {
    throw new Error(`Piper binary not found at ${piperBin}. Run scripts/setup-voice.sh first.`);
  }
  if (!fs.existsSync(model)) {
    throw new Error(`Piper voice model not found at ${model}. Run scripts/setup-voice.sh first.`);
  }
  if (!text || !text.trim()) throw new Error(`synthesizeOne: empty narration text for ${outWavPath}`);
  fs.mkdirSync(path.dirname(outWavPath), { recursive: true });

  await new Promise((resolve, reject) => {
    const proc = spawn(piperBin, ["-m", model, "-f", outWavPath], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    proc.on("error", (e) => reject(new Error(`piper could not be started: ${e.message}`)));
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`piper failed (exit ${code}): ${stderr.slice(-2000)}`));
      resolve();
    });
    proc.stdin.on("error", () => {}); // ignore EPIPE if piper exits before we finish writing
    proc.stdin.end(text);
  });

  if (!fs.existsSync(outWavPath) || fs.statSync(outWavPath).size === 0) {
    throw new Error(`piper produced no audio: ${outWavPath}`);
  }
  return outWavPath;
}

async function ffprobeDuration(file) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ]);
  const dur = parseFloat(stdout.toString().trim());
  if (!Number.isFinite(dur) || dur <= 0) throw new Error(`ffprobe returned an invalid duration for ${file}: ${stdout}`);
  return dur;
}

/**
 * @param {{scenes:Array<{num:number,title:string,narration:string}>, outDir:string,
 *          piperBin?:string, model?:string, concurrency?:number}} opts
 * @returns {Promise<{scenes:Array<{scene:number,title:string,narration:string,audio:string,duration:number}>}>}
 */
export async function synthesizeScenes({ scenes, outDir, piperBin, model, concurrency }) {
  if (!Array.isArray(scenes) || scenes.length === 0) throw new Error("synthesizeScenes: no scenes given.");
  const assetsDir = path.join(outDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  // Scenes are independent; synthesize up to `limit` at once. mapLimit preserves order,
  // so the manifest scene array stays 1..N regardless of which finished first.
  const limit = resolveConcurrency(concurrency, "TTS_CONCURRENCY");
  const manifestScenes = await mapLimit(scenes, limit, async (s) => {
    const sid = String(s.num).padStart(2, "0");
    const wavPath = path.join(assetsDir, `scene-${sid}.wav`);
    // Final safety net right before synthesis: strip any IPA pronunciation gloss so
    // Piper never voices a phonetic string. Pure text cleanup, facts untouched; the
    // manifest stores the same sanitized text the audio was made from.
    const narration = stripPronunciation(s.narration);
    await synthesizeOne(narration, wavPath, { piperBin, model });
    const duration = await ffprobeDuration(wavPath);
    return {
      scene: s.num,
      title: s.title,
      narration,
      audio: path.relative(outDir, wavPath),
      duration,
    };
  });

  const manifest = { voice: "piper/en_US-lessac-medium (generic stock voice)", scenes: manifestScenes };
  fs.writeFileSync(path.join(assetsDir, "scenes.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

// --- CLI -----------------------------------------------------------------------
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const { parseTeleprompter } = await import("../script/generate.mjs");
  const mdPath = process.argv[2];
  const outDir = process.argv[3];
  if (!mdPath || !outDir) {
    process.stderr.write("Usage: node src/tts/generate.mjs <teleprompter.md> <outDir>\n");
    process.exit(2);
  }
  const scenes = parseTeleprompter(fs.readFileSync(path.resolve(mdPath), "utf8"));
  synthesizeScenes({ scenes, outDir: path.resolve(outDir) })
    .then((m) => {
      process.stdout.write(JSON.stringify(m, null, 2) + "\n");
    })
    .catch((e) => {
      process.stderr.write(`FAILED: ${e.message}\n`);
      process.exit(1);
    });
}
