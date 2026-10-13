import assert from 'node:assert/strict';
import { it } from 'node:test';
import Fastify from 'fastify';
import { conversationQuestionTools } from '../../mcp-server/src/tools/conversation-question-tools.js';
import { withInvocationCredentials } from '../../mcp-server/src/tools/invocation-auth.js';
import { InvocationRegistry } from '../src/domains/cats/services/agents/invocation/InvocationRegistry.js';
import { MessageStore } from '../src/domains/cats/services/stores/ports/MessageStore.js';
import { createConversationQuestionService } from '../src/domains/runtime-interaction/conversation-question-composition.js';
import { InMemoryRuntimeInteractionStore } from '../src/domains/runtime-interaction/stores/InMemoryRuntimeInteractionStore.js';
import { callbackConversationQuestionRoutes } from '../src/routes/conversation-question-routes.js';

it('the registered MCP handler publishes through the authenticated HTTP callback and reads the same question', async () => {
  const registry = new InvocationRegistry();
  const credentials = await registry.create(
    'u',
    'codex-sol',
    't',
    undefined,
    undefined,
    undefined,
    'original',
    'strict',
  );
  const store = new InMemoryRuntimeInteractionStore();
  const service = createConversationQuestionService({
    store,
    messages: new MessageStore(),
    socket: { broadcastToRoom() {}, emitToUser() {} },
    delivery: {
      deliver: async () => {
        throw new Error('must not resume before an answer');
      },
    },
    onError: (error) => {
      throw error;
    },
  });
  const app = Fastify();
  await app.register(callbackConversationQuestionRoutes, {
    service,
    registry,
    isAvailableCat: (id) => id === 'codex-sol',
  });
  const previous = process.env.CAT_CAFE_API_URL;
  try {
    process.env.CAT_CAFE_API_URL = await app.listen({ port: 0, host: '127.0.0.1' });
    const tool = conversationQuestionTools[0];
    assert.equal(tool.name, 'cat_cafe_conversation_question');
    const result = await withInvocationCredentials(credentials, () =>
      tool.handler({
        command: {
          action: 'ask',
          subjectRef: 'acceptance:format',
          title: '验收格式',
          questions: [
            {
              id: 'format',
              header: '格式',
              question: '用哪种格式？',
              options: [{ label: 'PDF' }, { label: 'Markdown' }],
            },
          ],
          continuations: [
            {
              catId: 'codex-sol',
              workRef: 'acceptance:summary',
              work: '完成验收摘要',
              afterAnswer: '按选择的格式完成摘要',
            },
          ],
        },
      }),
    );
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.interaction.status, 'pending');
    const read = await withInvocationCredentials(credentials, () =>
      tool.handler({ command: { action: 'read', interactionId: body.interaction.request.interactionId } }),
    );
    assert.notEqual(read.isError, true);
    assert.equal(JSON.parse(read.content[0].text).interaction.cardRef.messageId, body.interaction.cardRef.messageId);
    const invalid = await tool.handler({ command: { action: 'ask', owner: 'someone-else' } });
    assert.equal(invalid.isError, true);
  } finally {
    if (previous === undefined) delete process.env.CAT_CAFE_API_URL;
    else process.env.CAT_CAFE_API_URL = previous;
    await app.close();
  }
});
