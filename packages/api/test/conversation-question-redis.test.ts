import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import type { RuntimeInteractionRecord } from '@cat-cafe/shared';
import { createRedisClient } from '@cat-cafe/shared/utils';
import {
  RedisRuntimeInteractionStore,
  RuntimeInteractionKeys,
} from '../src/domains/runtime-interaction/stores/RedisRuntimeInteractionStore.js';

it('retains questions and answer history across an isolated Redis restart; concurrent CAS has one winner and no TTL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'conversation-question-redis-'));
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  probe.close();
  await once(probe, 'close');
  let server: ReturnType<typeof spawn> | undefined;
  let redis: ReturnType<typeof createRedisClient> | undefined;
  async function start() {
    server = spawn(
      'redis-server',
      [
        '--bind',
        '127.0.0.1',
        '--port',
        String(port),
        '--dir',
        directory,
        '--save',
        '',
        '--appendonly',
        'yes',
        '--appendfsync',
        'always',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Isolated Redis did not start within 10 seconds')), 10_000);
      server!.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      server!.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Isolated Redis exited: ${code}`));
      });
      server!.stdout!.on('data', (chunk) => {
        if (String(chunk).includes('Ready to accept connections')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    redis = createRedisClient({ url: `redis://127.0.0.1:${port}`, keyPrefix: 'question-test:' });
    redis.on('error', () => {});
    await redis.ping();
    return new RedisRuntimeInteractionStore(redis);
  }
  async function stop() {
    redis?.disconnect();
    if (server && server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM');
      await once(server, 'exit');
    }
  }
  try {
    const store = await start();
    const record: RuntimeInteractionRecord = {
      request: {
        version: 1,
        interactionId: 'shared',
        kind: 'question',
        createdAt: 1,
        title: '选择格式',
        owner: { userId: 'owner', threadId: 'thread', catId: 'cat', invocationId: 'inv' },
        provider: { providerId: 'cat-cafe', method: 'conversation/question', requestId: 'shared' },
        conversation: { subjectRef: 'report:format' },
        questions: [{ id: 'format', header: '格式', question: '什么格式？' }],
      },
      status: 'pending',
      hostEpoch: 'durable-conversation',
      updatedAt: 1,
      cardRef: { threadId: 'thread', messageId: 'msg', blockId: 'block' },
      conversation: {
        revision: 1,
        deferred: false,
        history: [],
        continuations: [],
        publishedVersion: 0,
        needsRecovery: false,
        notes: [],
      },
    };
    assert.equal(await store.saveConversation(record, null), true);
    const answer = {
      ...record,
      status: 'answered' as const,
      conversation: {
        ...record.conversation!,
        revision: 2,
        needsRecovery: true,
        history: [
          {
            version: 1,
            at: 2,
            answers: { format: ['Markdown'] },
            questions: record.request.kind === 'question' ? record.request.questions : [],
          },
        ],
      },
    };
    const second = new RedisRuntimeInteractionStore(redis!);
    assert.equal(
      (await Promise.all([store.saveConversation(answer, 1), second.saveConversation(answer, 1)])).filter(Boolean)
        .length,
      1,
    );
    assert.equal(await redis!.pttl(RuntimeInteractionKeys.detail('shared')), -1);
    await stop();
    const restarted = await start();
    assert.deepEqual((await restarted.get('shared'))?.conversation?.history[0]?.answers, { format: ['Markdown'] });
    assert.equal((await restarted.listConversationsNeedingRecovery()).length, 1);
    assert.deepEqual(await restarted.invalidateActiveFromOtherHostEpoch('fresh-host', 'host_restarted', 5), []);
    assert.equal(await redis!.pttl(RuntimeInteractionKeys.detail('shared')), -1);
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
