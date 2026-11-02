/**
 * Navidrome MCP Server - e2e native prompt handling
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Page } from '@playwright/test';

/**
 * Answers the next native prompt on the page and resolves its text, so a spec asserts it. Call it before
 * the click that opens the prompt, since Playwright dismisses a prompt that no handler takes.
 */
export function answerNextPrompt(page: Page, answer: 'accept' | 'dismiss'): Promise<string> {
  return new Promise((resolve, reject) => {
    page.once('dialog', (dialog) => {
      const answered = answer === 'accept' ? dialog.accept() : dialog.dismiss();
      answered.then(() => resolve(dialog.message()), reject);
    });
  });
}
