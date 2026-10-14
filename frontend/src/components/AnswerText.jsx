import { useState } from 'react';
import { parseThinking } from '../utils/parseThinking';
import MarkdownRenderer from './Markdown';

export default function AnswerText({ text }) {
  const { thinking, rest } = parseThinking(text);
  const [expanded, setExpanded] = useState(false);

  return (
    <span className="answer__text">
      {rest && <MarkdownRenderer text={rest} />}
      {thinking && (
        <>
          <button
            type="button"
            className={`thinking${expanded ? '--expanded' : ''}`}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            <span className="thinking__label">
              {expanded ? 'Denkblock zuklappen' : 'Denkblock anzeigen'}
            </span>
          </button>
          {expanded && (
            <div className="thinking__body" role="region">
              <MarkdownRenderer text={thinking} />
            </div>
          )}
        </>
      )}
    </span>
  );
}
