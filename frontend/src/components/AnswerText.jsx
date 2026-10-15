import { parseThinking } from '../utils/parseThinking';
import ThinkBlock from './ThinkBlock';
import MarkdownRenderer from './Markdown';

export default function AnswerText({ text }) {
  const { thinking, rest } = parseThinking(text);

  return (
    <span className="answer__text">
      {rest && <MarkdownRenderer text={rest} />}
      {thinking && <ThinkBlock content={thinking} />}
    </span>
  );
}
