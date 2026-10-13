import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { BallCustodyEvent } from '@cat-cafe/shared';
import Fastify from 'fastify';
import { TurnCustodyProjectionService } from '../src/domains/ball-custody/TurnCustodyProjectionService.js';
import { InvocationQueue } from '../src/domains/cats/services/agents/invocation/InvocationQueue.js';
import { InvocationRegistry } from '../src/domains/cats/services/agents/invocation/InvocationRegistry.js';
import { PersistedQueueDelivery } from '../src/domains/cats/services/agents/invocation/PersistedQueueDelivery.js';
import { QueuedMessageCustodyCoordinator } from '../src/domains/cats/services/agents/invocation/QueuedMessageCustodyCoordinator.js';
import { buildCodexAsyncQuestionMessages } from '../src/domains/cats/services/agents/providers/codex-async-question.js';
import { MessageStore } from '../src/domains/cats/services/stores/ports/MessageStore.js';
import { adoptProviderQuestion } from '../src/domains/runtime-interaction/adopt-provider-question.js';
import { ConversationQuestionStartGuard } from '../src/domains/runtime-interaction/ConversationQuestionStartGuard.js';
import {
  createConversationQuestionService,
  withdrawQuestionContinuations,
} from '../src/domains/runtime-interaction/conversation-question-composition.js';
import { InMemoryRuntimeInteractionStore } from '../src/domains/runtime-interaction/stores/InMemoryRuntimeInteractionStore.js';
import {
  callbackConversationQuestionRoutes,
  conversationQuestionRoutes,
} from '../src/routes/conversation-question-routes.js';
import { createPersistedQueueFixture } from './helpers/persisted-queue-fixture.js';

