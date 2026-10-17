import SearchBar from './components/SearchBar';
import ReSyncButton from './components/ReSyncButton';
import StreamingResults from './components/StreamingResults';
import Conversation from './components/Conversation';
import { useSearchStream } from './hooks/useSearch';
import { useConversation } from './hooks/useConversation';

export default function App() {
  const { thinking, answer, statusMessage, pending, error, done, run } = useSearchStream();
  const { items, add, clear } = useConversation();

  const handleSubmit = async (question) => {
    const result = await run(question);
    add({
      question,
      answer: result.answer || null,
      thinking: result.thinking || null,
      error: result.error ? result.error.message : null,
      ts: Date.now(),
    });
  };

  return (
    <main className="main__container">
      <h1>Gitea Markdown Search RAG</h1>
      <ReSyncButton />
      <div className="app__layout">
        <section className="app__primary">
          <SearchBar onSubmit={handleSubmit} pending={pending} />
          <StreamingResults
            thinking={thinking}
            answer={answer}
            statusMessage={statusMessage}
            pending={pending}
            error={error}
            done={done}
          />
        </section>
        <section className="app__secondary">
          <div className="app__history-header">
            <h2 className="app__history-title">Verlauf</h2>
            {items.length > 0 && (
              <button
                className="app__clear"
                type="button"
                onClick={() => clear()}
              >
                Verlauf löschen
              </button>
            )}
          </div>
          <Conversation items={items} />
        </section>
      </div>
    </main>
  );
}
