import { useState } from 'react';
import AnswerText from './AnswerText';
import ThinkBlock from './ThinkBlock';

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

function formatTs(ts) {
  if (ts == null) return '';
  return new Date(ts).toLocaleString('de-DE');
}

export default function Conversation({ items, onSelect }) {
  if (!items || items.length === 0) {
    return <p className="conversation__empty">Noch keine Fragen.</p>;
  }

  return (
    <ul className="conversation">
      {items.map((item) => (
        <HistoryItem key={item.id} item={item} onSelect={onSelect} />
      ))}
    </ul>
  );
}

function HistoryItem({ item, onSelect }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li
          className={`conversation__item${item.error ? ' conversation__item--error' : ''}${expanded ? ' conversation__item--expanded' : ''}`}
      onClick={() => {
        setExpanded((v) => !v);
        if (onSelect) onSelect(item);
      }}
    >
      <div className="conversation__head">
        <h3 className="conversation__question">{item.question}</h3>
        <div className="conversation__head-trailing">
          {item.ts != null && (
            <time
              className="conversation__time"
              dateTime={new Date(item.ts).toISOString()}
            >
              {formatTs(item.ts)}
            </time>
          )}
          <span
            className="conversation__toggle"
            aria-hidden="true"
          />
        </div>
      </div>
      {expanded && (
        item.error ? (
          <p className="conversation__error">{errorMessage(item.error)}</p>
        ) : (
          <div className="conversation__answer">
            {item.thinking && <ThinkBlock content={item.thinking} />}
            <AnswerText text={item.answer} />
          </div>
        )
      )}
    </li>
  );
}
