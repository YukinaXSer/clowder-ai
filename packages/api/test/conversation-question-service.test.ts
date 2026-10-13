import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ConversationQuestionService } from '../src/domains/runtime-interaction/ConversationQuestionService.js';
import { InMemoryRuntimeInteractionStore } from '../src/domains/runtime-interaction/stores/InMemoryRuntimeInteractionStore.js';

const owner = { userId: 'owner', threadId: 'thread', catId: 'cat-a', invocationId: 'inv-a' };
const input = {
  owner,
  subjectRef: 'task:report:format',
  title: '报告格式',
  questions: [
    {
      id: 'format',
      header: '格式',
      question: '报告用什么格式？',
      isOther: true,
      options: [{ label: 'PDF' }, { label: 'Markdown' }],
    },
  ],
  continuations: [
    { catId: 'cat-a', workRef: 'report:write', work: '写报告', afterAnswer: '按选定格式完成原报告' },
    { catId: 'cat-b', workRef: 'report:review', work: '检查报告', afterAnswer: '按选定格式检查原报告的要求' },
  ],
};
function harness() {
  const store = new InMemoryRuntimeInteractionStore();
  const events: string[] = [];
  const service = new ConversationQuestionService({
    store,
    publisher: {
      prepare: async (request) => ({ threadId: 'thread', messageId: `msg:${request.interactionId}`, blockId: 'block' }),
      publish: async () => {
        events.push('question');
      },
      isLive: async () => true,
    },
    publishAnswer: async (record) => {
      assert.equal((await store.get(record.request.interactionId))?.status, record.status);
      events.push(record.status === 'cancelled' ? 'cancel' : 'answer');
    },
    resume: async (record, id) => {
      assert.ok(events.includes('answer'), 'shared answer must precede any continuation');
      events.push(`resume:${id}`);
      return { state: 'started', messageId: `resume:${id}` };
    },
    now: () => 100,
  });
  return { service, store, events };
}
it('coalesces the shared decision, holds declared work and resumes only after the durable shared answer', async () => {
  const { service, events } = harness();
  const question = await service.ask(input);
  const repeated = await service.ask(input);
  assert.equal(question.request.interactionId, repeated.request.interactionId);
  assert.equal(events.filter((x) => x === 'question').length, 1);
  assert.equal(events.filter((x) => x.startsWith('resume:')).length, 0);
  assert.equal(repeated.conversation?.continuations.length, 2);
  const answered = await service.act({
    ownerUserId: 'owner',
    interactionId: question.request.interactionId,
    cardRef: question.cardRef,
    expectedRevision: repeated.conversation?.revision,
    action: 'answer',
    response: { kind: 'answers', answers: { format: ['Markdown'] } },
  });
  assert.equal(answered.status, 'answered');
  assert.equal(events.filter((x) => x.startsWith('resume:')).length, 2);
  assert.deepEqual(answered.conversation?.history[0]?.answers, { format: ['Markdown'] });
});

it('recovers the saved answer after delivery failure without publishing a second answer', async () => {
  const { service, store, events } = harness();
  const q = await service.ask(input);
  const normalResume = service.deps.resume;
  service.deps.resume = async () => {
    throw new Error('transport unavailable');
  };
  const accepted = await service.act({
    ownerUserId: 'owner',
    interactionId: q.request.interactionId,
    cardRef: q.cardRef!,
    expectedRevision: q.conversation!.revision,
    action: 'answer',
    response: { kind: 'answers', answers: { format: ['自定义报告'] } },
  });
  assert.equal(accepted.conversation?.needsRecovery, true);
  assert.equal(events.filter((x) => x === 'answer').length, 1);
  assert.equal(events.filter((x) => x.startsWith('resume:')).length, 0);
  const restarted = new ConversationQuestionService({ ...service.deps, resume: normalResume });
  await restarted.recover();
  assert.equal((await store.get(q.request.interactionId))?.conversation?.needsRecovery, false);
  assert.equal(events.filter((x) => x === 'answer').length, 1);
  assert.equal(events.filter((x) => x.startsWith('resume:')).length, 2);
});

