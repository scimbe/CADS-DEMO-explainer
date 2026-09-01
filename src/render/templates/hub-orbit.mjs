/**
 * "hub-orbit" — a fixed central body ("hub") with 3-6 labeled satellites held in gently
 * wobbling near-circular paths around it. Physics: Matter.js bodies, but *not* a rigid
 * constraint — each step nudges a satellite's velocity toward the tangential speed its
 * orbit radius implies and applies a small radial correction back toward that radius
 * (a standard "orbit via force/velocity correction" technique), per the plan. Render
 * target: inline SVG (see ./chain-spring.mjs for why SVG attribute rewrites are used
 * instead of raw DOM transforms for line-connected shapes).
 */
import {
  sceneId, resolveTotalDuration, attachBakedDriverScript, registerTimelineScript, fadeInCaptionsScript, compositionShell, esc,
  assertNonEmptyString, assertStringArray,
} from "./_shared.mjs";

export const paramSchema = {
  hub: "string",
  satellites: "string[3..6]",
  validate(params, num) {
    assertNonEmptyString(params?.hub, { field: "hub", num });
    assertStringArray(params?.satellites, { field: "satellites", min: 3, max: 6, num });
  },
};

function defaultSatellites(title, narration) {
  const words = `${title || ""} ${narration || ""}`.split(/\s+/).filter((w) => w.length > 2);
  const uniq = [...new Set(words.map((w) => w.replace(/[^\w-]/g, "")))].filter(Boolean);
  return (uniq.length >= 3 ? uniq : ["Origin A", "Origin B", "Agent"]).slice(0, 5);
}

/** @param {{num:number,title:string,narration:string,duration:number,syncDuration?:number,
 *   holdDuration?:number,theme?:string,params?:{hub?:string,satellites?:string[]},seed?:number}} o */
