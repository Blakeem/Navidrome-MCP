import { byId, setHidden } from './dom.js';

// The snapshot never carries a device id or name, so the banner names no device.
const OUTPUT_LOST_TEXT = 'The audio output is not connected. Turn it on, or pick another output.';

// The `code` a play or resume answer carries when no audio output is connected (OUTPUT_MISSING_CODE in src/tools).
const OUTPUT_MISSING_CODE = 'output-missing';

// The lyrics overlay inerts the main view, so it carries its own copy of the banner.
const banners = [byId('output-banner'), byId('lyrics-output-banner')];

export function bindOutputBanner(onPick) {
  for (const banner of banners) {
    banner.querySelector('.output-banner-text').textContent = OUTPUT_LOST_TEXT;
    banner.querySelector('.output-banner-btn').addEventListener('click', onPick);
  }
}

export function renderOutputBanner(lost) {
  for (const banner of banners) setHidden(banner, !lost);
}

// A hidden or inert button ignores focus(), so the banner of the view the viewer is in takes it.
function focusOutputBanner() {
  for (const banner of banners) {
    const button = banner.querySelector('.output-banner-btn');
    button.focus({ preventScroll: true });
    if (document.activeElement === button) return;
  }
}

export function isOutputMissing(data) {
  return data?.code === OUTPUT_MISSING_CODE;
}

// An answer that says the output is missing shows the banner at once, without waiting for a snapshot.
export function revealOutputBanner() {
  renderOutputBanner(true);
  focusOutputBanner();
}
