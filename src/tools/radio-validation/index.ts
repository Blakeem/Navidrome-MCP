/**
 * Navidrome MCP Server - Radio Validation Public API
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// Public API for the radio-validation module. Only `validateRadioStream` is
// consumed outside this directory (by radio-discovery, radio-handlers, radio).
// The internal helpers (stream-detector / network-validator /
// recommendation-engine) are imported directly by validation-core where
// needed; re-exporting them here surfaced them as unused public exports
// (ts-unused-exports), so they are intentionally NOT re-exported.
export { validateRadioStream } from './validation-core.js';