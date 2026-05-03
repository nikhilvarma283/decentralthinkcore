#!/bin/sh
# Waits for Ollama to be ready, then pulls the Hermes model.
# Runs once as a Docker init container before the API starts.

OLLAMA_HOST="${OLLAMA_HOST:-http://ollama:11434}"
MODEL="${HERMES_MODEL:-nous-hermes2}"

echo "Waiting for Ollama at $OLLAMA_HOST ..."
until curl -sf "$OLLAMA_HOST/api/tags" > /dev/null 2>&1; do
  sleep 2
done

echo "Pulling model: $MODEL"
curl -sf -X POST "$OLLAMA_HOST/api/pull" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$MODEL\", \"stream\": false}"

echo "Model ready: $MODEL"
