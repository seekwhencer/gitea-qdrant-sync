# Frontend Concept: RAG Search UI for the `/search` endpoint

> Concept for a React web UI that uses the existing backend endpoints of the
> `gitea-qdrant-sync` service – focus on `POST /search`.

## 1. Context & Goal

The server (`server/`, Node.js + Express) synchronizes Markdown from Gitea into
Qdrant and answers questions via RAG:

```
Question ─▶ Embedding (LLM) ─▶ Qdrant search (topK) ─▶ Context ─▶ Chat LLM ─▶ Answer
```

The `POST /search` endpoint takes `{ "question": "…" }` and returns
`{ "answer": "…" }` (see section 3).

**Goal of the frontend:** a web UI where users can ask questions about the
synchronized documentation and read the answers.

The frontend already exists as a Vite/React setup (`frontend/`,
`package.json` with React 19, `@tanstack/react-query` v5, `react-router-dom` v7)
and is structured as follows: `index.html` is set up (`#root` + `main.jsx`),
empty skeleton files `src/App.jsx` and `src/main.jsx` exist, and initial
hand-written base CSS files (`src/style/*.css`) are present. The actual wiring
(`api/`, `hooks/`, `components/`) is still missing. This concept describes the
implementation of this wiring in incremental phases.

## Current Status

| Area | Status |
| --- | --- |
| Vite/React skeleton (`package.json`, `vite.config.js`, `index.html`) | ✔ present (`index.html` with `#root` + `main.jsx`) |
| Skeleton files `src/App.jsx`, `src/main.jsx` | ✔ created, but still **empty** (0 bytes) |
| Base CSS `src/style/*.css` | ✔ present (`variables.css`, `index.css`, `global.css`) |
| `api/` (fetch wrapper, `client.js`, `search.js`) | ✘ missing |
| `hooks/` (`useSearch.js`, …) | ✘ missing |
| `components/` (`SearchBar`, `SearchResults`, `Conversation`) | ✘ missing |
| `vite.config.js` (proxy) | ✘ still has duplicate `server` key (see §9) |

**Next goal: Phase 0** — fill `main.jsx`/`App.jsx`, create API layer
`src/api/`, fix `vite.config.js` (proxy to backend).

## 2. Tech Stack (already available in the project – will be kept)

| Area | Choice |
| --- | --- |
| Framework | React 19 (JSX) |
| Build/Dev | Vite 8 |
| Data fetching | `@tanstack/react-query` v5 |
| Routing | `react-router-dom` v7 |
| Typing | **JSX/JS** (no TypeScript – fits the rest of the repo) |
| Styling | **hand-written CSS** in `src/style/components/` |
| API access | native `fetch`, same-origin relative |

Reasoning: The backend and `package.json` use JavaScript without TypeScript and
without heavy UI libraries throughout. The frontend follows the same style to
remain maintainable and consistent.

## 3. API Contract (stable, taken from the backend)

The endpoint is stateless. One request → one response.
Embedding + Qdrant search + Chat LLM can take seconds → **loading states are
mandatory**.

### `GET /health`
| | |
| --- | --- |
| Request | – |
| Success | `200 { "status": "ok" }` |

### `POST /search`
| | |
| --- | --- |
| Content-Type | `application/json` |
| Body | `{ "question": "<string, required>" }` |
| Success | `200 { "answer": "<string>" }` |
| Error | `400 { "error": "Missing \"question\" in request body" }` |
| Error | `404 { "error": "No answer found" }` |
| Error | `500` Internal Server Error |

### Data model in Qdrant (only relevant for future source display)
Each vector point carries `payload: { text, source (file path), repository (html_url) }`.
Currently `/search` returns **only** the answer, no sources.

## 4. Architecture

```
frontend/
├─ index.html               # <div id="root"></div> + <script src="/src/main.jsx">
├─ vite.config.js           # Fix: proxy to backend in dev, correct server block
├─ main.jsx                 # ReactDOM, QueryClientProvider, Router
├─ App.jsx                  # Routes (/ , possibly /history)
├─ api/
│  ├─ client.js             # fetch wrapper (same-origin; VITE_API_BASE optional)
│  └─ search.js             # search(question) → { answer } | throws errors
├─ hooks/
│  └─ useSearch.js          # useMutation wrapper for search()
├─ components/
│  ├─ SearchBar.jsx         # Input field + submit
│  ├─ SearchResults.jsx     # Answer / Loading / Error / Empty
│  └─ Conversation.jsx      # Conversation history (Phase 3, optional)
└─ style/
   └─ components/
      ├─ SearchBar.css
      ├─ SearchResults.css
      └─ Conversation.css
```

