/**
 * "bouncing-icons" — 3-8 procedurally-drawn icons (lock/gear/cloud/chart/shield/bolt) drop
 * under gravity and land in a scattered pile. Physics: p5play (a p5.js addon; internally a
 * Box2D port, planck.js — hence the extra planck.min.js vendor file p5play requires). Bake
 * mechanism: p5play's own `world.physicsUpdate(timeStep, velIter, posIter)` is called
 * directly, N times in a plain for-loop, right inside `setup()` — completely independent
 * of p5's normal per-frame draw loop (`noLoop()` right after, matching the plan's point 4).
 * Render target: the same p5 canvas, but repainted only from the recorded keyframes (never
 * from live sprite state) — same "bake, then scrub" contract as every other template here.
 *
 * IMPORTANT ordering note (verified against the vendored p5.min.js source, not assumed):
 * `new p5(sketch, node)` only runs `setup()` synchronously when `document.readyState` is
 * already `"complete"` at construction time; otherwise p5 defers to the window `load`
 * event. This scene's `<script>` runs before `load` fires (Google Fonts is still loading),
 * so `setup()` — and therefore the whole bake — happens *after* this script has returned.
 * `window.__timelines[sid]` is only assigned at the *end* of `setup()`, once baking is
 * done; engine.mjs already polls for it to appear (up to 10s) rather than assuming it's
 * there immediately, so this is safe, just worth knowing if you edit this file.
 */
import {
  sceneId, resolveTotalDuration, attachBakedDriverScript, registerTimelineScript, fadeInCaptionsScript, compositionShell,
  assertEnumArray, assertOptionalNumberRange,
} from "./_shared.mjs";

export const ICON_NAMES = ["lock", "gear", "cloud", "chart", "shield", "bolt"];

export const paramSchema = {
  icons: `enum[3..8] from {${ICON_NAMES.join(",")}}`,
  settleAt: "number(0..1), default 0.5 (documents intended pacing; the bake always runs to completion)",
  validate(params, num) {
    assertEnumArray(params?.icons, { field: "icons", allowed: ICON_NAMES, min: 3, max: 8, num });
    assertOptionalNumberRange(params?.settleAt, { field: "settleAt", min: 0, max: 1, num });
  },
};

function defaultIcons(seedNum) {
  const out = [];
  for (let i = 0; i < 4; i++) out.push(ICON_NAMES[(seedNum + i * 2) % ICON_NAMES.length]);
  return out;
}

/** @param {{num:number,title:string,narration:string,duration:number,syncDuration?:number,
 *   holdDuration?:number,theme?:string,params?:{icons?:string[]},seed?:number}} o */
