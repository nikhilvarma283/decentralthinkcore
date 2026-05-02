#!/bin/sh
# Wait for Ollama to be ready, then pull the Hermes model.
# Runs once as an init container before the API starts.

MODEL="${HERMES_MODEL:-nous-hermes2}"
OLLAMA_HOST="${OLLAMA_HOST:-http://ollama:11434}"

echo "[model-init] Waiting for Ollama at $OLLAMA_HOST..."
until curl -sf "$OLLAMA_HOST/" > /dev/null 2>&1; do
  sleep 2
done

echo "[model-init] Ollama ready. Checking for model: $MODEL"

# Check if model is already present
if ollama list 2>/dev/null | grep -q "^$MODEL"; then
  echo "[model-init] Model $MODEL already present — skipping pull."
  exit 0
fi

echo "[model-init] Pulling $MODEL (this may take several minutes on first run)..."
OLLAMA_HOST="$OLLAMA_HOST" ollama pull "$MODEL"

echo "[model-init] Model $MODEL ready."
