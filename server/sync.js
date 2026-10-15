import { Qdrant } from './qdrant.js';
import { Llm } from './llm.js';
import { Gitea } from './gitea.js';

/**
 * Orchestrates synchronization of Gitea repository files to Qdrant.
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
        this.gitea = new Gitea({ url: giteaApiUrl, token: giteaToken });
        this.qdrant = qdrant || new Qdrant({ url: qdrantUrl, port: qdrantPort, collection: qdrantCollection });
        this.llm = llm || new Llm({
            embeddingsApi, embeddingsUrl, embeddingsModel,
            chatApi, chatUrl, chatModel
        });
    }

    /**
     * Processes a Gitea push webhook: extracts changed Markdown files and synchronizes them.
     * @param {object} payload - Webhook payload
     * @returns {Promise<void>}
     */
    async handlePushEvent(payload) {
        const repository = payload.repository;
        console.log(`[Webhook] Push received for repository: ${repository.html_url}`);

        const changedFiles = this.gitea.collectMarkdownFiles(payload.commits || []);

        for (const filePath of changedFiles) {
            try {
                await this.syncFile(payload, filePath);
            } catch (error) {
                console.error(`[Sync] Error processing file ${filePath}:`, error);
                throw error;
            }
        }
    }

    /**
     * Fully synchronizes all Markdown files of a repository with Qdrant.
     * @param {string} owner - Repository owner
     * @param {string} name - Repository name
     * @param {string} [ref='main'] - Git ref/branch/commit
     * @returns {Promise<void>}
     */
    async syncRepository(owner, name, ref = 'main') {
        console.log(`[Sync] Starting full sync for ${owner}/${name} (ref: ${ref})`);

        const markdownFiles = await this.gitea.listFiles(owner, name, ref);
        console.log(`[Sync] Found ${markdownFiles.length} Markdown files in ${owner}/${name}`);

        const payload = {
            repository: { html_url: `https://${this.gitea.url.replace(/\/api\/v1$/, '')}/${owner}/${name}` },
            after: ref
        };

        for (const filePath of markdownFiles) {
            try {
                await this.syncFile(payload, filePath);
            } catch (error) {
                console.error(`[Sync] Error processing file ${filePath}:`, error);
            }
        }

        console.log(`[Sync] Repository ${owner}/${name} synced with ${markdownFiles.length} files.`);
    }

    /**
     * Synchronizes a single file: loads content, splits into chunks, creates embeddings, and stores in Qdrant.
     * @param {object} payload - Webhook payload with repository information
     * @param {string} filePath - Path of the file to synchronize
     * @returns {Promise<void>}
     */
    async syncFile(payload, filePath) {
        console.log(`Processing file: ${filePath}`);

        const content = await this.gitea.fetchFile(payload.repository, filePath, payload.after);
        const chunks = this.chunkContent(content);

        await this.qdrant.deleteBySource(filePath);

        for (const chunkText of chunks) {
            const vector = await this.llm.embed(chunkText);
            await this.qdrant.upsert(vector, chunkText, filePath, payload.repository.html_url);
        }
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
