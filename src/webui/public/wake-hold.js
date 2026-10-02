// Holds the device screen awake while the lyrics move. One `held` flag decides for both paths,
// so a repeated acquire or a stray release does nothing.

/** The fallback video's source scheme. The CSP `media-src` directive has to permit exactly this. */
const WAKE_VIDEO_SCHEME = 'data:';

/** Five seconds of 32x32 black H.264, five frames, looped. Playing video is the only lever a plain-http
 *  origin has, because `navigator.wakeLock` exists only in a secure context. A single-frame clip never
 *  leaves HAVE_METADATA in Chrome, so its clock never runs and nothing is held. */
const WAKE_VIDEO_SRC = `${WAKE_VIDEO_SCHEME}video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMBbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAE4gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAlB0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAE4gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAACAAAAAgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAABOIAAAAAAABAAAAAAHIbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAABQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABc21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAATNzdGJsAAAAu3N0c2QAAAAAAAAAAQAAAKthdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAACAAIABIAAAASAAAAAAAAAABDExhdmMgbGlieDI2NAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAMWF2Y0MBZBAK/+EAFGdkEAqsuS2AiAAAAwAIAAADABAgAQAGaO4BlLIs/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAARgAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAFAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAABQAAAAEAAAAoc3RzegAAAAAAAAAAAAAABQAAAmgAAAAVAAAAFQAAABUAAAAVAAAAFHN0Y28AAAAAAAAAAQAAAzEAAAA9dWR0YQAAADVtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAAhpbHN0AAAACGZyZWUAAALEbWRhdAAAAlEGBf//TdxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MSBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTMzIG1lPXVtaCBzdWJtZT0xMCBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0wIG1lX3JhbmdlPTI0IGNocm9tYV9tZT0xIHRyZWxsaXM9MiA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MSBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjPWNyZiBtYnRyZWU9MCBjcmY9NTEuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAA9liIQEv/yD3Ao1LjjJn8EAAAARZYiCAc/+2QfApf2pQjl6n8AAAAARZYiEBz/+2QfApf2pQjl6n8EAAAARZYiCAc/+2QfApf2pQjl6n8AAAAARZYiEBz/+2QfApf2pQjl6n8E=`;

let held = false;
let generation = 0;
let sentinel = null;
let video = null;

export function bindWakeHold() {
  // The platform drops a wake lock whenever the page hides, and the same transition pauses
  // the fallback video, so coming back re-arms both.
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

// A request in flight outlives the hold that started it, so the grant is stamped with that hold
// and discarded when it returns to a later one. An orphaned lock would keep the screen awake forever.
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
  // The platform drops the lock whenever the page hides, and visibilitychange asks for a fresh one.
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
  // iOS reads the markup attributes, not the properties, when it decides whether an autoplay is permitted.
  el.setAttribute('muted', '');
  el.setAttribute('playsinline', '');
  el.setAttribute('aria-hidden', 'true');
  el.tabIndex = -1;
  // Laid out but invisible, since a video the layout drops stops counting as playing video.
  el.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  el.src = WAKE_VIDEO_SRC;
  video = el;
  document.body.appendChild(el);
  el.play().catch(() => {
    // An autoplay refusal leaves no hold, rather than a paused element that holds nothing.
    if (video === el) stopVideo();
  });
}
