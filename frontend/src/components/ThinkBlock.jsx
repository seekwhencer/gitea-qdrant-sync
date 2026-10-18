import { useState } from 'react';
import MarkdownRenderer from './Markdown';

export default function ThinkBlock({ content }) {
  const [expanded, setExpanded] = useState(false);
  if (!content) return null;

  return (
    <>
      <button
        type="button"
        className={`thinking ${expanded ? 'thinking--expanded' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
      >
        <span className="thinking__label">
          {expanded ? 'hide thinking ' : 'show thinking'}
        </span>
      </button>
      {expanded && (
        <div className="thinking__body" role="region">
          <MarkdownRenderer text={content} />
        </div>
      )}
    </>
  );
}
