$ErrorActionPreference = "Stop"

if (-not $env:AI_ENDPOINT_MODE) {
  $env:AI_ENDPOINT_MODE = "chat"
}

if (-not $env:AI_BASE_URL -and -not $env:OPENAI_BASE_URL) {
  $env:AI_BASE_URL = "http://127.0.0.1:11434/v1"
}

if (-not $env:AI_MODEL -and -not $env:OPENAI_MODEL) {
  $env:AI_MODEL = "qwen3:8b"
}

if (-not $env:AI_API_KEY -and -not $env:OPENAI_API_KEY) {
  $env:AI_API_KEY = "local"
}

npm run pubmed:update
