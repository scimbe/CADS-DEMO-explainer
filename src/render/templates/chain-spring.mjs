/**
 * "chain-spring" — a Matter.Composites.chain of 3-8 circle links hangs from a fixed
 * anchor. Every link starts pinned (isStatic) in a raised, sideways pose; at `releaseAt`
 * (a fraction of the bake) every link is unpinned in the same frame (Matter.Body.setStatic)
 * so the chain drops and swings/settles under gravity + constraint tension from then on —
 * this is this template's version of the plan's "scripted release" mechanic. Physics:
 * Matter.js. Render target: an inline SVG whose <line>/<circle>/<text> elements are
 * pre-positioned and then just have their attributes rewritten per keyframe (the SVG
 * analogue of "CSS transforms on pre-positioned DOM elements").
 */
import {
  sceneId, resolveTotalDuration, attachBakedDriverScript, registerTimelineScript, fadeInCaptionsScript, compositionShell, esc,
  assertOptionalNumberRange,
} from "./_shared.mjs";

export const paramSchema = {
  links: "number(3..8), default 5",
  labels: "string[links] (optional, one per link)",
  releaseAt: "number(0..1), default 0.4",
  validate(params, num) {
    if (params?.links !== undefined) {
      const l = params.links;
      if (!Number.isInteger(l) || l < 3 || l > 8) {
        throw new Error(`Scene ${num}: templateParams.links, when given, must be an integer between 3 and 8.`);
      }
    }
    if (params?.labels !== undefined) {
      const links = Number.isInteger(params?.links) ? params.links : 5;
      const labels = params.labels;
      if (!Array.isArray(labels) || labels.length !== links || !labels.every((v) => typeof v === "string" && v.trim())) {
        throw new Error(`Scene ${num}: templateParams.labels, when given, must be an array of ${links} non-empty strings (one per link).`);
      }
    }
    assertOptionalNumberRange(params?.releaseAt, { field: "releaseAt", min: 0, max: 1, num });
  },
};

/** @param {{num:number,title:string,narration:string,duration:number,syncDuration?:number,
 *   holdDuration?:number,theme?:string,params?:{links?:number,labels?:string[],releaseAt?:number},seed?:number}} o */
export function render({ num, title, narration, duration, syncDuration, holdDuration, theme = "default", params, seed }) {
  const sid = sceneId(num);
  const total = resolveTotalDuration({ duration, syncDuration, holdDuration });
  const links = Math.max(3, Math.min(8, Number(params?.links) || 5));
  const releaseAt = Number.isFinite(params?.releaseAt) ? Math.min(1, Math.max(0, params.releaseAt)) : 0.4;
  const labels = Array.isArray(params?.labels) && params.labels.length === links ? params.labels.map(String) : null;
  const seedNum = Number.isFinite(seed) ? seed : num;

  const stageHtml = `
    <svg class="chain-svg" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
      <circle id="chain-anchor" cx="960" cy="180" r="14" />
      ${Array.from({ length: links }).map((_, i) => `<line id="chain-line-${i}" class="chain-link-line" x1="0" y1="0" x2="0" y2="0" />`).join("\n      ")}
      ${Array.from({ length: links }).map((_, i) => `<circle id="chain-node-${i}" class="chain-link-node" cx="0" cy="0" r="26" />`).join("\n      ")}
      ${labels ? Array.from({ length: links }).map((_, i) => `<text id="chain-label-${i}" class="chain-link-label" x="0" y="0">${esc(labels[i])}</text>`).join("\n      ") : ""}
    </svg>`;

  const extraStyle = `
    .chain-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    #chain-anchor { fill: var(--muted); }
    .chain-link-line { stroke: var(--accent); stroke-width: 5; stroke-linecap: round; opacity: .85; }
    .chain-link-node { fill: var(--accent-dim); stroke: var(--accent); stroke-width: 3; }
    .chain-link-label { fill: var(--ink); font-family: var(--font-mono); font-size: 22px; text-anchor: middle; }`;

  const script = `
(function () {
  const N = 240, FIXED_DT = 1000 / 60;
  const LINKS = ${links};
  const RELEASE_FRAME = Math.round(${releaseAt} * (N - 1));
  const ANCHOR = { x: 960, y: 180 };
  const GAP = 78, RADIUS = 26;
  const rand = mulberry32(${seedNum});

  const engine = Matter.Engine.create({ gravity: { x: 0, y: 1 } });
  const world = engine.world;

  // Initial pose: chain pulled sideways and slightly up, every link pinned (isStatic) so
  // nothing moves until the scripted release below.
  const swingAngle = Math.PI / 2 + 0.9 + (rand() - 0.5) * 0.2;
  const bodies = [];
  let px = ANCHOR.x, py = ANCHOR.y;
  for (let i = 0; i < LINKS; i++) {
    px += Math.cos(swingAngle) * GAP;
    py += Math.sin(swingAngle) * GAP;
    const b = Matter.Bodies.circle(px, py, RADIUS, {
      isStatic: true, restitution: 0.15, friction: 0.4, frictionAir: 0.02,
    });
    Matter.World.add(world, b);
    bodies.push(b);
  }

  const anchorBody = Matter.Bodies.circle(ANCHOR.x, ANCHOR.y, 6, { isStatic: true });
  Matter.World.add(world, anchorBody);

  const constraints = [];
  let prev = anchorBody;
  for (let i = 0; i < LINKS; i++) {
    const c = Matter.Constraint.create({ bodyA: prev, bodyB: bodies[i], length: GAP, stiffness: 0.9, damping: 0.15 });
    Matter.World.add(world, c);
    constraints.push(c);
    prev = bodies[i];
  }

  let released = false;
  const keyframes = [];
  for (let f = 0; f < N; f++) {
    if (!released && f >= RELEASE_FRAME) {
      for (const b of bodies) Matter.Body.setStatic(b, false);
      released = true;
    }
    Matter.Engine.update(engine, FIXED_DT);
    keyframes.push(bodies.map((b) => ({ x: b.position.x, y: b.position.y })));
  }

  const lineEls = Array.from({ length: LINKS }, (_, i) => document.getElementById('chain-line-' + i));
  const nodeEls = Array.from({ length: LINKS }, (_, i) => document.getElementById('chain-node-' + i));
  const labelEls = ${labels ? "Array.from({ length: LINKS }, (_, i) => document.getElementById('chain-label-' + i))" : "null"};

  function applyKeyframe(kf) {
    let ax = ANCHOR.x, ay = ANCHOR.y;
    for (let i = 0; i < LINKS; i++) {
      const p = kf[i];
      lineEls[i].setAttribute('x1', ax); lineEls[i].setAttribute('y1', ay);
      lineEls[i].setAttribute('x2', p.x); lineEls[i].setAttribute('y2', p.y);
      nodeEls[i].setAttribute('cx', p.x); nodeEls[i].setAttribute('cy', p.y);
      if (labelEls) { labelEls[i].setAttribute('x', p.x); labelEls[i].setAttribute('y', p.y + 46); }
      ax = p.x; ay = p.y;
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
