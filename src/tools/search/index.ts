/**
 * Navidrome MCP Server - Search Module Public API
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

// Export main search orchestration function
export { searchAll } from './search-orchestrator.js';

// Export individual search functions for parallel operations
export { searchSongs, searchAlbums, searchArtists } from './parallel-searcher.js';

// Internal types are not exported - they are used only within the search module