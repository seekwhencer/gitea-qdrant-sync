import { Qdrant } from './qdrant.js';
import { Llm } from './llm.js';

class Search {
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
}

export { Search };
