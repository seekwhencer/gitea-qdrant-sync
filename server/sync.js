import { Qdrant } from './qdrant.js';
import { Llm } from './llm.js';
import { Gitea } from './gitea.js';

class GiteaQdrantSync {
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
     * Splittet Markdown-Text rekursiv anhand von hierarchischen Trennzeichen.
     * @param {string} text - Der zu splittende Text.
     * @param {number} maxSize - Maximale Zeichenanzahl pro Chunk.
     * @param {string[]} [separators] - Optionale Liste von Trennzeichen.
     * @returns {string[]} Ein Array von Text-Chunks.
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

    chunkContent(content) {
        return this.recursiveMarkdownSplitter(content, this.qdrantChunkMaxSize);
    }
}

export { GiteaQdrantSync };
