import { isDeepStrictEqual } from 'node:util';
import {
  type ConversationQuestionContinuation,
  type ConversationQuestionState,
  parseRuntimeInteractionRequest,
  parseRuntimeInteractionResponse,
  type RuntimeInteractionCardRef,
  type RuntimeInteractionOwner,
  type RuntimeInteractionRecord,
  type RuntimeInteractionRequest,
  type RuntimeInteractionResponse,
} from '@cat-cafe/shared';
import { recoverConversationQuestion } from './ConversationQuestionRecovery.js';
import { clarificationContinuations, digest } from './conversation-question-identity.js';
import type { RuntimeInteractionStore } from './ports/RuntimeInteractionStore.js';
import { type RuntimeInteractionCardPublisher, RuntimeInteractionError } from './RuntimeInteractionService.js';

type Question = Extract<RuntimeInteractionRequest, { kind: 'question' }>;
export interface ConversationQuestionWork {
  catId: string;
  workRef: string;
  work: string;
  afterAnswer: string;
}
export interface AskConversationQuestion {
  owner: RuntimeInteractionOwner;
  sourceMessageId?: string;
  subjectRef: string;
  title: string;
  questions: Question['questions'];
  continuations: ConversationQuestionWork[];
}
export interface ConversationQuestionAction {
  ownerUserId: string;
  interactionId: string;
  cardRef: RuntimeInteractionCardRef;
  expectedRevision: number;
  action: 'answer' | 'defer' | 'cancel' | 'retry';
  response?: unknown;
}
export type DurableQuestion = RuntimeInteractionRecord & { request: Question; conversation: ConversationQuestionState };

export class ConversationQuestionService {
  private readonly recovering = new Map<string, Promise<void>>();
  constructor(
    readonly deps: {
      store: RuntimeInteractionStore;
      publisher: RuntimeInteractionCardPublisher;
      registerWait?: (record: DurableQuestion) => Promise<void>;
      publishAnswer: (record: RuntimeInteractionRecord) => Promise<void>;
      resume: (
        record: RuntimeInteractionRecord,
        continuationId: string,
      ) => Promise<{ state: string; messageId?: string }>;
      now?: () => number;
      onUpdated?: (record: RuntimeInteractionRecord) => void;
      onRecoveryError?: (error: unknown) => void;
    },
  ) {}

  async ask(input: AskConversationQuestion): Promise<RuntimeInteractionRecord> {
    if (input.questions.some((q) => q.isSecret)) throw invalid('共同问题不能收集密码或其他秘密');
    const id = `question-${digest([input.owner.userId, input.owner.threadId, input.subjectRef])}`;
    const request = parseRuntimeInteractionRequest({
      version: 1,
      kind: 'question',
      interactionId: id,
      owner: input.owner,
      provider: { providerId: 'cat-cafe', method: 'conversation/question', requestId: id },
      createdAt: this.now(),
      title: input.title,
      questions: input.questions.map((q) => ({ ...q, isOther: true })),
      conversation: { subjectRef: input.subjectRef },
    });
    for (let attempt = 0; attempt < 16; attempt++) {
      const existing = await this.deps.store.get(id);
      if (!existing) {
        const record: RuntimeInteractionRecord = {
          request,
          hostEpoch: 'durable-conversation',
          status: 'staged',
          updatedAt: this.now(),
          conversation: {
            revision: 1,
            deferred: false,
            history: [],
            continuations: this.work(input),
            publishedVersion: 0,
            needsRecovery: true,
            notes: [],
            waiters: [waiter(input, 0)],
          },
        };
        if (!(await this.deps.store.saveConversation(record, null))) continue;
      } else {
        const current = asQuestion(existing);
        if (current.status === 'cancelled') return current;
        const byId = new Map(current.conversation.continuations.map((work) => [work.id, work]));
        for (const work of this.work(input)) {
          const previous = byId.get(work.id);
          if (previous && (previous.work !== work.work || previous.afterAnswer !== work.afterAnswer)) {
            throw new RuntimeInteractionError('duplicate', '同一工作引用已有不同续接内容；请读取原问题');
          }
          if (!previous) byId.set(work.id, work);
        }
        const waiters = current.conversation.waiters ?? [];
        const registration = waiter(input, current.conversation.history.length);
        const newWaiter =
          current.status === 'pending' && !waiters.some((value) => isDeepStrictEqual(value, registration));
        if (byId.size !== current.conversation.continuations.length || newWaiter) {
          if (
            !(await this.save(current, {
              ...current,
              conversation: {
                ...current.conversation,
                continuations: [...byId.values()],
                needsRecovery:
                  current.conversation.needsRecovery ||
                  newWaiter ||
                  current.status === 'answered' ||
                  current.status === 'staged',
                waiters: newWaiter ? [...waiters, registration] : waiters,
              },
            }))
          )
            continue;
        }
      }
      await this.recoverOne(id);
      return this.require(id, input.owner.userId, input.owner.threadId);
    }
    throw new RuntimeInteractionError('stale', '问题正在更新，请重试');
  }

