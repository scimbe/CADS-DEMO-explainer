/**
 * Exercises the real export/bundle step (src/export/bundle.mjs) against a synthetic but
 * on-disk project directory -- no mocks. Uses the real `tar` binary, matching this repo's
 * existing convention of shelling out to real tools rather than mocking them
 * (see tests/finalize.test.mjs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundleProjectSource } from "../src/export/bundle.mjs";

function hasTar() {
  return spawnSync("tar", ["--version"]).status === 0;
}

/** A minimal but realistic project dir, as buildSlides/synthesizeScenes would leave it. */
function makeProjectDir({ withImage = false, withReview = false, withRenderPlan = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-test-"));
  const assetsDir = path.join(dir, "assets");
  const compositionsDir = path.join(dir, "compositions");
  const vendorDir = path.join(dir, "vendor");
  const rendersDir = path.join(dir, "renders");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(compositionsDir, { recursive: true });
  fs.mkdirSync(vendorDir, { recursive: true });
  fs.mkdirSync(rendersDir, { recursive: true });

  fs.writeFileSync(path.join(dir, "teleprompter.md"), "## Scene 1 — Intro\n\nHello world.\n");
  const scenes = [{ scene: 1, title: "Intro", narration: "Hello world.", audio: "assets/scene-01.wav", duration: 3.2 }];
  fs.writeFileSync(path.join(assetsDir, "scenes.json"), JSON.stringify({ scenes }, null, 2));
  fs.writeFileSync(path.join(assetsDir, "scene-01.wav"), "fake-wav-bytes");
  fs.writeFileSync(path.join(compositionsDir, "scene-01.html"), "<html><!-- scene 1 --></html>");
  fs.writeFileSync(path.join(vendorDir, "gsap.min.js"), "/* fake gsap */");
  // A real render output -- must NOT end up in the source bundle.
  fs.writeFileSync(path.join(rendersDir, "final.mp4"), "fake-mp4-bytes");

  if (withImage) fs.writeFileSync(path.join(assetsDir, "scene-01-image.jpg"), "fake-jpg-bytes");
  if (withReview) fs.writeFileSync(path.join(assetsDir, "review.json"), JSON.stringify([{ num: 1, verdict: "OK" }]));
  if (withRenderPlan) {
    fs.writeFileSync(
      path.join(assetsDir, "render-plan.json"),
      JSON.stringify({ durationScale: 1, scenes: [{ scene: 1, duration: 3.8 }] }),
    );
  }
  return dir;
}

test("bundleProjectSource throws a clear error when teleprompter.md is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-test-empty-"));
  assert.throws(() => bundleProjectSource({ projectDir: dir, topic: "x", archive: false }), /teleprompter\.md not found/);
});

test("bundleProjectSource throws a clear error when assets/scenes.json is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-test-noscenes-"));
  fs.writeFileSync(path.join(dir, "teleprompter.md"), "## Scene 1 — Intro\n\nHi.\n");
  assert.throws(() => bundleProjectSource({ projectDir: dir, topic: "x", archive: false }), /scenes\.json not found/);
});

test("bundleProjectSource throws a clear error when there are no scene compositions yet", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-test-nocomp-"));
  fs.writeFileSync(path.join(dir, "teleprompter.md"), "## Scene 1 — Intro\n\nHi.\n");
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "assets", "scenes.json"), JSON.stringify({ scenes: [] }));
  assert.throws(() => bundleProjectSource({ projectDir: dir, topic: "x", archive: false }), /no scene-NN\.html files/);
});

test("bundleProjectSource writes a manifest + README describing exactly what's present, with no false claims about §1/§4 files that don't exist yet", () => {
  const dir = makeProjectDir();
  const result = bundleProjectSource({ projectDir: dir, topic: "How tunnels work", model: "bunsenbrenner-default", archive: false });

  assert.equal(result.archivePath, null);
  assert.ok(fs.existsSync(result.manifestPath));
  assert.ok(fs.existsSync(result.readmePath));

  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
  assert.equal(manifest.topic, "How tunnels work");
  assert.equal(manifest.storyboardModel, "bunsenbrenner-default");
  assert.equal(manifest.sceneCount, 1);
  assert.equal(manifest.hasImages, false);
  assert.equal(manifest.hasReview, false);
  assert.equal(manifest.hasRenderPlan, false);
  assert.equal(manifest.files.review, null);
  assert.equal(manifest.files.renderPlan, null);
  assert.match(manifest.pipelineCommit === null ? "null" : manifest.pipelineCommit, /^(null|[0-9a-f]{7,})$/);

  const readme = fs.readFileSync(result.readmePath, "utf8");
  assert.match(readme, /teleprompter\.md/);
  assert.match(readme, /assets\/scenes\.json/);
  assert.match(readme, /compositions\/scene-NN\.html/);
  assert.match(readme, /window\.__timelines\[sid\]/);
  // Must not claim review.json/render-plan.json exist when they don't.
  assert.ok(!readme.includes("assets/review.json"));
  assert.ok(!readme.includes("assets/render-plan.json"));
});

test("bundleProjectSource documents review.json and render-plan.json only when they're actually present", () => {
  const dir = makeProjectDir({ withReview: true, withRenderPlan: true, withImage: true });
  const result = bundleProjectSource({ projectDir: dir, topic: "x", archive: false });

  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
  assert.equal(manifest.hasReview, true);
  assert.equal(manifest.hasRenderPlan, true);
  assert.equal(manifest.hasImages, true);
  assert.equal(manifest.files.review, "assets/review.json");
  assert.equal(manifest.files.renderPlan, "assets/render-plan.json");
  assert.deepEqual(manifest.files.images, ["assets/scene-01-image.jpg"]);

  const readme = fs.readFileSync(result.readmePath, "utf8");
  assert.match(readme, /assets\/review\.json/);
  assert.match(readme, /assets\/render-plan\.json/);
});

test(
  "bundleProjectSource produces a tar.gz containing exactly the editable source (never renders/)",
  { skip: !hasTar() && "tar not on PATH" },
  () => {
    const dir = makeProjectDir({ withReview: true, withRenderPlan: true });
    const result = bundleProjectSource({ projectDir: dir, topic: "x" });

    assert.ok(result.archivePath);
    assert.ok(fs.existsSync(result.archivePath));
    assert.ok(result.archiveSize > 0);

    const listing = spawnSync("tar", ["-tzf", result.archivePath]).stdout.toString();
    assert.match(listing, /teleprompter\.md/);
    assert.match(listing, /assets\/scenes\.json/);
    assert.match(listing, /assets\/review\.json/);
    assert.match(listing, /assets\/render-plan\.json/);
    assert.match(listing, /compositions\/scene-01\.html/);
    assert.match(listing, /vendor\/gsap\.min\.js/);
    assert.match(listing, /bundle-manifest\.json/);
    assert.match(listing, /README\.md/);
    // The compiled output must not leak into the source bundle.
    assert.ok(!listing.includes("renders/"), `renders/ must not be in the bundle, got:\n${listing}`);

    // Round-trip: extract and confirm the manifest inside matches what was reported.
    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-test-extract-"));
    spawnSync("tar", ["-xzf", result.archivePath, "-C", extractDir]);
    const extractedManifest = JSON.parse(fs.readFileSync(path.join(extractDir, "bundle-manifest.json"), "utf8"));
    assert.deepEqual(extractedManifest, result.manifest);
    assert.ok(fs.existsSync(path.join(extractDir, "compositions", "scene-01.html")));
  },
);
