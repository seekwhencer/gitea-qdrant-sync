import { Qdrant } from './qdrant.js';
import { Llm } from './llm.js';

/**
 * Performs semantic search on vectors stored in Qdrant and generates LLM-based answers (RAG).
 */
class Search {
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
     * @param {number} [params.topK=20] - Number of returned results
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
        topK = 20
    } = {}) {
        this.qdrantCollection = qdrantCollection;
        this.topK = topK;
        this.qdrant = qdrant || new Qdrant({ url: qdrantUrl, port: qdrantPort, collection: qdrantCollection });
        this.llm = llm || new Llm({
            embeddingsApi, embeddingsUrl, embeddingsModel,
            chatApi, chatUrl, chatModel
        });
    }

    /**
     * Generates an embedding vector for the question, searches in Qdrant, and has the LLM generate an answer.
     * @param {string} question - The search query
     * @returns {Promise<string|undefined>} The generated answer or undefined
     */
    async searchAndAnswer(question) {
        try {
            console.log(`[Search] Generating embedding for: "${question}"...`);
            const queryVector = await this.llm.embed(question);

            console.log('[Search] query vector:', queryVector, this.topK);

            console.log('[Search] Searching in Qdrant...');
            const results = await this.qdrant.search(queryVector, this.topK);

            if (!results || results.length === 0) {
                console.log('[Search] No matching documents found.');
                return;
            }

            const contextTexts = results
                .map(item => item.payload?.text)
                .filter(Boolean);

            const context = contextTexts.join('\n\n---\n\n');

            console.log(`[Search] Found ${results.length} relevant documents. Generating answer...`);

            const messages = [
                {
                    role: 'system',
                    content: `You are a helpful research assistant. Answer the user's question precisely based solely on the following context:\n\n${context}`
                },
                {
                    role: 'user',
                    content: question
                }
            ];

            const answer = await this.llm.chat(messages);

            console.log('\n--- ANSWER ---');
            console.log(answer);
            console.log('---------------\n');

            return answer;
        } catch (err) {
            console.error('[Error]', err);
        }
    }

    /**
     * Streaming version of searchAndAnswer: yields status, thinking, and answer events.
     * @param {string} question - The search query
     * @param {object} [options] - Optional parameters
     * @param {AbortSignal} [options.signal] - AbortSignal to cancel the stream
     * @yields {object} Event objects with type ('status' | 'thinking' | 'answer' | 'empty' | 'done')
     */
    async *streamAndAnswer(question, { signal } = {}) {
        yield { type: 'status', phase: 'embedding', message: 'Embedding wird erzeugt…' };
        const queryVector = await this.llm.embed(question);

        yield { type: 'status', phase: 'search', message: 'Durchsuche Dokumente…' };
        const results = await this.qdrant.search(queryVector, this.topK);

        if (!results || results.length === 0) {
            yield { type: 'empty' };
            return;
        }

        const context = results
            .map(item => item.payload?.text)
            .filter(Boolean)
            .join('\n\n---\n\n');

        const messages = [
            {
                role: 'system',
                content: `You are a helpful research assistant. Answer the user's question precisely based solely on the following context:\n\n${context}`
            },
            {
                role: 'user',
                content: question
            }
        ];

        yield { type: 'status', phase: 'thinking', message: 'Modell denkt…' };
        for await (const { phase, token } of this.llm.streamChat(messages, { signal })) {
            yield { type: phase, token };
        }
        yield { type: 'done' };
    }

    /**
     * Performs semantic search in Qdrant and returns raw results with metadata.
     * @param {string} question - The search query
     * @returns {Promise<Array<{text: string, score: number, metadata: object}>>} Array of results
     */
    async searchAndReturnChunks(question) {
        try {
            console.log(`[Search] Generating embedding for: "${question}"...`);
            const queryVector = await this.llm.embed(question);

            console.log('[Search] Searching in Qdrant...');
            const results = await this.qdrant.search(queryVector, this.topK);

            if (!results || results.length === 0) {
                console.log('[Search] No matching documents found.');
                return [];
            }

            const chunks = results.map(item => ({
                text: item.payload?.text || '',
                score: item.score || 0,
                metadata: {
                    repository: item.payload?.repository || '',
                    path: item.payload?.path || '',
                    ref: item.payload?.ref || '',
                    commit: item.payload?.commit || ''
                }
            }));

            console.log(`[Search] Found ${chunks.length} relevant documents.`);
            return chunks;
        } catch (err) {
            console.error('[Error]', err);
            return [];
        }
    }
}

export { Search };
