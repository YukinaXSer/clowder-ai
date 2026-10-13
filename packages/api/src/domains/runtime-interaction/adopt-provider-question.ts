import type { RuntimeInteractionOwner } from '@cat-cafe/shared';
import { conversationQuestionCommandSchema } from '@cat-cafe/shared';
import type { AgentMessage } from '../cats/services/types.js';
import type { ConversationQuestionService } from './ConversationQuestionService.js';

export async function adoptProviderQuestion(input: {
  message: AgentMessage;
  owner: RuntimeInteractionOwner;
  ownerAuthProvenance: string;
  sourceMessageId?: string;
  originalWork?: string;
  ask?: ConversationQuestionService['ask'];
}): Promise<boolean> {
  if (input.message.type !== 'system_info' || !input.message.content) return false;
  let payload: { type?: string; conversationQuestion?: { itemId?: string; questions?: unknown } };
  try {
    payload = JSON.parse(input.message.content);
  } catch {
    return false;
  }
  if (payload.type !== 'rich_block' || !payload.conversationQuestion) return false;
  if (!input.ask || input.ownerAuthProvenance !== 'strict')
    throw new Error('Structured question requires an authenticated conversation owner');
  const item = payload.conversationQuestion;
  if (typeof item.itemId !== 'string' || !item.itemId) throw new Error('Structured question has no provider identity');
  const parsed = conversationQuestionCommandSchema.parse({
    action: 'ask',
    subjectRef: `provider-question:${input.owner.invocationId}:${item.itemId}`,
    title: '继续当前工作前，需要你选择',
    questions: item.questions,
    continuations: [
      {
        catId: input.owner.catId,
        workRef: `provider:${item.itemId}`,
        work: '继续提问前的工作',
        afterAnswer: [
          `原消息：${input.sourceMessageId ?? '见原执行记录'}`,
          input.originalWork?.slice(0, 3000) ?? '',
          '读取最新问题答案，继续原任务；需要补充条件时在原问题上 clarify。',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  });
  if (parsed.action !== 'ask') throw new Error('Invalid provider question');
  await input.ask({
    ...parsed,
    owner: input.owner,
    ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
  });
  return true;
}