**Data flow:** `SearchBar` triggers a `useMutation` from `useSearch`, which calls
`client.search()` → `POST /search` → `SearchResults` renders based on mutation
state (`isPending` / `isError` / `success`).

## 5. Feature Scope

**Mandatory (Phases 1–2):**
- Input field + submit, `Enter` triggers search
- Loading state (skeleton/spinner), as the endpoint can be slow
- Answer display (formatted, multi-line)
- Error handling: `400`, `404`, `500`, network errors
- Empty state (no search yet)

**Optional (depending on open decisions):**
- Conversation history (multiple questions in one session, client-side)
- Source attribution (replaces/extends `/search` in the backend)
- Persistence of history in `localStorage`
- Integration: serve `dist` via the Express server (Phase 6)

## 6. Open Decisions (with recommendation)

> The answers to these points are incorporated into the phases in section 7.

| # | Decision | Recommendation | Alternative |
|---|----------|---------------|-------------|
| 1 | UI model: single query vs. chat with conversation history | Chat with client-side history | single query only |
| 2 | Source display: only answer or also sources (snippets/files/repos)? | only answer (no backend change) | with sources (backend extension needed) |
| 3 | JSX/JS vs. TypeScript | JSX/JS (fits the repo) | TypeScript |
| 4 | Dev proxy: Vite proxy to backend vs. pure same-origin | Vite proxy (`/search`→backend URL) | pure same-origin via Express middleware |

## 7. Implementation Phases

### General rules for each phase
Each phase is implemented as a **separate sub-agent (cold KV cache)**. This
means: each phase is fully standalone and implementable on its own, without
context from previous phases. Therefore each phase contains:
- **Goal** (one sentence)
- **Prerequisites** (what earlier phases provide)
- **Files** (create/modify, with exact paths)
- **Exact specification** (API contract, props, exports)
- **Conventions** (aligned with existing code: plain JS/JSX, CSS in
  `src/style/components/`, React Query for data)
- **Definition of Done** (`npm install && npm run build` must succeed)

The phases are **incremental and sequential**: each builds on the working
result of the previous. Each phase ends with a successful `vite build`.

---

### Phase 0 – Setup, Wiring & API Layer
**Goal:** working Vite/React skeleton with proxy and reusable API access.

**Prerequisites:** Existing `frontend/` (package.json, src/).

**Files (create/modify):**
- `frontend/index.html` → `<div id="root">` + `<script type="module" src="/src/main.jsx">`
- `frontend/src/main.jsx` → `createRoot`, `QueryClientProvider`, `Router`
- `frontend/src/App.jsx` → placeholder route
- `frontend/src/api/client.js` → `getHealth()`, `search(question)`
- `frontend/src/api/search.js` → export of `search`
- `frontend/vite.config.js` → fix (remove duplicate `server` key),
  add `server.proxy` for `/search`, `/health` to the backend,
  proxy target via `process.env.VITE_API_TARGET` (default `http://localhost:3000`)

**Exact specification (`api/client.js`):**
- Base URL relative (`/search`, `/health`) for same-origin; if
  `import.meta.env.VITE_API_BASE` is set, use it as prefix.
- `search(question)`: `POST /search`, `Content-Type: application/json`,
  body `{ question }`. On `!ok` throws an `Error` with `status` and
  `error` message. Returns `{ answer }`.
- `getHealth()`: `GET /health`, returns `status`.

**Conventions:** plain JS/JSX, ES modules, no store other than React Query.

**Definition of Done:** `npm run dev` starts, `npm run build` succeeds,
browser loads `#root`, `getHealth` is testable.

---

### Phase 1 – Core Search (single query)
**Goal:** enter question, display answer.

**Prerequisites:** Phase 0 (API layer, app shell).

**Files (create):**
- `frontend/src/hooks/useSearch.js` → `useMutation({ mutationFn: search })`
- `frontend/src/components/SearchBar.jsx` → `input` + button, Enter sends,
  props: `onSubmit(question)`, `pending`
- `frontend/src/components/SearchResults.jsx` → renders `data.answer`;
  props: `answer`, `error`, `pending`
- `frontend/src/App.jsx` → wires SearchBar + SearchResults via `useSearch`
- `frontend/src/style/components/SearchBar.css`, `SearchResults.css`

**Exact specification:**
- `SearchBar`: state `question`, `onSubmit(value)` on submit/Enter (only if
  not empty). Shows `pending` as `disabled`/spinner.
- `SearchResults`:
  - `pending && !answer` → loading state
  - `error` → error text (`error.message`)
  - else → `answer` in multi-line container
