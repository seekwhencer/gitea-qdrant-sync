# Frontend-Konzept: RAG-Search-UI für den Endpunkt `/search`

> Konzept für eine React-Web-UI, die die bestehenden Backend-Endpunkte des
> `gitea-qdrant-sync`-Services bedient – Schwerpunkt `POST /search`.

## 1. Kontext & Ziel

Der Server (`server/`, Node.js + Express) synchronisiert Markdown aus Gitea in
Qdrant und beantwortet Fragen über RAG:

```
Frage ─▶ Embedding (LLM) ─▶ Qdrant-Suche (topK) ─▶ Context ─▶ Chat-LLM ─▶ Antwort
```

Der Endpunkt `POST /search` nimmt `{ "question": "…" }` und gibt
`{ "answer": "…" }` zurück (siehe Abschnitt 3).

**Ziel des Frontends:** eine Web-UI, mit der Benutzer Fragen an die
synchronisierte Dokumentation stellen und die Antworten lesen können.

Das Frontend existiert bereits als Vite/React-Setup (`frontend/`,
`package.json` mit React 19, `@tanstack/react-query` v5, `react-router-dom` v7)
und ist im Aufbau: `index.html` ist belegt (`#root` + `main.jsx`), es liegen
leere Skelett-Dateien `src/App.jsx` und `src/main.jsx` sowie erste
handgeschriebene Basis-CSS-Dateien (`src/style/*.css`) vor. Die eigentliche
Verdrahtung (`api/`, `hooks/`, `components/`) steht noch aus. Dieses Konzept
beschreibt die Umsetzung dieser Verdrahtung in inkrementellen Phasen.

## Aktueller Stand

| Bereich | Status |
| --- | --- |
| Vite/React-Skeleton (`package.json`, `vite.config.js`, `index.html`) | ✔ vorhanden (`index.html` mit `#root` + `main.jsx`) |
| Skelett-Dateien `src/App.jsx`, `src/main.jsx` | ✔ angelegt, aber noch **leer** (0 Bytes) |
| Basis-CSS `src/style/*.css` | ✔ vorhanden (`variables.css`, `index.css`, `global.css`) |
| `api/` (fetch-Wrapper, `client.js`, `search.js`) | ✘ fehlt |
| `hooks/` (`useSearch.js`, …) | ✘ fehlt |
| `components/` (`SearchBar`, `SearchResults`, `Conversation`) | ✘ fehlt |
| `vite.config.js` (Proxy) | ✘ noch mit doppeltem `server`-Key (siehe §9) |

**Nächstes Ziel: Phase 0** — `main.jsx`/`App.jsx` befüllen, API-Layer
`src/api/` anlegen, `vite.config.js` korrigieren (Proxy zum Backend).

## 2. Tech-Stack (bereits im Projekt vorgegeben – wird beibehalten)

| Bereich        | Wahl                                  |
| -------------- | ------------------------------------- |
| Framework      | React 19 (JSX)                        |
| Build/Dev      | Vite 8                                |
| Datenabruf     | `@tanstack/react-query` v5            |
| Routing        | `react-router-dom` v7                 |
| Typisierung    | **JSX/JS** (kein TypeScript – passt zum Rest des Repos) |
| Styling        | **handgeschriebenes CSS** in `src/style/components/` |
| API-Zugang     | native `fetch`, same-origin relativ   |

Begründung: Das Backend und die `package.json` verwenden durchgehend
JavaScript ohne TypeScript und ohne schwere UI-Library. Das Frontend folgt dem
gleichen Stil, um wartbar und konsistent zu bleiben.

## 3. API-Vertrag (stabil, vom Backend übernommen)

Der Endpunkt ist zustandslos. Eine einzige Anfrage → eine einzige Antwort.
Embedding + Qdrant-Suche + Chat-LLM können Sekunden dauern → **Ladezustände
 sind zwingend**.

### `GET /health`
|                |                                                    |
| -------------- | -------------------------------------------------- |
| Request        | –                                                  |
| Success        | `200 { "status": "ok" }`                           |

### `POST /search`
|                |                                                    |
| -------------- | -------------------------------------------------- |
| Content-Type   | `application/json`                                 |
| Body           | `{ "question": "<string, required>" }`             |
| Success        | `200 { "answer": "<string>" }`                     |
| Fehler         | `400 { "error": "Missing \"question\" in request body" }` |
| Fehler         | `404 { "error": "No answer found" }`              |
| Fehler         | `500` Internal Server Error                        |

