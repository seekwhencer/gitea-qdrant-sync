export function parseThinking(text) {
  if (typeof text !== 'string') return { thinking: null, rest: '' };

  const openRe = /<think>[^]*?<\/think[^]*?>/i;
  const open = openRe.exec(text);
  if (!open) return { thinking: null, rest: text };

  const start = open.index;
  const end = open.index + open[0].length;

  const inner = open[0]
    .slice(open[0].indexOf('>') + 1)
    .replace(/<\/think[^]*?$/i, '')
    .trim();
  const rest = text.slice(0, start) + text.slice(end);

  return { thinking: inner || null, rest: rest.trim() };
}
