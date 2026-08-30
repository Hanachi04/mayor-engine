# Aegis Quant — Environment Check

**Checked at:** 2026-08-30T18:49:30Z

| Check | Result | Decision |
|---|---|---|
| Memory | 23 GiB total, approximately 21 GiB available | Sufficient for the first local slice |
| CPU | 6 x86_64 CPUs | Sufficient for the first local slice |
| GitHub Actions | Not running in GitHub Actions | Local-only execution is possible |
| Container | Running inside a container | Native Ollama installation/runtime is not assumed safe here |
| Ollama binary/service | Binary not found; `127.0.0.1:11434` unavailable | Ollama is not operational in this environment |

## Decision

Ollama was not installed or started. The first slice uses the Google Gemini API through Google AI Studio, configured with `GEMINI_API_KEY`, for the single sentiment-agent role. The default model is `gemini-2.5-flash` and can be overridden with `GEMINI_MODEL`. Market data, feature engineering, technical decision logic, and SQLite persistence remain local. No GitHub Actions workflow or live order execution is included.

**Privacy note:** Google AI Studio's free tier may use submitted content to improve Google products, and quotas or terms may change. Do not send confidential data through the sentiment prompt.