### Datenmodell in Qdrant (nur für künftige Quellen-Anzeigen relevant)
Jeder Vektorenpunkt trägt `payload: { text, source (Dateipfad), repository (html_url) }`.
Derzeit gibt `/search` **nur** die Antwort zurück, keine Quellen.

## 4. Architektur

```
frontend/
├─ index.html               # <div id="root"></div> + <script src="/src/main.jsx">
├─ vite.config.js           # Fix: Proxy zu Backend in dev, korrekter server-Block
├─ main.jsx                 # ReactDOM, QueryClientProvider, Router
├─ App.jsx                  # Routen (/ , ggf. /history)
├─ api/
│  ├─ client.js             # fetch-Wrapper (same-origin; VITE_API_BASE optional)
│  └─ search.js             # search(question) → { answer } | wirft Fehler
├─ hooks/
│  └─ useSearch.js          # useMutation-Wrapper für search()
├─ components/
│  ├─ SearchBar.jsx         # Eingabefeld + Absenden
│  ├─ SearchResults.jsx     # Antwort / Loading / Error / Empty
│  └─ Conversation.jsx      # Konversationsverlauf (Phase 3, optional)
└─ style/
   └─ components/
      ├─ SearchBar.css
      ├─ SearchResults.css
      └─ Conversation.css
```

**Datenfluss:** `SearchBar` triggert eine `useMutation` aus `useSearch`, die
`client.search()` aufruft → `POST /search` → `SearchResults` rendert je nach
Mutation-State (`isPending` / `isError` / `success`).

## 5. Feature-Umfang

**Pflicht (Phase 1–2):**
- Eingabefeld + Absenden, `Enter` löst Suche aus
- Ladezustand (Skeleton/Spinner), da der Endpunkt langsam sein kann
- Antwortanzeige (formatiert, mehrzeilig)
- Fehlerbehandlung: `400`, `404`, `500`, Netzwerkfehler
- Leerer Zustand (noch keine Suche)

**Optional (abhängig von den offenen Entscheidungen):**
- Konversationsverlauf (mehrere Fragen in einer Sitzung, clientseitig)
- Quellenangaben (ersetzt/erweitert `/search` im Backend)
- Persistenz des Verlaufs in `localStorage`
- Integration: `dist` über den Express-Server ausliefern (Phase 6)

## 6. Offene Entscheidungen (mit Empfehlung)

> Die Antworten auf diese Punkte werden in Abschnitt 7 in die Phasen eingearbeitet.

| # | Entscheidung | Empfehlung | Alternative |
|---|--------------|-----------|-------------|
| 1 | UI-Modell: Einzelabfrage vs. Chat mit Konversationsverlauf | Chat mit clientseitiger History | nur Einzelabfrage |
| 2 | Quellenanzeigen: nur Antwort oder auch Quellen (Ausschnitte/Dateien/Repos)? | nur Antwort (kein Backend-Wechsel) | mit Quellen (Backend-Erweiterung nötig) |
| 3 | JSX/JS vs. TypeScript | JSX/JS (passt zum Repo) | TypeScript |
| 4 | Dev-Proxy: Vite-Proxy zu Backend vs. pure Same-Origin | Vite Proxy (`/search`→Backend-URL) | pure Same-Origin via Express-Middleware |

## 7. Abarbeitungsphasen

### Allgemeine Regeln für jede Phase
Jede Phase wird als **eigener Sub-Agent (kalter KV-Cache)** umgesetzt. Das
bedeutet: jede Phase ist vollständig eigenständig und aus sich selbst heraus
implementierbar, ohne Kontext vorheriger Phasen. Deshalb enthält jede Phase:
- **Ziel** (ein Satz)
- **Voraussetzungen** (was frühere Phasen bereitstellen)
- **Dateien** (erstellen/ändern, mit exaktem Pfad)
- **Exakte Spezifikation** (API-Vertrag, Props, Exporte)
- **Konventionen** (an bestehendem Code ausgerichtet: plain JS/JSX, CSS in
  `src/style/components/`, React-Query für Daten)
- **Definition von Done** (`npm install && npm run build` muss erfolgreich sein)

Die Phasen sind **inkrementell und sequenziell**: jede baut auf dem
funktionierenden Ergebnis der vorherigen. Jede Phase endet mit einem
erfolgreichen `vite build`.

---

