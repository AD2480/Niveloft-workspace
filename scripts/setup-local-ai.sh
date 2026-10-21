#!/usr/bin/env bash
# Sets up a free AI model on this Mac (or Linux) for ProjectFlow's assistant:
# installs Ollama if needed, starts it, downloads a small model and tests it.
# The backend finds it by itself (AI_PROVIDER=auto, the default) — no keys, no settings.
#
#   ./scripts/setup-local-ai.sh            # llama3.2 (about 2 GB)
#   ./scripts/setup-local-ai.sh qwen2.5:3b # or another model from https://ollama.com/library
set -euo pipefail
MODEL="${1:-llama3.2}"
URL="http://localhost:11434"

up() { curl -fsS "$URL/api/tags" >/dev/null 2>&1; }

if ! command -v ollama >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "Installing Ollama with Homebrew…"
    brew install ollama
  else
    echo "Ollama isn't installed. Download it from https://ollama.com/download, open it once, then run this script again."
    exit 1
  fi
fi

if ! up; then
  echo "Starting Ollama…"
  if [ -d /Applications/Ollama.app ]; then
    open -a Ollama
  elif command -v brew >/dev/null 2>&1 && brew list ollama >/dev/null 2>&1; then
    brew services start ollama >/dev/null
  else
    nohup ollama serve >/tmp/ollama.log 2>&1 &
  fi
  for _ in $(seq 1 30); do up && break; sleep 1; done
fi
if ! up; then
  echo "Ollama didn't start. Open the Ollama app (or run: ollama serve) and try again."
  exit 1
fi

echo "Downloading $MODEL (once; llama3.2 is about 2 GB)…"
ollama pull "$MODEL"

echo "Testing it…"
if curl -fsS "$URL/api/chat" -d "{\"model\":\"$MODEL\",\"stream\":false,\"format\":\"json\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with the JSON {\\\"ok\\\":true}\"}]}" | grep -q '"content"'; then
  echo
  echo "Done: $MODEL is running on this computer."
  echo "Start (or restart) the backend. It finds Ollama by itself, and the assistant's header will say \"AI on\" with the model's name."
  if [ "$MODEL" != "llama3.2" ]; then
    echo "If other models are installed too, pick this one with: AI_MODEL=$MODEL"
  fi
else
  echo "The model didn't answer. Try: ollama run $MODEL"
  exit 1
fi
