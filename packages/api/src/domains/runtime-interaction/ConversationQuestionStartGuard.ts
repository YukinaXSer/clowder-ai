import type { IMessageStore } from '../cats/services/stores/ports/MessageStore.js';
import { formatConversationAnswer } from './conversation-question-composition.js';
import type { RuntimeInteractionStore } from './ports/RuntimeInteractionStore.js';

/** Re-read the decision at dispatch, including after queue residence or a clarification. */
export class ConversationQuestionStartGuard {
  constructor(
    private readonly deps: {
      store: RuntimeInteractionStore;
      messages: Pick<IMessageStore, 'getById' | 'getByIdempotencyKey'>;
    },
  ) {}
  async check(input: {
    messageId: string;
    threadId: string;
    userId: string;
    catId: string;
  }): Promise<{ ready: boolean; terminal?: boolean; context?: string }> {
    const message = await this.deps.messages.getById(input.messageId);
    if (message?.source?.connector !== 'conversation-question-resume') return { ready: true };
    const id = message.source.meta?.interactionId;
    const continuationId = message.source.meta?.continuationId;
    if (
      typeof id !== 'string' ||
      typeof continuationId !== 'string' ||
      message.deletedAt ||
      message._tombstone ||
      message.userId !== input.userId ||
      message.threadId !== input.threadId
    )
      return { ready: false };
    const record = await this.deps.store.get(id);
    const work = record?.conversation?.continuations.find((item) => item.id === continuationId);
    if (
      !record ||
      record.request.owner.userId !== input.userId ||
      record.request.owner.threadId !== input.threadId ||
      !work ||
      work.catId !== input.catId
    )
      return { ready: false };
    const canonical = await this.deps.messages.getByIdempotencyKey(
      input.userId,
      input.threadId,
      `conversation-resume:${id}:${work.id}`,
    );
    if (canonical?.id !== message.id) return { ready: false };
    if (record.status === 'cancelled' || work.supersededBy) return { ready: false, terminal: true };
    if (record.status !== 'answered') return { ready: false };
    const version = record.conversation?.history.at(-1)?.version ?? 0;
    if (!version || (record.conversation?.publishedVersion ?? 0) < version) return { ready: false };
    return { ready: true, context: formatConversationAnswer(record) };
  }
}
