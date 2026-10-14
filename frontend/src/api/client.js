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
