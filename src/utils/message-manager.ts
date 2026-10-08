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

/** One-time LLM tips tracked process-wide. Under HTTP all sessions share shown state,
 *  accepted because a missed tip is cosmetic. */
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

  /** Lets tests isolate cases, since the instance is process-wide. */
  public reset(): void {
    this.shownMessages.clear();
  }
}

export function getMessageManager(): MessageManager {
  return MessageManager.getInstance();
}