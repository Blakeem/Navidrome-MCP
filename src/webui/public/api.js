// Both requests resolve instead of rejecting and log their own failure, so a caller branches on one value.

export async function getJson(url) {
  try {
    const res = await fetch(url);
    if (res.ok) return await res.json();
    const text = await res.text().catch(() => '');
    console.warn(`webui: ${url} failed`, res.status, text);
  } catch (err) {
    console.warn(`webui: ${url} failed`, err);
  }
  return null;
}

// The server rejects a POST without a JSON Content-Type, so a bodyless control sends `{}`.
// `data` is the parsed response body, or null when the body is not JSON.
export async function postJson(path, body = {}) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) console.warn(`webui: ${path} failed`, res.status, text);
    return { ok: res.ok, data: parseJson(text) };
  } catch (err) {
    console.warn(`webui: ${path} failed`, err);
    return { ok: false, data: null };
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
