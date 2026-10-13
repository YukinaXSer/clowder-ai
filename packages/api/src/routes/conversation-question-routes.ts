import {
  type ConversationQuestionCommand,
  conversationQuestionCommandSchema,
  type RuntimeInteractionOwner,
} from '@cat-cafe/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { InvocationRegistry } from '../domains/cats/services/agents/invocation/InvocationRegistry.js';
import type { ConversationQuestionService } from '../domains/runtime-interaction/ConversationQuestionService.js';
import { RuntimeInteractionError } from '../domains/runtime-interaction/RuntimeInteractionService.js';
import { resolveStrictUserId } from '../utils/request-identity.js';
import { registerCallbackAuthHook, requireCallbackAuth } from './callback-auth-prehandler.js';

const ref = z.string().trim().min(1).max(240);
const actionSchema = z
  .object({
    cardRef: z.object({ threadId: ref, messageId: ref, blockId: ref }).strict(),
    expectedRevision: z.number().int().positive(),
    action: z.enum(['answer', 'defer', 'cancel', 'retry']),
    response: z.unknown().optional(),
  })
  .strict();
export const conversationQuestionRoutes: FastifyPluginAsync<{ service: ConversationQuestionService }> = async (
  app,
  { service },
) => {
  app.post<{ Params: { interactionId: string } }>(
    '/api/runtime-interactions/:interactionId/conversation',
    async (request, reply) => {
      const ownerUserId = resolveStrictUserId(request);
      if (!ownerUserId) return reply.code(401).send({ error: 'Authenticated owner session required' });
      const parsed = actionSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: 'Invalid question action', details: parsed.error.flatten() });
      try {
        return {
          interaction: await service.act({ ...parsed.data, interactionId: request.params.interactionId, ownerUserId }),
        };
      } catch (error) {
        return respondError(error, reply);
      }
    },
  );
};
export const callbackConversationQuestionRoutes: FastifyPluginAsync<{
  service: ConversationQuestionService;
  registry: InvocationRegistry;
  isAvailableCat: (catId: string) => boolean;
}> = async (app, { service, registry, isAvailableCat }) => {
  registerCallbackAuthHook(app, registry);
  app.post('/api/callbacks/conversation-question', async (request, reply) => {
    const auth = requireCallbackAuth(request, reply);
    if (!auth) return;
    const parsed = conversationQuestionCommandSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'Invalid conversation question command', details: parsed.error.flatten() });
    const input = parsed.data;
    if (input.action !== 'read' && (auth.ownerAuthProvenance !== 'strict' || auth.executionGrant)) {
      return reply.code(403).send({ error: 'Question creation requires authenticated owner-work authority' });
    }
    const owner = { userId: auth.userId, threadId: auth.threadId, catId: auth.catId, invocationId: auth.invocationId };
    try {
      if ('continuations' in input && input.continuations.some((work) => !isAvailableCat(work.catId)))
        throw new RuntimeInteractionError('invalid_response', '依赖工作包含不可用的猫');
      const interaction = await runCommand(service, input, owner, auth.originTriggerMessageId);
      return {
        interaction,
        instruction:
          interaction.status === 'pending'
            ? '等待已登记。不要执行列出的依赖工作或另开重复问题；不依赖答案的调查和解释可以继续。用户回答后系统会续接原工作。'
            : interaction.status === 'cancelled'
              ? '该项工作已取消，不要续接。'
              : '按最新共同答案继续原工作；先前已执行的效果不自动撤销。',
      };
    } catch (error) {
      return respondError(error, reply);
    }
  });
};
function respondError(error: unknown, reply: import('fastify').FastifyReply) {
  if (!(error instanceof RuntimeInteractionError)) throw error;
  const status =
    error.code === 'not_found' || error.code === 'unauthorized' ? 404 : error.code === 'invalid_response' ? 400 : 409;
  return reply.code(status).send({ error: status === 404 ? 'Question not found' : error.message });
}

async function runCommand(
  service: ConversationQuestionService,
  input: ConversationQuestionCommand,
  owner: RuntimeInteractionOwner,
  sourceMessageId?: string,
) {
  const context = { owner, ...(sourceMessageId ? { sourceMessageId } : {}) };
  switch (input.action) {
    case 'ask':
      return service.ask({ ...input, ...context });
    case 'read':
      return service.read(input.interactionId, owner, sourceMessageId);
    case 'clarify':
      return service.clarify({ ...input, ...context });
    case 'join': {
      const existing = await service.read(input.interactionId, owner);
      if (existing.request.kind !== 'question' || !existing.request.conversation)
        throw new RuntimeInteractionError('not_found', 'Question not found');
      return service.ask({
        ...context,
        subjectRef: existing.request.conversation.subjectRef,
        title: existing.request.title,
        questions: existing.request.questions,
        continuations: input.continuations,
      });
    }
  }
}
