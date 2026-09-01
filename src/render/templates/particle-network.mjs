/**
 * "particle-network" — 3-8 labeled nodes settle into a force-directed layout (pairwise
 * repulsion + spring edges via Matter.Constraint). Physics: Matter.js. Render target:
 * a <canvas> 2D context (variable node/edge counts are more natural there than as
 * individually pre-positioned DOM elements — see plan §2).
 */
import {
  sceneId, resolveTotalDuration, attachBakedDriverScript, registerTimelineScript, fadeInCaptionsScript, compositionShell,
  assertStringArray, assertOptionalNumberRange,
} from "./_shared.mjs";

export const paramSchema = {
  nodes: "string[3..8]",
  edges: "[number,number][] (0-based indices into nodes)",
  settleAt: "number(0..1), default 0.6 (unused by the bake itself; documents intended pacing)",
  validate(params, num) {
    assertStringArray(params?.nodes, { field: "nodes", min: 3, max: 8, num });
    const maxIdx = (params.nodes?.length || 1) - 1;
    if (params?.edges !== undefined) {
      const edges = params.edges;
      const ok = Array.isArray(edges) && edges.every(
        (e) => Array.isArray(e) && e.length === 2 && Number.isInteger(e[0]) && Number.isInteger(e[1])
          && e[0] >= 0 && e[0] <= maxIdx && e[1] >= 0 && e[1] <= maxIdx && e[0] !== e[1],
      );
      if (!ok) throw new Error(`Scene ${num}: templateParams.edges, when given, must be [nodeIndex,nodeIndex] pairs within 0..${maxIdx}.`);
    }
    assertOptionalNumberRange(params?.settleAt, { field: "settleAt", min: 0, max: 1, num });
  },
};

function defaultGraph(title, narration) {
  const words = `${title || ""} ${narration || ""}`.split(/\s+/).filter((w) => w.length > 2);
  const uniq = [...new Set(words.map((w) => w.replace(/[^\w-]/g, "")))].filter(Boolean);
  const nodes = (uniq.length >= 3 ? uniq : ["Edge", "Origin", "Agent", "Client"]).slice(0, 6);
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) edges.push([i, i + 1]);
  if (nodes.length > 2) edges.push([nodes.length - 1, 0]);
  return { nodes, edges };
}

/** @param {{num:number,title:string,narration:string,duration:number,syncDuration?:number,
 *   holdDuration?:number,theme?:string,params?:{nodes?:string[],edges?:number[][]},seed?:number}} o */
export function render({ num, title, narration, duration, syncDuration, holdDuration, theme = "default", params, seed }) {
  const sid = sceneId(num);
  const total = resolveTotalDuration({ duration, syncDuration, holdDuration });
  const fallback = defaultGraph(title, narration);
  let nodes = (params?.nodes?.length ? params.nodes : fallback.nodes).slice(0, 8).map(String);
  while (nodes.length < 3) nodes.push(`Node ${nodes.length + 1}`);
  const maxIdx = nodes.length - 1;
  let edges = (Array.isArray(params?.edges) ? params.edges : fallback.edges)
    .filter((e) => Array.isArray(e) && e.length === 2 && e[0] >= 0 && e[0] <= maxIdx && e[1] >= 0 && e[1] <= maxIdx && e[0] !== e[1]);
  if (edges.length === 0) for (let i = 0; i < maxIdx; i++) edges.push([i, i + 1]);
  const seedNum = Number.isFinite(seed) ? seed : num;

  const stageHtml = `<canvas id="net-canvas" class="net-canvas" width="1920" height="1080"></canvas>`;
  const extraStyle = `.net-canvas { position: absolute; inset: 0; }`;

  const script = `
(function () {
  const N = 240, FIXED_DT = 1000 / 60;
  const W = 1920, H = 1080, CX = W / 2, CY = H / 2 + 40;
  const rand = mulberry32(${seedNum});
  const labels = ${JSON.stringify(nodes)};
  const edges = ${JSON.stringify(edges)};

  const engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
  const world = engine.world;

  const bodies = labels.map((_, i) => {
    const a = (i / labels.length) * Math.PI * 2 + rand() * 0.6;
    const r = 200 + rand() * 80;
    const b = Matter.Bodies.circle(CX + Math.cos(a) * r, CY + Math.sin(a) * r, 10, {
      frictionAir: 0.35, restitution: 0.1, density: 0.02,
    });
    Matter.World.add(world, b);
    return b;
  });

  for (const [i, j] of edges) {
    Matter.World.add(world, Matter.Constraint.create({
      bodyA: bodies[i], bodyB: bodies[j], stiffness: 0.015, damping: 0.4, length: 280,
    }));
  }

  // Tuned empirically against the vendored Matter.js: with these circles' default density
  // a naive inverse-square repulsion constant explodes to thousands of px off-canvas
  // within a handful of steps (nodes have very little mass, so force/mass -> huge
  // acceleration). This constant, a minimum-distance floor, and a stronger frictionAir
  // above keep the layout inside the 1920x1080 stage and converging, not diverging.
  const REPEL = 1.6e4;
  function applyRepulsion() {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        let dx = a.position.x - b.position.x, dy = a.position.y - b.position.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 2500) d2 = 2500; // 50px floor
        const d = Math.sqrt(d2);
        const f = REPEL / d2;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        Matter.Body.applyForce(a, a.position, { x: fx, y: fy });
        Matter.Body.applyForce(b, b.position, { x: -fx, y: -fy });
      }
      // gentle centering so the whole graph doesn't drift off-canvas
      const a = bodies[i];
      Matter.Body.applyForce(a, a.position, { x: (CX - a.position.x) * 6e-5, y: (CY - a.position.y) * 6e-5 });
    }
  }

  const keyframes = [];
  for (let f = 0; f < N; f++) {
    applyRepulsion();
    Matter.Engine.update(engine, FIXED_DT);
    keyframes.push(bodies.map((b) => ({ x: b.position.x, y: b.position.y })));
  }

  const canvas = document.getElementById('net-canvas');
  const ctx = canvas.getContext('2d');
  const rootStyle = getComputedStyle(document.documentElement);
  const inkColor = rootStyle.getPropertyValue('--ink').trim() || '#E8EDF4';
  const accentColor = rootStyle.getPropertyValue('--accent').trim() || '#4DA3FF';
  const ruleColor = rootStyle.getPropertyValue('--rule').trim() || '#4DA3FF';

  function applyKeyframe(kf) {
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 3;
    ctx.strokeStyle = ruleColor;
    ctx.globalAlpha = 0.55;
    for (const [i, j] of edges) {
      ctx.beginPath();
      ctx.moveTo(kf[i].x, kf[i].y);
      ctx.lineTo(kf[j].x, kf[j].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.font = '600 26px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < kf.length; i++) {
      const p = kf[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 34, 0, Math.PI * 2);
      ctx.fillStyle = accentColor;
      ctx.fill();
      ctx.fillStyle = inkColor;
      ctx.fillText(labels[i], p.x, p.y + 58);
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
