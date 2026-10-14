import { useState } from 'react';

export default function SearchBar({ onSubmit, pending }) {
  const [question, setQuestion] = useState('');

  function submit() {
    const value = question.trim();
    if (!value) return;
    onSubmit(value);
    setQuestion('');
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form className="search-bar" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <input
        className="search-bar__input"
        type="text"
        value={question}
        placeholder="Ask a question about the docs…"
        aria-label="Question"
        disabled={pending}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button className="search-bar__button" type="submit" disabled={pending}>
        {pending ? 'Searching…' : 'Search'}
      </button>
    </form>
  );
}
