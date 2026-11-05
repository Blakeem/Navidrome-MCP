// The Jukebox dialog. The server keeps the code, so the dialog shows the live QR again on every open.

import { getJson, postJson } from './api.js';
import { byId, setHidden } from './dom.js';
import { formatDateTime } from './time-format.js';

// Music Assistant caps its guest links at 7 days, so a longer lifetime earns a warning.
const LONG_LIFETIME_HOURS = 7 * 24;
const QR_FILE_PREFIX = 'jukebox-qr';
const INTERNET_LABEL = 'Internet';
const NO_LAN_ADDRESS = 'No local network address was found. Pick Internet, or connect this computer to the network.';
const CLOSE_CONFIRM = 'Close the jukebox? Every guest is signed out and the code stops working.';

const openBtn = byId('open-jukebox');
const dialog = byId('jukebox-dialog');
const message = byId('jukebox-message');
const lifetimeField = byId('jukebox-lifetime-field');
const lifetime = byId('jukebox-lifetime');
const lifetimeWarn = byId('jukebox-lifetime-warn');
const closedState = byId('jukebox-closed');
const closedLifetimeSlot = byId('jukebox-closed-lifetime');
const openJukeboxBtn = byId('jukebox-open');
const openState = byId('jukebox-open-state');
const shareSwitch = byId('jukebox-share');
const shareLan = byId('jukebox-share-lan');
const shareInternet = byId('jukebox-share-internet');
const qr = byId('jukebox-qr');
const urlText = byId('jukebox-url');
const lanSelect = byId('jukebox-lan-select');
const status = byId('jukebox-status');
const fullscreenBtn = byId('jukebox-fullscreen-btn');
const copyBtn = byId('jukebox-copy');
const copyLabel = byId('jukebox-copy-label');
const downloadBtn = byId('jukebox-download');
const newBtn = byId('jukebox-new');
const closeBtn = byId('jukebox-close');
const newConfirm = byId('jukebox-new-confirm');
const newLifetimeSlot = byId('jukebox-new-lifetime');
const signOut = byId('jukebox-signout');
const newMakeBtn = byId('jukebox-new-make');
const newCancelBtn = byId('jukebox-new-cancel');
const fullscreen = byId('jukebox-fullscreen');
const fullscreenQr = byId('jukebox-fullscreen-qr');

let view = null;
let shareLink = 'lan';

export function bindJukebox() {
  openBtn.addEventListener('click', () => {
    message.textContent = '';
    closeNewConfirm();
    void refresh();
    dialog.showModal();
  });
  lifetime.addEventListener('change', renderLifetimeWarning);
  openJukeboxBtn.addEventListener('click', () => void makeCode(false));
  shareLan.addEventListener('change', () => void saveShareLink('lan'));
  shareInternet.addEventListener('change', () => void saveShareLink('internet'));
  lanSelect.addEventListener('change', renderLink);
  fullscreenBtn.addEventListener('click', openFullscreen);
  copyBtn.addEventListener('click', () => void copyLink());
  downloadBtn.addEventListener('click', downloadQr);
  newBtn.addEventListener('click', openNewConfirm);
  newCancelBtn.addEventListener('click', closeNewConfirm);
  newMakeBtn.addEventListener('click', () => void makeCode(signOut.checked));
  closeBtn.addEventListener('click', () => void closeJukebox());
  fullscreen.addEventListener('click', () => fullscreen.close());
  renderLifetimeWarning();
}

export function showJukeboxButton() {
  setHidden(openBtn, false);
}

/**
 * Makes a new code for the "Open for" lifetime chosen here. The Guests dialog's ban calls it with
 * `signOutGuests` false. Resolves null on success, or the reason it failed.
 */
export async function makeNewCode(signOutGuests) {
  const { ok, data } = await postJson('/api/jukebox/key', { lifetimeHours: Number(lifetime.value), signOutGuests });
  if (!ok) return data?.error ?? 'The jukebox code was not made. Check the connection and try again.';
  view = data;
  return null;
}

async function refresh() {
  const [code, settings] = await Promise.all([getJson('/api/jukebox/code'), getJson('/api/jukebox/settings')]);
  if (settings !== null) shareLink = settings.shareLink;
  view = code;
  render();
}

function render() {
  const active = view?.active === true;
  if (view === null) message.textContent = 'Could not load the jukebox. Check the connection and try again.';
  setHidden(closedState, view === null || active);
  setHidden(openState, !active);
  if (!active) {
    closedLifetimeSlot.append(lifetimeField);
    return;
  }
  status.textContent = `Open until ${formatDateTime(view.expiresAt)}. ${guestCountText(view.guestCount)}`;
  setHidden(shareSwitch, view.links.internet === null);
  renderShareSwitch();
  renderLanSelect(view.links.lan);
  renderLink();
}

