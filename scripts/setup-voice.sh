#!/usr/bin/env bash
# Sets up local, offline TTS: a Python venv with piper-tts + one generic stock voice
# (downloaded from the public rhasspy/piper-voices model repo on Hugging Face).
# No account, no API key, no cloud calls at synthesis time.
set -euo pipefail
cd "$(dirname "$0")/.."

VOICE="${PIPER_VOICE:-en_US-lessac-medium}"
LANG_DIR="${VOICE%%-*}"          # en_US
NAME_DIR="$(echo "$VOICE" | cut -d- -f2)"   # lessac
QUALITY="$(echo "$VOICE" | cut -d- -f3)"    # medium
LANG_SHORT="${LANG_DIR%%_*}"     # en

BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/${LANG_SHORT}/${LANG_DIR}/${NAME_DIR}/${QUALITY}"

echo "==> Python venv (.venv)"
python3 -m venv .venv
./.venv/bin/pip install --quiet --disable-pip-version-check piper-tts

echo "==> Downloading voice: ${VOICE}"
mkdir -p voices
curl -sL --fail -o "voices/${VOICE}.onnx" "${BASE}/${VOICE}.onnx"
curl -sL --fail -o "voices/${VOICE}.onnx.json" "${BASE}/${VOICE}.onnx.json"

echo "==> Done. Voice model: voices/${VOICE}.onnx"
echo "    Set PIPER_VOICE_MODEL=voices/${VOICE}.onnx in .env if it differs from the default."