export function render({ num, title, narration, duration, syncDuration, holdDuration, theme = "default", params, seed }) {
  const sid = sceneId(num);
  const total = resolveTotalDuration({ duration, syncDuration, holdDuration });
  const hub = String(params?.hub || title || "Hub");
  let satellites = (params?.satellites?.length ? params.satellites : defaultSatellites(title, narration)).slice(0, 6).map(String);
  while (satellites.length < 3) satellites.push(`Node ${satellites.length + 1}`);
  const seedNum = Number.isFinite(seed) ? seed : num;

  const stageHtml = `
    <svg class="orbit-svg" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
      ${satellites.map((_, i) => `<line id="orbit-line-${i}" class="orbit-line" x1="960" y1="540" x2="960" y2="540" />`).join("\n      ")}
      <circle id="orbit-hub" cx="960" cy="540" r="54" />
      <text id="orbit-hub-label" class="orbit-hub-label" x="960" y="546">${esc(hub)}</text>
      ${satellites.map((_, i) => `<circle id="orbit-sat-${i}" class="orbit-sat" cx="960" cy="540" r="28" />`).join("\n      ")}
      ${satellites.map((_, i) => `<text id="orbit-sat-label-${i}" class="orbit-sat-label" x="960" y="540">${esc(satellites[i])}</text>`).join("\n      ")}
    </svg>`;

  const extraStyle = `
    .orbit-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .orbit-line { stroke: var(--rule); stroke-width: 2; opacity: .35; }
    #orbit-hub { fill: var(--accent); }
    .orbit-hub-label { fill: var(--bg); font-family: var(--font-mono); font-weight: 700; font-size: 22px; text-anchor: middle; dominant-baseline: middle; }
    .orbit-sat { fill: var(--accent-dim); stroke: var(--accent); stroke-width: 3; }
    .orbit-sat-label { fill: var(--ink); font-family: var(--font-mono); font-size: 22px; text-anchor: middle; }`;

  const script = `
(function () {
  const N = 240, FIXED_DT = 1000 / 60;
  const SATS = ${satellites.length};
  const HUB = { x: 960, y: 540 };
  const rand = mulberry32(${seedNum});

  const engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
  const world = engine.world;

  // Keep every orbit clear of the canvas edge and of the bottom caption band
  // (.narration-caption starts at bottom:128px on this 1080px-tall canvas, i.e. its
  // top edge is at y=952 -- see _shared.mjs) and of the satellite's own label, which
  // applyKeyframe() below draws 50px under the satellite center. Without this, a fixed
  // "170 + i*85" radius step guarantees the 4th+ satellite (of the schema-allowed 3-6)
  // swings into/through the caption text, and the 6th orbits entirely off-canvas.
  const SAT_R = 28, LABEL_DROP = 50, LABEL_H = 26, EDGE_MARGIN = 24;
  const WOBBLE_MAX = 12 + 18; // matches wobbleAmp's own [12, 30) range below
  const MAX_RADIUS = Math.min(
    (1080 - 128) - HUB.y - WOBBLE_MAX - SAT_R - LABEL_DROP - LABEL_H, // caption-band clearance
    (1920 - EDGE_MARGIN) - HUB.x - WOBBLE_MAX - SAT_R, // right-edge clearance
  );
  const RADIUS_STEP = SATS > 1 ? Math.min(85, (MAX_RADIUS - 170) / (SATS - 1)) : 0;

  const orbits = Array.from({ length: SATS }, (_, i) => ({
    radius: Math.min(170 + i * RADIUS_STEP + rand() * 20, MAX_RADIUS),
    omega: (0.9 + rand() * 0.5) * (i % 2 === 0 ? 1 : -1) / 1000, // rad per ms of sim time, alternating direction
    wobbleAmp: 12 + rand() * 18,
    wobbleFreq: (0.6 + rand() * 0.8) / 1000,
    phase: rand() * Math.PI * 2,
  }));
  // NOTE (verified empirically against the vendored Matter.js, not assumed): body.velocity
  // is expressed in px *per Engine.update() call*, independent of the delta passed to that
  // call -- i.e. already a "per step" quantity, not "per second" or "per ms". The desired
  // tangential velocity below is therefore radius * angularVelocity(rad/ms) * FIXED_DT(ms)
  // directly, with no further unit conversion; an earlier version of this file multiplied
  // by 1000 assuming a px/s->px/step conversion was still needed, which made every orbit
  // blow out to 2-3x its intended radius within a handful of steps.

  const bodies = orbits.map((o, i) => {
    const a0 = (i / SATS) * Math.PI * 2 + rand() * 0.5;
    const b = Matter.Bodies.circle(HUB.x + Math.cos(a0) * o.radius, HUB.y + Math.sin(a0) * o.radius, 28, { frictionAir: 0 });
    Matter.World.add(world, b);
    return b;
  });

  let simTime = 0;
  const keyframes = [];
  for (let f = 0; f < N; f++) {
    for (let i = 0; i < SATS; i++) {
      const b = bodies[i], o = orbits[i];
      const dx = b.position.x - HUB.x, dy = b.position.y - HUB.y;
      const r = Math.max(1, Math.hypot(dx, dy));
      const desired = o.radius + Math.sin(simTime * o.wobbleFreq + o.phase) * o.wobbleAmp;
      const radial = { x: dx / r, y: dy / r };
      const tangential = { x: -radial.y, y: radial.x };
      const desiredVel = { x: tangential.x * desired * o.omega * FIXED_DT, y: tangential.y * desired * o.omega * FIXED_DT };
      Matter.Body.setVelocity(b, {
        x: b.velocity.x + (desiredVel.x - b.velocity.x) * 0.15,
        y: b.velocity.y + (desiredVel.y - b.velocity.y) * 0.15,
      });
      const radialError = desired - r;
      Matter.Body.applyForce(b, b.position, {
        x: radial.x * radialError * 0.0008 * b.mass,
        y: radial.y * radialError * 0.0008 * b.mass,
      });
    }
    Matter.Engine.update(engine, FIXED_DT);
    simTime += FIXED_DT;
    keyframes.push(bodies.map((b) => ({ x: b.position.x, y: b.position.y })));
  }

  const lineEls = Array.from({ length: SATS }, (_, i) => document.getElementById('orbit-line-' + i));
  const satEls = Array.from({ length: SATS }, (_, i) => document.getElementById('orbit-sat-' + i));
  const satLabelEls = Array.from({ length: SATS }, (_, i) => document.getElementById('orbit-sat-label-' + i));

  function applyKeyframe(kf) {
    for (let i = 0; i < SATS; i++) {
      const p = kf[i];
      lineEls[i].setAttribute('x2', p.x); lineEls[i].setAttribute('y2', p.y);
      satEls[i].setAttribute('cx', p.x); satEls[i].setAttribute('cy', p.y);
      satLabelEls[i].setAttribute('x', p.x); satLabelEls[i].setAttribute('y', p.y + 50);
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
