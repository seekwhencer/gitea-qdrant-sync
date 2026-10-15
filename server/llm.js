import axios from 'axios';

class Llm {
    constructor({
        embeddingsApi = 'ollama',
        embeddingsUrl = '',
        embeddingsModel = '',
        chatApi = 'ollama',
        chatUrl = '',
        chatModel = ''
    } = {}) {
        this.embeddingsConfig = {
            api: (embeddingsApi === 'openapi') ? 'openapi' : 'ollama',
            baseUrl: this.normalizeUrl(embeddingsUrl),
            modelName: embeddingsModel
        };
        this.chatConfig = {
            api: (chatApi === 'openapi') ? 'openapi' : 'ollama',
            baseUrl: this.normalizeUrl(chatUrl),
            modelName: chatModel
        };
    }

    normalizeUrl(url) {
        return String(url || '').replace(/\/+$/, '');
    }

    async embed(text) {
        const cfg = this.embeddingsConfig;
        const base = this.normalizeUrl(cfg.baseUrl);

        if (cfg.api === 'openapi') {
            const res = await axios.post(`${base}/embeddings`, {
                model: cfg.modelName,
                input: text
            });
            const body = res.data;
            if (Array.isArray(body.data)) {
                return body.data[0].embedding;
            }
            throw new Error('Unrecognized OpenAI embedding response shape');
        }

        const res = await axios.post(`${base}/api/embed`, {
            model: cfg.modelName,
            input: text
        });
        const body = res.data;
        if (Array.isArray(body.embeddings)) return body.embeddings[0];
        if (Array.isArray(body.embedding)) return body.embedding;
        throw new Error('Unrecognized Ollama embedding response shape');
    }

    async chat(messages, options = {}) {
        const cfg = this.chatConfig;
        const base = this.normalizeUrl(cfg.baseUrl);

        if (cfg.api === 'openapi') {
            const res = await axios.post(`${base}/chat/completions`, {
                model: options.model || cfg.modelName,
                messages: messages,
                ...options
            });
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

    async *streamChunks(messages, options = {}) {
        const cfg = this.chatConfig;
        const base = this.normalizeUrl(cfg.baseUrl);

        if (cfg.api === 'openapi') {
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

    async *streamChat(messages, options = {}) {
        for await (const chunk of this.streamChunks(messages, options)) {
            if (this.chatConfig.api === 'openapi') {
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
