import type { RuntimeInteractionRecord } from '@cat-cafe/shared';
import type { ConversationQuestionService, DurableQuestion } from './ConversationQuestionService.js';

type RecoveryDeps = Pick<
  ConversationQuestionService['deps'],
  'store' | 'publisher' | 'publishAnswer' | 'resume' | 'registerWait'
> & {
  asQuestion(record: RuntimeInteractionRecord): DurableQuestion;
  save(previous: DurableQuestion, next: DurableQuestion): Promise<boolean>;
};

/** Publication and scheduling are replayable; the canonical CAS state owns progress. */
export async function recoverConversationQuestion(id: string, deps: RecoveryDeps): Promise<void> {
  for (let attempt = 0; attempt < 32; attempt++) {
    const raw = await deps.store.get(id);
    if (!raw?.conversation?.needsRecovery) return;
    const current = deps.asQuestion(raw);
    await recoverStep(current, deps);
  }
}

async function recoverStep(current: DurableQuestion, deps: RecoveryDeps): Promise<void> {
  if (current.status === 'staged') {
    const cardRef = await deps.publisher.prepare(current.request);
    await deps.save(current, { ...current, cardRef, status: 'pending' });
    return;
  }
  if (current.status === 'pending') {
    if (!current.cardRef) throw new Error('Question has no canonical card');
    await deps.publisher.publish(current.request, current.cardRef);
    await deps.registerWait?.(current);
    await deps.save(current, { ...current, conversation: { ...current.conversation, needsRecovery: false } });
    return;
  }
  if (current.status === 'cancelled') {
    await deps.publishAnswer(current);
    await deps.save(current, {
      ...current,
      conversation: { ...current.conversation, cancelPublished: true, needsRecovery: false },
    });
    return;
  }
  if (current.status === 'answered') await recoverAnswer(current, deps);
}

async function recoverAnswer(current: DurableQuestion, deps: RecoveryDeps): Promise<void> {
  const version = current.conversation.history.at(-1)?.version ?? 0;
  if (current.conversation.publishedVersion < version) {
    await deps.publishAnswer(current);
    await deps.save(current, { ...current, conversation: { ...current.conversation, publishedVersion: version } });
    return;
  }
  const pending = current.conversation.continuations.find(
    (work) => !work.supersededBy && work.deliveredVersion < version,
  );
  if (!pending) {
    await deps.save(current, { ...current, conversation: { ...current.conversation, needsRecovery: false } });
    return;
  }
  const result = await deps.resume(current, pending.id);
  if (result.state === 'unavailable' || result.state === 'conflict') throw new Error(`Question resume ${result.state}`);
  const continuations = current.conversation.continuations.map((work) =>
    work.id === pending.id
      ? {
          ...work,
          deliveredVersion: version,
          deliveryState: result.state,
          ...(result.messageId ? { messageId: result.messageId } : {}),
        }
      : work,
  );
  await deps.save(current, { ...current, conversation: { ...current.conversation, continuations } });
}
