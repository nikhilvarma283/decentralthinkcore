#!/bin/sh
# pull-model.sh — wait for Ollama to be ready then pull the Hermes model.
# Runs as the ollama-init one-shot container in docker-compose.
#
# Environment variables:
#   OLLAMA_HOST   — Ollama base URL (default: http://ollama:11434)
#   HERMES_MODEL  — Model to pull   (default: nous-hermes2)

set -e

OLLAMA_HOST="${OLLAMA_HOST:-http://ollama:11434}"
MODEL="${HERMES_MODEL:-nous-hermes2}"
MAX_WAIT=120
INTERVAL=3

echo "pull-model: waiting for Ollama at $OLLAMA_HOST ..."
waited=0
until curl -sf "${OLLAMA_HOST}/api/tags" > /dev/null 2>&1; do
  if [ "$waited" -ge "$MAX_WAIT" ]; then
    echo "pull-model: ERROR — Ollama did not become ready after ${MAX_WAIT}s" >&2
    exit 1
  fi
  echo "pull-model: not ready yet, retrying in ${INTERVAL}s (${waited}s elapsed)..."
  sleep "$INTERVAL"
  waited=$((waited + INTERVAL))
done

echo "pull-model: Ollama is ready. Checking if ${MODEL} is already pulled..."

TAGS=$(curl -sf "${OLLAMA_HOST}/api/tags" || echo '{"models":[]}')
MODEL_BASE=$(echo "$MODEL" | cut -d: -f1)

if echo "$TAGS" | grep -q "\"$MODEL_BASE"; then
  echo "pull-model: ${MODEL} already present — skipping pull."
  exit 0
fi

echo "pull-model: pulling ${MODEL} (this may take several minutes on first run)..."
curl -sf "${OLLAMA_HOST}/api/pull" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${MODEL}\",\"stream\":false}"

echo "pull-model: ${MODEL} pull complete."
