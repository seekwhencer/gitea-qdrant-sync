const THINKING_RE = /<think>([\s\S]*?)</think>/gi;

export function splitAnswer(text) {
  if (!text) return [];

  const segments = [];
  let lastIndex = 0;
  let match;

  THINKING_RE.lastIndex = 0;
  while ((match = THINKING_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const content = text.slice(lastIndex, match.index).trim();
      if (content) segments.push({ type: 'text', content });
    }

    const inner = (match[1] ?? '').trim();
    segments.push({ type: 'thinking', content: inner });
    lastIndex = THINKING_RE.lastIndex;
  }

  const tail = text.slice(lastIndex).trim();
  if (tail) segments.push({ type: 'text', content: tail });

  return segments;
}
