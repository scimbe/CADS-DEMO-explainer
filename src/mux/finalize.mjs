/**
 * Mux each scene's silent render with its narration audio, then concat into one final
 * narrated MP4.
 *
 * Simpler than SlideCreator's scene-sync.mjs (which globally stretches video to match a
 * separately-generated whole-video audio track with word-level timestamps). Here each
 * scene's GSAP timeline was already scaled to that exact scene's Piper audio duration
 * (engine.mjs), so per-scene video and audio already agree to within a frame — muxing
 * them 1:1 per scene and concatenating with `-c copy` (no re-encode) is enough, and avoids
 * needing word-level alignment at all.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function ffprobeDuration(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ]);
  return parseFloat(out.toString().trim());
}

/**
 * @param {{projectDir:string}} opts
 * @returns {{outFile:string, scenes:Array<{scene:number,videoDuration:number,audioDuration:number}>}}
 */
export function finalizeVideo({ projectDir }) {
  const manifest = JSON.parse(readFileSync(path.join(projectDir, "assets", "scenes.json"), "utf8"));
  const rendersDir = path.join(projectDir, "renders");
  mkdirSync(rendersDir, { recursive: true });
  const tmp = mkdtempSync(path.join(tmpdir(), "explainer-mux-"));

  const narratedParts = [];
  const report = [];
  try {
    for (const s of manifest.scenes) {
      const sid = String(s.scene).padStart(2, "0");
      const videoFile = path.join(rendersDir, `scene-${sid}.mp4`);
      const audioFile = path.join(projectDir, s.audio);
      if (!existsSync(videoFile)) throw new Error(`Missing rendered scene video: ${videoFile}`);
      if (!existsSync(audioFile)) throw new Error(`Missing scene audio: ${audioFile}`);

      const narrated = path.join(tmp, `scene-${sid}-narrated.mp4`);
      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error",
        "-i", videoFile, "-i", audioFile,
        "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
        "-shortest",
        narrated,
      ], { stdio: "inherit" });

      narratedParts.push(narrated);
      report.push({
        scene: s.scene,
        videoDuration: ffprobeDuration(videoFile),
        audioDuration: ffprobeDuration(audioFile),
      });
    }

    const listFile = path.join(tmp, "concat.txt");
    writeFileSync(listFile, narratedParts.map((p) => `file '${p}'`).join("\n"));
    const outFile = path.join(rendersDir, "final.mp4");
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error",
      "-f", "concat", "-safe", "0", "-i", listFile,
      "-c", "copy", "-movflags", "+faststart",
      outFile,
    ], { stdio: "inherit" });

    return { outFile, scenes: report };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
