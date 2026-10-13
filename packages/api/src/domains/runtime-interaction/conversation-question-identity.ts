import { createHash } from 'node:crypto';
import type { ConversationQuestionContinuation, RuntimeInteractionOwner } from '@cat-cafe/shared';
import type { DurableQuestion } from './ConversationQuestionService.js';

export function clarificationContinuations(
  current: DurableQuestion,
  owner: RuntimeInteractionOwner,
  sourceMessageId?: string,
): readonly ConversationQuestionContinuation[] {
  const source = current.conversation.continuations.find(
    (work) => !work.supersededBy && work.catId === owner.catId && sourceMessageId && work.messageId === sourceMessageId,
  );
  if (!source) return current.conversation.continuations;
  const id = digest([source.id, owner.invocationId, String(current.conversation.revision)]);
  const next: ConversationQuestionContinuation = {
    id,
    workRef: source.workRef,
    catId: owner.catId,
    invocationId: owner.invocationId,
    work: source.work,
    afterAnswer: `在已完成进展上续做，读取补问后的答案：${source.afterAnswer}`,
    deliveredVersion: 0,
  };
  return [
    ...current.conversation.continuations.map((work) => (work.id === source.id ? { ...work, supersededBy: id } : work)),
    next,
  ];
}

export function digest(value: string[]): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}
