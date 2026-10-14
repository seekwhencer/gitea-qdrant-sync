import AnswerText from './AnswerText';

const ERROR_MESSAGES = {
  400: 'Bitte gib eine Frage ein.',
  404: 'Keine passenden gefundenen Dokumente.',
  500: 'Serverfehler, bitte erneut versuchen.'
};

function errorMessage(error) {
  if (error && (error.name === 'NetworkError' || error.status === 0)) {
    return 'Verbindung zum Server fehlgeschlagen.';
  }
  if (error && ERROR_MESSAGES[error.status] !== undefined) {
    return ERROR_MESSAGES[error.status];
  }
  return error ? error.message : '';
}

export default function SearchResults({ answer, error, pending }) {
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

  if (pending && !answer) {
    return (
      <section className="search-results search-results--loading" aria-live="polite">
        <span className="spinner" role="status" aria-hidden="true" />
        <p className="search-results__loading">Suche läuft…</p>
        <div className="skeleton">
          <span className="skeleton__line skeleton__line--short" />
          <span className="skeleton__line" />
          <span className="skeleton__line skeleton__line--long" />
        </div>
      </section>
    );
  }

  if (!answer) {
    return (
      <section className="search-results search-results--empty" aria-live="polite">
        <p className="search-results__empty">Noch keine Suche – gib oben eine Frage ein.</p>
      </section>
    );
  }

  return (
    <section className="search-results search-results--success" aria-live="polite">
      <h2 className="search-results__title">Ergebnis</h2>
      <div className="search-results__answer">
        <AnswerText text={answer} />
      </div>
    </section>
  );
}
