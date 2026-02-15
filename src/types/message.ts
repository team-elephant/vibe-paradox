// types/message.ts — Chat messages

import type { EntityId, Position, Tick } from './core.js';

export type MessageMode = 'whisper' | 'local' | 'broadcast';

export interface ChatMessage {
  id: string;
  tick: Tick;
  senderId: EntityId;
  senderName: string;
  mode: MessageMode;
  content: string;
  targetId: EntityId | null;
  position: Position;
  recipients: EntityId[] | 'all';
}

export interface ChatMessageView {
  id: string;
  mode: MessageMode;
  senderId: EntityId;
  senderName: string;
  content: string;
  tick: Tick;
}
