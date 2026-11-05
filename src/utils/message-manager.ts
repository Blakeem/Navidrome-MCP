/**
 * Navidrome MCP Server - One-Time Message Manager
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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