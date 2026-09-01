/**
 * "physics-drop-title" — 2-6 word/label chips drop under gravity into a floor+wall
 * enclosure and settle into a pile. Physics: Matter.js. Render target: CSS transforms on
 * pre-positioned absolute DOM chip elements (one <div> per item), per the plan's baking
 * contract in ./_shared.mjs.
 */
import {
  esc, sceneId, resolveTotalDuration, attachBakedDriverScript, registerTimelineScript, fadeInCaptionsScript, compositionShell,
  assertStringArray, assertOptionalNumberRange, assertOptionalEnum,
} from "./_shared.mjs";

const PRESET_NAMES = ["bouncy", "heavy", "light"];

export const paramSchema = {
  items: "string[2..6]",
  settleAt: "number(0..1), default 0.5",
  preset: "'bouncy' | 'heavy' | 'light', default 'bouncy'",
  validate(params, num) {
    assertStringArray(params?.items, { field: "items", min: 2, max: 6, num });
    assertOptionalNumberRange(params?.settleAt, { field: "settleAt", min: 0, max: 1, num });
    assertOptionalEnum(params?.preset, { field: "preset", allowed: PRESET_NAMES, num });
  },
};

const PRESETS = {
  bouncy: { restitution: 0.6, friction: 0.15, density: 0.0018, gravityScale: 1.0 },
  heavy: { restitution: 0.1, friction: 0.55, density: 0.006, gravityScale: 1.3 },
  light: { restitution: 0.35, friction: 0.25, density: 0.0006, gravityScale: 0.6 },
};

function defaultItems(title) {
  const words = String(title || "Scene").split(/\s+/).filter(Boolean);
  const chips = words.slice(0, 6);
  while (chips.length < 2) chips.push(chips[0] || "Scene");
  return chips;
}

/** @param {{num:number,title:string,narration:string,duration:number,syncDuration?:number,
 *   holdDuration?:number,theme?:string,params?:{items?:string[],settleAt?:number,preset?:string},seed?:number}} o */
export function render({ num, title, narration, duration, syncDuration, holdDuration, theme = "default", params, seed }) {
  const sid = sceneId(num);
  const total = resolveTotalDuration({ duration, syncDuration, holdDuration });
  let items = (params?.items?.length ? params.items : defaultItems(title)).slice(0, 6).map(String);
  while (items.length < 2) items.push(items[0] || title || "Scene");
  const preset = PRESETS[params?.preset] ? params.preset : "bouncy";
  const seedNum = Number.isFinite(seed) ? seed : num;

  const stageHtml = `
    <div class="drop-stage" id="drop-stage">
      ${items.map((it) => `<div class="drop-chip">${esc(it)}</div>`).join("\n      ")}
    </div>`;

  const extraStyle = `
    .drop-stage { position: absolute; inset: 0; }
    .drop-chip {
      position: absolute; left: 0; top: 0; will-change: transform;
      background: var(--accent-dim); color: var(--ink); border: 3px solid var(--accent);
      border-radius: 16px; padding: 20px 38px; font-family: var(--font-display); font-weight: 800;
      font-size: 42px; white-space: nowrap;
    }`;

  const script = `
(function () {
  const P = ${JSON.stringify(PRESETS[preset])};
  const N = 240, FIXED_DT = 1000 / 60;
  const W = 1920, H = 1080, FLOOR_Y = 800, WALL_MARGIN = 120;
  const rand = mulberry32(${seedNum});

  const engine = Matter.Engine.create({ gravity: { x: 0, y: 1 * P.gravityScale } });
  const world = engine.world;

  const els = Array.from(document.querySelectorAll('.drop-chip'));
  const bodies = els.map((el, i) => {
    const r = el.getBoundingClientRect();
    const w = Math.max(80, r.width), h = Math.max(50, r.height);
    const x = 300 + (i / Math.max(1, els.length - 1)) * (W - 600) + (rand() - 0.5) * 80;
    const y = -220 - i * 180 - rand() * 240;
    const angle = (rand() - 0.5) * 0.7;
    const b = Matter.Bodies.rectangle(x, y, w, h, {
      restitution: P.restitution, friction: P.friction, density: P.density, angle,
      chamfer: { radius: 10 },
    });
    Matter.Body.setAngularVelocity(b, (rand() - 0.5) * 0.25);
    Matter.World.add(world, b);
    return b;
  });

  Matter.World.add(world, [
    Matter.Bodies.rectangle(W / 2, FLOOR_Y + 60, W, 120, { isStatic: true }),
    Matter.Bodies.rectangle(WALL_MARGIN - 60, H / 2, 120, H, { isStatic: true }),
    Matter.Bodies.rectangle(W - WALL_MARGIN + 60, H / 2, 120, H, { isStatic: true }),
  ]);

  const keyframes = [];
  for (let f = 0; f < N; f++) {
    Matter.Engine.update(engine, FIXED_DT);
    keyframes.push(bodies.map((b) => ({ x: b.position.x, y: b.position.y, a: b.angle })));
  }

  function applyKeyframe(kf) {
    for (let i = 0; i < els.length; i++) {
      const p = kf[i];
      els[i].style.transform =
        'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) translate(-50%,-50%) rotate(' + p.a.toFixed(3) + 'rad)';
    }
  }

  const tl = gsap.timeline({ paused: true });
  ${fadeInCaptionsScript({ totalDuration: total })}
  ${attachBakedDriverScript({ totalDuration: total })}
  ${registerTimelineScript({ sid })}
})();
`;

  return compositionShell({
    num, title, narration, theme, totalDuration: total,
    vendor: ["gsap.min.js", "matter.min.js"], extraStyle, stageHtml, script,
  });
}
