/**
 * Scene -> scene-NN.html composition.
 *
 * Reuses the "HyperFrames" composition contract from scimbe/SlideCreator's
 * MyExplainAnimator (a `.composition[data-composition-id/duration/fps]` element whose
 * inline script registers a paused GSAP timeline on `window.__timelines[id]`, played live
 * in a browser but paused/scrubbed frame-by-frame by the render engine) — that contract
 * is what makes engine.mjs's frame-by-frame Puppeteer capture possible. The slide *design*
 * itself is new, simpler code: this demo does not port SlideCreator's much larger
 * archetype/diagram library (flow/compare/steps/tree/...); every scene here uses one plain
 * title+narration text template. Porting the diagram archetypes is a known gap — see README.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { themeRootCss } from "./theme.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_GSAP = path.join(__dirname, "vendor", "gsap.min.js");

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** One markup-safe scene-NN.html. duration = seconds this scene's narration audio takes. */
export function renderSlideHtml({ num, title, narration, duration, theme = "default" }) {
  const sid = `scene-${String(num).padStart(2, "0")}`;
  const dur = Number(duration) > 0.5 ? Number(duration).toFixed(2) : "5";
  const D = Number(dur);
  const tEyebrow = +(D * 0.05).toFixed(2);
  const tTitle = +(D * 0.18).toFixed(2);
  const tRule = +(D * 0.40).toFixed(2);
  const tSub = +(D * 0.50).toFixed(2);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)} — ${sid}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,700;0,9..40,800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <script src="../vendor/gsap.min.js"></script>
  <style>
    ${themeRootCss(theme)}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: var(--bg); color: var(--ink); font-family: var(--font-display); overflow: hidden; }
    .composition { position: relative; width: 1920px; height: 1080px; overflow: hidden; background-color: var(--bg); background-image: radial-gradient(circle, var(--grid-dot) 1.4px, transparent 1.4px); background-size: 46px 46px; }
    .stage { position: absolute; inset: 0; padding: 130px 150px; display: flex; flex-direction: column; justify-content: center; }
    .eyebrow { font-family: var(--font-mono); font-size: 24px; letter-spacing: .18em; color: var(--muted); text-transform: uppercase; opacity: 0; }
    .display { font-size: 92px; font-weight: 800; letter-spacing: -.02em; line-height: 1.06; margin-top: 34px; max-width: 1500px; opacity: 0; }
    .rule { width: 0; height: 3px; background: var(--rule); margin: 44px 0; }
    .sub { font-size: 40px; margin-top: 8px; max-width: 1500px; opacity: 0; line-height: 1.5; color: var(--ink); }
    .caption { position: absolute; bottom: 84px; left: 150px; font-family: var(--font-mono); font-size: 22px; color: var(--muted); letter-spacing: .06em; }
  </style>
</head>
<body>
  <div class="composition" data-composition-id="${sid}" data-duration="${dur}" data-fps="30">
    <div class="stage">
      <div class="eyebrow" data-anim="eyebrow">Scene ${String(num).padStart(2, "0")}</div>
      <h1 class="display" data-anim="display">${esc(title)}</h1>
      <div class="rule" data-anim="rule"></div>
      <p class="sub" data-anim="sub">${esc(narration)}</p>
    </div>
    <div class="caption">CADS-DEMO-explainer</div>
  </div>

  <script>
    const tl = gsap.timeline({ paused: true });
    tl.to('[data-anim="eyebrow"]', { opacity: 1, y: 0, duration: 0.6, ease: "power3.out", startAt: { y: 14 } }, ${tEyebrow});
    tl.to('[data-anim="display"]', { opacity: 1, y: 0, duration: 0.9, ease: "back.out(1.4)", startAt: { y: 30 } }, ${tTitle});
    tl.to('[data-anim="rule"]',    { width: 360, duration: 0.8, ease: "power2.inOut" }, ${tRule});
    tl.to('[data-anim="sub"]', { opacity: 1, y: 0, duration: 0.8, ease: "power2.out", startAt: { y: 18 } }, ${tSub});

    window.__timelines = window.__timelines || {};
    window.__timelines["${sid}"] = tl;
    if (!window.__hyperframesRender) { tl.play(); }
  </script>
</body>
</html>
`;
}

/**
 * @param {{scenesManifest:{scenes:Array<{scene:number,title:string,narration:string,duration:number}>}, projectDir:string, theme?:string}} o
 * Writes <projectDir>/compositions/scene-NN.html and <projectDir>/vendor/gsap.min.js.
 * @returns {Array<{scene:number, file:string}>}
 */
export function buildSlides({ scenesManifest, projectDir, theme = "default" }) {
  const compositionsDir = path.join(projectDir, "compositions");
  const vendorDir = path.join(projectDir, "vendor");
  fs.mkdirSync(compositionsDir, { recursive: true });
  fs.mkdirSync(vendorDir, { recursive: true });
  fs.copyFileSync(VENDOR_GSAP, path.join(vendorDir, "gsap.min.js"));

  const made = [];
  for (const s of scenesManifest.scenes) {
    const html = renderSlideHtml({ num: s.scene, title: s.title, narration: s.narration, duration: s.duration, theme });
    const file = path.join(compositionsDir, `scene-${String(s.scene).padStart(2, "0")}.html`);
    fs.writeFileSync(file, html);
    made.push({ scene: s.scene, file });
  }
  return made;
}