### Phase 0 – Setup, Verdrahtung & API-Layer
**Ziel:** lauffähiges Vite/React-Skelett mit Proxy und wiederverwendbarem
API-Zugang.

**Voraussetzungen:** Vorhandenes `frontend/` (package.json, src/).

**Dateien (erstellen/ändern):**
- `frontend/index.html` → `<div id="root">` + `<script type="module" src="/src/main.jsx">`
- `frontend/src/main.jsx` → `createRoot`, `QueryClientProvider`, `Router`
- `frontend/src/App.jsx` → Platzhalter-Route
- `frontend/src/api/client.js` → `getHealth()`, `search(question)`
- `frontend/src/api/search.js` → Export von `search`
- `frontend/vite.config.js` → korrigieren (Duplikat `server`-Key entfernen),
  `server.proxy` für `/search`, `/health` zum Backend hinzufügen,
  Proxy-Ziel über `process.env.VITE_API_TARGET` (Default `http://localhost:3000`)

**Exakte Spezifikation (`api/client.js`):**
- Base-URL relativ (`/search`, `/health`) für same-origin; bei gesetztem
  `import.meta.env.VITE_API_BASE` wird dieses als Präfix verwendet.
- `search(question)`: `POST /search`, `Content-Type: application/json`,
  Body `{ question }`. Bei `!ok` wirft es einen `Error` mit `status` und
  `error`-Nachricht. Gibt `{ answer }` zurück.
- `getHealth()`: `GET /health`, gibt `status` zurück.

**Konventionen:** plain JS/JSX, ES-Module, kein Store ausser React-Query.

**Definition von Done:** `npm run dev` startet, `npm run build` erfolgreich,
Browser lädt `#root`, `getHealth` ist testbar.

---

### Phase 1 – Kernsuche (einzelne Abfrage)
**Ziel:** Frage eingeben, Antwort anzeigen.

**Voraussetzungen:** Phase 0 (API-Layer, App-Shell).

**Dateien (erstellen):**
- `frontend/src/hooks/useSearch.js` → `useMutation({ mutationFn: search })`
- `frontend/src/components/SearchBar.jsx` → `input` + Button, Enter sendet,
  Props: `onSubmit(question)`, `pending`
- `frontend/src/components/SearchResults.jsx` → rendert `data.answer`;
  Props: `answer`, `error`, `pending`
- `frontend/src/App.jsx` → verdrahtet SearchBar + SearchResults via `useSearch`
- `frontend/src/style/components/SearchBar.css`, `SearchResults.css`

**Exakte Spezifikation:**
- `SearchBar`: State `question`, `onSubmit(value)` bei Senden/Enter (nur wenn
  nicht leer). Zeigt `pending` als `disabled`/Spinner.
- `SearchResults`:
  - `pending && !answer` → Ladezustand
  - `error` → Fehlertext (`error.message`)
  - else → `answer` in mehrzeiligem Container
- `App`: `const { mutate, isPending, isError, error, data } = useSearch()`;
  `mutate(question)`.

**Definition von Done:** Anfrage an lokales Backend (`npm run dev` + Server)
liefert eine Antwort in der UI.

---

### Phase 2 – Zustände, Fehler & Randfälle
**Zielrobust:** vollständige Behandlung von Lade-/Fehler-/Leerzuständen.

**Voraussetzungen:** Phase 1.

**Ändern:**
- `SearchResults.jsx` → unterscheide klar: `isPending` (Skeleton),
  `isError` (Nachricht je nach `error.status`: 400/404/500/Netzwerk),
  Empty-Zustand (noch nichts gesucht).
- `client.js` → Netzwerkfehler als erkennbarer `Error` (mit `name`/`message`).
- `SearchBar.css`/`SearchResults.css` → Stile für alle Zustände.

**Exacht spezifikation Fehlermeldungen:**
- `400` → „Bitte gib eine Frage ein.“
- `404` → „Keine passenden gefundenen Dokumente.“
- `500` → „Serverfehler, bitte später erneut versuchen.“
- Netzwerk → „Verbindung zum Server fehlgeschlagen.“

**Definition von Done:** Alle vier Zustände sichtbar und korrekt beschriftet;
`vite build` erfolgreich.

---

### Phase 3 – Konversationsverlauf (optional, nur wenn Entscheidung #1 „Chat“/„Beides“)
**Ziel:** mehrere Fragen in einer Sitzung anzeigen.

**Voraussetzungen:** Phase 2.

