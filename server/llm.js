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
}

export { Llm };
