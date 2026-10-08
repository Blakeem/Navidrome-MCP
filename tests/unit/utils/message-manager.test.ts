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
    it('should return the radio list tip on first call', () => {
      const message = messageManager.getMessage('radio.list_tip');

      expect(message).toBeTruthy();
      expect(message).toContain('validate_radio_stream');
    });

    it('should return null on subsequent calls', () => {
      const firstMessage = messageManager.getMessage('radio.list_tip');
      expect(firstMessage).toBeTruthy();

      const secondMessage = messageManager.getMessage('radio.list_tip');
      expect(secondMessage).toBeNull();

      const thirdMessage = messageManager.getMessage('radio.list_tip');
      expect(thirdMessage).toBeNull();
    });

    it('should return null for an unknown key on every call', () => {
      expect(messageManager.getMessage('unknown.message.key')).toBeNull();
      expect(messageManager.getMessage('unknown.message.key')).toBeNull();
    });

    it('does not consume the slot of a known key when an unknown key is probed', () => {
      expect(messageManager.getMessage('unknown.message.key')).toBeNull();
      expect(messageManager.getMessage('radio.list_tip')).toBeTruthy();
    });
  });

  describe('Reset Functionality', () => {
    it('should make a shown message available again', () => {
      expect(messageManager.getMessage('radio.list_tip')).toBeTruthy();
      expect(messageManager.getMessage('radio.list_tip')).toBeNull();

      messageManager.reset();

      expect(messageManager.getMessage('radio.list_tip')).toBeTruthy();
    });
  });
});
