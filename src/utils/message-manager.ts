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
 * Manages one-time messages for LLM assistants
 * Ensures tips, reminders, and helpful messages are shown only once per session
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

  /**
   * Get the singleton instance of MessageManager
   */
  public static getInstance(): MessageManager {
    MessageManager.instance ??= new MessageManager();
    return MessageManager.instance;
  }

  /**
   * Initialize predefined message templates
   */
  private initializeMessages(): void {
    // Radio validation reminder
    this.messageTemplates.set('radio.validation_reminder', `
🎵 STREAM VALIDATION RECOMMENDED
   Use 'validate_radio_stream' tool first to test your URL
   Many internet radio URLs change frequently
   Validation checks: accessibility, audio format, streaming headers
   
   💡 TIP: Find reliable streams at radio-browser.info or somafm.com`);

    // Radio list tip
    this.messageTemplates.set('radio.list_tip', 
      "💡 TIP: Use 'validate_radio_stream' to test station URLs if playback issues occur");

    // Radio creation success
    this.messageTemplates.set('radio.creation_success',
      "✅ Station created successfully! Remember to validate streams periodically as URLs may change.");

    // General validation advice
    this.messageTemplates.set('radio.validation_advice',
      "🔍 Pro tip: Radio streams can go offline. Validate regularly for best experience.");

    // Add more message templates as needed
    this.messageTemplates.set('general.welcome',
      "🎶 Welcome to Navidrome MCP! Type 'test_connection' to verify your setup.");
  }

  /**
   * Get a message if it hasn't been shown yet
   * @param messageKey The unique key for the message
   * @param customMessage Optional custom message to use instead of template
   * @returns The message if not shown before, null otherwise
   */
  public getMessage(messageKey: string, customMessage?: string): string | null {
    // Check if message was already shown
    if (this.shownMessages.has(messageKey)) {
      return null;
    }

    // Mark as shown
    this.shownMessages.add(messageKey);

    // Return custom message or template
    if (customMessage !== null && customMessage !== undefined && customMessage !== '') {
      return customMessage;
    }

    return this.messageTemplates.get(messageKey) ?? null;
  }

  /**
   * Check if a message has been shown
   * @param messageKey The unique key for the message
   */
  public hasShownMessage(messageKey: string): boolean {
    return this.shownMessages.has(messageKey);
  }

  /**
   * Manually mark a message as shown without returning it
   * @param messageKey The unique key for the message
   */
  public markAsShown(messageKey: string): void {
    this.shownMessages.add(messageKey);
  }

  /**
   * Reset all shown messages (useful for testing)
   */
  public reset(): void {
    this.shownMessages.clear();
  }

  /**
   * Get all available message keys (for debugging)
   */
  public getAvailableMessageKeys(): string[] {
    return Array.from(this.messageTemplates.keys());
  }

  /**
   * Add a new message template at runtime
   * @param key The unique key for the message
   * @param message The message content
   */
  public addMessageTemplate(key: string, message: string): void {
    this.messageTemplates.set(key, message);
  }

  /**
   * Format a message with dynamic values
   * @param messageKey The message key
   * @param values Object with key-value pairs to replace in message
   */
  public getFormattedMessage(
    messageKey: string, 
    values: Record<string, string | number>,
    customMessage?: string
  ): string | null {
    const message = this.getMessage(messageKey, customMessage);
    if (message === null || message === undefined || message === '') return null;

    let formatted = message;
    for (const [key, value] of Object.entries(values)) {
      formatted = formatted.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
    }
    return formatted;
  }
}

// Export singleton getter for convenience
export function getMessageManager(): MessageManager {
  return MessageManager.getInstance();
}