export function render({ num, title, narration, duration, syncDuration, holdDuration, theme = "default", params, seed }) {
  const sid = sceneId(num);
  const total = resolveTotalDuration({ duration, syncDuration, holdDuration });
  const seedNum = Number.isFinite(seed) ? seed : num;
  let icons = (params?.icons?.length ? params.icons : defaultIcons(seedNum))
    .filter((n) => ICON_NAMES.includes(n))
    .slice(0, 8);
  while (icons.length < 3) icons.push(ICON_NAMES[icons.length % ICON_NAMES.length]);

  const stageHtml = `<div id="bounce-canvas-holder" class="bounce-canvas-holder"></div>`;
  const extraStyle = `
    .bounce-canvas-holder { position: absolute; inset: 0; }
    .bounce-canvas-holder canvas { display: block; }`;

  const script = `
(function () {
  const N = 240, FIXED_DT_SEC = 1 / 60;
  const W = 1920, H = 1080;
  const rand = mulberry32(${seedNum});
  const iconNames = ${JSON.stringify(icons)};

  function drawIcon(p, name, x, y, rotDeg, accent, accentDim, ink) {
    p.push();
    p.translate(x, y);
    p.rotate(rotDeg);
    p.noStroke();
    const R = 62;
    if (name === 'lock') {
      p.fill(accentDim); p.stroke(accent); p.strokeWeight(4);
      p.noFill(); p.arc(0, -R * 0.35, R * 0.9, R * 0.9, 180, 360);
      p.noStroke(); p.fill(accentDim); p.rect(-R * 0.55, -R * 0.1, R * 1.1, R * 0.85, 10);
      p.fill(ink); p.circle(0, R * 0.2, R * 0.22);
    } else if (name === 'gear') {
      p.fill(accentDim);
      for (let i = 0; i < 8; i++) { p.push(); p.rotate(i * 45); p.rect(-R * 0.12, -R * 0.95, R * 0.24, R * 0.35); p.pop(); }
      p.circle(0, 0, R * 1.3);
      p.fill(ink); p.circle(0, 0, R * 0.5);
    } else if (name === 'cloud') {
      p.fill(accentDim);
      p.ellipse(-R * 0.4, R * 0.1, R * 0.9, R * 0.7);
      p.ellipse(R * 0.35, R * 0.05, R * 1.0, R * 0.8);
      p.ellipse(0, -R * 0.2, R * 1.1, R * 0.75);
    } else if (name === 'chart') {
      p.fill(accentDim);
      p.rect(-R * 0.7, R * 0.05, R * 0.35, R * 0.75);
      p.fill(accent);
      p.rect(-R * 0.15, -R * 0.35, R * 0.35, R * 1.15);
      p.fill(accentDim);
      p.rect(R * 0.4, -R * 0.7, R * 0.35, R * 1.5);
    } else if (name === 'shield') {
      p.fill(accentDim); p.stroke(accent); p.strokeWeight(4);
      p.beginShape();
      p.vertex(0, -R); p.vertex(R * 0.75, -R * 0.55); p.vertex(R * 0.75, R * 0.25);
      p.vertex(0, R); p.vertex(-R * 0.75, R * 0.25); p.vertex(-R * 0.75, -R * 0.55);
      p.endShape(p.CLOSE);
      p.noStroke(); p.fill(ink);
      p.rect(-R * 0.12, -R * 0.3, R * 0.24, R * 0.6, 4);
    } else {
      p.fill(accent); p.noStroke();
      p.beginShape();
      p.vertex(R * 0.15, -R); p.vertex(-R * 0.35, R * 0.1); p.vertex(0, R * 0.1);
      p.vertex(-R * 0.15, R); p.vertex(R * 0.35, -R * 0.1); p.vertex(0, -R * 0.1);
      p.endShape(p.CLOSE);
    }
    p.pop();
  }

  const sketch = function (p) {
    const keyframes = [];
    let latestKeyframe = null;
    let colors = { accent: '#4DA3FF', accentDim: '#28425E', ink: '#E8EDF4' };

    p.draw = function () {
      p.clear();
      if (!latestKeyframe) return;
      for (let i = 0; i < latestKeyframe.length; i++) {
        const kf = latestKeyframe[i];
        drawIcon(p, iconNames[i], kf.x, kf.y, kf.r, colors.accent, colors.accentDim, colors.ink);
      }
    };

    p.setup = function () {
      const holderEl = document.getElementById('bounce-canvas-holder');
      p.createCanvas(W, H).parent(holderEl);
      const cs = getComputedStyle(document.documentElement);
      colors = {
        accent: (cs.getPropertyValue('--accent').trim() || '#4DA3FF'),
        accentDim: (cs.getPropertyValue('--accent-dim').trim() || '#28425E'),
        ink: (cs.getPropertyValue('--ink').trim() || '#E8EDF4'),
      };

      p.world.gravity.y = 1400;
      // p5play draws every sprite in allSprites automatically (that's its whole point);
      // since this template paints icons itself from baked keyframes (see the shared
      // "bake, then scrub" contract in ./_shared.mjs), every physics sprite -- floor,
      // walls, and the icons themselves -- is set invisible so only our own drawIcon()
      // calls below ever put pixels on the canvas.
      const floor = new p.Sprite(W / 2, H - 210, W - 200, 60, 'static'); floor.visible = false; // clears the narration caption band
      const wallL = new p.Sprite(90, H / 2, 60, H * 2, 'static'); wallL.visible = false;
      const wallR = new p.Sprite(W - 90, H / 2, 60, H * 2, 'static'); wallR.visible = false;

      const sprites = iconNames.map((name, i) => {
        const s = new p.Sprite(340 + rand() * (W - 680), -220 - i * 230 - rand() * 220, 140);
        s.bounciness = 0.35 + rand() * 0.2;
        s.friction = 0.5;
        s.visible = false;
        return s;
      });

      for (let f = 0; f < N; f++) {
        p.world.physicsUpdate(FIXED_DT_SEC, 8, 3);
        keyframes.push(sprites.map((s) => ({ x: s.x, y: s.y, r: s.rotation })));
      }
      p.noLoop();
      latestKeyframe = keyframes[0];

      function applyKeyframe(kf) {
        latestKeyframe = kf;
        p.redraw();
      }

      const tl = gsap.timeline({ paused: true });
      ${fadeInCaptionsScript({ totalDuration: total })}
      ${attachBakedDriverScript({ totalDuration: total })}
      ${registerTimelineScript({ sid })}
    };
  };

  new p5(sketch, document.getElementById('bounce-canvas-holder'));
})();
`;

  return compositionShell({
    num, title, narration, theme, totalDuration: total,
    vendor: ["gsap.min.js", "p5.min.js", "planck.min.js", "p5.play.min.js"], extraStyle, stageHtml, script,
  });
}
