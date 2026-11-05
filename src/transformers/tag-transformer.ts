/**
 * Navidrome MCP Server - Tag Data Transformers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { TagDTO } from '../types/index.js';
import { transformObjectRows } from './shared-transformers.js';

/** /api/tag returns albumCount and songCount only for genre, so other tag names need a backfill. */
export interface TagWithMeta {
  // Navidrome merges case variants into one row, and only a filter by its id matches every casing.
  id: string;
  tagName: string;
  tag: TagDTO;
  countsProvided: boolean;
  backfillFailed: boolean;
}

function transformToTagWithMeta(row: Record<string, unknown>): TagWithMeta {
  const albumCountRaw = row['albumCount'];
  const songCountRaw = row['songCount'];
  const countsProvided =
    (typeof albumCountRaw === 'number' && Number.isFinite(albumCountRaw)) ||
    (typeof songCountRaw === 'number' && Number.isFinite(songCountRaw));

  const idRaw = row['id'];
  const tagNameRaw = row['tagName'];
  const tagValueRaw = row['tagValue'];
  return {
    id: typeof idRaw === 'string' || typeof idRaw === 'number' ? String(idRaw) : '',
    tagName: typeof tagNameRaw === 'string' || typeof tagNameRaw === 'number' ? String(tagNameRaw) : '',
    tag: {
      tagValue: typeof tagValueRaw === 'string' || typeof tagValueRaw === 'number' ? String(tagValueRaw) : '',
      albumCount: Number(albumCountRaw) || 0,
      songCount: Number(songCountRaw) || 0,
    },
    countsProvided,
    backfillFailed: false,
  };
}

export function transformTagsToMeta(raw: unknown): TagWithMeta[] {
  if (!Array.isArray(raw)) {
    throw new Error('Expected array of tags from Navidrome');
  }
  return transformObjectRows(raw, transformToTagWithMeta);
}
