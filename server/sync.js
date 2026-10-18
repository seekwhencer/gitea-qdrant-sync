import { Qdrant } from './qdrant.js';
import { Llm } from './llm.js';
import { Gitea } from './gitea.js';

/**
 * Sleeps for the given number of milliseconds.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Simple concurrency limiter (semaphore). Limits how many task functions run
 * concurrently so downstream rate limits (e.g. Qdrant) are respected.
 */
class ConcurrencyLimiter {
    constructor(limit = 1) {

        this.limit = Math.max(Number(limit), 1);
        this.activePromises = [];
    }

    async run(taskFn) {

        if (this.activePromises.length >= this.limit) {
            // Wait for the fastest in-flight task to settle before starting a new one.
            await Promise.race(this.activePromises.map(p => p.catch(() => undefined)));
        }
        const promise = taskFn();
        this.activePromises.push(promise);
        try {
            return await promise;
        } finally {
            void this.activePromises.splice(this.activePromises.indexOf(promise), 1);
        }
    }
}

/**
 * Orchestrates synchronization of Gitea repository files to Qdrant.
 *
 * Reads Markdown files, creates embeddings, and stores vectors in Qdrant.
 */
class GiteaQdrantSync {
    /**
     * @param {object} params - Configuration parameters
     * @param {Qdrant} [params.qdrant] - Qdrant client instance
     * @param {Llm} [params.llm] - LLM service instance
     * @param {string} [params.qdrantUrl] - Qdrant server URL
     * @param {number} [params.qdrantPort] - Qdrant port
     * @param {string} [params.qdrantCollection] - Qdrant collection name
     * @param {string} [params.embeddingsApi] - Embedding API (ollama/openapi)
     * @param {string} [params.embeddingsUrl] - Embedding server URL
     * @param {string} [params.embeddingsModel] - Embedding model name
     * @param {string} [params.chatApi] - Chat API (ollama/openapi)
     * @param {string} [params.chatUrl] - Chat server URL
     * @param {string} [params.chatModel] - Chat model name
     * @param {string} [params.giteaApiUrl] - Gitea API URL
     * @param {string} [params.giteaToken] - Gitea API token
     * @param {number} [params.qdrantChunkMaxSize] - Maximum chunk size
     */
    constructor({
        qdrant,
        llm,
        qdrantUrl,
        qdrantPort,
        qdrantCollection,
        embeddingsApi,
        embeddingsUrl,
        embeddingsModel,
        chatApi,
        chatUrl,
        chatModel,
        giteaApiUrl,
        giteaToken,
        qdrantChunkMaxSize
    } = {}) {
        this.qdrantChunkMaxSize = qdrantChunkMaxSize;

        const maxConcurrency = Number(process.env.QDRANT_MAX_CONCURRENCY ?? 4);
        const maxUpsertRetries = Number(process.env.QDRANT_MAX_UPSERT_RETRIES ?? 5);

        this.limiter = new ConcurrencyLimiter(Math.max(maxConcurrency, 1));
        this.maxUpsertRetries = Math.max(Number(maxUpsertRetries), 0);

        this.gitea = new Gitea({ url: giteaApiUrl, token: giteaToken });
        this.qdrant = qdrant || new Qdrant({ url: qdrantUrl, port: qdrantPort, collection: qdrantCollection });
        this.llm = llm || new Llm({
            embeddingsApi, embeddingsUrl, embeddingsModel,
            chatApi, chatUrl, chatModel
        });
    }

    /**
     * Processes a Gitea push webhook: extracts changed Markdown files and synchronizes them.
     *
     * Files are processed concurrently (bounded by the concurrency limiter) so that Qdrant rate limits
     * are respected. Within one file its chunks are embedded and upserted in parallel via Promise.all.
     * Errors of individual files are logged; processing continues with the remaining files. Only if no
     * file could be processed successfully an error is thrown, keeping the webhook HTTP status at 200 as
     * long as at least one file was synchronized.
     *
     * @param {object} payload - Webhook payload
     * @returns {Promise<void>}
     */
    async handlePushEvent(payload) {
        const repository = payload.repository;
        const ref = payload.ref || '';
        const owner = repository?.owner?.username;
        const name = repository?.name;
        console.log(`[Webhook] Push received for repository: ${repository.html_url}`);

        const changedFiles = this.gitea.collectMarkdownFiles(payload.commits || []);
        if (changedFiles.length === 0) return;

        // Process files concurrently, bounded by the concurrency limiter.
        const results = await Promise.all(changedFiles.map(filePath => this.limiter.run(async () => {
            try {
                const path = `${owner}/${name}/${filePath}`;
                await this.syncFile(payload, filePath, ref, path);
                return true;
            }
            catch (error) {
                console.error(`[Sync] Error processing changed file ${filePath}:`, error);
                return false;
            }
        })));

        const successCount = results.filter(Boolean).length;

        if (successCount === 0 && changedFiles.length > 0) {
            throw new Error('No files could be synchronized successfully.');
        }

        console.log(`[Webhook] Synchronized ${successCount}/${changedFiles.length} changed files for ${repository.html_url}.`);
    }

