# CADS-DEMO-explainer

**Topic in, narrated animated explainer video out.** An LLM writes the storyboard; every
other step — text-to-speech, animation rendering, video muxing — is deterministic, local,
non-LLM code.

```
topic
  │
  ▼
[LLM] storyboard/script (5 short scenes, title + narration each)
  │
  ▼
[Piper TTS] narration audio per scene, generic stock voice
  │
  ▼
[GSAP/HTML] scene compositions, each timed to its own audio
  │
  ▼
[Headless Chrome] frame-by-frame render -> silent MP4 per scene
  │
  ▼
[ffmpeg] mux audio+video per scene, concat -> final.mp4
```

Part of the `*.bunsenbrenner.org` marketplace demo portfolio. Tracking issue:
[`CADS-agent-marketplace#31`](https://github.com/scimbe/CADS-agent-marketplace/issues/31).

## Credit

This demo is built on ideas and code from **[`scimbe/SlideCreator`](https://github.com/scimbe/SlideCreator)**
(private repo) — the operator's existing "topic → narrated explainer video" toolchain,
which pairs a HyperFrames/GSAP animation engine (**MyExplainAnimator**) with a
voice-cloned MOSS-TTS voice, normally rendered against a HAW-ICC Kubernetes cluster.

What's reused here, concretely:
- The **HyperFrames composition contract** — a `.composition[data-composition-id/duration/fps]`
  element whose inline script registers a paused GSAP timeline on `window.__timelines[id]`,
  played live in a browser but scrubbed frame-by-frame by a render engine. This is what
  makes `src/render/engine.mjs` possible; it's a straight port of the contract
  `MyExplainAnimator`/`studio/workers/render/engine/render.mjs` define and depend on,
  including a Puppeteer/Chrome quirk documented there and rediscovered independently while
  building this (see "Known gaps" below).
- The general **pipeline shape**: LLM writes script/storyboard, everything downstream is a
  deterministic engine (`studio/docs/ARCHITECTURE.md`'s "Trennung KI ↔ Engine" principle).
- The **scene-per-Markdown-header** teleprompter format (`## Scene N — Title`), renamed to
  English from SlideCreator's German `## Szene NN — Titel`.

What's **not** ported, and why (both were explicit operator decisions on the tracking issue,
made before this repo was created):
- **Voice**: SlideCreator's TTS worker clones the operator's own voice (MOSS-TTS-v1.5 +
  a personal LoRA). This demo is public and multi-tenant, so it uses
  **[Piper](https://github.com/rhasspy/piper)** — a different, real, fully local/offline
  neural TTS engine — with a generic stock voice (`en_US-lessac-medium`), never a cloned
  voice.
- **Rendering backend**: SlideCreator's primary render path targets a HAW-ICC Kubernetes
  cluster (university infrastructure, VPN/kubectl). This demo only ever uses the **local**
  path — plain Puppeteer + headless Chrome + ffmpeg, no cluster, no VPN, runs entirely in
  this sandbox.
- **The diagram archetype library** (`archetypes.mjs`, ~1500 lines: flow/compare/steps/
  central/stack/cycle/sequence/tree/image diagrams) was **not** ported. Every scene here
  uses one simple title+narration text template (`src/render/slides.mjs`). Porting the
  archetype library is real, scoped-out follow-up work, not a hidden shortcut.
- **Word-anchor sync**: SlideCreator warps each scene's animation to per-word timestamps
  from a Whisper alignment pass. This demo doesn't have per-word timestamps (Piper doesn't
  emit them without an extra alignment step), so each scene's GSAP timeline is instead
  scaled uniformly to that scene's whole-audio duration — the same fallback path
  SlideCreator's own `render.mjs` uses for scenes without word timestamps. In practice this
  is the dominant cost of skipping word-anchor sync: reveals land at fixed fractions of the
  scene, not synced to specific spoken words.

## What's real

Every step in the pipeline diagram above does real work, verified end-to-end (not mocked):
LLM calls a live model, Piper actually synthesizes audio, Chrome actually renders frames,
ffmpeg actually muxes. See "Acceptance run" below for a real example with real output.

## Setup

```bash
npm install
cp .env.example .env
# fill in LITELLM_BASE_URL / LITELLM_API_KEY / LITELLM_DEFAULT_MODEL in .env

./scripts/setup-voice.sh   # creates .venv, installs piper-tts, downloads a stock voice (~65 MB)
```

Requires `ffmpeg`/`ffprobe` on `PATH`, and a Chrome/Chromium binary (default:
`/usr/bin/google-chrome`; override with `CHROME_PATH`).

## Run

```bash
node src/pipeline.mjs "How zero-trust tunnels avoid exposing origin host ports"
# -> projects/<slug>-<timestamp>/renders/final.mp4
```

Or run each stage independently:

```bash
node src/script/generate.mjs "<topic>"                    # -> storyboard markdown on stdout
node src/tts/generate.mjs teleprompter.md <outDir>         # -> outDir/assets/{scene-NN.wav,scenes.json}
# src/render/slides.mjs and src/render/engine.mjs, src/mux/finalize.mjs are library modules
# (see src/pipeline.mjs for how they're wired together)
```

## Tests

```bash
npm test
```

Real unit tests for the storyboard parser/validator, the slide template (including the
HyperFrames contract required by the render engine), and the mux/concat step (exercised
against real ffmpeg-generated synthetic fixtures — no mocks). `npm test` does not require
network access or a running LLM/TTS.

## Acceptance run (real output)

```
$ node src/pipeline.mjs "What a signed manifest proves about an agent before it runs" projects/acceptance-run
[1/5] Generating storyboard for: "What a signed manifest proves about an agent before it runs"
      5 scenes, model=local-devstral-small2
[2/5] Synthesizing narration (Piper, stock voice)
[3/5] Building scene compositions
[4/5] Rendering scenes (headless Chrome)
  render scene-01 (11.2s, 337 frames)
  render scene-02 (9.1s, 273 frames)
  render scene-03 (8.7s, 262 frames)
  render scene-04 (8.7s, 260 frames)
  render scene-05 (8.1s, 242 frames)
[5/5] Muxing + concatenating final video

Done in 155.9s -> projects/acceptance-run/renders/final.mp4
```

Resulting `final.mp4`: 1920x1080 h264 video + aac audio, 45.9s, ~2.0 MB. Per-scene audio
and rendered-video durations agreed to within 0.02s (well under one frame at 30fps) for all
5 scenes, without any word-level alignment — because each scene's GSAP timeline is scaled
to that exact scene's own Piper audio before rendering, so video and audio are derived from
the same number rather than synced after the fact. Verified with `ffprobe` (codecs,
duration) and `ffmpeg -af volumedetect` (mean −16 dB / max 0 dB — real speech, not silence).

Output videos aren't committed to this repo (git isn't a good place for generated MP4s);
run the pipeline yourself to reproduce, or ask a maintainer for a sample.

## Known limitations

- **The TTS stage is currently broken on macOS/arm64.** `pip install piper-tts` pulls a wheel
  (confirmed on 1.7.0) whose compiled `espeakbridge.so` has an absolute
  `/Users/runner/work/piper1-gpl/.../espeak-ng-data` path baked in from its CI build machine —
  it ignores the correct bundled `espeak-ng-data` sitting right next to it, and there's no env
  var (`ESPEAK_DATA_PATH`/`ESPEAK_NG_DATA_PATH`) or CLI flag that overrides it. Result: every
  synthesis call fails with `Error processing file '.../phontab': No such file or directory`,
  even though setup/voice-download succeed cleanly. This was found and fully diagnosed on a
  real Mac (arm64) — confirmed not fixable from outside the wheel. Verified working on Linux,
  where the wheel's baked-in path happens to resolve (or a system `espeak-ng` fills the gap).
  Not yet fixed here — needs either a `piper-tts` version whose wheel resolves espeak-ng-data
  relatively, or `setup-voice.sh` detecting macOS and wiring a system `espeak-ng`
  (`brew install espeak-ng`) with the correct data path instead.
- No diagram/archetype visuals — text-only slide template (see "Credit" above).
- No word-anchor sync — animation timing is per-scene, not per-word.
- No QA gates — SlideCreator has a linter (`teleprompter_lint.py`), a Whisper
  transcription-vs-script check, and acoustic QA (clipping, dead air). None of that is
  ported; a bad LLM output or bad audio take would ship as-is here.
- English only (the stock voice + prompt are English; German would need a different Piper
  voice and prompt tweaks).
- Single flat slide layout, single default theme in `src/pipeline.mjs`'s default call (the
  theme system in `src/render/theme.mjs` supports 3 named themes; wiring a `--theme` flag
  through the CLI is a small follow-up, not done here).
