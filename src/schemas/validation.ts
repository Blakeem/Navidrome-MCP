/**
 * Navidrome MCP Server - Validation Schema Definitions
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { z } from 'zod';
import {
  DEFAULT_VALUES,
  GUEST_QUEUE_LIMIT_MAX,
  GUEST_QUEUE_LIMIT_MIN,
  JUKEBOX_CODE_MAX_LIFETIME_HOURS,
  JUKEBOX_SHARE_LINKS,
  WEBUI_THEMES,
} from '../constants/defaults.js';
import {
  MAX_VALIDATION_TIMEOUT_MS,
  MIN_VALIDATION_TIMEOUT_MS,
  SINGLE_VALIDATION_TIMEOUT_MS,
} from '../constants/timeouts.js';
import { isHttpUrlScheme } from '../utils/network-safety.js';
import {
  AlbumIdSchema,
  EnhancedSearchSchema,
  IdStringSchema,
  ItemTypeSchema,
  RatingSchema,
  OptionalBooleanSchema,
  VerboseSchema,
  createLimitSchema,
  ID_PATTERN,
  NonEmptyIdArraySchema,
  OffsetSchema,
  OrderSchema,
  PlaylistIdSchema,
  SEARCH_QUERY_MAX_LENGTH,
  SearchAlbumsSchema,
  SearchSongsSchema,
  SongIdSchema,
} from './common.js';

export const StarItemSchema = z.object({
  itemId: IdStringSchema,
  type: ItemTypeSchema,
});

export const SetRatingSchema = z.object({
  itemId: IdStringSchema,
  type: ItemTypeSchema,
  rating: RatingSchema,
});

// Navidrome stores a whitespace-only name as given, which lists as a blank playlist.
const PlaylistNameSchema = z.string().trim().min(1, 'Playlist name is required');

export const CreatePlaylistSchema = z.object({
  name: PlaylistNameSchema,
  comment: z.string().optional(),
  public: OptionalBooleanSchema.default(false),
});

export const UpdatePlaylistSchema = PlaylistIdSchema.extend({
  name: PlaylistNameSchema.optional(),
  comment: z.string().optional(),
  public: OptionalBooleanSchema,
}).superRefine((val, ctx) => {
  // Navidrome stores an empty PUT body as a blank name and comment.
  if (val.name === undefined && val.comment === undefined && val.public === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one of name, comment, or public must be provided',
    });
  }
});

export const AddTracksToPlaylistSchema = PlaylistIdSchema.extend({
  songIds: z.array(IdStringSchema).optional(),
  albumIds: z.array(IdStringSchema).optional(),
  artistIds: z.array(IdStringSchema).optional(),
  discs: z.array(z.object({
    albumId: AlbumIdSchema.shape.albumId,
    discNumber: z.number().int().min(1),
  })).optional(),
}).superRefine((val, ctx) => {
  const hasContent =
    (val.songIds?.length ?? 0) > 0 ||
    (val.albumIds?.length ?? 0) > 0 ||
    (val.artistIds?.length ?? 0) > 0 ||
    (val.discs?.length ?? 0) > 0;
  if (!hasContent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one of songIds, albumIds, artistIds, or discs must be provided',
    });
  }
});

// get_playlist_tracks emits each row's 1-based position as a string, so positions round-trip
// as strings.
const PlaylistPositionSchema = z.string().regex(/^[1-9]\d*$/, 'Track position must be a 1-based positive integer');

export const RemoveTracksFromPlaylistSchema = PlaylistIdSchema.extend({
  positions: z.array(PlaylistPositionSchema).min(1, 'At least one track position is required').max(500, 'Remove at most 500 tracks per call. Repeat for more.'),
});

// `insertBefore` names the 1-based slot the track lands before, so N+1 appends.
// Navidrome answers insert_before=0 with HTTP 500, so the schema requires >= 1.
export const ReorderPlaylistTrackSchema = PlaylistIdSchema.extend({
  position: PlaylistPositionSchema,
  insertBefore: z.number().int().min(1, 'insertBefore must be a 1-based position (use 1 for the first slot)'),
});

export const SaveQueueSchema = z.object({
  songIds: z.array(IdStringSchema),
  currentIndex: z.number().int().min(0).optional().default(0),
  // Seconds, the unit now_playing reports. saveQueue converts to Navidrome's milliseconds.
  position: z.number().min(0).optional().default(0),
}).superRefine((val, ctx) => {
  // A nonzero current must point at a real track, or the saved queue desyncs.
  if (val.currentIndex > 0 && val.currentIndex >= val.songIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['currentIndex'],
      message: `currentIndex must be less than songIds.length (${val.songIds.length})`,
    });
  }
});

// One offset applies to all three sub-fetches. The search_* tools page a single type.
export const SearchAllSchema = EnhancedSearchSchema.extend({
  artistCount: z.number().int().min(0).max(100).optional().default(DEFAULT_VALUES.SEARCH_ALL_LIMIT),
  albumCount: z.number().int().min(0).max(100).optional().default(DEFAULT_VALUES.SEARCH_ALL_LIMIT),
  songCount: z.number().int().min(0).max(100).optional().default(DEFAULT_VALUES.SEARCH_ALL_LIMIT),
  offset: OffsetSchema,
  verbose: VerboseSchema,
});

export const ListTagValuesSchema = z.object({
  tagName: z.string().min(1).optional().default('genre').transform((name) => name.toLowerCase()),
  tagValue: z.string().optional(),
  limit: createLimitSchema(1, 100, DEFAULT_VALUES.TAG_SEARCH_LIMIT),
  offset: OffsetSchema,
});

export const TagDistributionSchema = z.object({
  tagNames: z.array(z.string().min(1).transform((name) => name.toLowerCase())).optional(),
  limit: createLimitSchema(1, 50, DEFAULT_VALUES.TAG_DISTRIBUTION_LIMIT),
  distributionLimit: createLimitSchema(1, 100, DEFAULT_VALUES.TAG_DISTRIBUTION_VALUES_LIMIT),
});

export const SimilarArtistsSchema = z.object({
  artist: z.string().min(1),
  limit: createLimitSchema(1, 100, DEFAULT_VALUES.SIMILAR_ARTISTS_LIMIT),
  verbose: VerboseSchema,
});

export const SimilarTracksSchema = z.object({
  artist: z.string().min(1),
  track: z.string().min(1),
  limit: createLimitSchema(1, 100, DEFAULT_VALUES.SIMILAR_TRACKS_LIMIT),
  verbose: VerboseSchema,
});

export const ArtistInfoSchema = z.object({
  artist: z.string().min(1),
  lang: z.string().optional().default('en'),
  verbose: VerboseSchema,
});

export const TopTracksByArtistSchema = z.object({
  artist: z.string().min(1),
  limit: createLimitSchema(1, 50, 10),
  verbose: VerboseSchema,
});

export const TrendingMusicSchema = z.object({
  type: z.enum(['artists', 'tracks', 'tags']),
  limit: createLimitSchema(1, 100, DEFAULT_VALUES.TRENDING_MUSIC_LIMIT),
  page: z.number().int().min(1).optional().default(1),
  verbose: VerboseSchema,
});

// MusicBrainz release-group types (docs/musicbrainz-api.md §8). Lowercase, since MB's `type=`
// browse filter accepts lowercase and the parser lowercases secondary types.
const MbPrimaryTypeSchema = z.enum(['album', 'ep', 'single']);
const MbSecondaryTypeSchema = z.enum([
  'live',
  'compilation',
  'soundtrack',
  'remix',
  'dj-mix',
  'demo',
  'mixtape/street',
  'interview',
  'audiobook',
  'audio drama',
  'spokenword',
  'field recording',
]);

export const ArtistAlbumsSchema = z.object({
  artist: z.string().min(1).optional(),
  mbid: z.string().uuid().optional(),
  includeTypes: z.array(MbPrimaryTypeSchema).min(1).optional().default(['album']),
  excludeSecondary: z.array(MbSecondaryTypeSchema).optional()
    .default(['live', 'compilation', 'soundtrack', 'remix', 'dj-mix', 'demo']),
  onlyMissing: OptionalBooleanSchema.default(false),
  includeUnverified: OptionalBooleanSchema.default(false),
  verbose: VerboseSchema,
}).superRefine((value, ctx) => {
  if (value.artist === undefined && value.mbid === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either artist (name) or mbid (MusicBrainz artist ID) is required',
      path: ['artist'],
    });
  }
});

// `mbid` is a MusicBrainz RELEASE-GROUP MBID, the mbid of a get_artist_albums row with source
// 'musicbrainz'. See docs/ARTIST-ALBUMS-SPEC.md §9.
export const AlbumInfoSchema = z.object({
  artist: z.string().min(1).optional(),
  album: z.string().min(1).optional(),
  mbid: z.string().uuid().optional(),
  verbose: VerboseSchema,
}).superRefine((value, ctx) => {
  if (value.mbid === undefined && (value.artist === undefined || value.album === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either mbid (MusicBrainz release-group ID) or both artist and album are required',
      path: ['album'],
    });
  }
});

export const LyricsMetadataSchema = z.object({
  title: z.string().min(1),
  artist: z.string().min(1),
  album: z.string().optional(),
  durationMs: z.number().min(0).optional(),
});

// search_lyrics candidates carry the lrclibId that get_lyrics accepts.
export const LyricsIdentitySchema = z.object({
  songId: SongIdSchema.shape.songId.optional(),
  lrclibId: z.string().min(1).regex(/^\d+$/, 'LRCLIB record ID must be numeric').optional(),
}).superRefine((value, ctx) => {
  if (value.songId === undefined && value.lrclibId === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either songId (a Navidrome song ID) or lrclibId (an LRCLIB record ID) is required',
      path: ['songId'],
    });
  }
  if (value.songId !== undefined && value.lrclibId !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Pass songId or lrclibId, not both',
      path: ['lrclibId'],
    });
  }
});

// A `limit` of 0 would return an empty list that reads as "no values", so it is rejected.
export const FilterOptionsSchema = z.object({
  filterType: z.enum(['genres', 'mediaTypes', 'countries', 'releaseTypes', 'recordLabels', 'moods']),
  limit: createLimitSchema(1, 200, 50),
  offset: OffsetSchema,
});

export const TestConnectionSchema = z.object({
  includeServerInfo: OptionalBooleanSchema.default(false),
});

export const SetActiveLibrariesSchema = z.object({
  libraryIds: z.array(z.number().int().positive().finite())
    .min(1, 'At least one library ID must be provided')
    .transform((ids) => Array.from(new Set(ids))),
}).strict();

const QueueShuffleShape = {
  shuffleSongs: z.boolean().default(false),
  shuffleAlbums: z.boolean().default(false),
};

const LibraryPlayOptionsShape = {
  mode: z.enum(['replace', 'append']),
  ...QueueShuffleShape,
};

export const LibraryPlayRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['artist', 'album', 'song', 'playlist']),
    id: z
      .string({ error: (issue) => (issue.input === undefined ? 'ID is required' : undefined) })
      .min(1, { message: 'ID is required', abort: true })
      .regex(ID_PATTERN, 'ID contains invalid characters'),
    ...LibraryPlayOptionsShape,
  }),
  z.object({
    type: z.enum(['starred-songs', 'starred-albums']),
    ...LibraryPlayOptionsShape,
  }),
], { error: 'type must be one of artist, album, song, playlist, starred-songs, starred-albums' });

export const SetVolumeSchema = z.strictObject({
  // The tool contract promises clamping to [0, 100] in playback-engine.setVolume, so the
  // schema rejects only non-finite values, never out-of-range ones.
  level: z.number().finite(),
});

export const ListAudioDevicesSchema = z.strictObject({
  verbose: z.boolean().optional(),
});

// Not IdSchema, since mpv device ids carry characters such as `/`, `{`, `}`, `.`, `:` and `=`.
export const SetAudioDeviceSchema = z.strictObject({
  id: z.string().trim().min(1).max(512),
});

export const SeekSchema = z.strictObject({
  seconds: z.number(),
  mode: z.enum(['absolute', 'relative']).default('relative'),
}).refine((val) => val.mode === 'relative' || val.seconds >= 0, {
  // mpv reads a negative absolute target as an offset from the end of the track.
  message: 'An absolute seek needs seconds of 0 or more. Use mode relative with a negative value to seek backwards.',
  path: ['seconds'],
});

export const PlayQueueIndexSchema = z.strictObject({
  index: z.number().int().min(0),
});

const QueueModeSchema = z.enum(['replace', 'append']).default('replace');

export const PlaySongsSchema = z.strictObject({
  songIds: NonEmptyIdArraySchema,
  mode: QueueModeSchema,
  shuffle: z.boolean().default(false),
});

export const PlayAlbumsSchema = z.strictObject({
  albumIds: NonEmptyIdArraySchema,
  mode: QueueModeSchema,
  ...QueueShuffleShape,
});

export const PlayAlbumsSearchSchema = SearchAlbumsSchema.extend({
  mode: QueueModeSchema,
  ...QueueShuffleShape,
}).strict();

export const PlaySongsSearchSchema = SearchSongsSchema.extend({
  mode: QueueModeSchema,
  shuffle: z.boolean().default(false),
}).strict();

export const PlayPlaylistSchema = PlaylistIdSchema.extend({
  mode: QueueModeSchema,
  shuffle: z.boolean().default(false),
}).strict();

export const MoveInPlayQueueSchema = z.strictObject({
  from: z.number().int().min(0),
  to: z.number().int().min(0),
});

export const PlayerSettingsPatchSchema = z.strictObject({
  persistAfterMcpExit: z.boolean().optional(),
  autoOpenBrowser: z.boolean().optional(),
  // Null clears a forced theme, so each device follows its own setting again.
  theme: z.enum(WEBUI_THEMES).nullable().optional(),
  visualizer: z.boolean().optional(),
});

// Any string is a login attempt, so a too-short or too-long one fails as "Wrong password" too.
export const AdminLoginSchema = z.strictObject({
  password: z.string({ error: 'password must be a string' }),
});

const JUKEBOX_CODE_LIFETIME_ERROR = `lifetimeHours must be a whole number from 1 to ${String(JUKEBOX_CODE_MAX_LIFETIME_HOURS)}`;

export const JukeboxCodeCreateSchema = z.strictObject({
  lifetimeHours: z.number({ error: JUKEBOX_CODE_LIFETIME_ERROR })
    .int({ error: JUKEBOX_CODE_LIFETIME_ERROR })
    .min(1, { error: JUKEBOX_CODE_LIFETIME_ERROR })
    .max(JUKEBOX_CODE_MAX_LIFETIME_HOURS, { error: JUKEBOX_CODE_LIFETIME_ERROR }),
  signOutGuests: z.boolean({ error: 'signOutGuests must be true or false' }).default(false),
});

// Indic vowel signs and decomposed accents are combining marks (\p{M}), so a name in letters needs them too.
const GUEST_NICKNAME_PATTERN = /^[\p{L}\p{M}\p{Nd} .,'!?_-]{1,24}$/u;

const GuestNicknameField = z.string().trim().normalize('NFC').regex(GUEST_NICKNAME_PATTERN, {
  error: "nickname must be 1 to 24 letters, digits, spaces or . , ' ! ? - _",
});

// Any key string is a join attempt, so a malformed key fails with the same message as a wrong one.
export const GuestJoinSchema = z.strictObject({
  key: z.string({ error: 'key must be a string' }),
  nickname: GuestNicknameField.optional(),
});

export const GuestNicknameSchema = z.strictObject({ nickname: GuestNicknameField });

export const LibrarySearchQuerySchema = z.string().trim().min(1).max(SEARCH_QUERY_MAX_LENGTH);

const GUEST_SEARCH_QUERY_MAX_LENGTH = 100;
const GUEST_SEARCH_QUERY_ERROR = `Enter 1 to ${String(GUEST_SEARCH_QUERY_MAX_LENGTH)} characters to search.`;

export const GuestSearchQuerySchema = z.string({ error: GUEST_SEARCH_QUERY_ERROR }).trim()
  .min(1, { error: GUEST_SEARCH_QUERY_ERROR })
  .max(GUEST_SEARCH_QUERY_MAX_LENGTH, { error: GUEST_SEARCH_QUERY_ERROR });

export const GuestQueueAddSchema = z.strictObject({
  songId: SongIdSchema.shape.songId,
});

const ENTRY_ID_ERROR = 'entryId must be a whole number of 0 or more';

// The host and guest remove routes name an entry by its mpv id, which survives a move.
export const QueueEntryRemoveSchema = z.strictObject({
  entryId: z.number({ error: ENTRY_ID_ERROR }).int({ error: ENTRY_ID_ERROR }).min(0, { error: ENTRY_ID_ERROR }),
});

const GUEST_SESSION_ID_ERROR = 'sessionId must be a guest session id';
const GuestSessionIdSchema = z.string({ error: GUEST_SESSION_ID_ERROR }).min(1, { error: GUEST_SESSION_ID_ERROR });

export const JukeboxGuestRemoveSchema = z.strictObject({
  sessionId: GuestSessionIdSchema,
});

// The durations the Guests dialog offers. A network ban always expires, since one address can hold innocent guests.
const NETWORK_BAN_HOURS = [0, 1, 24, 168, 720] as const;

export const JukeboxGuestBanSchema = z.strictObject({
  sessionId: GuestSessionIdSchema,
  networkBanHours: z.literal(NETWORK_BAN_HOURS, { error: `networkBanHours must be one of ${NETWORK_BAN_HOURS.join(', ')}` }),
});

const BAN_ID_ERROR = 'banId must be a ban id';

export const JukeboxBanRemoveSchema = z.strictObject({
  banId: z.string({ error: BAN_ID_ERROR }).min(1, { error: BAN_ID_ERROR }),
});

const GUEST_QUEUE_LIMIT_ERROR =
  `guestQueueLimit must be a whole number from ${String(GUEST_QUEUE_LIMIT_MIN)} to ${String(GUEST_QUEUE_LIMIT_MAX)}`;

const JUKEBOX_SHARE_LINK_ERROR = `shareLink must be one of ${JUKEBOX_SHARE_LINKS.join(', ')}`;

export const JukeboxSettingsPatchSchema = z.strictObject({
  guestQueueLimit: z.number({ error: GUEST_QUEUE_LIMIT_ERROR })
    .int({ error: GUEST_QUEUE_LIMIT_ERROR })
    .min(GUEST_QUEUE_LIMIT_MIN, { error: GUEST_QUEUE_LIMIT_ERROR })
    .max(GUEST_QUEUE_LIMIT_MAX, { error: GUEST_QUEUE_LIMIT_ERROR })
    .optional(),
  shareLink: z.enum(JUKEBOX_SHARE_LINKS, { error: JUKEBOX_SHARE_LINK_ERROR }).optional(),
}).refine((patch) => patch.guestQueueLimit !== undefined || patch.shareLink !== undefined, {
  error: 'Send guestQueueLimit, shareLink or both',
});

// Node fetch probes only http and https, so other radio schemes fail here with guidance
// instead of an opaque fetch error.
export const ValidateStreamSchema = z.object({
  url: z.string()
    .trim()
    .url('URL must be a valid URL')
    .refine(isHttpUrlScheme, {
      message: 'URL must use http:// or https://. This validator probes only HTTP/HTTPS. Add an mms://, rtsp:// or rtmp:// station in the Navidrome web UI instead.',
    }),
  timeout: z.number().min(MIN_VALIDATION_TIMEOUT_MS).max(MAX_VALIDATION_TIMEOUT_MS).optional().default(SINGLE_VALIDATION_TIMEOUT_MS),
  followRedirects: z.boolean().optional().default(true),
});

// Per-station name and url checks stay in the create loop, so one bad entry in a batch
// still lets the rest process and report per-item results.
export const CreateRadioStationSchema = z.strictObject({
  stations: z.array(z.strictObject({
    name: z.string(),
    streamUrl: z.string().trim(),
    homePageUrl: z.string().trim().optional(),
  })).min(1, 'At least one station must be provided'),
  validateBeforeAdd: z.boolean().optional().default(false),
});

export const DiscoverRadioStationsSchema = z.object({
  query: z.string().optional(),
  tag: z.string().optional(),
  countryCode: z.string().optional(),
  language: z.string().optional(),
  codec: z.string().optional(),
  bitrateMin: z.number().min(0).optional(),
  isHttps: z.boolean().optional(),
  sort: z.enum(['name', 'votes', 'clickcount', 'bitrate', 'lastcheckok', 'random']).default('votes'),
  // The direction default depends on the sort field, so OrderSchema's fixed ASC default does
  // not apply.
  order: OrderSchema.removeDefault(),
  offset: OffsetSchema,
  limit: createLimitSchema(1, 500, DEFAULT_VALUES.RADIO_DISCOVERY_LIMIT),
  hideBroken: z.boolean().default(true)
});

export const RadioFiltersSchema = z.object({
  kinds: z.array(z.enum(['tags', 'countries', 'languages', 'codecs'])).default(['tags', 'countries', 'languages', 'codecs'])
});
