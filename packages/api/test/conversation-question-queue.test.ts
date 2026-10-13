import assert from 'node:assert/strict';
import { it } from 'node:test';
import { MessageStore } from '../src/domains/cats/services/stores/ports/MessageStore.js';
import { ConversationQuestionStartGuard } from '../src/domains/runtime-interaction/ConversationQuestionStartGuard.js';
import { createConversationQuestionService } from '../src/domains/runtime-interaction/conversation-question-composition.js';
import { InMemoryRuntimeInteractionStore } from '../src/domains/runtime-interaction/stores/InMemoryRuntimeInteractionStore.js';
import { createPersistedQueueFixture } from './helpers/persisted-queue-fixture.js';

it('a reopened question holds its own queued step while independent work for the same cat can start', async () => {
  const messages = new MessageStore();
  const store = new InMemoryRuntimeInteractionStore();
  const fixture = createPersistedQueueFixture(messages, undefined, {
    conversationQuestionStartGuard: new ConversationQuestionStartGuard({ store, messages }),
  });
  const service = createConversationQuestionService({
    store,
    messages,
    delivery: fixture.delivery,
    socket: { broadcastToRoom() {}, emitToUser() {} },
    onError: (error) => {
      throw error;
    },
  });
  const owner = { userId: 'u', threadId: 't', catId: 'codex-sol', invocationId: 'original' };
  const busy = fixture.tracker.start('t', 'codex-sol', 'u');
  try {
    const q = await service.ask({
      owner,
      subjectRef: 'report-format',
      title: '格式',
      questions: [
        { id: 'format', header: '格式', question: '哪种格式？', options: [{ label: 'PDF' }, { label: 'Markdown' }] },
      ],
      continuations: [{ catId: 'codex-sol', workRef: 'report', work: '交付报告', afterAnswer: '按最新格式交付报告' }],
    });
    assert.ok(q.cardRef && q.conversation);
    const answered = await service.act({
      interactionId: q.request.interactionId,
      cardRef: q.cardRef,
      ownerUserId: 'u',
      expectedRevision: q.conversation.revision,
      action: 'answer',
      response: { kind: 'answers', answers: { format: ['PDF'] } },
    });
    assert.ok(answered.conversation);
    await service.clarify({
      interactionId: q.request.interactionId,
      owner,
      expectedRevision: answered.conversation.revision,
      text: '需要补充一个条件',
      questions: [{ id: 'format', header: '格式', question: '需要可编辑吗？' }],
    });
    fixture.tracker.complete('t', 'codex-sol', busy);
    const independent = await fixture.delivery.deliver({
      ownerAuthProvenance: 'strict',
      ownerUserId: 'u',
      threadId: 't',
      targetCatId: 'codex-sol',
      idempotencyKey: 'independent',
      content: '查清可编辑格式的事实，帮助用户判断',
      source: { connector: 'independent-research', label: '查事实', icon: 'i' },
      sourceCategory: 'producer_return',
    });
    assert.ok(independent.message);
    await fixture.waitForAwakening(independent.message.id);
    assert.equal(fixture.starts.length, 1);
    assert.match(fixture.prompts[0], /查清可编辑格式/);
    assert.equal(
      fixture.queue
        .list('t', 'u')
        .find((entry) => entry.messageId === answered.conversation?.continuations[0]?.messageId)?.status,
      'queued',
    );
  } finally {
    fixture.tracker.complete('t', 'codex-sol', busy);
    await fixture.close();
  }
});
