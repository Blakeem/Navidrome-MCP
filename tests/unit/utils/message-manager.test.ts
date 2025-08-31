/**
 * Navidrome MCP Server - Message Manager Tests
 * Copyright (C) 2025
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageManager, getMessageManager } from '../../../src/utils/message-manager.js';

describe('MessageManager', () => {
  let messageManager: MessageManager;

  beforeEach(() => {
    // Get a fresh instance and reset it
    messageManager = MessageManager.getInstance();
    messageManager.reset();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = MessageManager.getInstance();
      const instance2 = MessageManager.getInstance();
      const instance3 = getMessageManager();
      
      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });
  });

  describe('One-Time Messages', () => {
    it('should return message on first call', () => {
      const message = messageManager.getMessage('radio.validation_reminder');
      
      expect(message).toBeTruthy();
      expect(message).toContain('STREAM VALIDATION RECOMMENDED');
      expect(message).toContain('validate_radio_stream');
    });

    it('should return null on subsequent calls', () => {
      // First call
      const firstMessage = messageManager.getMessage('radio.validation_reminder');
      expect(firstMessage).toBeTruthy();
      
      // Second call
      const secondMessage = messageManager.getMessage('radio.validation_reminder');
      expect(secondMessage).toBeNull();
      
      // Third call
      const thirdMessage = messageManager.getMessage('radio.validation_reminder');
      expect(thirdMessage).toBeNull();
    });

    it('should handle different message keys independently', () => {
      const validationMessage = messageManager.getMessage('radio.validation_reminder');
      const listTip = messageManager.getMessage('radio.list_tip');
      
      expect(validationMessage).toBeTruthy();
      expect(listTip).toBeTruthy();
      expect(validationMessage).not.toBe(listTip);
      
      // Try getting them again
      const validationMessage2 = messageManager.getMessage('radio.validation_reminder');
      const listTip2 = messageManager.getMessage('radio.list_tip');
      
      expect(validationMessage2).toBeNull();
      expect(listTip2).toBeNull();
    });
  });

  describe('Custom Messages', () => {
    it('should accept custom message instead of template', () => {
      const customMessage = 'This is a custom validation reminder';
      const message = messageManager.getMessage('radio.validation_reminder', customMessage);
      
      expect(message).toBe(customMessage);
      
      // Second call should still return null
      const secondMessage = messageManager.getMessage('radio.validation_reminder');
      expect(secondMessage).toBeNull();
    });

    it('should return null for unknown template without custom message', () => {
      const message = messageManager.getMessage('unknown.message.key');
      
      expect(message).toBeNull();
      
      // Should still be marked as shown
      const secondMessage = messageManager.getMessage('unknown.message.key');
      expect(secondMessage).toBeNull();
    });

    it('should accept custom message for unknown template', () => {
      const customMessage = 'This is a new message type';
      const message = messageManager.getMessage('new.message.type', customMessage);
      
      expect(message).toBe(customMessage);
    });
  });

  describe('Message Status Tracking', () => {
    it('should track shown messages', () => {
      expect(messageManager.hasShownMessage('radio.validation_reminder')).toBe(false);
      
      messageManager.getMessage('radio.validation_reminder');
      
      expect(messageManager.hasShownMessage('radio.validation_reminder')).toBe(true);
    });

    it('should allow manual marking as shown', () => {
      expect(messageManager.hasShownMessage('test.message')).toBe(false);
      
      messageManager.markAsShown('test.message');
      
      expect(messageManager.hasShownMessage('test.message')).toBe(true);
      expect(messageManager.getMessage('test.message', 'Test')).toBeNull();
    });
  });

  describe('Formatted Messages', () => {
    it('should format messages with placeholders', () => {
      const customMessage = 'Hello {{name}}, you have {{count}} new messages';
      messageManager.addMessageTemplate('formatted.test', customMessage);
      
      const formatted = messageManager.getFormattedMessage(
        'formatted.test',
        { name: 'Alice', count: 5 }
      );
      
      expect(formatted).toBe('Hello Alice, you have 5 new messages');
    });

    it('should return null for already shown formatted messages', () => {
      const customMessage = 'Hello {{name}}';
      messageManager.addMessageTemplate('formatted.test', customMessage);
      
      // First call
      const first = messageManager.getFormattedMessage('formatted.test', { name: 'Bob' });
      expect(first).toBe('Hello Bob');
      
      // Second call
      const second = messageManager.getFormattedMessage('formatted.test', { name: 'Alice' });
      expect(second).toBeNull();
    });

    it('should handle missing placeholders gracefully', () => {
      const customMessage = 'Hello {{name}}, you are {{age}} years old';
      messageManager.addMessageTemplate('partial.test', customMessage);
      
      const formatted = messageManager.getFormattedMessage(
        'partial.test',
        { name: 'Charlie' } // Missing age
      );
      
      expect(formatted).toBe('Hello Charlie, you are {{age}} years old');
    });

    it('should format with custom message instead of template', () => {
      const customMessage = 'Custom: {{value}}';
      const formatted = messageManager.getFormattedMessage(
        'nonexistent.key',
        { value: 'test' },
        customMessage
      );
      
      expect(formatted).toBe('Custom: test');
    });
  });

  describe('Template Management', () => {
    it('should list available message keys', () => {
      const keys = messageManager.getAvailableMessageKeys();
      
      expect(keys).toContain('radio.validation_reminder');
      expect(keys).toContain('radio.list_tip');
      expect(keys).toContain('radio.creation_success');
      expect(keys).toContain('general.welcome');
    });

    it('should add new message templates at runtime', () => {
      const newMessage = 'This is a runtime message';
      messageManager.addMessageTemplate('runtime.test', newMessage);
      
      const keys = messageManager.getAvailableMessageKeys();
      expect(keys).toContain('runtime.test');
      
      const message = messageManager.getMessage('runtime.test');
      expect(message).toBe(newMessage);
    });
  });

  describe('Reset Functionality', () => {
    it('should reset shown message tracking', () => {
      // Show some messages
      messageManager.getMessage('radio.validation_reminder');
      messageManager.getMessage('radio.list_tip');
      
      expect(messageManager.hasShownMessage('radio.validation_reminder')).toBe(true);
      expect(messageManager.hasShownMessage('radio.list_tip')).toBe(true);
      
      // Reset
      messageManager.reset();
      
      expect(messageManager.hasShownMessage('radio.validation_reminder')).toBe(false);
      expect(messageManager.hasShownMessage('radio.list_tip')).toBe(false);
      
      // Should be able to show messages again
      const message = messageManager.getMessage('radio.validation_reminder');
      expect(message).toBeTruthy();
    });

    it('should not affect message templates after reset', () => {
      const keysBefore = messageManager.getAvailableMessageKeys();
      
      messageManager.reset();
      
      const keysAfter = messageManager.getAvailableMessageKeys();
      expect(keysAfter).toEqual(keysBefore);
    });
  });

  describe('Predefined Messages', () => {
    it('should have radio validation reminder', () => {
      const message = messageManager.getMessage('radio.validation_reminder');
      
      expect(message).toContain('STREAM VALIDATION RECOMMENDED');
      expect(message).toContain('validate_radio_stream');
      expect(message).toContain('radio-browser.info');
    });

    it('should have radio list tip', () => {
      const message = messageManager.getMessage('radio.list_tip');
      
      expect(message).toContain('validate_radio_stream');
      expect(message).toContain('playback issues');
    });

    it('should have radio creation success', () => {
      const message = messageManager.getMessage('radio.creation_success');
      
      expect(message).toContain('Station created successfully');
      expect(message).toContain('validate streams');
    });

    it('should have validation advice', () => {
      const message = messageManager.getMessage('radio.validation_advice');
      
      expect(message).toContain('Radio streams can go offline');
      expect(message).toContain('Validate regularly');
    });

    it('should have welcome message', () => {
      const message = messageManager.getMessage('general.welcome');
      
      expect(message).toContain('Welcome to Navidrome MCP');
      expect(message).toContain('test_connection');
    });
  });
});