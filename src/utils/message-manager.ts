/**
 * Navidrome MCP Server - One-Time Message Manager
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

/**
 * Manages one-time messages for LLM assistants.
 *
 * State is a process-wide singleton (see getInstance), so tips, reminders, and
 * helpful messages are shown only once per process. Under the stdio transport
 * that is one process per client session, so it reads as "once per session".
 * Under the multi-session HTTP transport all concurrent sessions share this
 * state, so once any session consumes a tip no other session in that process
 * sees it. That trade-off is accepted, since a helper tip not repeating is cosmetic.
 */
export class MessageManager {
  private static instance: MessageManager | null = null;
  private readonly shownMessages: Set<string>;
  private readonly messageTemplates: Map<string, string>;

  private constructor() {
    this.shownMessages = new Set();
    this.messageTemplates = new Map();
    this.initializeMessages();
  }

  public static getInstance(): MessageManager {
    MessageManager.instance ??= new MessageManager();
    return MessageManager.instance;
  }

  private initializeMessages(): void {
    this.messageTemplates.set('radio.list_tip',
      "TIP: Use 'validate_radio_stream' to test station URLs if playback issues occur");
  }

  /**
   * Get a message if it hasn't been shown yet
   * @param messageKey The unique key for the message
   * @returns The message if not shown before, null otherwise
   */
  public getMessage(messageKey: string): string | null {
    if (this.shownMessages.has(messageKey)) {
      return null;
    }

    const template = this.messageTemplates.get(messageKey);
    if (template === undefined) {
      return null;
    }

    this.shownMessages.add(messageKey);
    return template;
  }

  /**
   * Reset all shown messages (useful for testing)
   */
  public reset(): void {
    this.shownMessages.clear();
  }
}

// Export singleton getter for convenience
export function getMessageManager(): MessageManager {
  return MessageManager.getInstance();
}