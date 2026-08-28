/**
 * Visual theme tokens for rendered slides.
 * Adapted from scimbe/SlideCreator's studio/workers/render/themes.mjs (same idea: named
 * CSS custom-property sets, kept deterministic and dependency-free), trimmed to the
 * subset used by this demo's single slide template.
 */
const FONT_DISPLAY = '"DM Sans", "Inter", "Helvetica Neue", Arial, sans-serif';
const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';

export const THEMES = {
  default: { label: "Midnight Blue", bg: "#0D1321", ink: "#E8EDF4", accent: "#4DA3FF", accentDim: "#28425E", muted: "#8A94A6", rule: "#4DA3FF" },
  light: { label: "Light", bg: "#F4F7FB", ink: "#172234", accent: "#2563EB", accentDim: "#CBDBF4", muted: "#5B6675", rule: "#2563EB" },
  emerald: { label: "Emerald", bg: "#0C1512", ink: "#E6F0EA", accent: "#34D399", accentDim: "#1E4034", muted: "#8AA89C", rule: "#34D399" },
};

export const DEFAULT_THEME = "default";

export function themeTokens(name) {
  return THEMES[name] ?? THEMES[DEFAULT_THEME];
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return { r: 77, g: 163, b: 255 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function themeRootCss(name) {
  const t = themeTokens(name);
  const { r, g, b } = hexToRgb(t.accent);
  return `:root {
    --bg: ${t.bg}; --ink: ${t.ink}; --accent: ${t.accent};
    --accent-dim: ${t.accentDim}; --muted: ${t.muted}; --rule: ${t.rule};
    --grid-dot: rgba(${r},${g},${b},0.05);
    --font-display: ${FONT_DISPLAY};
    --font-mono: ${FONT_MONO};
  }`;
}
