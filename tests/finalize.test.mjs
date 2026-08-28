/**
 * Exercises the real mux/concat step (src/mux/finalize.mjs) against real, tiny synthetic
 * fixtures generated with ffmpeg's lavfi sources -- no mocks, no checked-in binaries.
 * Skips (rather than fails) if ffmpeg/ffprobe are not on PATH.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finalizeVideo } from "../src/mux/finalize.mjs";

function hasFfmpeg() {
  return spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
}

function ffprobeDuration(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ]);
  return parseFloat(out.toString().trim());
}

function makeSilentVideo(outFile, seconds) {
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=black:s=64x64:d=${seconds}:r=30`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    outFile,
  ]);
}

function makeToneAudio(outFile, seconds) {
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
    outFile,
  ]);
}

test("finalizeVideo mux+concat produces a video whose duration matches the sum of scene audio", { skip: !hasFfmpeg() && "ffmpeg/ffprobe not on PATH" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finalize-test-"));
  const rendersDir = path.join(dir, "renders");
  const assetsDir = path.join(dir, "assets");
  fs.mkdirSync(rendersDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  const sceneDurations = [1.2, 0.8];
  const scenes = [];
  for (let i = 0; i < sceneDurations.length; i++) {
    const num = i + 1;
    const sid = String(num).padStart(2, "0");
    const dur = sceneDurations[i];
    makeSilentVideo(path.join(rendersDir, `scene-${sid}.mp4`), dur);
    const audioRel = path.join("assets", `scene-${sid}.wav`);
    makeToneAudio(path.join(dir, audioRel), dur);
    scenes.push({ scene: num, title: `Scene ${num}`, narration: "x", audio: audioRel, duration: dur });
  }
  fs.writeFileSync(path.join(assetsDir, "scenes.json"), JSON.stringify({ scenes }, null, 2));

  const { outFile, scenes: report } = finalizeVideo({ projectDir: dir });
  assert.ok(fs.existsSync(outFile));
  assert.equal(report.length, 2);

  const expectedTotal = sceneDurations.reduce((a, b) => a + b, 0);
  const actualTotal = ffprobeDuration(outFile);
  // ffmpeg's -shortest per-scene mux + concat can differ by up to ~1 frame per scene boundary.
  assert.ok(
    Math.abs(actualTotal - expectedTotal) < 0.15,
    `expected ~${expectedTotal}s, got ${actualTotal}s`,
  );

  const probe = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", outFile,
  ]).toString();
  assert.match(probe, /video/);
  assert.match(probe, /audio/);
});
