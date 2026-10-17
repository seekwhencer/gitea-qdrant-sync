const BASE = import.meta.env.VITE_API_BASE || '';

async function request(path, options) {
  let res;
  try {
    res = await fetch(BASE + path, options);
  } catch {
    throw Object.assign(new Error('Verbindung zum Server fehlgeschlagen.'), { name: 'NetworkError', status: 0 });
  }

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.error === 'string') message = body.error;
    } catch (_) {}

    const err = new Error(message);
    err.status = res.status;
    err.response = res;
    throw err;
  }

  return res;
}

export async function getHealth() {
  const res = await request('/health', { method: 'GET' });
  const data = await res.json();
  return data.status;
}

export async function search(question) {
  const res = await request('/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question })
  });
  const data = await res.json();
  return { answer: data.answer };
}

export async function syncAll() {
  const res = await request('/sync-all', { method: 'POST' });
  return res.json();
}

export async function* searchStream(question) {
  let res;
  try {
    res = await fetch(BASE + '/search/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
  } catch {
    throw Object.assign(new Error('Verbindung zum Server fehlgeschlagen.'), { name: 'NetworkError', status: 0 });
  }

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.error === 'string') message = body.error;
    } catch (_) {}

    const err = new Error(message);
    err.status = res.status;
    err.response = res;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        let event = '';
        const dataLines = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^\s*/, ''));
        }
        if (!event) continue;

        const dataStr = dataLines.join('\n');
        let data;
        try { data = JSON.parse(dataStr); } catch { data = dataStr; }
        yield { event, data };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
