/**
 * Navidrome MCP Server - Radio Validation Public API
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Only the tool entry is re-exported, since ts-unused-exports fails CI on an unused re-export.
export { validateRadioStream } from './validation-core.js';