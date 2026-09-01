/**
 * Shared plumbing for the physics/animated scene templates (src/render/templates/*.mjs).
 *
 * Every template follows the same "bake, then scrub" contract described in the explainer
 * pipeline plan (§2 "p5.play / Matter.js animated scene templates"):
 *
 *   1. On page load, the template's inline <script> runs a *deterministic* physics
 *      simulation forward for a fixed number of samples (N) using a manual step loop
 *      (Matter.Engine.update / world.physicsUpdate) — never requestAnimationFrame,
 *      never Math.random() (a seeded mulberry32 PRNG is used instead). Each sample's
 *      positions/angles are pushed into a `keyframes` array; the live physics engine is
 *      then done with (nothing about later playback touches it again).
 *   2. A *phantom progress tween* — one more child tween on the scene's real
 *      `gsap.timeline()` — drives playback: as `driver.progress` goes 0 -> 1 over the
 *      scene's whole authored duration, `onUpdate` picks the nearest baked keyframe and
 *      calls the template's own `applyKeyframe(kf)` to paint it (CSS transforms on
 *      pre-positioned DOM/SVG elements, or a canvas 2D redraw).
 *   3. `window.__timelines[sid]` is set to that real timeline, so engine.mjs's existing
 *      frame-by-frame capture loop (`tl.totalDuration(seconds)`, `tl.pause(t)`) needs
 *      *zero* changes to drive any of these templates — same duck-typed contract as the
 *      plain text-reveal slide in ../slides.mjs.
 *
 * This module only emits *strings* of JS/HTML/CSS — everything here ends up inlined into
 * a scene-NN.html file and executed inside the headless-Chrome page, not in this Node
 * process. Keep it dependency-free and self-contained for that reason.
 */
import { themeRootCss } from "../theme.mjs";

export function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function sceneId(num) {
  return `scene-${String(num).padStart(2, "0")}`;
}

/** Resolves the scene's total authored duration in seconds (syncDuration + holdDuration,
 *  falling back to plain `duration` when the pacing split — plan §4, not yet wired in by
 *  the caller — isn't present). Never below 3s so a physics bake always has room to read. */
export function resolveTotalDuration({ duration, syncDuration, holdDuration }) {
  const sync = Number(syncDuration ?? duration);
  const hold = Number(holdDuration ?? 0);
  const total = (Number.isFinite(sync) ? sync : 0) + (Number.isFinite(hold) ? hold : 0);
  return total > 3 ? total : Math.max(Number(duration) || 0, 5);
}

/** Deterministic mulberry32 PRNG, inlined as source (runs in the page, not in Node).
 *  Seeded by the scene number by convention, so re-rendering a scene is reproducible. */
export const MULBERRY32_SRC = `
function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
`;

/**
 * JS source: adds the phantom progress tween (the "driver") as a child of an existing
 * `tl` (must already be declared in scope) that scrubs a `keyframes` array via a
 * template-supplied `applyKeyframe(kf)` function (also assumed already declared).
 *
 * The driver tween's `onUpdate` is what drives the *live* browser view (`tl.play()`
 * ticks normally there, and GSAP fires `onUpdate` on every real tick). It is NOT enough
 * on its own for the *render* path, though: verified directly against the vendored
 * gsap.min.js, `Timeline.pause(t)` calls `seek(t, e)` with `e` defaulting through a `w()`
 * helper that is `true` whenever no second argument was given — i.e. `suppressEvents`
 * defaults to `true` for a bare `pause(t)`, which is exactly how engine.mjs calls it for
 * every captured frame, and a suppressed seek skips every child tween's `onUpdate`
 * (confirmed empirically too: without this override, every frame captured the scene's
 * very first baked keyframe and nothing ever visibly moved). GSAP's own direct property
 * writes — the opacity/y fades in ../slides.mjs and in fadeInCaptionsScript below — are
 * unaffected by suppressEvents, so only *this* onUpdate-driven mechanism needed a fix:
 * `tl.pause` is overridden on the returned timeline itself to paint the right keyframe
 * straight from the requested time, independent of GSAP's event suppression, while still
 * calling through to the real `pause()` for everything else. Contained entirely in this
 * template layer — no change to engine.mjs's generic capture loop.
 */
export function attachBakedDriverScript({ totalDuration }) {
  return `
  applyKeyframe(keyframes[0]);
  (function () {
    const __N = keyframes.length;
    const __driver = { progress: 0 };
    tl.to(__driver, {
      progress: 1,
      duration: ${Number(totalDuration).toFixed(3)},
      ease: "none",
      onUpdate: function () {
        applyKeyframe(keyframes[Math.round(__driver.progress * (__N - 1))]);
      },
    }, 0);
    var __realPause = tl.pause.bind(tl);
    tl.pause = function (atTime, suppressEvents) {
      if (typeof atTime === "number") {
        var total = tl.totalDuration() || ${Number(totalDuration).toFixed(3)};
        var frac = total > 0 ? Math.min(1, Math.max(0, atTime / total)) : 0;
        applyKeyframe(keyframes[Math.round(frac * (__N - 1))]);
      }
      return __realPause(atTime, suppressEvents);
    };
  })();
  `;
}

/** JS source: registers `tl` (must already be declared) on window.__timelines[sid], with
 *  the same live-vs-render play guard every composition in this project uses. */
export function registerTimelineScript({ sid }) {
  return `
  window.__timelines = window.__timelines || {};
  window.__timelines[${JSON.stringify(sid)}] = tl;
  if (!window.__hyperframesRender) { tl.play(); }
  `;
}