- `App`: `const { mutate, isPending, isError, error, data } = useSearch()`;
  `mutate(question)`.

**Definition of Done:** request to local backend (`npm run dev` + server)
returns an answer in the UI.

---

### Phase 2 – States, Errors & Edge Cases
**Goal:** robust handling of loading/error/empty states.

**Prerequisites:** Phase 1.

**Modify:**
- `SearchResults.jsx` → clearly distinguish: `isPending` (skeleton),
  `isError` (message depending on `error.status`: 400/404/500/network),
  empty state (nothing searched yet).
- `client.js` → network error as recognizable `Error` (with `name`/`message`).
- `SearchBar.css`/`SearchResults.css` → styles for all states.

**Exact specification of error messages:**
- `400` → "Please enter a question."
- `404` → "No matching documents found."
- `500` → "Server error, please try again later."
- Network → "Connection to server failed."

**Definition of Done:** all four states visible and correctly labeled;
`vite build` succeeds.

---

### Phase 3 – Conversation History (optional, only if decision #1 "Chat"/"Both")
**Goal:** display multiple questions in one session.

**Prerequisites:** Phase 2.

**Files (create):**
- `frontend/src/components/Conversation.jsx` → list of {question, answer,
  error, ts}; props: `items`, `onSelect(item)`
- `frontend/src/hooks/useConversation.js` → state (`useState`), optional
  persistence in `localStorage`
- `frontend/src/App.jsx` → `Conversation` alongside `SearchBar`/`SearchResults`,
  write `mutate` results into the list

**Exact specification:**
- Each search adds an entry; old entries remain (client-side).
- No backend call for history; pure client logic.
- Optional: `localStorage` key `gitea-search:history`, limit e.g. 20 entries.

**Definition of Done:** multiple searches are displayed sequentially, page
survives without data loss (`vite build`).

---

### Phase 4 – Source Attribution (optional, only if decision #2 "with sources")
**Goal:** display found sources in the UI.

**Prerequisites:** Phase 3 + **backend extension** of `/search`.

> Warning: Phase 4 requires a backend change. `/search` must additionally
> return the hits (max. `topK`) with `text/source/repository`, e.g.
> `200 { "answer": "...", "sources": [ { "text", "source", "repository" } ] }`.
> This change is **not part of this frontend concept** and will be implemented
> separately (backend sub-agent).

**Frontend changes:**
- `api/client.js` → `search()` returns `{ answer, sources }`.
- `SearchResults.jsx` → collapsible source list below the answer.
- new CSS files in `style/components/`.

**Definition of Done:** answer plus sources are displayed; `vite build`.

---

### Phase 5 – Styling & Polish
**Goal:** consistent, responsive design.

**Prerequisites:** Phases 2–4 (depending on activated scope).

**Modify:** all `style/components/*.css` → layout, typography, rounded corners,
responsive (mobile/desktop), optional dark mode support via
`@media (prefers-color-scheme: dark)`.

**Definition of Done:** UI usable on desktop and mobile; `vite build`.

---

### Phase 6 – Production/Integration (optional)
**Goal:** serve built UI via the Express server.

**Prerequisites:** Phase 5 + `frontend/dist` (from `npm run build`).

**Modify:**
- `index.js` (backend) → in production `express.static('frontend/dist')` +
  fallback route for SPA routing.
- Build pipeline in Dockerfile/compose (frontend build before server start).

> Touches backend file `index.js`; coordinate separately.

**Definition of Done:** calling the service URL shows the UI, `/search`
remains accessible via same-origin.

## 8. Verification (all phases)

```bash
cd frontend
npm install
npm run build     # Must succeed (end of each phase)
npm run dev       # Smoke test against running server
```

Dev proxy (Phase 0) routes `/search` → `VITE_API_TARGET` (default
`http://localhost:3000`). For same-origin deployment set the proxy URL to the
service name (e.g. `sync.gitea.home`, see `vite.config.js`).

## 9. Risks & Notes

- **No streaming:** `/search` blocks until the full answer is ready → UI must
  support loading states and possibly "cancel" (Phase 1/2).
- **CORS:** not needed with same-origin (proxy or Express serving). With
  external `VITE_API_BASE` the backend must allow CORS (not currently).
- **`vite.config.js` is currently incorrect** (duplicate `server` key,
  `middlewareMode` without Express integration) → will be cleaned up in Phase 0.
- **Source display** requires a backend change (Phase 4/decision #2).
- **SPA serving** in Express requires a small `index.js` change
  (Phase 6, outside pure frontend scope).