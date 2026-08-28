import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderSlideHtml, buildSlides } from "../src/render/slides.mjs";

test("renderSlideHtml embeds the HyperFrames composition contract required by the render engine", () => {
  const html = renderSlideHtml({ num: 3, title: "A Title", narration: "Some narration.", duration: 7.5 });
  assert.match(html, /data-composition-id="scene-03"/);
  assert.match(html, /data-duration="7.50"/);
  assert.match(html, /data-fps="30"/);
  assert.match(html, /window\.__timelines\["scene-03"\] = tl;/);
  assert.match(html, /if \(!window\.__hyperframesRender\) \{ tl\.play\(\); \}/);
});

test("renderSlideHtml escapes title/narration to prevent markup injection", () => {
  const html = renderSlideHtml({ num: 1, title: '<script>x</script>', narration: "A & B", duration: 5 });
  assert.ok(!html.includes("<script>x</script>"));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /A &amp; B/);
});

test("renderSlideHtml falls back to a minimum duration for degenerate input", () => {
  const html = renderSlideHtml({ num: 1, title: "T", narration: "N", duration: 0 });
  assert.match(html, /data-duration="5"/);
});

test("buildSlides writes one scene-NN.html per manifest scene plus a vendored gsap.min.js", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slides-test-"));
  const scenesManifest = {
    scenes: [
      { scene: 1, title: "First", narration: "Hello.", duration: 4 },
      { scene: 2, title: "Second", narration: "World.", duration: 6 },
    ],
  };
  const made = buildSlides({ scenesManifest, projectDir: dir });
  assert.equal(made.length, 2);
  assert.ok(fs.existsSync(path.join(dir, "compositions", "scene-01.html")));
  assert.ok(fs.existsSync(path.join(dir, "compositions", "scene-02.html")));
  const vendorGsap = path.join(dir, "vendor", "gsap.min.js");
  assert.ok(fs.existsSync(vendorGsap));
  assert.ok(fs.statSync(vendorGsap).size > 10000, "vendored gsap.min.js should be a real, non-trivial file");
});
