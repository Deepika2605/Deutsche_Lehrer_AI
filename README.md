# Deutsch Lehrer AI

A local React app for practicing spoken and written German. The UI runs in the browser; replies, vocabulary extraction, and grammar lookups go through a small Node server to Ollama.

## Features

- React + Vite frontend with a Node HTTP backend (`server/index.mjs`)
- Microphone capture via the browser Web Speech API (`de-DE`)
- Conversation replies from local Ollama, returned as JSON (`reply`, `difficulty`, `topicIndex`)
- CEFR-style difficulty chips (A1–C1): auto-detect from the last Ollama rating, or set manually
- Vocabulary bank: each user sentence is sent to Ollama to extract verbs, nouns, and adjectives; expanding a word loads grammar details (articles, cases, conjugations, declension)
- Session history and vocabulary stored in the browser (`localStorage`, last 8 sessions)
- End-of-session summary with heuristic corrections (common English words in German answers, short replies), recommended words, and strengths

## Run locally

```bash
npm install
npm run dev
```

`npm run dev` starts both processes:

- Vite on the frontend (proxies `/api` to the backend)
- `node server/index.mjs` on port `8787` (override with `PORT`)

Pull a model and point the server at Ollama (defaults shown):

```bash
ollama pull llama3.1:8b
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=llama3.1:8b
export OLLAMA_STRICT=true
```

Check the backend:

```bash
curl -s http://localhost:8787/api/health
```

`/api/health` reports the configured Ollama model and whether strict mode is on. It does not ping Ollama.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Configured provider, model, and `OLLAMA_STRICT` |
| `POST` | `/api/chat` | Coach reply for the current conversation |
| `POST` | `/api/vocabulary/extract` | Verbs, nouns, and adjectives from a sentence |
| `POST` | `/api/word-forms` | Grammar details for one word |

After `npm run build`, `npm start` serves the `dist` frontend from the same Node process.

## Validate

```bash
npm test
npm run build
```

## Notes

- Speech recognition uses the Web Speech API, so Chromium-based browsers work best.
- All model calls go to local Ollama. If Ollama is down and `OLLAMA_STRICT=true` (the default), chat returns an error-style German message. Set `OLLAMA_STRICT=false` to fall back to keyword-based follow-ups with no model call.
- Grammar details come from the same local model, not a dictionary, so forms can be wrong.
- End-of-session corrections are client-side heuristics, not a full grammar review from the model.