  async act(input: ConversationQuestionAction): Promise<RuntimeInteractionRecord> {
    const current = await this.require(input.interactionId, input.ownerUserId);
    if (!isDeepStrictEqual(current.cardRef, input.cardRef))
      throw new RuntimeInteractionError('unauthorized', '问题不属于此卡片');
    if (current.conversation.revision !== input.expectedRevision)
      throw new RuntimeInteractionError('stale', '问题已更新，请按最新内容作答');
    if (!(await this.deps.publisher.isLive(current.request, input.cardRef)))
      throw new RuntimeInteractionError('unavailable', '原问题消息不可用');
    if (input.action === 'retry') {
      await this.recoverOne(input.interactionId);
      return this.require(input.interactionId, input.ownerUserId);
    }
    if (current.status === 'cancelled' || current.status === 'staged')
      throw new RuntimeInteractionError('stale', '当前问题不能作答');
    let next = current;
    if (input.action === 'answer') {
      let response: RuntimeInteractionResponse;
      try {
        response = parseRuntimeInteractionResponse(current.request, input.response);
      } catch (error) {
        throw invalid(error instanceof Error ? error.message : String(error));
      }
      if (response.kind !== 'answers') throw invalid('需要问题答案');
      if (
        Object.values(response.answers).some((values) => values.some((value) => !value.trim() || value.length > 8000))
      )
        throw invalid('回答不能为空或超过 8000 字符');
      const version = (current.conversation.history.at(-1)?.version ?? 0) + 1;
      next = {
        ...current,
        status: 'answered',
        conversation: {
          ...current.conversation,
          deferred: false,
          needsRecovery: true,
          history: [
            ...current.conversation.history,
            { version, at: this.now(), answers: response.answers, questions: current.request.questions },
          ],
        },
      };
    } else {
      if (current.status !== 'pending') throw new RuntimeInteractionError('stale', '已提交的决定请使用修改回答');
      next = {
        ...current,
        status: input.action === 'cancel' ? 'cancelled' : 'pending',
        conversation: {
          ...current.conversation,
          deferred: input.action === 'defer',
          needsRecovery: input.action === 'cancel',
        },
      };
    }
    if (!(await this.save(current, next))) throw new RuntimeInteractionError('stale', '问题已更新，请重试');
    await this.recoverOne(input.interactionId);
    return this.require(input.interactionId, input.ownerUserId);
  }

  async read(
    interactionId: string,
    owner: RuntimeInteractionOwner,
    sourceMessageId?: string,
  ): Promise<RuntimeInteractionRecord> {
    const current = await this.require(interactionId, owner.userId, owner.threadId);
    const version = current.conversation.history.at(-1)?.version ?? 0;
    if (sourceMessageId && version > 0) {
      const continuations = current.conversation.continuations.map((work) =>
        work.catId === owner.catId && work.messageId === sourceMessageId ? { ...work, consumedVersion: version } : work,
      );
      if (!isDeepStrictEqual(continuations, current.conversation.continuations)) {
        await this.save(current, { ...current, conversation: { ...current.conversation, continuations } });
      }
    }
    return this.require(interactionId, owner.userId, owner.threadId);
  }

