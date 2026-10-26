// The signed-in and banned sections of the Guests dialog. Every nickname is guest input, so it
// renders through textContent only.

import { getJson, postJson } from './api.js';
import { buildIcon, byId, setHidden, SYMBOL_VIEWBOX } from './dom.js';
import { formatDateTime } from './time-format.js';

const ADDRESS_CLASS_LABELS = { loopback: 'this computer', lan: 'local network', public: 'internet' };
const DEFAULT_NETWORK_BAN_HOURS = '24';
const ICON_REMOVE = 'M640-520v-80h240v80H640Zm-280 40q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM40-160v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q66 0 130 15.5T616-378q29 15 46.5 43.5T680-272v112H40Zm80-80h480v-32q0-11-5.5-20T580-306q-54-27-109-40.5T360-360q-56 0-111 13.5T140-306q-9 5-14.5 14t-5.5 20v32Zm240-320q33 0 56.5-23.5T440-640q0-33-23.5-56.5T360-720q-33 0-56.5 23.5T280-640q0 33 23.5 56.5T360-560Zm0-80Zm0 400Z';
const ICON_BAN = 'M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q54 0 104-17.5t92-50.5L228-676q-33 42-50.5 92T160-480q0 134 93 227t227 93Zm252-124q33-42 50.5-92T800-480q0-134-93-227t-227-93q-54 0-104 17.5T284-732l448 448Z';
const ICON_UNBAN = 'M240-160h480v-400H240v400Zm240-120q33 0 56.5-23.5T560-360q0-33-23.5-56.5T480-440q-33 0-56.5 23.5T400-360q0 33 23.5 56.5T480-280ZM240-160v-400 400Zm0 80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h280v-80q0-83 58.5-141.5T720-920q83 0 141.5 58.5T920-720h-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80h120q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Z';

const guestStatus = byId('guest-list-status');
const guestList = byId('guest-list');
const guestMessage = byId('guest-message');
const banPanel = byId('guest-ban');
const banTitle = byId('guest-ban-title');
const banHours = byId('guest-ban-hours');
const banWarn = byId('guest-ban-warn');
const banRotate = byId('guest-ban-rotate');
const banConfirm = byId('guest-ban-confirm');
const banCancel = byId('guest-ban-cancel');
const banStatus = byId('ban-list-status');
const banList = byId('ban-list');
const banMessage = byId('ban-message');

let banTarget = null;
let rotateCode = async () => null;
let onChange = async () => {};

// `rotate` makes a new jukebox code that keeps the other guests and resolves null, or the reason it
// failed. `changed` reloads the dialog.
export function bindGuestList({ rotate, changed }) {
  rotateCode = rotate;
  onChange = changed;
  banConfirm.addEventListener('click', () => void confirmBan());
  banCancel.addEventListener('click', closeBanPanel);
}

export function resetGuests() {
  guestMessage.textContent = '';
  banMessage.textContent = '';
  closeBanPanel();
}

export async function refreshGuests() {
  const [guests, bans] = await Promise.all([getJson('/api/jukebox/guests'), getJson('/api/jukebox/bans')]);
  renderGuests(guests?.guests ?? null);
  renderBans(bans?.bans ?? null);
}

function displayName(entry) {
  return entry.nickname === null ? entry.label : `${entry.label} (${entry.nickname})`;
}

function renderGuests(guests) {
  if (guests === null) guestStatus.textContent = 'Could not load the guests.';
  else guestStatus.textContent = guests.length === 0 ? 'No guest is signed in.' : '';
  guestList.replaceChildren(...(guests ?? []).map(buildGuestRow));
  if (banTarget !== null && !(guests ?? []).some((guest) => guest.sessionId === banTarget.sessionId)) closeBanPanel();
}

function buildGuestRow(guest) {
  const li = document.createElement('li');
  const info = document.createElement('div');
  const head = document.createElement('span');
  const dot = document.createElement('span');
  const name = document.createElement('strong');
  const details = document.createElement('span');
  const actions = document.createElement('div');

  dot.className = guest.online ? 'guest-dot is-online' : 'guest-dot';
  dot.title = guest.online ? 'Online' : 'Offline';
  dot.setAttribute('role', 'img');
  dot.setAttribute('aria-label', dot.title);
  name.textContent = displayName(guest);
  head.className = 'guest-head';
  head.append(dot, name);
  details.className = 'modal-hint';
  details.textContent = `Joined ${formatDateTime(guest.joinedAt)} · ${guest.networkKey} (${ADDRESS_CLASS_LABELS[guest.addressClass] ?? guest.addressClass})`;
  info.className = 'guest-info';
  info.append(head, details, buildSongs(guest.songs));
  actions.className = 'guest-row-actions';
  actions.append(
    buildButton('Remove', ICON_REMOVE, 'btn-secondary small', (event) => void removeGuest(guest, event.currentTarget)),
    buildButton('Ban', ICON_BAN, 'btn-secondary small danger', () => openBanPanel(guest)),
  );
  li.append(info, actions);
  return li;
}