it('one concurrent answer wins; edits preserve history and reuse the same continuation identities', async () => {
  const { service } = harness();
  const q = await service.ask(input);
  const base = {
    ownerUserId: 'owner',
    interactionId: q.request.interactionId,
    cardRef: q.cardRef!,
    expectedRevision: q.conversation!.revision,
    action: 'answer' as const,
  };
  const results = await Promise.allSettled(
    ['PDF', 'Markdown'].map((answer) =>
      service.act({ ...base, response: { kind: 'answers', answers: { format: [answer] } } }),
    ),
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const first = await service.read(q.request.interactionId, owner);
  const edited = await service.act({
    ...base,
    expectedRevision: first.conversation!.revision,
    response: { kind: 'answers', answers: { format: ['其他格式'] } },
  });
  assert.equal(edited.conversation?.history.length, 2);
  assert.deepEqual(
    edited.conversation?.continuations.map((work) => work.id),
    first.conversation?.continuations.map((work) => work.id),
  );
  assert.equal(edited.conversation?.continuations[0]?.deliveredVersion, 2);
  await assert.rejects(service.read(q.request.interactionId, { ...owner, threadId: 'other-thread' }));
});

it('clarification reuses the card; a teammate may explain but cannot replace the question', async () => {
  const { service } = harness();
  const q = await service.ask(input);
  const note = {
    interactionId: q.request.interactionId,
    expectedRevision: q.conversation!.revision,
    text: 'Markdown 便于编辑',
    owner: { ...owner, catId: 'cat-b' },
  };
  await assert.rejects(service.clarify({ ...note, questions: input.questions }));
  const clarified = await service.clarify(note);
  assert.deepEqual(clarified.cardRef, q.cardRef);
  assert.equal(clarified.conversation?.notes.length, 1);
  assert.equal(clarified.status, 'pending');
  await assert.rejects(service.ask({ ...input, questions: [{ ...input.questions[0]!, isSecret: true }] }));
});

it('a follow-up from the resumed invocation registers a new checkpoint on the same question', async () => {
  const { service } = harness();
  const q = await service.ask(input);
  assert.ok(q.cardRef && q.conversation);
  const answered = await service.act({
    ownerUserId: 'owner',
    interactionId: q.request.interactionId,
    cardRef: q.cardRef,
    expectedRevision: q.conversation.revision,
    action: 'answer',
    response: { kind: 'answers', answers: { format: ['Markdown'] } },
  });
  assert.ok(answered.conversation);
  const original = answered.conversation.continuations.find((work) => work.catId === 'cat-a');
  assert.ok(original?.messageId);
  const clarification = await service.clarify({
    owner: { ...owner, invocationId: 'resumed' },
    sourceMessageId: original.messageId,
    interactionId: q.request.interactionId,
    expectedRevision: answered.conversation.revision,
    text: '补充交付条件',
    questions: input.questions,
  });
  assert.ok(clarification.conversation);
  const replacement = clarification.conversation.continuations.find((work) => work.invocationId === 'resumed');
  assert.ok(replacement);
  assert.notEqual(replacement.id, original.id);
  assert.equal(
    clarification.conversation.continuations.find((work) => work.id === original.id)?.supersededBy,
    replacement.id,
  );
  assert.deepEqual(clarification.cardRef, q.cardRef);
  const final = await service.act({
    ownerUserId: 'owner',
    interactionId: q.request.interactionId,
    cardRef: q.cardRef,
    expectedRevision: clarification.conversation.revision,
    action: 'answer',
    response: { kind: 'answers', answers: { format: ['有目录的 Markdown'] } },
  });
  assert.equal(final.conversation?.continuations.find((work) => work.id === replacement.id)?.deliveredVersion, 2);
});
it('defer is not consent; cancel resumes no work; stale and foreign responses cannot settle', async () => {
  const { service, events } = harness();
  const q = await service.ask(input);
  const base = {
    interactionId: q.request.interactionId,
    cardRef: q.cardRef,
    expectedRevision: q.conversation?.revision,
  };
  await assert.rejects(service.act({ ...base, ownerUserId: 'intruder', action: 'cancel' }));
  const deferred = await service.act({ ...base, ownerUserId: 'owner', action: 'defer' });
  assert.equal(deferred.status, 'pending');
  assert.equal(deferred.conversation?.deferred, true);
  await assert.rejects(
    service.act({
      ...base,
      ownerUserId: 'owner',
      action: 'answer',
      response: { kind: 'answers', answers: { format: ['PDF'] } },
    }),
  );
  const cancelled = await service.act({
    ...base,
    expectedRevision: deferred.conversation?.revision,
    ownerUserId: 'owner',
    action: 'cancel',
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(events.filter((x) => x.startsWith('resume:')).length, 0);
});