    /**
     * Promise-basierte Sperre für Re-Syncs. Verhindert parallele Re-Syncs;
     * ein neuer Request wartet auf _syncLock bis der laufende Re-Sync fertig ist.
     */
    /** @type {Promise<void>} */
    _syncLock = Promise.resolve();
    /** @type {boolean} */
    _syncInProgress = false;

    /**
     * Synchronisiert alle Markdown-Dateien aller Gitea-Repositories in Qdrant.
     * Läuft im Hintergrund; gibt sofort zurück. Ein erneuter Aufruf wartet auf
     * _syncLock bis der aktuelle Re-Sync beendet ist, dann übernimmt er die Sperre.
     * @returns {{status: string, message: string}}
     */
    async syncAllRepositories() {
        // Warten auf eventuellen laufenden Re-Sync (erworbt implizit die Sperre)
        await this._syncLock;

        // Sperre erwerben: _syncLock durch neues Promise ersetzen, das erst am Ende aufgelöst wird
        let resolveLock;
        this._syncLock = new Promise((resolve) => { resolveLock = resolve; });
        this._syncInProgress = true;

        // Re-Sync im Hintergrund starten (fire-and-forget)
        void (async () => {
            try {
                await this._performSyncAll();
            } catch (error) {
                console.error('[Sync-All] Fehler während Re-Sync:', error);
            } finally {
                this._syncInProgress = false;
                if (resolveLock) resolveLock();
            }
        })();

        return {
            status: 'started',
            message: 'Re-Sync aller Repositories gestartet im Hintergrund.'
        };
    }

    /**
     * Interne Implementierung des Re-Syncs aller Repositories.
     * Listet alle Repos via Gitea API und synchronisiert jedes Repository.
     * @returns {Promise<void>}
     */
    async _performSyncAll() {
        const repos = await this.gitea.listRepos();
        console.log(`[Sync-All] ${repos.length} Repository gefunden.`);

        for (const { owner, name } of repos) {
            try {
                await this.syncRepository(owner, name, 'main');
                console.log(`[Sync-All] Repo ${owner}/${name} synchronisiert.`);
            } catch (error) {
                console.error(`[Sync-All] Fehler bei Repo ${owner}/${name}:`, error.message);
            }
        }

        console.log('[Sync-All] Re-Sync aller Repositories abgeschlossen.');
    }

    /**
     * Fully synchronizes all Markdown files of a repository with Qdrant.
     *
     * Files are processed concurrently, bounded by the concurrency limiter (same as handlePushEvent).
     */
    async syncRepository(owner, name, ref = 'main') {
        console.log(`[Sync] Starting full sync for ${owner}/${name} (ref: ${ref})`);

        const markdownFiles = await this.gitea.listFiles(owner, name, ref);
        console.log(`[Sync] Found ${markdownFiles.length} Markdown files in ${owner}/${name}`);

        if (markdownFiles.length === 0) {
            console.log(`[Sync] No Markdown files found for ${owner}/${name}.`);
            return;
        }

        const payload = {
            repository: { owner: { username: owner }, name, html_url: `https://${this.gitea.url.replace(/\/api\/v1$/, '')}/${owner}/${name}` },
            after: ref
        };

        // Process files concurrently, bounded by the concurrency limiter. Errors of individual files are logged.
        await Promise.all(markdownFiles.map(filePath => this.limiter.run(async () => {
            try {
                const path = `${owner}/${name}/${filePath}`;
                await this.syncFile(payload, filePath, ref, path);
            }
            catch (error) {
                console.error(`[Sync] Error processing file ${filePath}:`, error);
            }
        })));

        console.log(`[Sync] Repository ${owner}/${name} synced with ${markdownFiles.length} files.`);
    }

    /**
     * Synchronizes a single file: loads content, splits into chunks, creates embeddings,
     * and stores them in Qdrant.
     *
     * Chunks of one file are processed in parallel (Promise.all over the chunk list).
     * Upserts that fail due to rate limits are retried with exponential backoff.
     *
     * @param {object} payload - Webhook payload with repository information
     * @param {string} filePath - Path of the file to synchronize
     * @returns {Promise<void>}
     */
    async syncFile(payload, filePath, ref = '', path = '') {
        console.log(`Processing file: ${filePath}`);

        const content = await this.gitea.fetchFile(payload.repository, filePath, payload.after);
        const chunks = this.chunkContent(content);

        // Remove previously indexed points for this source path so the upsert below
        // replaces rather than duplicates them.
        try { await this.qdrant.deleteBySource(filePath); }
        catch (err) {
            if (!this.qdrant.isCollectionNotFoundError(err)) throw err;
        }

        if (chunks.length === 0) return;

        const repositoryUrl = payload.repository && payload.repository.html_url ? String(payload.repository.html_url) : '';

        // Embed and upsert all chunks of this file in parallel. The outer concurrency
        // limiter bounds how many files run at the same time, keeping Qdrant rate limits respected.
        await Promise.all(chunks.map(async chunkText => {
            const vector = await this.llm.embed(chunkText);
            try { return await this.upsertWithRetry(vector, chunkText, filePath, repositoryUrl, ref, path); }
            catch (error) {
                console.error(`[Sync] Error upserting chunks of ${filePath}:`, error);
                throw error;
            }
        }));
    }

