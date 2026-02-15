// pipeline/chat-processor.ts — Message routing by mode

import type { ChatMessage, EntityId } from '../types/index.js';
import type { WorldState } from '../server/world.js';
import { LOCAL_CHAT_RADIUS } from '../shared/constants.js';

export class ChatProcessor {
  processMessage(msg: ChatMessage, world: WorldState): void {
    switch (msg.mode) {
      case 'whisper':
        // Only sender + target receive it (works at any distance)
        msg.recipients = msg.targetId
          ? [msg.senderId, msg.targetId]
          : [msg.senderId];
        break;

      case 'local': {
        // All entities within LOCAL_CHAT_RADIUS of sender's position
        const sender = world.agents.get(msg.senderId);
        if (!sender) {
          msg.recipients = [msg.senderId];
          break;
        }
        const nearbyIds = world.chunkManager.getEntitiesInRadius(
          sender.position,
          LOCAL_CHAT_RADIUS,
        );
        // Filter to only agents (not resources, monsters, etc.)
        const agentRecipients: EntityId[] = [];
        for (const id of nearbyIds) {
          if (world.agents.has(id)) {
            agentRecipients.push(id);
          }
        }
        // Ensure sender is always included
        if (!agentRecipients.includes(msg.senderId)) {
          agentRecipients.push(msg.senderId);
        }
        msg.recipients = agentRecipients;
        break;
      }

      case 'broadcast':
        // Everyone
        msg.recipients = 'all';
        break;
    }
  }
}
