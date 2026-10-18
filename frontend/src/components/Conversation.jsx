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

function formatTs(ts) {
  if (ts == null) return '';
  return new Date(ts).toLocaleString('en-US');
}

export default function Conversation({ items, onSelect }) {
  if (!items || items.length === 0) {
    return <p className="conversation__empty">No questions yet.</p>;
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
  return (
    <li
      className={`conversation__item${item.error ? ' conversation__item--error' : ''}${item.pending ? ' conversation__item--pending' : ''}`}
      onClick={() => {
        if (onSelect) onSelect(item);
      }}
    >
      <div className="conversation__head">
        <h3 className="conversation__question">{item.question}</h3>
        <div className="conversation__head-trailing">
          {item.pending && (
            <span className="conversation__pending" aria-label="Search in progress">…</span>
          )}
          {item.ts != null && (
            <time
              className="conversation__time"
              dateTime={new Date(item.ts).toISOString()}
            >
              {formatTs(item.ts)}
            </time>
          )}
        </div>
      </div>
    </li>
  );
}
