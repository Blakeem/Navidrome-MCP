// Per-device preferences in localStorage. Storage throws where site data is blocked,
// so a failed read returns null and a failed write keeps the choice for this page only.

export function prefRead(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function prefWrite(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Nothing to recover and nothing worth telling the reader.
  }
}

export function prefRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing stored is the outcome either way.
  }
}

export function readStoredInt(key, min, max) {
  const parsed = Number.parseInt(prefRead(key) ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}