function renderShareSwitch() {
  shareLan.checked = shareLink !== 'internet';
  shareInternet.checked = shareLink === 'internet';
}

function guestCountText(count) {
  return count === 1 ? '1 guest.' : `${count} guests.`;
}

function renderLanSelect(lan) {
  const kept = lanSelect.value;
  lanSelect.replaceChildren(...lan.map((link, index) => new Option(link.label, String(index))));
  if (lan.some((_link, index) => String(index) === kept)) lanSelect.value = kept;
}

// The internet link applies only when one exists, so a removed public URL falls back to the LAN links.
function chosenLink() {
  const { lan, internet } = view.links;
  if (shareLink === 'internet' && internet !== null) return { label: INTERNET_LABEL, ...internet };
  return lan[Number(lanSelect.value)] ?? lan[0] ?? null;
}

function renderLink() {
  const link = chosenLink();
  const showsLan = link !== null && link.label !== INTERNET_LABEL;
  setHidden(lanSelect, !showsLan || view.links.lan.length < 2);
  setHidden(qr, link === null);
  setHidden(copyBtn, link === null || !navigator.clipboard);
  copyLabel.textContent = 'Copy link';
  fullscreenBtn.disabled = link === null;
  downloadBtn.disabled = link === null;
  if (link === null) {
    urlText.textContent = view.problem ?? NO_LAN_ADDRESS;
    return;
  }
  qr.src = qrDataUrl(link);
  qr.alt = `QR code for the ${link.label} join link`;
  urlText.textContent = link.url;
}

// The SVG comes from the server's QR encoder, and a data URL keeps it inside the img-src policy.
function qrDataUrl(link) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(link.qrSvg)}`;
}

// A failed save puts the switch and QR back on the server's choice, so the dialog never shows an unsaved link.
async function saveShareLink(link) {
  const previous = shareLink;
  shareLink = link;
  renderLink();
  const { ok, data } = await postJson('/api/jukebox/settings', { shareLink: link });
  if (!ok) {
    shareLink = previous;
    renderShareSwitch();
    renderLink();
    message.textContent = data?.error ?? 'The link choice was not saved. Check the connection and try again.';
    return;
  }
  message.textContent = data.persisted ? '' : 'The link choice holds until the player restarts. settings.json was not written.';
}

function renderLifetimeWarning() {
  setHidden(lifetimeWarn, Number(lifetime.value) <= LONG_LIFETIME_HOURS);
}

function openNewConfirm() {
  signOut.checked = false;
  newLifetimeSlot.append(lifetimeField);
  setHidden(newConfirm, false);
  newBtn.disabled = true;
}

function closeNewConfirm() {
  setHidden(newConfirm, true);
  newBtn.disabled = false;
}

async function makeCode(signOutGuests) {
  openJukeboxBtn.disabled = true;
  newMakeBtn.disabled = true;
  message.textContent = '';
  const error = await makeNewCode(signOutGuests);
  openJukeboxBtn.disabled = false;
  newMakeBtn.disabled = false;
  if (error !== null) {
    message.textContent = error;
    return;
  }
  closeNewConfirm();
  render();
}

async function closeJukebox() {
  if (!window.confirm(CLOSE_CONFIRM)) return;
  closeBtn.disabled = true;
  const { ok, data } = await postJson('/api/jukebox/key/revoke');
  closeBtn.disabled = false;
  if (!ok) {
    message.textContent = data?.error ?? 'The jukebox did not close. Try again.';
    return;
  }
  message.textContent = 'The jukebox closed. Every guest was signed out.';
  closeNewConfirm();
  await refresh();
}

function openFullscreen() {
  const link = chosenLink();
  if (link === null) return;
  fullscreenQr.src = qrDataUrl(link);
  fullscreenQr.alt = qr.alt;
  fullscreen.showModal();
}

async function copyLink() {
  const link = chosenLink();
  if (link === null) return;
  try {
    await navigator.clipboard.writeText(link.url);
    copyLabel.textContent = 'Copied';
  } catch {
    copyLabel.textContent = 'Copy failed';
  }
}

function downloadQr() {
  const link = chosenLink();
  if (link === null) return;
  const anchor = document.createElement('a');
  anchor.href = qrDataUrl(link);
  anchor.download = qrFileName(link.label);
  anchor.click();
}

// The label names the file, so a host who saves several codes can tell the internet one apart.
function qrFileName(label) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug === '' ? `${QR_FILE_PREFIX}.svg` : `${QR_FILE_PREFIX}-${slug}.svg`;
}
