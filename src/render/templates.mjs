/**
 * Registry of animated-scene templates (plan §2: "p5.play / Matter.js animated scene
 * templates"). Each entry's `render()` returns a full composition HTML string with the
 * same contract as ../slides.mjs's renderSlideHtml — a `.composition[data-*]` element
 * whose inline script registers a real, paused `gsap.timeline()` on
 * `window.__timelines[sid]` — so ../engine.mjs's frame-by-frame capture loop drives every
 * template here identically, with zero changes.
 *
 * NOT wired into ../slides.mjs's buildSlides() or src/pipeline.mjs yet — that dispatch
 * (deciding, per scene, which template to use) is the storyboard schema/review work in
 * plan §1, a separate, not-yet-built piece owned elsewhere in the pipeline. This registry
 * is the self-contained library §1's dispatcher will call into.
 */
import * as physicsDropTitle from "./templates/physics-drop-title.mjs";
import * as particleNetwork from "./templates/particle-network.mjs";
import * as bouncingIcons from "./templates/bouncing-icons.mjs";
import * as chainSpring from "./templates/chain-spring.mjs";
import * as hubOrbit from "./templates/hub-orbit.mjs";

/**
 * @typedef {{
 *   render: (o: {num:number, title:string, narration:string, duration:number,
 *     syncDuration?:number, holdDuration?:number, theme?:string, params?:object,
 *     seed?:number}) => string,
 *   baseHold: number,
 *   paramSchema: object|null,
 *   vendor: string[],
 * }} TemplateEntry
 */

/** @type {Record<string, TemplateEntry>} */
export const TEMPLATES = {
  "physics-drop-title": { render: physicsDropTitle.render, baseHold: 2.0, paramSchema: physicsDropTitle.paramSchema, vendor: ["gsap.min.js", "matter.min.js"] },
  "particle-network": { render: particleNetwork.render, baseHold: 2.5, paramSchema: particleNetwork.paramSchema, vendor: ["gsap.min.js", "matter.min.js"] },
  "bouncing-icons": { render: bouncingIcons.render, baseHold: 2.0, paramSchema: bouncingIcons.paramSchema, vendor: ["gsap.min.js", "p5.min.js", "planck.min.js", "p5.play.min.js"] },
  "chain-spring": { render: chainSpring.render, baseHold: 2.5, paramSchema: chainSpring.paramSchema, vendor: ["gsap.min.js", "matter.min.js"] },
  "hub-orbit": { render: hubOrbit.render, baseHold: 3.0, paramSchema: hubOrbit.paramSchema, vendor: ["gsap.min.js", "matter.min.js"] },
};

export const ALLOWED_TEMPLATES = Object.keys(TEMPLATES);

/** Union of vendor files actually needed across a set of template keys — so a storyboard
 *  with zero physics scenes never pays for matter.min.js/p5.min.js/etc. Always includes
 *  gsap.min.js (every composition in this project, animated or not, needs it). */
export function vendorFilesFor(templateKeys) {
  const set = new Set(["gsap.min.js"]);
  for (const key of templateKeys) {
    const entry = TEMPLATES[key];
    if (!entry) continue;
    for (const v of entry.vendor) set.add(v);
  }
  return [...set];
}