/** JS source: the three fade-in tweens (eyebrow/title/narration) every template uses so
 *  the on-screen text doesn't just hard-cut into view — added to `tl` (already declared)
 *  ahead of the driver child tween, timed off the scene's own total duration exactly like
 *  ../slides.mjs's renderSlideHtml does for its eyebrow/display/sub elements. */
export function fadeInCaptionsScript({ totalDuration }) {
  const D = Number(totalDuration) || 5;
  const tEyebrow = +(D * 0.04).toFixed(2);
  const tTitle = +(D * 0.12).toFixed(2);
  const tNarration = +(D * 0.22).toFixed(2);
  return `
  tl.to('.eyebrow-fixed', { opacity: 1, y: 0, duration: 0.6, ease: "power3.out", startAt: { y: 14 } }, ${tEyebrow});
  tl.to('.title-fixed', { opacity: 1, y: 0, duration: 0.7, ease: "back.out(1.4)", startAt: { y: 20 } }, ${tTitle});
  tl.to('.narration-caption', { opacity: 1, y: 0, duration: 0.6, ease: "power2.out", startAt: { y: 14 } }, ${tNarration});
  `;
}

// --- paramSchema.validate() helpers -------------------------------------------------
//
// src/script/review.mjs (plan §1, built in parallel) calls `paramSchema.validate(params,
// sceneNum)` when present and expects it to throw a `Scene ${num}: ...`-prefixed Error on
// a bad shape; without a `validate` function it falls back to generic (non-null-object)
// checking. These small helpers give each template's paramSchema a real `validate`, kept
// to the bounded checks the plan calls for (array lengths, enum membership, numeric
// ranges) — never anything that could accept free-form/executable content.

export function assertStringArray(value, { field, min, max, num }) {
  if (!Array.isArray(value) || value.length < min || value.length > max || !value.every((v) => typeof v === "string" && v.trim())) {
    throw new Error(`Scene ${num}: templateParams.${field} must be an array of ${min}-${max} non-empty strings.`);
  }
}

export function assertEnumArray(value, { field, allowed, min, max, num }) {
  if (!Array.isArray(value) || value.length < min || value.length > max || !value.every((v) => allowed.includes(v))) {
    throw new Error(`Scene ${num}: templateParams.${field} must be an array of ${min}-${max} values from {${allowed.join(",")}}.`);
  }
}

export function assertOptionalNumberRange(value, { field, min, max, num }) {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Scene ${num}: templateParams.${field}, when given, must be a number between ${min} and ${max}.`);
  }
}

export function assertOptionalEnum(value, { field, allowed, num }) {
  if (value === undefined) return;
  if (!allowed.includes(value)) {
    throw new Error(`Scene ${num}: templateParams.${field}, when given, must be one of {${allowed.join(",")}}.`);
  }
}

export function assertNonEmptyString(value, { field, num }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Scene ${num}: templateParams.${field} must be a non-empty string.`);
  }
}

function vendorScriptTags(names) {
  return names.map((n) => `<script src="../vendor/${esc(n)}"></script>`).join("\n  ");
}

/**
 * Common HTML shell for every physics-template composition: fonts, vendor <script> tags,
 * the shared eyebrow/title/narration-caption/watermark chrome, and the mulberry32 PRNG
 * inlined ahead of the template's own bake+register script. Mirrors ../slides.mjs's
 * renderSlideHtml shell (same composition-contract element, same fonts/watermark) so
 * animated scenes sit visually consistent with plain text-reveal scenes.
 *
 * @param {{num:number, title:string, narration:string, theme:string, totalDuration:number,
 *   vendor:string[], extraStyle?:string, stageHtml:string, script:string}} o
 */
export function compositionShell({ num, title, narration, theme = "default", totalDuration, vendor, extraStyle, stageHtml, script }) {
  const sid = sceneId(num);
  const dur = (Number(totalDuration) > 0.5 ? Number(totalDuration) : 5).toFixed(2);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)} — ${sid}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,700;0,9..40,800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  ${vendorScriptTags(vendor)}
  <style>
    ${themeRootCss(theme)}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: var(--bg); color: var(--ink); font-family: var(--font-display); overflow: hidden; }
    .composition { position: relative; width: 1920px; height: 1080px; overflow: hidden; background-color: var(--bg); background-image: radial-gradient(circle, var(--grid-dot) 1.4px, transparent 1.4px); background-size: 46px 46px; }
    .eyebrow-fixed { position: absolute; top: 92px; left: 150px; font-family: var(--font-mono); font-size: 24px; letter-spacing: .18em; color: var(--muted); text-transform: uppercase; opacity: 0; z-index: 5; }
    .title-fixed { position: absolute; top: 132px; left: 150px; right: 150px; font-size: 56px; font-weight: 800; letter-spacing: -.02em; color: var(--ink); opacity: 0; z-index: 5; }
    .narration-caption { position: absolute; bottom: 128px; left: 200px; right: 200px; text-align: center; font-size: 32px; line-height: 1.5; color: var(--ink); opacity: 0; z-index: 5; text-shadow: 0 2px 10px var(--bg), 0 0 24px var(--bg); }
    .caption { position: absolute; bottom: 40px; left: 150px; font-family: var(--font-mono); font-size: 22px; color: var(--muted); letter-spacing: .06em; z-index: 5; }
    ${extraStyle || ""}
  </style>
</head>
<body>
  <div class="composition" data-composition-id="${sid}" data-duration="${dur}" data-fps="30">
    <div class="eyebrow-fixed">Scene ${String(num).padStart(2, "0")}</div>
    <div class="title-fixed">${esc(title)}</div>
    ${stageHtml}
    <div class="narration-caption">${esc(narration)}</div>
    <div class="caption">CADS-DEMO-explainer</div>
  </div>

  <script>
    ${MULBERRY32_SRC}
    ${script}
  </script>
</body>
</html>
`;
}