it('callback question → owner answer → shared fact → exact original-work queue carrier; edits update the dispatch context', async () => {
  const registry = new InvocationRegistry();
  const credentials = await registry.create(
    'owner',
    'cat-a',
    'thread',
    undefined,
    undefined,
    undefined,
    'original-request',
    'strict',
  );
  const headers = { 'x-invocation-id': credentials.invocationId, 'x-callback-token': credentials.callbackToken };
  const store = new InMemoryRuntimeInteractionStore();
  const messages = new MessageStore();
  const queue = new InvocationQueue();
  const custody = new QueuedMessageCustodyCoordinator({ messageStore: messages });
  const progress: string[] = [];
  const guard = new ConversationQuestionStartGuard({ store, messages });
  const delivery = new PersistedQueueDelivery({
    messages,
    queue,
    progress: async (entry, catId) => {
      const decision = await guard.check({
        messageId: entry.messageId!,
        threadId: entry.threadId,
        userId: entry.userId,
        catId,
      });
      assert.equal(decision.ready, true);
      progress.push(decision.context!);
      return { state: 'owned_deferred_busy' };
    },
  });
  const events: BallCustodyEvent[] = [];
  const gate = new TurnCustodyProjectionService({
    ballCustodyEventLog: { read: async (_key, from = 0) => events.slice(from) },
  });
  const opened = {
    state: 'covered_active' as const,
    evidenceRefs: [],
    baseline: {
      kind: 'structured' as const,
      subjectKey: 'ball:thread:thread',
      holderCatId: 'cat-a',
      fromSequence: 0,
      protocol: 'dispatch' as const,
    },
  };
  assert.equal((await gate.close(opened)).shouldBlock, true);
  const errors: unknown[] = [];
  const service = createConversationQuestionService({
    store,
    messages,
    delivery,
    ballCustody: {
      record: async (event) => {
        if (!events.some((existing) => existing.sourceEventId === event.sourceEventId)) events.push(event);
      },
    },
    socket: { broadcastToRoom() {}, emitToUser() {} },
    onError: (error) => errors.push(error),
    cancelQueued: (record) => withdrawQuestionContinuations(record, queue, custody),
  });
  const app = Fastify();
  await app.register(callbackConversationQuestionRoutes, {
    service,
    registry,
    isAvailableCat: (id) => ['cat-a', 'cat-b'].includes(id),
  });
  await app.register(conversationQuestionRoutes, { service });
  try {
    const payload = {
      action: 'ask',
      subjectRef: 'original:format',
      title: '报告格式',
      questions: [
        { id: 'format', header: '格式', question: '选择格式', options: [{ label: 'PDF' }, { label: 'Markdown' }] },
      ],
      continuations: [
        { catId: 'cat-a', workRef: 'original:write', work: '完成原报告', afterAnswer: '按格式完成报告' },
        { catId: 'cat-b', workRef: 'original:review', work: '检查报告要求', afterAnswer: '按格式核对要求' },
      ],
    };
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/callbacks/conversation-question', payload })).statusCode,
      401,
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/callbacks/conversation-question',
      headers,
      payload,
    });
    assert.equal(response.statusCode, 200, response.body);
    const q = response.json().interaction;
    assert.equal(
      (await gate.close(opened)).shouldBlock,
      false,
      'a durable question must actually transfer the current stop obligation to the owner',
    );
    const handoff = events.find((event) => event.kind === 'ball.handed_cvo');
    assert.ok(handoff);
    const receipt = await messages.getById(handoff.sourceEventId.slice('route:'.length));
    assert.equal(receipt?.catId, 'cat-a');
    assert.equal(receipt?.replyTo, 'original-request', 'handoff retains exact dispatch lineage');
    assert.equal(queue.list('thread', 'owner').length, 0, 'waiting must not admit a runnable carrier');
    const answerPayload = {
      cardRef: q.cardRef,
      expectedRevision: q.conversation.revision,
      action: 'answer',
      response: { kind: 'answers', answers: { format: ['Markdown'] } },
    };
    const url = `/api/runtime-interactions/${q.request.interactionId}/conversation`;
    assert.equal(
      (await app.inject({ method: 'POST', url, headers: { 'x-cat-cafe-user': 'intruder' }, payload: answerPayload }))
        .statusCode,
      404,
    );
    const answered = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-cat-cafe-user': 'owner' },
      payload: answerPayload,
    });
    assert.equal(answered.statusCode, 200, answered.body);
    assert.deepEqual(errors, []);
    assert.equal(queue.list('thread', 'owner').length, 2);
    assert.equal(progress.length, 2);
    assert.ok(progress.every((context) => context.includes('Markdown')));
    assert.equal(
      (await app.inject({ method: 'POST', url, headers: { 'x-cat-cafe-user': 'owner' }, payload: answerPayload }))
        .statusCode,
      409,
    );
    const changed = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-cat-cafe-user': 'owner' },
      payload: {
        ...answerPayload,
        expectedRevision: answered.json().interaction.conversation.revision,
        response: { kind: 'answers', answers: { format: ['PDF'] } },
      },
    });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.deepEqual(errors, []);
    assert.equal(queue.list('thread', 'owner').length, 2, 'an edit must not create another execution');
    const entry = queue.list('thread', 'owner')[0]!;
    const current = await guard.check({
      messageId: entry.messageId!,
      threadId: 'thread',
      userId: 'owner',
      catId: entry.targetCats[0]!,
    });
    assert.ok(current.context?.includes('PDF'));
    const amended = await service.clarify({
      owner: { userId: 'owner', threadId: 'thread', catId: 'cat-a', invocationId: credentials.invocationId },
      interactionId: q.request.interactionId,
      expectedRevision: changed.json().interaction.conversation.revision,
      text: '补充一个条件',
      questions: payload.questions,
    });
    assert.deepEqual(amended.cardRef, q.cardRef);
    assert.equal(
      (
        await guard.check({
          messageId: entry.messageId!,
          threadId: 'thread',
          userId: 'owner',
          catId: entry.targetCats[0]!,
        })
      ).ready,
      false,
    );
    await delivery.deliver({
      ownerAuthProvenance: 'strict',
      ownerUserId: 'owner',
      threadId: 'thread',
      targetCatId: 'cat-b',
      idempotencyKey: 'unrelated-work',
      content: '继续查不受格式影响的事实',
      sourceCategory: 'producer_return',
      source: { connector: 'unrelated', label: '独立调查', icon: 'search' },
    });
    const cancelled = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-cat-cafe-user': 'owner' },
      payload: { cardRef: q.cardRef, expectedRevision: amended.conversation!.revision, action: 'cancel' },
    });
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(queue.list('thread', 'owner').length, 1);
    assert.equal(queue.list('thread', 'owner')[0]?.content, '继续查不受格式影响的事实');
  } finally {
    await app.close();
  }
});

