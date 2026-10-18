import SearchBar from './components/SearchBar';
import ReSyncButton from './components/ReSyncButton';
import StreamingResults from './components/StreamingResults';
import Conversation from './components/Conversation';
import { useSearchStream } from './hooks/useSearch';
import { useConversation } from './hooks/useConversation';

export default function App() {
  const { thinking, answer, question, statusMessage, pending, error, done, run, setResult } = useSearchStream();
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

  const handleSelect = (item) => {
    setResult({
      thinking: item.thinking || '',
      answer: item.answer || '',
      error: item.error || null,
      question: item.question || '',
    });
  };

  return (
    <main className="main__container">
      <h1>Gitea Markdown Search RAG</h1>
      <ReSyncButton />
      <div className="app__layout">
        <section className="app__secondary">
          <div className="app__history-header">
            <h2 className="app__history-title">History</h2>
            {items.length > 0 && (
              <button
                className="app__clear"
                type="button"
                onClick={() => clear()}
              >
                Clear history
              </button>
            )}
          </div>
          <Conversation items={items} onSelect={handleSelect} />
        </section>
        <section className="app__primary">
          <SearchBar onSubmit={handleSubmit} pending={pending} />
          <StreamingResults
            thinking={thinking}
            answer={answer}
            question={question}
            statusMessage={statusMessage}
            pending={pending}
            error={error}
            done={done}
          />
        </section>
      </div>
    </main>
  );
}
