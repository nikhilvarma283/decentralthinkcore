#!/bin/sh
# pull-model.sh — wait for Ollama then pull the Hermes model via ollama CLI.
# OLLAMA_HOST is used by the ollama CLI to reach the running server.

set -e

MODEL="${HERMES_MODEL:-nous-hermes2}"
MAX_WAIT=180
INTERVAL=3

echo "pull-model: waiting for Ollama at $OLLAMA_HOST ..."
waited=0
until ollama list > /dev/null 2>&1; do
  if [ "$waited" -ge "$MAX_WAIT" ]; then
    echo "pull-model: ERROR — Ollama not ready after ${MAX_WAIT}s" >&2
    exit 1
  fi
  echo "pull-model: not ready, retrying in ${INTERVAL}s (${waited}s elapsed)..."
  sleep "$INTERVAL"
  waited=$((waited + INTERVAL))
done

echo "pull-model: Ollama ready. Checking if ${MODEL} is pulled..."
if ollama list | grep -q "${MODEL}"; then
  echo "pull-model: ${MODEL} already present — done."
  exit 0
fi

echo "pull-model: pulling ${MODEL} (may take several minutes)..."
ollama pull "${MODEL}"
echo "pull-model: ${MODEL} ready."
