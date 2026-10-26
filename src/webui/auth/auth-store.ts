/**
 * Navidrome MCP Server - Web remote auth store (webui-auth-<port>.json)
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { writePrivateFileAtomic } from '../../config/store.js';
import { getSettingsStorePath } from '../../config/store-path.js';
import { logger } from '../../utils/logger.js';

const sessionFields = {
  id: z.string().min(1),
  secretDigest: z.string().min(1),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  expiresAt: z.number(),
  csrfToken: z.string().min(1),
  lastAddress: z.string(),
};

const AdminSessionSchema = z.object({
  ...sessionFields,
  role: z.literal('admin'),
  credentialEpoch: z.string().min(1),
});

/** A session or ban stored before device cookies existed has no device id, so it reads as null. */
const DeviceIdSchema = z.string().min(1).nullable().default(null);

const GuestSessionSchema = z.object({
  ...sessionFields,
  role: z.literal('guest'),
  keyId: z.string().min(1),
  label: z.string().min(1),
  nickname: z.string().nullable(),
  deviceId: DeviceIdSchema,
});

const SessionRecordSchema = z.discriminatedUnion('role', [AdminSessionSchema, GuestSessionSchema]);

/**
 * `secret` is the raw key, kept so the admin can show the QR again. A join compares `digest` in
 * constant time. `lastGuestNumber` numbers the guest labels.
 */
const JukeboxCodeSchema = z.object({
  id: z.string().min(1),
  secret: z.string().min(1),
  digest: z.string().min(1),
  createdAt: z.number(),
  expiresAt: z.number(),
  lastGuestNumber: z.number().int().min(0),
});

/**
 * A `guest` ban refuses a join from the browser whose device cookie holds `deviceId`. It lasts while
 * the jukebox stays open, so a new code moves its expiry and closing the jukebox ends it. A `network`
 * ban refuses every request from a source whose `networkKey` matches, and its `deviceId` is null.
 */
const BanSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['guest', 'network']),
  label: z.string().min(1),
  nickname: z.string().nullable(),
  networkKey: z.string().min(1),
  deviceId: DeviceIdSchema,
  createdAt: z.number(),
  expiresAt: z.number(),
});

/**
 * A file written before jukebox codes or bans existed lacks those fields, so it reads as none. A code
 * record that fails validation, such as one stored before `secret` existed, reads as closed, so the
 * admin sessions and network bans survive. The guests and their guest bans end with the code.
 */
const AuthFileSchema = z.object({
  version: z.literal(1),
  sessions: z.array(SessionRecordSchema),
  envAdminHash: z.string().nullable(),
  jukeboxCode: JukeboxCodeSchema.nullable().default(null).catch(null),
  bans: z.array(BanSchema).default([]),
});

export type AdminSession = z.infer<typeof AdminSessionSchema>;
export type GuestSession = z.infer<typeof GuestSessionSchema>;
export type SessionRecord = z.infer<typeof SessionRecordSchema>;
export type JukeboxCode = z.infer<typeof JukeboxCodeSchema>;
export type Ban = z.infer<typeof BanSchema>;
export type AuthFile = z.infer<typeof AuthFileSchema>;
type AuthFileInput = z.input<typeof AuthFileSchema>;

function emptyAuthFile(): AuthFile {
  return { version: 1, sessions: [], envAdminHash: null, jukeboxCode: null, bans: [] };
}

/**
 * Beside settings.json, so `NAVIDROME_CONFIG_PATH` moves both and a container keeps both on one volume.
 * The port owner owns the file, so two players on one config directory never overwrite each other.
 */
export function getAuthStorePath(port: number): string {
  return join(dirname(getSettingsStorePath()), `webui-auth-${String(port)}.json`);
}

/** `droppedJukeboxCode` is true when the file held a code record that failed validation and reads as null. */
interface AuthFileRead {
  file: AuthFile;
  droppedJukeboxCode: boolean;
}

/** A lost file costs only the open sessions, the jukebox code and the bans, so every failure starts empty instead of stopping the player. */
export function readAuthFileWithStatus(port: number): AuthFileRead {
  const path = getAuthStorePath(port);
  const empty: AuthFileRead = { file: emptyAuthFile(), droppedJukeboxCode: false };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') logger.warn(`webui: ${path} is unreadable (${code ?? String(err)}), so every session starts signed out`);
    return empty;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    logger.warn(`webui: ${path} is not valid JSON, so every session starts signed out`);
    return empty;
  }
  const result = AuthFileSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn(`webui: ${path} failed validation, so every session starts signed out`);
    return empty;
  }
  const storedCode: unknown = (parsed as { jukeboxCode?: unknown }).jukeboxCode;
  const droppedJukeboxCode = storedCode !== undefined && storedCode !== null && result.data.jukeboxCode === null;
  return { file: result.data, droppedJukeboxCode };
}

export function readAuthFile(port: number): AuthFile {
  return readAuthFileWithStatus(port).file;
}

export function writeAuthFile(port: number, file: AuthFileInput): void {
  writePrivateFileAtomic(getAuthStorePath(port), `${JSON.stringify(file, null, 2)}\n`);
}