  async clarify(input: {
    interactionId: string;
    owner: RuntimeInteractionOwner;
    expectedRevision: number;
    text: string;
    questions?: Question['questions'];
    sourceMessageId?: string;
  }): Promise<RuntimeInteractionRecord> {
    const current = await this.require(input.interactionId, input.owner.userId, input.owner.threadId);
    if (current.conversation.revision !== input.expectedRevision || current.status === 'cancelled')
      throw new RuntimeInteractionError('stale', '问题已更新或取消');
    if (input.questions && input.owner.catId !== current.request.owner.catId)
      throw new RuntimeInteractionError('unauthorized', '仅提问的猫可以补问；伙伴请添加说明');
    if (input.questions?.some((q) => q.isSecret)) throw invalid('共同问题不能收集秘密');
    const request = input.questions
      ? (parseRuntimeInteractionRequest({
          ...current.request,
          questions: input.questions.map((q) => ({ ...q, isOther: true })),
        }) as Question)
      : current.request;
    const next = {
      ...current,
      request,
      ...(input.questions ? { status: 'pending' as const } : {}),
      conversation: {
        ...current.conversation,
        deferred: false,
        ...(input.questions
          ? {
              continuations: clarificationContinuations(current, input.owner, input.sourceMessageId),
              needsRecovery: true,
              waiters: [...(current.conversation.waiters ?? []), waiter(input, current.conversation.history.length)],
            }
          : {}),
        notes: [...current.conversation.notes, { catId: input.owner.catId, text: input.text, at: this.now() }],
      },
    };
    if (!(await this.save(current, next))) throw new RuntimeInteractionError('stale', '问题正在更新');
    await this.recoverOne(input.interactionId);
    return this.require(input.interactionId, input.owner.userId, input.owner.threadId);
  }

  async recover(): Promise<void> {
    for (const record of await this.deps.store.listConversationsNeedingRecovery())
      await this.recoverOne(record.request.interactionId);
  }

  private async recoverOne(id: string): Promise<void> {
    const running = this.recovering.get(id);
    if (running) return running;
    const operation = recoverConversationQuestion(id, {
      ...this.deps,
      asQuestion,
      save: (previous, next) => this.save(previous, next),
    }).catch((error) => this.deps.onRecoveryError?.(error));
    this.recovering.set(id, operation);
    try {
      await operation;
    } finally {
      this.recovering.delete(id);
    }
  }

  private work(input: AskConversationQuestion): ConversationQuestionContinuation[] {
    const works = input.continuations.map((work) => ({
      id: digest([work.catId, work.workRef]),
      workRef: work.workRef,
      catId: work.catId,
      invocationId: input.owner.invocationId,
      work: work.work,
      afterAnswer: work.afterAnswer,
      deliveredVersion: 0,
    }));
    if (new Set(works.map((work) => work.id)).size !== works.length) throw invalid('同一工作不可重复登记');
    return works;
  }
  private async require(id: string, ownerUserId: string, threadId?: string): Promise<DurableQuestion> {
    const record = await this.deps.store.get(id);
    if (
      !record ||
      record.request.owner.userId !== ownerUserId ||
      (threadId && record.request.owner.threadId !== threadId)
    )
      throw new RuntimeInteractionError('not_found', 'Question not found');
    return asQuestion(record);
  }
  private async save(previous: DurableQuestion, next: DurableQuestion): Promise<boolean> {
    const record = {
      ...next,
      updatedAt: this.now(),
      conversation: { ...next.conversation, revision: previous.conversation.revision + 1 },
    };
    const saved = await this.deps.store.saveConversation(record, previous.conversation.revision);
    if (saved) this.deps.onUpdated?.(record);
    return saved;
  }
  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}

function asQuestion(record: RuntimeInteractionRecord): DurableQuestion {
  if (record.request.kind !== 'question' || !record.request.conversation || !record.conversation)
    throw new RuntimeInteractionError('not_found', 'Conversation question not found');
  return record as DurableQuestion;
}
function invalid(message: string): RuntimeInteractionError {
  return new RuntimeInteractionError('invalid_response', message);
}

function waiter(input: { owner: RuntimeInteractionOwner; sourceMessageId?: string }, round: number) {
  return { owner: input.owner, ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}), round };
}
