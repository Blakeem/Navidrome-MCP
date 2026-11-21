/**
 * Navidrome MCP Server - settings.json schema walks (coercion, unknown keys, salvage, prune)
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { z } from 'zod';

export type JsonObject = Record<string, unknown>;

/** A shape's fields are typed as core schemas, so the walkers take that type. */
type SchemaNode = z.core.$ZodType;

/** A wrong value in these keys could weaken the web remote's login, so they stay strict. */
const STRICT_PATHS: ReadonlySet<string> = new Set(['webui.auth']);

/** A bitrate reads naturally as a number, and no other text setting does, so a secret such as transport.authToken is never coerced. */
const TEXT_FROM_NUMBER_PATHS: ReadonlySet<string> = new Set(['playback.transcodeBitrate']);

/** An unknown key that a person tends to write for a known purpose gets the fix in place of a spelling suggestion. */
const UNKNOWN_KEY_FIXES: ReadonlyMap<string, string> = new Map([
  [
    'webui.auth.adminPassword',
    'webui.auth.adminPassword is not read from settings.json. Set the admin password on the settings page, then delete this key, since it holds the password as plain text.',
  ],
]);

const NUMERIC_TEXT = /^-?\d+(?:\.\d+)?$/;

const SUGGESTION_MAX_DISTANCE = 2;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function joinPath(parent: string, key: string): string {
  return parent === '' ? key : `${parent}.${key}`;
}

function unwrap(schema: SchemaNode): SchemaNode {
  let current = schema;
  while (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
    current = current.unwrap() as SchemaNode;
  }
  return current;
}

function ownField(shape: z.ZodRawShape, key: string): SchemaNode | undefined {
  return Object.hasOwn(shape, key) ? shape[key] : undefined;
}

/**
 * Turns an unambiguous slip into the type the schema wants, such as the text "8808" where a number
 * belongs, and names each coerced key. A value the schema accepts is never touched, so a file that
 * parsed before parses the same way.
 */
export function coerceSlips(schema: z.ZodObject, value: unknown): { value: unknown; notices: string[] } {
  const notices: string[] = [];
  const coerced = isJsonObject(value) ? coerceObject(schema.shape, value, '', notices) : value;
  return { value: coerced, notices };
}

function coerceObject(shape: z.ZodRawShape, value: JsonObject, path: string, notices: string[]): JsonObject {
  const out: JsonObject = { ...value };
  for (const key of Object.keys(value)) {
    const field = ownField(shape, key);
    const keyPath = joinPath(path, key);
    if (field === undefined || STRICT_PATHS.has(keyPath)) continue;
    out[key] = coerceValue(unwrap(field), value[key], keyPath, notices);
  }
  return out;
}

function coerceValue(schema: SchemaNode, value: unknown, path: string, notices: string[]): unknown {
  if (schema instanceof z.ZodObject && isJsonObject(value)) {
    return coerceObject(schema.shape, value, path, notices);
  }
  if (schema instanceof z.ZodArray && Array.isArray(value)) {
    const element = unwrap(schema.element as SchemaNode);
    return value.map((item: unknown) => coerceValue(element, item, path, notices));
  }
  if (schema instanceof z.ZodNumber && typeof value === 'string' && NUMERIC_TEXT.test(value.trim())) {
    const number = Number(value);
    notices.push(`${path} holds the text "${value}", so it is read as the number ${String(number)}. Remove the quotes to fix the file.`);
    return number;
  }
  if (schema instanceof z.ZodBoolean && (value === 'true' || value === 'false')) {
    notices.push(`${path} holds the text "${value}", so it is read as ${value}. Remove the quotes to fix the file.`);
    return value === 'true';
  }
  if (schema instanceof z.ZodString && TEXT_FROM_NUMBER_PATHS.has(path) && typeof value === 'number') {
    const text = String(value);
    notices.push(`${path} holds the number ${text}, so it is read as the text "${text}". Put the value in quotes to fix the file.`);
    return text;
  }
  return value;
}

/**
 * Names each key the schema does not know, with the nearest known sibling as a suggestion. A newer
 * build may have written the key, so the notice does not call it wrong.
 */
export function findUnknownKeys(schema: z.ZodObject, value: unknown): string[] {
  const notices: string[] = [];
  if (isJsonObject(value)) collectUnknownKeys(schema.shape, value, '', notices);
  return notices;
}

function collectUnknownKeys(shape: z.ZodRawShape, value: JsonObject, path: string, notices: string[]): void {
  for (const key of Object.keys(value)) {
    const keyPath = joinPath(path, key);
    const field = ownField(shape, key);
    if (field === undefined) {
      notices.push(UNKNOWN_KEY_FIXES.get(keyPath) ?? unknownKeyNotice(keyPath, path, nearestKey(key, Object.keys(shape))));
      continue;
    }
    const inner = unwrap(field);
    const child = value[key];
    if (inner instanceof z.ZodObject && isJsonObject(child)) collectUnknownKeys(inner.shape, child, keyPath, notices);
  }
}

function unknownKeyNotice(keyPath: string, parentPath: string, suggestion: string | null): string {
  const notice = `${keyPath} is not a setting this version knows.`;
  return suggestion === null ? notice : `${notice} Did you mean ${joinPath(parentPath, suggestion)}?`;
}

function nearestKey(key: string, knownKeys: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = SUGGESTION_MAX_DISTANCE + 1;
  for (const known of knownKeys) {
    const distance = editDistance(key.toLowerCase(), known.toLowerCase());
    if (distance < bestDistance) {
      best = known;
      bestDistance = distance;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/**
 * Keeps each known value that passes its own schema, so the settings page can still show the good
 * values of a file that fails as a whole. An unknown key is kept unchanged, since a newer build may
 * have written it. An object such as `playback.audioDevice` that fails after its bad fields are
 * dropped is left out entirely.
 */
export function salvageValidLeaves(schema: z.ZodObject, value: unknown): JsonObject {
  return isJsonObject(value) ? salvageObject(schema.shape, value) : {};
}

function salvageObject(shape: z.ZodRawShape, value: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    // Assigning __proto__ would replace the prototype instead of adding a key.
    if (key === '__proto__') continue;
    const field = ownField(shape, key);
    if (field === undefined) {
      out[key] = child;
      continue;
    }
    const inner = unwrap(field);
    const candidate = inner instanceof z.ZodObject && isJsonObject(child) ? salvageObject(inner.shape, child) : child;
    if (z.safeParse(field, candidate).success) out[key] = candidate;
  }
  return out;
}

/**
 * Drops each known key whose value is null, "", [] or an object left empty, when the schema lets the
 * key be absent. An unknown key is kept unchanged, since a newer build may give its empty value a meaning.
 */
export function pruneEmptyValues(schema: z.ZodObject, value: JsonObject): JsonObject {
  return pruneObject(schema.shape, value);
}

function pruneObject(shape: z.ZodRawShape, value: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    // Assigning __proto__ would replace the prototype instead of adding a key.
    if (key === '__proto__') continue;
    const field = ownField(shape, key);
    if (field === undefined) {
      out[key] = child;
      continue;
    }
    const inner = unwrap(field);
    const pruned = inner instanceof z.ZodObject && isJsonObject(child) ? pruneObject(inner.shape, child) : child;
    if (isEmptyValue(pruned) && z.safeParse(field, undefined).success) continue;
    out[key] = pruned;
  }
  return out;
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return isJsonObject(value) && Object.keys(value).length === 0;
}
