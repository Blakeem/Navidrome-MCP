// Every request resolves instead of rejecting and logs its own failure,
// so a caller branches on one value.

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

// A failed answer keeps its body, so the caller can show the server's error text.
export function getJsonResult(url) {
  return requestJson(url);
}

// The server rejects a POST without a JSON Content-Type, so a bodyless control sends `{}`.
export function postJson(path, body = {}) {
  return requestJson(path, body);
}

// A body makes the request a JSON POST. It is serialized inside the try, so an
// unserializable body resolves too.
async function requestJson(url, body) {
  try {
    const init = body === undefined
      ? undefined
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const res = await fetch(url, init);
    const text = await res.text().catch(() => '');
    if (!res.ok) console.warn(`webui: ${url} failed`, res.status, text);
    return { ok: res.ok, data: parseJson(text) };
  } catch (err) {
    console.warn(`webui: ${url} failed`, err);
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