    /**
     * Upserts a single point with exponential backoff on rate-limit errors.
     *
     * @param {number[]} vector - The embedding vector
     * @param {string} chunkText - The text content of the point
     * @param {string} filePath - Source path (used as `source`)
     * @param {string} repositoryUrl - Repository URL used for idempotent point ids and metadata
     * @param {string} [ref=''] - Git ref/branch name
     * @param {string} [path=''] - Complete repo path (owner/repo/filePath)
     * @returns {Promise<void>}
     */
    async upsertWithRetry(vector, chunkText, filePath, repositoryUrl, ref = '', path = '') {
        let lastError;
        const maxAttempts = this.maxUpsertRetries + 1;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try { return await this.qdrant.upsert(vector, { text: chunkText, source: filePath, path, repository: repositoryUrl, ref }); }
            catch (err) {
                if (!this.isRateLimitError(err)) throw err;
                lastError = err;
                const delayMs = Math.min(1000 * Math.pow(2, attempt), 8000);
                console.log(`[Sync] Rate limit hit for ${filePath}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxAttempts})`);
                await sleep(delayMs);
            }
        }

        throw lastError ?? new Error(`Upsert failed after ${maxAttempts} attempts: ${filePath}`);
    }

    /**
     * Returns true when the error indicates a Qdrant rate limit (HTTP 429 / "rate limited").
     *
     * @param {object} err - The error object
     * @returns {boolean}
     */
    isRateLimitError(err) {
        return (
            err?.status === 429 ||
            String(err?.message ?? '').toLowerCase().includes('rate limit') ||
            String(err?.message ?? '').toLowerCase().includes('too many requests')
        );
    }

    /**
     * Splits Markdown text recursively based on hierarchical separators.
     * @param {string} text - The text to split.
     * @param {number} maxSize - Maximum number of characters per chunk.
     * @param {string[]} [separators] - Optional list of separators.
     * @returns {string[]} An array of text chunks.
     */
    recursiveMarkdownSplitter(text, maxSize, separators) {
        const defaultSeparators = ["\n# ", "\n## ", "\n### ", "\n\n", "\n", " "];
        const seps = separators || defaultSeparators;

        // Basis-Fall: Text ist klein genug
        if (text.length <= maxSize) {
            return [text];
        }

        // Wenn keine Trennzeichen mehr übrig sind: Hart abschneiden
        if (seps.length === 0) {
            const chunks = [];
            for (let i = 0; i < text.length; i += maxSize) {
                chunks.push(text.slice(i, i + maxSize));
            }
            return chunks;
        }

        const currentSep = seps[0];
        const nextSeps = seps.slice(1);

        // Text am aktuellen Trennzeichen splitten
        const parts = text.split(currentSep);

        // Wenn das Trennzeichen nicht existiert, direkt die nächste Ebene versuchen
        if (parts.length === 1) {
            return this.recursiveMarkdownSplitter(text, maxSize, nextSeps);
        }

        const chunks = [];
        let currentChunk = "";

        for (let i = 0; i < parts.length; i++) {
            let part = parts[i];

            // Trennzeichen wieder einfügen (außer beim allerersten Element)
            const partWithSep = (currentChunk === "") ? part : currentSep + part;

            if ((currentChunk + partWithSep).length <= maxSize) {
                currentChunk += partWithSep;
            } else {
                if (currentChunk !== "") {
                    chunks.push(currentChunk);
                }

                // Wenn das Einzelteil immer noch zu groß ist, rekursiv tiefer gehen
                if (partWithSep.length > maxSize) {
                    // Wir übergeben das pure 'part' (ohne das große Trennzeichen) an die nächste Ebene
                    const subChunks = this.recursiveMarkdownSplitter(part, maxSize, nextSeps);
                    chunks.push(...subChunks);
                    currentChunk = "";
                } else {
                    currentChunk = part;
                }
            }
        }

        if (currentChunk !== "") {
            chunks.push(currentChunk);
        }

        return chunks;
    }

    /**
     * Splits raw file content into chunks of maximum size.
     * @param {string} content - The file content to split
     * @returns {string[]} Array of text chunks
     */
    chunkContent(content) {
        return this.recursiveMarkdownSplitter(content, this.qdrantChunkMaxSize);
    }
}

export { GiteaQdrantSync };
