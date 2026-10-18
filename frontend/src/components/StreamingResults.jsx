import ThinkBlock from './ThinkBlock';
import MarkdownRenderer from './Markdown';

const ERROR_MESSAGES = {
  400: 'Please enter a question.',
  404: 'No matching documents found.',
  500: 'Server error, please try again.'
};

function errorMessage(error) {
  if (error && (error.name === 'NetworkError' || error.status === 0)) {
    return 'Connection to server failed.';
  }
  if (error && ERROR_MESSAGES[error.status] !== undefined) {
    return ERROR_MESSAGES[error.status];
  }
  return error ? error.message : '';
}

export default function StreamingResults({ thinking, answer, question, statusMessage, pending, error, done }) {
  if (error) {
    let severity = 'other';
    if (error.name === 'NetworkError' || error.status === 0) severity = 'connection';
    else if (error.status === 400) severity = 'validation';
    else if (error.status === 404) severity = 'not-found';
    else if (error.status === 500) severity = 'server';

    return (
      <section
        className={`search-results search-results--error search-results--${severity}`}
        aria-live="polite"
      >
        <p className="search-results__error">{errorMessage(error)}</p>
      </section>
    );
  }

  const streaming = pending && !done;

  if (streaming && !thinking && !answer) {
    return (
      <section className="search-results search-results--loading" aria-live="polite">
        {question && <p className="search-results__question">{question}</p>}
        <div className="search-results__loading-flex">
          <span className="spinner" role="status" aria-hidden="true" />
          <p className="search-results__loading">{statusMessage || 'Search in progress…'}</p>
        </div>
        <div className="skeleton">
          <span className="skeleton__line skeleton__line--short" />
          <span className="skeleton__line" />
          <span className="skeleton__line skeleton__line--long" />
        </div>
      </section>
    );
  }

  if (done && !thinking && !answer && !error) {
    return (
      <section className="search-results search-results--empty" aria-live="polite">
        <p className="search-results__empty">No matching documents found.</p>
      </section>
    );
  }

  return (
    <section className="search-results search-results--success" aria-live="polite">
      <h2 className="search-results__title">Result</h2>
      {question && <p className="search-results__question">{question}</p>}
      <div className="search-results__answer">
        {thinking && <ThinkBlock content={thinking} />}
        {answer ? (
          <MarkdownRenderer text={answer} />
        ) : streaming ? (
          <span className="answer__cursor" aria-hidden="true" />
        ) : null}
      </div>
    </section>
  );
}
