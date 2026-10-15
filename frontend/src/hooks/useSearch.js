import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { search, searchStream } from '../api/search';

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

export function useSearch() {
  return useMutation({ mutationFn: search });
}

export function useSearchStream() {
  const [thinking, setThinking] = useState('');
  const [answer, setAnswer] = useState('');
  const [phase, setPhase] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const run = useCallback(async (question) => {
    let serverThinking = '';
    let extractedThinking = '';
    let answerPrefix = '';
    let answerSuffix = '';
    let buffer = '';
    let inThink = false;
    let thinkClosed = false;
    let err = null;

    const flush = () => {
      setThinking(serverThinking + extractedThinking);
      setAnswer(answerPrefix + answerSuffix);
    };

    setThinking('');
    setAnswer('');
    setPhase('searching');
    setStatusMessage('Suche läuft…');
    setError(null);
    setPending(true);
    setDone(false);

    try {
      for await (const { event, data } of searchStream(question)) {
        if (event === 'thinking') {
          serverThinking += data;
          flush();
        } else if (event === 'answer') {
          buffer += data;

          if (!thinkClosed) {
            if (!inThink) {
              const openIdx = buffer.indexOf(OPEN_TAG);
              if (openIdx !== -1) {
                answerPrefix += buffer.slice(0, openIdx);
                buffer = buffer.slice(openIdx + OPEN_TAG.length);
                inThink = true;
              } else {
                const keep = OPEN_TAG.length - 1;
                if (buffer.length > keep) {
                  answerPrefix += buffer.slice(0, buffer.length - keep);
                  buffer = buffer.slice(buffer.length - keep);
                }
              }
            } else {
              const closeIdx = buffer.indexOf(CLOSE_TAG);
              if (closeIdx !== -1) {
                extractedThinking += buffer.slice(0, closeIdx);
                buffer = buffer.slice(closeIdx + CLOSE_TAG.length);
                inThink = false;
                thinkClosed = true;
                answerSuffix += buffer;
                buffer = '';
              } else {
                const keep = CLOSE_TAG.length - 1;
                if (buffer.length > keep) {
                  extractedThinking += buffer.slice(0, buffer.length - keep);
                  buffer = buffer.slice(buffer.length - keep);
                }
              }
            }
          } else {
            answerSuffix += buffer;
            buffer = '';
          }

          flush();
        } else if (event === 'status') { setPhase(data.phase); setStatusMessage(data.message); }
        else if (event === 'empty') { setPhase(null); setStatusMessage(''); setDone(true); setPending(false); }
        else if (event === 'done') { setDone(true); setPending(false); flush(); }
        else if (event === 'error') throw new Error(data.message || 'Streaming fehlgeschlagen.');
      }
    } catch (e) {
      err = e;
      setError(e);
      setPending(false);
      setDone(true);
    }

    return { thinking: serverThinking + extractedThinking, answer: answerPrefix + answerSuffix, error: err };
  }, []);

  return { thinking, answer, phase, statusMessage, pending, error, done, run };
}
