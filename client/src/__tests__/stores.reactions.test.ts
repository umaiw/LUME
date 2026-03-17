// @vitest-environment jsdom
/**
 * Tests for Reaction store actions (addReaction, removeReaction).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useChatsStore, type Chat, type Message, type Reaction } from '@/stores';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    chatId: 'chat-1',
    senderId: 'user-a',
    content: 'Hello',
    type: 'text',
    timestamp: Date.now(),
    status: 'delivered',
    ...overrides,
  };
}

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    contactId: 'contact-1',
    messages: [makeMessage()],
    unreadCount: 0,
    isHidden: false,
    ...overrides,
  };
}

describe('useChatsStore — reactions', () => {
  beforeEach(() => {
    useChatsStore.setState({ chats: [makeChat()], activeChatId: null });
  });

  it('adds a reaction to a message', () => {
    const reaction: Reaction = { emoji: '👍', senderId: 'user-b', timestamp: Date.now() };
    useChatsStore.getState().addReaction('chat-1', 'msg-1', reaction);

    const msg = useChatsStore.getState().chats[0].messages[0];
    expect(msg.reactions).toHaveLength(1);
    expect(msg.reactions![0].emoji).toBe('👍');
    expect(msg.reactions![0].senderId).toBe('user-b');
  });

  it('does not add duplicate reaction (same sender + same emoji)', () => {
    const reaction: Reaction = { emoji: '👍', senderId: 'user-b', timestamp: Date.now() };
    useChatsStore.getState().addReaction('chat-1', 'msg-1', reaction);
    useChatsStore.getState().addReaction('chat-1', 'msg-1', reaction);

    const msg = useChatsStore.getState().chats[0].messages[0];
    expect(msg.reactions).toHaveLength(1);
  });

  it('allows different emojis from the same sender', () => {
    useChatsStore.getState().addReaction('chat-1', 'msg-1', { emoji: '👍', senderId: 'user-b', timestamp: Date.now() });
    useChatsStore.getState().addReaction('chat-1', 'msg-1', { emoji: '❤️', senderId: 'user-b', timestamp: Date.now() });

    const msg = useChatsStore.getState().chats[0].messages[0];
    expect(msg.reactions).toHaveLength(2);
  });

  it('allows same emoji from different senders', () => {
    useChatsStore.getState().addReaction('chat-1', 'msg-1', { emoji: '👍', senderId: 'user-a', timestamp: Date.now() });
    useChatsStore.getState().addReaction('chat-1', 'msg-1', { emoji: '👍', senderId: 'user-b', timestamp: Date.now() });

    const msg = useChatsStore.getState().chats[0].messages[0];
    expect(msg.reactions).toHaveLength(2);
  });

  it('removes a specific reaction', () => {
    useChatsStore.getState().addReaction('chat-1', 'msg-1', { emoji: '👍', senderId: 'user-b', timestamp: Date.now() });
    useChatsStore.getState().addReaction('chat-1', 'msg-1', { emoji: '❤️', senderId: 'user-b', timestamp: Date.now() });

    useChatsStore.getState().removeReaction('chat-1', 'msg-1', 'user-b', '👍');

    const msg = useChatsStore.getState().chats[0].messages[0];
    expect(msg.reactions).toHaveLength(1);
    expect(msg.reactions![0].emoji).toBe('❤️');
  });

  it('sets reactions to undefined when last reaction is removed', () => {
    useChatsStore.getState().addReaction('chat-1', 'msg-1', { emoji: '👍', senderId: 'user-b', timestamp: Date.now() });
    useChatsStore.getState().removeReaction('chat-1', 'msg-1', 'user-b', '👍');

    const msg = useChatsStore.getState().chats[0].messages[0];
    expect(msg.reactions).toBeUndefined();
  });

  it('ignores addReaction for non-existent chat', () => {
    const before = useChatsStore.getState().chats;
    useChatsStore.getState().addReaction('no-such-chat', 'msg-1', { emoji: '👍', senderId: 'user-b', timestamp: Date.now() });
    const after = useChatsStore.getState().chats;
    expect(after[0].messages[0].reactions).toBeUndefined();
  });

  it('ignores addReaction for non-existent message', () => {
    useChatsStore.getState().addReaction('chat-1', 'no-such-msg', { emoji: '👍', senderId: 'user-b', timestamp: Date.now() });
    const msg = useChatsStore.getState().chats[0].messages[0];
    expect(msg.reactions).toBeUndefined();
  });
});
