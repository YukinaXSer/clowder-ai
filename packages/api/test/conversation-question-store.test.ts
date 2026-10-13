import assert from 'node:assert/strict';
import { it } from 'node:test';
import { InMemoryRuntimeInteractionStore } from '../src/domains/runtime-interaction/stores/InMemoryRuntimeInteractionStore.js';

it('keeps a conversation question when its asking invocation ends or the host restarts', async () => {
  const store = new InMemoryRuntimeInteractionStore();
  await store.createStaged({
    hostEpoch: 'old-host',
    now: 1,
    request: {
      version: 1,
      interactionId: 'shared-question',
      kind: 'question',
      createdAt: 1,
      owner: { userId: 'owner', threadId: 'thread', catId: 'cat', invocationId: 'inv' },
      provider: { providerId: 'cat-cafe', method: 'conversation/question', requestId: 'shared-question' },
      title: '选择格式',
      questions: [{ id: 'format', header: '格式', question: '用什么格式？', isOther: true }],
      conversation: { subjectRef: 'work:report:format' },
    },
  });
  await store.anchor('shared-question', 'old-host', { threadId: 'thread', messageId: 'message', blockId: 'block' }, 2);
  assert.deepEqual(await store.invalidateByInvocation('inv', 'transport_lost', 3), []);
  assert.deepEqual(await store.invalidateActiveFromOtherHostEpoch('new-host', 'host_restarted', 4), []);
  assert.equal((await store.get('shared-question'))?.status, 'pending');
  const shared = await store.get('shared-question');
  assert.ok(shared && shared.request.kind === 'question');
  const { conversation: _conversation, ...native } = shared.request;
  await store.createStaged({
    hostEpoch: 'new-host',
    now: 5,
    request: { ...native, interactionId: 'native-independent' },
  });
  assert.equal(
    (await store.get('native-independent'))?.status,
    'staged',
    'a durable shared question does not occupy the native single-waiter slot',
  );
});