it('adopts a real structured provider event into one durable question; ordinary numbered text is untouched', async () => {
  const asked: unknown[] = [];
  const owner = { userId: 'owner', threadId: 'thread', catId: 'cat-a', invocationId: 'inv' };
  const providerOutput = buildCodexAsyncQuestionMessages(
    { id: 'item-1', delivery: 'async', questions: [{ title: '格式？', options: ['PDF', 'Markdown'] }] },
    'cat-a',
  );
  assert.equal(
    await adoptProviderQuestion({
      message: providerOutput[0]!,
      owner,
      ownerAuthProvenance: 'strict',
      sourceMessageId: 'original',
      originalWork: '写报告',
      ask: async (input) => {
        asked.push(input);
        return {} as never;
      },
    }),
    true,
  );
  assert.equal(asked.length, 1);
  assert.match(JSON.stringify(asked), /写报告/);
  assert.equal(
    await adoptProviderQuestion({
      message: { type: 'text', catId: 'cat-a', content: '1. PDF\n2. Markdown', timestamp: 1 },
      owner,
      ownerAuthProvenance: 'strict',
    }),
    false,
  );
  await assert.rejects(
    adoptProviderQuestion({
      message: providerOutput[0]!,
      owner,
      ownerAuthProvenance: 'unknown',
      ask: async () => ({}) as never,
    }),
  );
});

it('the real QueueProcessor starts the original-work continuation with the shared answer and records its consumption', async () => {
  const store = new InMemoryRuntimeInteractionStore();
  const messages = new MessageStore();
  const registry = new InvocationRegistry();
  const guard = new ConversationQuestionStartGuard({ store, messages });
  const h = createPersistedQueueFixture(messages, registry, { conversationQuestionStartGuard: guard });
  const errors: unknown[] = [];
  const service = createConversationQuestionService({
    store,
    messages,
    delivery: h.delivery,
    socket: { broadcastToRoom() {}, emitToUser() {} },
    onError: (error) => errors.push(error),
  });
  try {
    const q = await service.ask({
      owner: { userId: 'owner', threadId: 'thread', catId: 'cat-a', invocationId: 'original' },
      subjectRef: 'work:publish:format',
      title: '交付格式',
      questions: [
        {
          id: 'format',
          header: '格式',
          question: '选一个格式',
          isOther: true,
          options: [{ label: 'PDF' }, { label: 'Markdown' }],
        },
      ],
      continuations: [{ catId: 'cat-a', workRef: 'work:publish', work: '完成报告', afterAnswer: '继续完成原报告' }],
    });
    assert.equal(h.starts.length, 0);
    const answer = await service.act({
      interactionId: q.request.interactionId,
      ownerUserId: 'owner',
      cardRef: q.cardRef!,
      expectedRevision: q.conversation!.revision,
      action: 'answer',
      response: { kind: 'answers', answers: { format: ['Markdown'] } },
    });
    assert.deepEqual(errors, []);
    const messageId = answer.conversation!.continuations[0]!.messageId!;
    const invocationId = await h.waitForAwakening(messageId);
    assert.equal(h.starts.length, 1);
    assert.match(h.prompts[0]!, /继续完成原报告/);
    assert.match(h.prompts[0]!, /共同决定 v1/);
    assert.match(h.prompts[0]!, /Markdown/);
    const consumed = await service.read(
      q.request.interactionId,
      { userId: 'owner', threadId: 'thread', catId: 'cat-a', invocationId },
      messageId,
    );
    assert.equal(consumed.conversation!.continuations[0]!.consumedVersion, 1);
    assert.equal(
      (
        await service.read(
          q.request.interactionId,
          { userId: 'owner', threadId: 'thread', catId: 'cat-b', invocationId: 'unrelated' },
          messageId,
        )
      ).conversation!.continuations[0]!.consumedVersion,
      1,
    );
  } finally {
    await h.close();
  }
});
