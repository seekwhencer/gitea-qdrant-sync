import { useState } from 'react';
import SearchBar from './components/SearchBar';
import ReSyncButton from './components/ReSyncButton';
import StreamingResults from './components/StreamingResults';
import Conversation from './components/Conversation';
import { useSearchStream } from './hooks/useSearch';
import { useConversation } from './hooks/useConversation';

export default function App() {
  const { thinking, answer, question, statusMessage, pending, error, done, run } = useSearchStream();
  const { items, add, update, clear } = useConversation();
  const [activeItemId, setActiveItemId] = useState(null);
  const [currentSearchItemId, setCurrentSearchItemId] = useState(null);

  const handleSubmit = async (question) => {
    const id = add({
      question,
      answer: null,
      thinking: null,
      error: null,
      ts: Date.now(),
      pending: true,
    });
    setCurrentSearchItemId(id);
    setActiveItemId(null);

    const result = await run(question);

    update(id, {
      answer: result.answer ?? null,
      thinking: result.thinking ?? null,
      error: result.error ? result.error.message : null,
      pending: false,
    });
    setCurrentSearchItemId(null);
  };

  const handleSelect = (item) => {
    setActiveItemId(item.id === currentSearchItemId ? null : item.id);
  };

  const activeItem = activeItemId ? items.find((i) => i.id === activeItemId) : null;
  const isLive = !activeItemId;

  return (
    <main className="main__container">
      <header className="app__header">
        <h1>Gitea Markdown Search RAG</h1>
        <ReSyncButton />
      </header>
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
          {/* activeItemId === null => show the live running search; otherwise show the selected history item */}
          <StreamingResults
            thinking={isLive ? thinking : (activeItem?.thinking || '')}
            answer={isLive ? answer : (activeItem?.answer || '')}
            question={isLive ? question : (activeItem?.question || '')}
            statusMessage={isLive ? statusMessage : ''}
            pending={isLive ? pending : false}
            error={isLive ? error : (activeItem?.error || null)}
            done={isLive ? done : true}
          />
        </section>
      </div>
    </main>
  );
}
