import SearchBar from './components/SearchBar';
import SearchResults from './components/SearchResults';
import Conversation from './components/Conversation';
import { useSearch } from './hooks/useSearch';
import { useConversation } from './hooks/useConversation';

export default function App() {
  const { mutate, isPending, isError, error, data } = useSearch();
  const { items, add, clear } = useConversation();

  const handleSubmit = (question) => {
    mutate(question, {
      onSuccess: (result) =>
        add({ question, answer: result.answer, error: null, ts: Date.now() }),
      onError: (err) => add({ question, answer: null, error: err, ts: Date.now() }),
    });
  };

  return (
    <main className="main__container">
      <h1>Gitea Markdown Search RAG</h1>
      <div className="app__layout">
        <section className="app__primary">
          <SearchBar onSubmit={handleSubmit} pending={isPending} />
          <SearchResults answer={data?.answer} error={error} pending={isPending} />
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
