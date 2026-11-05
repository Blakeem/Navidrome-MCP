// One `held` flag covers both the wake lock and the video fallback, so a repeated acquire or a
// stray release does nothing.

/** The `media-src` directive of `CONTENT_SECURITY_POLICY` in src/webui/http-helpers.ts must permit this scheme. */
const WAKE_VIDEO_SCHEME = 'data:';

/** `navigator.wakeLock` needs a secure context, so a plain-http page plays this video instead.
 *  Chrome never moves a single-frame clip past HAVE_METADATA, so this clip has five frames. */
const WAKE_VIDEO_SRC = `${WAKE_VIDEO_SCHEME}video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMBbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAE4gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAlB0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAE4gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAACAAAAAgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAABOIAAAAAAABAAAAAAHIbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAABQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABc21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAATNzdGJsAAAAu3N0c2QAAAAAAAAAAQAAAKthdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAACAAIABIAAAASAAAAAAAAAABDExhdmMgbGlieDI2NAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAMWF2Y0MBZBAK/+EAFGdkEAqsuS2AiAAAAwAIAAADABAgAQAGaO4BlLIs/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAARgAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAFAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAABQAAAAEAAAAoc3RzegAAAAAAAAAAAAAABQAAAmgAAAAVAAAAFQAAABUAAAAVAAAAFHN0Y28AAAAAAAAAAQAAAzEAAAA9dWR0YQAAADVtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAAhpbHN0AAAACGZyZWUAAALEbWRhdAAAAlEGBf//TdxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MSBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTMzIG1lPXVtaCBzdWJtZT0xMCBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0wIG1lX3JhbmdlPTI0IGNocm9tYV9tZT0xIHRyZWxsaXM9MiA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MSBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjPWNyZiBtYnRyZWU9MCBjcmY9NTEuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAA9liIQEv/yD3Ao1LjjJn8EAAAARZYiCAc/+2QfApf2pQjl6n8AAAAARZYiEBz/+2QfApf2pQjl6n8EAAAARZYiCAc/+2QfApf2pQjl6n8AAAAARZYiEBz/+2QfApf2pQjl6n8E=`;

let held = false;
let generation = 0;
let sentinel = null;
let video = null;

export function bindWakeHold() {
  // The platform drops a wake lock whenever the page hides, and the same transition pauses
  // the fallback video, so a return to visible restarts both.
  document.addEventListener('visibilitychange', () => {
    if (!held || document.visibilityState !== 'visible') return;
    if (hasWakeLock()) {
      if (sentinel === null) void lockScreen();
      return;
    }
    if (video !== null && video.paused) {
      void video.play().catch(() => { /* the hold is lost, and unreportable */ });
    }
  });
  // pagehide rather than beforeunload, which iOS never fires.
  window.addEventListener('pagehide', releaseWakeHold);
}

export function acquireWakeHold() {
  if (held) return;
  held = true;
  generation += 1;
  if (hasWakeLock()) {
    void lockScreen();
    return;
  }
  startVideo();
}

export function releaseWakeHold() {
  if (!held) return;
  const granted = sentinel;
  held = false;
  generation += 1;
  sentinel = null;
  if (granted !== null) void granted.release().catch(() => { /* already gone */ });
  stopVideo();
}

function hasWakeLock() {
  return typeof navigator.wakeLock?.request === 'function';
}

// A request in flight can outlive the hold that started it, so a grant that returns to a later
// hold is released. An orphaned lock would keep the screen awake forever.
async function lockScreen() {
  const mine = generation;
  let granted = null;
  try {
    granted = await navigator.wakeLock.request('screen');
  } catch {
    // Refused by policy, or the page hid during the request. The reader has nothing to act on.
    return;
  }
  if (!held || generation !== mine || sentinel !== null) {
    void granted.release().catch(() => { /* nothing left to hold */ });
    return;
  }
  granted.addEventListener('release', () => {
    if (sentinel === granted) sentinel = null;
  });
  sentinel = granted;
}

function stopVideo() {
  if (video === null) return;
  video.pause();
  video.removeAttribute('src');
  video.remove();
  video = null;
}

function startVideo() {
  const el = document.createElement('video');
  el.loop = true;
  el.muted = true;
  el.playsInline = true;
  // iOS reads the markup attributes, not the properties, when it decides whether to allow autoplay.
  el.setAttribute('muted', '');
  el.setAttribute('playsinline', '');
  el.setAttribute('aria-hidden', 'true');
  el.tabIndex = -1;
  el.className = 'wake-video';
  el.src = WAKE_VIDEO_SRC;
  video = el;
  document.body.appendChild(el);
  el.play().catch(() => {
    // An autoplay refusal leaves no hold, rather than a paused element that holds nothing.
    if (video === el) stopVideo();
  });
}