- No caching/output-pinning (SlideCreator hashes topic+settings to skip re-generation on
  identical input); every run here re-calls the LLM and re-synthesizes audio.
- **`npm audit` reports 3 high-severity transitive vulnerabilities** (`extract-zip`, via
  `@puppeteer/browsers` → `puppeteer-core`, symlink path traversal in puppeteer's own
  browser-*download* tooling — GHSA-jmr9-qjv8-65gv). This repo never exercises that code
  path — `src/render/engine.mjs` always points `executablePath` at a system-installed Chrome
  (`findChrome()`), it never lets `puppeteer-core` download one — so the vulnerable code
  never runs here. Fixing it requires a major `puppeteer-core` bump (`npm audit fix --force`)
  that wasn't applied without re-verifying the whole render pipeline against it; tracked as a
  real follow-up, not silently ignored.
- **Rendering has one soft network dependency**: `src/render/slides.mjs` loads DM Sans /
  JetBrains Mono from `fonts.googleapis.com`/`fonts.gstatic.com` at render time. It falls
  back cleanly to `Arial`/`sans-serif` and `ui-monospace`/`monospace` if that's unreachable,
  so it degrades rather than breaks offline — but "renders entirely locally" has this one
  asterisk, unlike the render *engine* itself (Chrome/ffmpeg), which has none.
- **Trailing LLM commentary with no code fence can leak into the last scene's narration**
  (e.g. a closing "Let me know if you'd like changes!" appended after the real script, with
  no fence to signal "this isn't scene content"). The two fence-handling bugs this repo fixed
  (stray trailing fence, fenced-block *contents* not skipped) are unaffected — this is a
  different, narrower case: chatter with no fence marker at all. Guarded today by the system
  prompt's explicit "no commentary" instruction, not by the parser; a real fix would need the
  parser to detect trailing non-scene text heuristically. Not observed to affect validation or
  rendering (chatter just becomes extra narration text), but worth closing properly later.

## License

Code in this repo: MIT. Vendored `src/render/vendor/gsap.min.js` is GSAP 3.12.5, under
[GreenSock's own license](https://gsap.com/standard-license) (free for this kind of use).
The downloaded Piper voice model is under its own license from the
[piper-voices](https://huggingface.co/rhasspy/piper-voices) model repository.