function buildSongs(songs) {
  if (songs.length === 0) {
    const none = document.createElement('span');
    none.className = 'modal-hint';
    none.textContent = 'No songs waiting';
    return none;
  }
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const list = document.createElement('ul');
  summary.className = 'modal-hint';
  summary.textContent = songs.length === 1 ? '1 song waiting' : `${songs.length} songs waiting`;
  list.className = 'guest-songs';
  for (const song of songs) {
    const item = document.createElement('li');
    item.textContent = song.artist === null ? (song.title ?? 'Unknown song') : `${song.title ?? 'Unknown song'} · ${song.artist}`;
    list.appendChild(item);
  }
  details.append(summary, list);
  return details;
}

function buildButton(text, iconPath, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.append(buildIcon('', iconPath, SYMBOL_VIEWBOX), text);
  button.addEventListener('click', onClick);
  return button;
}

async function removeGuest(guest, button) {
  guestMessage.textContent = '';
  button.disabled = true;
  const { ok, data } = await postJson('/api/jukebox/guests/remove', { sessionId: guest.sessionId });
  guestMessage.textContent = ok
    ? `${displayName(guest)} was signed out. Their songs stay queued, and the jukebox code lets them join again.`
    : (data?.error ?? 'The guest was not signed out. Try again.');
  await onChange();
  button.disabled = false;
}

// No network ban blocks this computer, so the server refuses a network ban on a loopback guest.
function openBanPanel(guest) {
  const loopback = guest.addressClass === 'loopback';
  banTarget = guest;
  banTitle.textContent = `Ban ${displayName(guest)}? They are signed out and their waiting songs leave the queue. Their browser stays blocked until the jukebox closes, but a private window or another device gets around it.`;
  banHours.value = loopback ? '0' : DEFAULT_NETWORK_BAN_HOURS;
  banHours.disabled = loopback;
  banRotate.checked = false;
  banWarn.textContent = loopback
    ? 'This guest connects from this computer, which a network ban never blocks.'
    : sharedWarnings(guest).join(' ');
  setHidden(banWarn, banWarn.textContent === '');
  setHidden(banPanel, false);
  guestMessage.textContent = '';
}

function sharedWarnings(guest) {
  const warnings = [];
  if (guest.sharedCount > 0) {
    const others = guest.sharedCount === 1 ? '1 other guest shares' : `${guest.sharedCount} other guests share`;
    warnings.push(`${others} this address, so a network ban blocks them too.`);
  }
  if (guest.adminShares) warnings.push('An admin device shares this address, so a network ban blocks it too.');
  return warnings;
}

function closeBanPanel() {
  banTarget = null;
  setHidden(banPanel, true);
}

async function confirmBan() {
  if (banTarget === null) return;
  const guest = banTarget;
  const rotate = banRotate.checked;
  banConfirm.disabled = true;
  const { ok, data } = await postJson('/api/jukebox/guests/ban', { sessionId: guest.sessionId, networkBanHours: Number(banHours.value) });
  banConfirm.disabled = false;
  if (!ok) {
    guestMessage.textContent = data?.error ?? 'The guest was not banned. Try again.';
    return;
  }
  closeBanPanel();
  const banned = banResultMessage(guest, data.songsRemoved, data.songsStayed);
  const rotateError = rotate ? await rotateCode() : null;
  guestMessage.textContent = rotateError === null ? banned : `${banned} ${rotateError}`;
  await onChange();
}

function songCount(count) {
  return count === 1 ? '1 song' : `${count} songs`;
}

function banResultMessage(guest, songsRemoved, songsStayed) {
  if (songsRemoved === null) return `${displayName(guest)} was banned, but their songs could not be removed from the queue.`;
  const removed = `${displayName(guest)} was banned, and ${songCount(songsRemoved)} left the queue.`;
  return songsStayed > 0 ? `${removed} ${songCount(songsStayed)} stayed, since no player is running.` : removed;
}

function renderBans(bans) {
  if (bans === null) banStatus.textContent = 'Could not load the bans.';
  else banStatus.textContent = bans.length === 0 ? 'No one is banned.' : '';
  banList.replaceChildren(...(bans ?? []).map(buildBanRow));
}

function buildBanRow(ban) {
  const li = document.createElement('li');
  const info = document.createElement('div');
  const name = document.createElement('strong');
  const details = document.createElement('span');
  const actions = document.createElement('div');

  name.textContent = displayName(ban);
  details.className = 'modal-hint';
  details.textContent = ban.kind === 'network'
    ? `Network ${ban.networkKey} blocked until ${formatDateTime(ban.expiresAt)}`
    : `Browser blocked until ${formatDateTime(ban.expiresAt)}, when the jukebox code expires`;
  info.className = 'guest-info';
  info.append(name, details);
  actions.className = 'guest-row-actions';
  actions.appendChild(buildButton('Unban', ICON_UNBAN, 'btn-secondary small', (event) => void liftBan(ban, event.currentTarget)));
  li.append(info, actions);
  return li;
}

async function liftBan(ban, button) {
  button.disabled = true;
  const { ok, data } = await postJson('/api/jukebox/bans/remove', { banId: ban.id });
  banMessage.textContent = ok ? liftedMessage(ban) : (data?.error ?? 'The ban was not lifted. Try again.');
  await onChange();
  button.disabled = false;
}

function liftedMessage(ban) {
  return ban.kind === 'network'
    ? `The network ban on ${displayName(ban)} was lifted.`
    : `The ban on ${displayName(ban)} was lifted, so their browser can join again.`;
}
