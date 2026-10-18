import axios from 'axios';
import { createHash } from 'node:crypto';

/**
 * LLM service for generating embeddings and chat completions via Ollama or OpenAI-compatible APIs.
 */
class Llm {
    /**
     * @param {object} [params] - Configuration parameters
     * @param {string} [params.embeddingsApi='ollama'] - Embedding API backend
     * @param {string} [params.embeddingsUrl=''] - Embedding server base URL
     * @param {string} [params.embeddingsModel=''] - Embedding model name
     * @param {string} [params.chatApi='ollama'] - Chat API backend
     * @param {string} [params.chatUrl=''] - Chat server base URL
     * @param {string} [params.chatModel=''] - Chat model name
     * @param {Logger} [params.logger] - Logger instance
     */
    constructor({
        embeddingsApi = 'ollama',
        embeddingsUrl = '',
        embeddingsModel = '',
        chatApi = 'ollama',
        chatUrl = '',
        chatModel = '',
        logger
    } = {}) {
        this.embeddingsConfig = {
            api: (embeddingsApi === 'openai') ? 'openai' : 'ollama',
            baseUrl: this.normalizeUrl(embeddingsUrl),
            modelName: embeddingsModel
        };
        this.chatConfig = {
            api: (chatApi === 'openai') ? 'openai' : 'ollama',
            baseUrl: this.normalizeUrl(chatUrl),
            modelName: chatModel
        };

        // Cache for embeddings keyed by SHA-256 of the chunk text.
        // Avoids redundant LLM calls when identical chunks are re-synced within a session/process.
        this._embeddingCache = new Map();
        this.label = '[Embed]';
        this.logger = logger || { log: () => {}, error: () => {} };
    }

    /**
     * Normalizes a URL by stripping trailing slashes.
     * @param {string} url - The URL to normalize
     * @returns {string}
     */
    normalizeUrl(url) {
        return String(url || '').replace(/\/+$/, '');
    }

    /**
     * Generates an embedding vector for the given text.
     * @param {string} text - The text to embed
     * @returns {Promise<number[]>} The embedding vector
     */
    async embed(text) {
        // Return cached embedding for identical chunk text, avoiding redundant LLM calls.
        const key = createHash('sha256').update(String(text)).digest('hex');
        if (this._embeddingCache.has(key)) return this._embeddingCache.get(key);

        let vector;

        try {
            const cfg = this.embeddingsConfig;
            const base = this.normalizeUrl(cfg.baseUrl);

            if (cfg.api === 'openai') {
                const res = await axios.post(`${base}/embeddings`, {
                    model: cfg.modelName,
                    input: text
                });
                const body = res.data;
                if (Array.isArray(body.data)) {
                    vector = body.data[0].embedding;
                } else {
                    throw new Error('Unrecognized OpenAI embedding response shape');
                }
            } else {
                const res = await axios.post(`${base}/api/embed`, {
                    model: cfg.modelName,
                    input: text
                });
                const body = res.data;
                if (Array.isArray(body.embeddings)) {
                    vector = body.embeddings[0];
                } else if (Array.isArray(body.embedding)) {
                    vector = body.embedding;
                } else {
                    throw new Error('Unrecognized Ollama embedding response shape');
                }
            }

            if (vector === undefined) {
                throw new Error('Unrecognized embedding response shape');
            }

            this._embeddingCache.set(key, vector);
            return vector;
        } catch (error) {
            this.logger.error(this.label,`Failed to generate embedding for chunk:`, error);
            throw error;
        }
    }

    /**
     * Sends a chat request and returns the full response text.
     * @param {Array<object>} messages - Array of chat messages
     * @param {object} [options={}] - Additional options (e.g. model, temperature)
     * @returns {Promise<string>} The assistant's response text
     */
    async chat(messages, options = {}) {
        const cfg = this.chatConfig;
        const base = this.normalizeUrl(cfg.baseUrl);

        if (cfg.api === 'openai') {
            const res = await axios.post(`${base}/chat/completions`, {
                model: options.model || cfg.modelName,
                messages: messages,
                ...options
            });

            this.logger.log(this.label, 'CHOICES', res.data.choices);

            return res.data.choices[0].message.content;
        }

        const res = await axios.post(`${base}/api/chat`, {
            model: options.model || cfg.modelName,
            messages: messages,
            stream: false,
            ...options
        });
        return res.data.message.content;
    }

    /**
     * Parses an SSE (Server-Sent Events) stream into yielded JSON objects.
     * @param {ReadableStreamDefaultReader} body - The response body reader
     * @yields {object} Parsed JSON chunks
     * @private
     */
    async *_readSSE(body) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let idx;
                while ((idx = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + 1);
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]' || !trimmed.startsWith('data:')) continue;
                    const payload = trimmed.slice(5).trim();
                    if (payload === '') continue;
                    try { yield JSON.parse(payload); } catch {}
                }
            }
            const tail = decoder.decode();
            if (tail.trim() && tail.trim() !== 'data: [DONE]') {
                try { yield JSON.parse(tail.trim()); } catch {}
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Parses an NDJSON stream into yielded JSON objects.
     * @param {ReadableStreamDefaultReader} body - The response body reader
     * @yields {object} Parsed JSON chunks
     * @private
     */
    async *_readNDJSON(body) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let idx;
                while ((idx = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, idx).trim();
                    buffer = buffer.slice(idx + 1);
                    if (line === '') continue;
                    try { yield JSON.parse(line); } catch {}
                }
            }
            const tail = buffer.trim();
            if (tail) {
                try { yield JSON.parse(tail); } catch {}
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Streams chat completions and yields raw chunk objects.
     * @param {Array<object>} messages - Array of chat messages
     * @param {object} [options={}] - Additional options
     * @yields {object} Raw streaming chunks
     */
    async *streamChunks(messages, options = {}) {
        const cfg = this.chatConfig;
        const base = this.normalizeUrl(cfg.baseUrl);

        if (cfg.api === 'openai') {
            const res = await fetch(`${base}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: options.model || cfg.modelName,
                    messages,
                    stream: true,
                    ...options
                })
            });
            if (!res.ok || !res.body) throw new Error(`Chat-Streaming fehlgeschlagen: ${res.status}`);
            yield* this._readSSE(res.body);
        } else {
            const res = await fetch(`${base}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: options.model || cfg.modelName,
                    messages,
                    stream: true,
                    ...options
                })
            });
            if (!res.ok || !res.body) throw new Error(`Chat-Streaming fehlgeschlagen: ${res.status}`);
            yield* this._readNDJSON(res.body);
        }
    }

    /**
     * Streams chat completions and yields structured { phase, token } objects.
     * @param {Array<object>} messages - Array of chat messages
     * @param {object} [options={}] - Additional options
     * @yields {object} Objects with phase ('thinking' | 'answer') and token
     */
    async *streamChat(messages, options = {}) {
        for await (const chunk of this.streamChunks(messages, options)) {
            if (this.chatConfig.api === 'openai') {
                const delta = chunk.choices?.[0]?.delta || {};
                const reasoning = delta.reasoning_content ?? delta.thinking ?? '';
                if (reasoning) yield { phase: 'thinking', token: reasoning };
                if (delta.content) yield { phase: 'answer', token: delta.content };
            } else {
                const msg = chunk.message || {};
                const reasoning = chunk.thinking ?? msg.thinking ?? '';
                if (reasoning) yield { phase: 'thinking', token: reasoning };
                if (msg.content) yield { phase: 'answer', token: msg.content };
            }
        }
    }
}

export { Llm };
