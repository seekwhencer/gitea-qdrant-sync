class Router {
    constructor(sync, search, express) {
        this.sync = sync;
        this.search = search;

        this.router = express.Router();
        this.router.use(express.json());

        this.define();

        return this.router;
    }

    define() {
        
        //
        this.router.get('/health', (req, res) => {
            res.status(200).json({ status: 'ok' });
        });

        //
        this.router.post('/webhook', async (req, res) => {
            if (req.headers['x-gitea-event'] !== 'push') {
                return res.status(200).send('Ignored non-push event');
            }

            try {
                await this.sync.handlePushEvent(req.body);
                res.status(200).send('Sync completed successfully.');
            } catch (error) {
                console.error('Error processing webhook:', error);
                res.status(500).send('Internal Server Error');
            }
        });

        //
        this.router.post('/search', async (req, res) => {
            const question = req.body.question;
            if (!question) {
                return res.status(400).json({ error: 'Missing "question" in request body' });
            }

            try {
                const answer = await this.search.searchAndAnswer(question);
                if (answer === undefined) {
                    return res.status(404).json({ error: 'No answer found' });
                }
                res.status(200).json({ answer });
            } catch (error) {
                console.error('Error processing search:', error);
                res.status(500).send('Internal Server Error');
            }
        });
    }
}

export { Router };
