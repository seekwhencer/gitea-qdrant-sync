import { useCallback, useState } from 'react';

const STORAGE_KEY = 'gitea-search:history';
const MAX_ITEMS = 20;

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch (_) {}
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

function loadInitial() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

export function useConversation() {
  const [items, setItems] = useState(loadInitial);

  const add = useCallback(({ question, answer, thinking, error, ts }) => {
    setItems((prev) => {
      const next = [
        {
          id: makeId(),
          question,
          answer: answer ?? null,
          thinking: thinking ?? null,
          error: error ?? null,
          ts: ts ?? Date.now(),
        },
        ...prev,
      ].slice(0, MAX_ITEMS);

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (_) {}

      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }, []);

  return { items, add, clear };
}
