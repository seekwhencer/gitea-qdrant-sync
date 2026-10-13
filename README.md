# gitea-qdrant-sync

A Node.js service that synchronizes Markdown files from Gitea repositories into a
[Qdrant](https://qdrant.tech) vector database. On a push event, the affected
Markdown files are fetched, split into chunks, converted into embeddings with the
help of an LLM (e.g. [Ollama](https://ollama.com)) and stored as points with
metadata in Qdrant. This creates a vector-based search and retrieval source (RAG)
for the repository documentation. Questions can be answered via the `/search`
endpoint, which retrieves relevant chunks and generates an answer with a chat LLM.

## How it works

1. A push event in a Gitea repository triggers the `/webhook` endpoint.
2. All added and changed `.md` files are collected.
3. Each file is fetched via the Gitea API as raw content.
4. The content is split into chunks with a recursive Markdown splitter that splits at hierarchical boundaries (headings `#`/`##`/`###`, blank-line separated paragraphs, newlines) and merges the parts up to a configurable size (`QDRANT_CHUNK_MAX_SIZE`, default `768`) without breaking those boundaries.
5. Each chunk is converted into a vector via the LLM's embedding API.
6. The vector, together with the text (as `text`) and the metadata
   (`source`, `repository`), is stored via `upsert` in the Qdrant collection.
   Existing points for the same source are deleted first, so re-syncing a file
   keeps the collection up to date.
7. On a `/search` request, the question is embedded, the most relevant chunks are
   retrieved from Qdrant, and a chat LLM generates an answer based solely on that
   context (RAG).

## Project structure

```
.
├── index.js                 # Express server: wires modules together and starts listening
├── server/
│   ├── routes.js            # Route definitions: /health, /webhook, /search
│   ├── sync.js              # Core logic: push event → chunk → embed → Qdrant
│   ├── gitea.js             # Gitea API client: fetch files, collect changed .md files
│   ├── search.js            # RAG: embed question, retrieve chunks, answer with chat LLM
│   ├── llm.js               # Embedding + chat client (Ollama / OpenAI-compatible)
│   ├── qdrant.js            # Qdrant client: upsert, search, delete points
│   └── config.js            # Config loader (env + config.json)
├── config.json              # Default values (optional, created if needed)
├── compose.yml              # Docker Compose definition of the service
├── compose-local-dev.yml    # Docker Compose for local development with hot reload
├── Dockerfile               # Node 22 (Alpine) base image
├── .env.default             # Template for the environment variables
├── .env                     # Environment variables (not committed)
└── package.json
```

## Prerequisites

- Node.js 22+
- An accessible Qdrant (e.g. via `QDRANT_URL`)
- An embedding LLM with an embedding endpoint (Ollama `/api/embed` or OpenAI-compatible `/embeddings`)
- A chat LLM with a chat endpoint (Ollama `/api/chat` or OpenAI-compatible `/chat/completions`) for answering questions
- A Gitea account with API token (for repository access)

## Configuration

The environment variables take precedence over `config.json`. In Docker they are
passed via `compose.yml` using a `.env` file:

| Variable                  | Description                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `SERVER_PORT`             | Port the service listens on (default: `3000`)                                                                         |
| `QDRANT_URL`              | Base URL of the Qdrant instance                                                                                       |
| `QDRANT_PORT`             | Port of the Qdrant instance (default: `80`)                                                                           |
| `QDRANT_COLLECTION`       | Name of the Qdrant collection (default: `research`)                                                                   |
| `QDRANT_CHUNK_MAX_SIZE`   | Maximum size of a chunk in characters (default: `768`)                                                                |
| `EMBEDDINGS_API`          | Embedding backend: `ollama` (default) posts to `{URL}/api/embed`, `openapi` posts to `{URL}/embeddings`               |
| `EMBEDDINGS_URL`          | Base URL of the embedding LLM host (e.g. `http://localhost:11434` for Ollama or `http://localhost:8080/v1` for llama.cpp) |
| `EMBEDDINGS_MODEL`        | Embedding model name (default: `nomic-embed-text`)                                                                    |
| `CHAT_API`                | Chat backend: `ollama` (default) posts to `{URL}/api/chat`, `openapi` posts to `{URL}/chat/completions`               |
| `CHAT_URL`                | Base URL of the chat LLM host                                                                                         |
| `CHAT_MODEL`              | Chat model name                                                                                                        |
| `GITEA_API_URL`           | Base URL of the Gitea API                                                                                             |
| `GITEA_TOKEN`             | Personal Access Token for the Gitea API                                                                               |
| `CONFIG_PATH`             | Path to `config.json` (default: `./config.json`)                                                                      |

The older `LLM_URL`, `LLM_API` and `MODEL_NAME` variables are still supported as
fallbacks for `EMBEDDINGS_URL`, `EMBEDDINGS_API` and `EMBEDDINGS_MODEL`.

Without `config.json`, a sheet of default values is created at the
`CONFIG_PATH` location on startup.

## Installation

```bash
npm install
```

## Local start

```bash
SERVER_PORT=3000 QDRANT_URL=http://localhost:6333 QDRANT_PORT=6333 QDRANT_COLLECTION=research QDRANT_CHUNK_MAX_SIZE=768 \
EMBEDDINGS_API=ollama EMBEDDINGS_URL=http://localhost:11434 EMBEDDINGS_MODEL=nomic-embed-text-v2-moe:latest \
CHAT_API=ollama CHAT_URL=http://localhost:11434 CHAT_MODEL=loaded \
GITEA_API_URL=https://gitea.example.com GITEA_TOKEN=your-token node index.js
```

## Start with Docker Compose

```bash
docker compose up --build
```

Copy `.env.default` to `.env` and fill in the variables above.

For local development with hot reload:

```bash
docker compose -f compose-local-dev.yml up --build
```

## Endpoints

### `POST /webhook`

Called by Gitea. Processes only events of the type
`x-gitea-event: push`. The payload matches the Gitea push webhook
(`repository`, `commits` with `added`/`modified`).

### `POST /search`

Accepts a JSON body with a `question` field and returns `{ "answer": "..." }`
based on the synchronized documentation. Returns `404` if no answer could be
generated.

### `GET /health`

Returns the service status: `{ "status": "ok" }`.

## Set up Gitea webhook

In a repository under *Settings → Webhooks → Gitea Webhook*, create a new webhook
with the following URL:

```
http://<service-host>:<port>/webhook
```

"Push" must be enabled as the event type. The `x-gitea-event` header is validated
automatically by the service.

## Notes on customization

In `server/config.js`, default values for the embedding model (`embeddingsModel`,
default `nomic-embed-text`), the chat model (`chatModel`), the Qdrant collection
(`qdrantCollection`, default `research`) and the maximum chunk size
(`qdrantChunkMaxSize`, default `768` characters per chunk) can be changed. The
chunking uses a recursive Markdown splitter in `server/sync.js`. The point ID
generation in `server/qdrant.js` (`upsert`) uses a timestamp plus random id; adjust
this if a deduplicated or content-stable synchronization is required.