**Dateien (erstellen):**
- `frontend/src/components/Conversation.jsx` → Liste von {question, answer,
  error, ts}; Props: `items`, `onSelect(item)`
- `frontend/src/hooks/useConversation.js` → State (`useState`), optional
  Persistenz in `localStorage`
- `frontend/src/App.jsx` → `Conversation` um `SearchBar`/`SearchResults`,
  `mutate`-Egebnisse in die Liste schreiben

**Exacht Spezifikation:**
- Jede Suche ergänzt einen Eintrag; alte Einträge bleiben bestehen (clientseitig).
- Kein Backend-Aufruf zur History; reine Client-Logik.
- Optional: `localStorage`-Key `gitea-search:history`, Limit z. B. 20 Einträge.

**Definition von Done:** Mehrere Suchen werden in Folge angezeigt, Seite
überlebt ohne Datenverlust (`vite build`).

---

### Phase 4 – Quellenangaben (optional, nur wenn Entscheidung #2 „mit Quellen“)
**Ziel:** gefundene Quellen in der UI anzeigen.

**Voraussetzungen:** Phase 3 + **Backend-Erweiterung** von `/search`.

> Achtung: Phase 4 erfordert eine Backend-Änderung. `/search` muss zusätzlich
> zur Antwort die Treffer (max. `topK`) mit `text/source/repository`
> zurückgeben, z. B. `200 { "answer": "...", "sources": [ { "text", "source",
> "repository" } ] }`. Diese Änderung ist **nicht Teil dieses Frontend-Konzepts**
> und wird separat umgesetzt (Backend-Sub-Agent).

**Frontend-Änderungen:**
- `api/client.js` → `search()` gibt `{ answer, sources }` zurück.
- `SearchResults.jsx` → Quelle-Liste ausklappbar unter der Antwort.
- neue CSS-Dateien in `style/components/`.

**Definition von Done:** Antwort plus Quellen werden angezeigt; `vite build`.

---

### Phase 5 – Styling & Polish
**Ziel:** konsistentes, responsives Design.

**Voraussetzungen:** Phase 2–4 (je nach aktiviertem Umfang).

**Ändern:** alle `style/components/*.css` → Layout, Typografie, abgerundet,
Responsive (Mobile/Desktop), optionale Dark-Mode-Unterstützung via
`@media (prefers-color-scheme: dark)`.

**Definition von Done:** UI auf Desktop und Mobile nutzbar; `vite build`.

---

### Phase 6 – Produktion/Integration (optional)
**Ziel:** Built UI über den Express-Server ausliefern.

**Voraussetzungen:** Phase 5 + `frontend/dist` (aus `npm run build`).

**Ändern:**
- `index.js` (Backend) → in Produktion `express.static('frontend/dist')` +
  Fallback-Route für SPA-Routing.
- Build-Pipeline im Dockerfile/compose (Frontend-Build vor Serverstart).

> Berührt die Backend-Datei `index.js`; separat koordinieren.

**Definition von Done:** Aufruf der Service-URL zeigt die UI, `/search`
bleibt über same-origin erreichbar.

## 8. Verifikation (alle Phasen)

```bash
cd frontend
npm install
npm run build     # Muss erfolgreich sein (Ende jeder Phase)
npm run dev       # Smoke-Test gegen laufenden Server
```

Dev-Proxy (`Phase 0`) leitet `/search` → `VITE_API_TARGET` (Default
`http://localhost:3000`). Für Same-Origin-Deployment die Proxy-URL auf den
Service-Namen setzen (z. B. `sync.gitea.home`, siehe `vite.config.js`).

## 9. Risiken & Hinweise

- **Kein Streaming:** `/search` blockiert bis zur fertigen Antwort → UI muss
  Ladezustände und evtl. „Abbrechen“ unterstützen (Phase 1/2).
- **CORS:** bei same-origin (Proxy oder Express-Serving) nicht nötig. Bei
  externem `VITE_API_BASE` muss das Backend CORS erlauben (nicht aktuell).
- **`vite.config.js` ist aktuell inkorrekt** (doppelter `server`-Key,
  `middlewareMode` ohne Express-Einbindung) → wird in Phase 0 bereinigt.
- **Quellen-Anzeigen** setzen eine Backend-Änderung voraus (Phase 4/§6-Entscheidung #2).
- **SPA-Serving** im Express erfordert eine kleine `index.js`-Änderung
  (Phase 6, außerhalb des reinen Frontend-Scope).
