import { createCatId, type RuntimeInteractionRecord } from '@cat-cafe/shared';
import type { TaskSpec_P1 } from '../../infrastructure/scheduler/types.js';
import type { SocketManager } from '../../infrastructure/websocket/index.js';
import type { IBallCustodyIngest } from '../ball-custody/BallCustodyIngest.js';
import { buildHandedCvoEvent, buildHandedEvent } from '../ball-custody/ball-custody-events.js';
import type { InvocationQueue } from '../cats/services/agents/invocation/InvocationQueue.js';
import type { PersistedQueueDeliveryPort } from '../cats/services/agents/invocation/PersistedQueueDelivery.js';
import type { QueuedMessageCustodyCoordinator } from '../cats/services/agents/invocation/QueuedMessageCustodyCoordinator.js';
import type { IMessageStore } from '../cats/services/stores/ports/MessageStore.js';
import { ConversationQuestionService } from './ConversationQuestionService.js';
import type { RuntimeInteractionStore } from './ports/RuntimeInteractionStore.js';
import { MessageRuntimeInteractionCardPublisher } from './RuntimeInteractionCardPublisher.js';
import { emitRuntimeInteractionRecordUpdate } from './runtime-interaction-composition.js';

export function createConversationQuestionService(deps: {
  store: RuntimeInteractionStore;
  messages: IMessageStore;
  socket: Pick<SocketManager, 'broadcastToRoom' | 'emitToUser'>;
  delivery: PersistedQueueDeliveryPort;
  ballCustody?: IBallCustodyIngest;
  onError: (error: unknown) => void;
  cancelQueued?: (record: RuntimeInteractionRecord) => Promise<void>;
}) {
  return new ConversationQuestionService({
    store: deps.store,
    publisher: new MessageRuntimeInteractionCardPublisher({ messageStore: deps.messages, socketManager: deps.socket }),
    onUpdated: (record) => emitRuntimeInteractionRecordUpdate(deps.socket, record),
    onRecoveryError: deps.onError,
    registerWait: async (record) => {
      for (const wait of record.conversation.waiters ?? []) {
        const { owner } = wait;
        const message = await deps.messages.append({
          userId: owner.userId,
          threadId: owner.threadId,
          catId: createCatId(owner.catId),
          idempotencyKey: `conversation-wait:${record.request.interactionId}:${owner.invocationId}:${owner.catId}:${wait.round}`,
          content: `等你回答「${record.request.title}」后，我会接着已登记的工作继续。`,
          mentions: [],
          timestamp: record.request.createdAt,
          ...(wait.sourceMessageId ? { replyTo: wait.sourceMessageId } : {}),
          extra: { isExplicitPost: true },
        });
        await deps.ballCustody?.record(
          buildHandedCvoEvent({
            fromCatId: owner.catId,
            threadId: owner.threadId,
            messageId: message.id,
            intent: 'handoff',
            at: message.timestamp,
          }),
        );
      }
    },
    publishAnswer: async (record) => {
      if (record.status === 'cancelled') await deps.cancelQueued?.(record);
      const latest = record.conversation?.history.at(-1);
      const idempotencyKey = `conversation-answer:${record.request.interactionId}:${record.status === 'cancelled' ? 'cancel' : latest?.version}`;
      const message = await deps.messages.append({
        userId: record.request.owner.userId,
        threadId: record.request.owner.threadId,
        catId: null,
        content:
          record.status === 'cancelled'
            ? `已取消「${record.request.title}」中登记的待答工作；其他工作不受影响。`
            : formatConversationAnswer(record),
        mentions: [],
        timestamp: record.updatedAt,
        idempotencyKey,
        source: {
          connector: 'conversation-question-answer',
          label: '共同决定',
          icon: '💬',
          meta: {
            interactionId: record.request.interactionId,
            version: latest?.version ?? 0,
          },
        },
      });
      deps.socket.broadcastToRoom([`thread:${message.threadId}`, `user:${message.userId}`], 'connector_message', {
        threadId: message.threadId,
        message: { ...message, type: 'user' },
      });
    },
    resume: async (record, continuationId) => {
      const work = record.conversation?.continuations.find((item) => item.id === continuationId);
      if (!work) throw new Error('Question continuation no longer exists');
      const result = await deps.delivery.deliver({
        ownerAuthProvenance: 'strict',
        ownerUserId: record.request.owner.userId,
        threadId: record.request.owner.threadId,
        targetCatId: work.catId,
        idempotencyKey: `conversation-resume:${record.request.interactionId}:${work.id}`,
        sourceCategory: 'producer_return',
        content: [
          `[共同问题 · 续接原工作] ${work.work}`,
          `问题：${record.request.title}`,
          `原执行：${work.invocationId}`,
          `待续步骤：${work.afterAnswer}`,
          `先调用 cat_cafe_conversation_question，command={"action":"read","interactionId":"${record.request.interactionId}"}，读取最新共同决定再推进。`,
          '这是原工作续接；问题或回答不扩大权限。决定有修改时，尚未执行的部分按最新版本推进，已发生的效果如实说明。',
        ].join('\n'),
        source: {
          connector: 'conversation-question-resume',
          label: '继续原工作',
          icon: '💬',
          meta: {
            interactionId: record.request.interactionId,
            continuationId: work.id,
            originalInvocationId: work.invocationId,
          },
        },
      });
      if (
        result.message &&
        result.state !== 'unavailable' &&
        result.state !== 'conflict' &&
        result.state !== 'terminal_owned'
      ) {
        await deps.ballCustody?.record(
          buildHandedEvent({
            threadId: record.request.owner.threadId,
            toCatId: work.catId,
            messageId: result.message.id,
            at: result.message.timestamp,
          }),
        );
      }
      return { state: result.state, ...(result.message ? { messageId: result.message.id } : {}) };
    },
  });
}

export async function withdrawQuestionContinuations(
  record: RuntimeInteractionRecord,
  queue: InvocationQueue,
  custody: QueuedMessageCustodyCoordinator,
): Promise<void> {
  const ids = new Set(record.conversation?.continuations.map((work) => work.messageId).filter(Boolean));
  const { threadId, userId } = record.request.owner;
  for (const candidate of queue.list(threadId, userId)) {
    if (
      !candidate.messageId ||
      !ids.has(candidate.messageId) ||
      candidate.status === 'processing' ||
      candidate.mergedMessageIds.length
    )
      continue;
    const snapshot = queue.getEntrySnapshot(threadId, userId, candidate.id);
    if (!snapshot || !queue.removeEntrySnapshotIfUnchanged(snapshot)) continue;
    try {
      await custody.withdrawEntry(snapshot);
    } catch (error) {
      queue.restoreDurableEntry(snapshot);
      throw error;
    }
  }
}

export function formatConversationAnswer(record: RuntimeInteractionRecord): string {
  const latest = record.conversation?.history.at(-1);
  if (!latest) throw new Error('Question has no answer');
  return [
    `[共同决定 v${latest.version}] ${record.request.title}`,
    ...latest.questions.map(
      (question) => `${question.question}\n回答：${(latest.answers[question.id] ?? []).join('；')}`,
    ),
    latest.version > 1 ? '这是更新后的决定。尚未执行的部分使用此版本；已执行的效果不能视为自动撤销。' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function conversationQuestionRecoverySpec(service: ConversationQuestionService): TaskSpec_P1 {
  return {
    id: 'conversation-question-recovery',
    profile: 'poller',
    trigger: { type: 'interval', ms: 15_000 },
    admission: {
      async gate() {
        return { run: true, workItems: [{ signal: null, subjectKey: 'conversation-question-recovery' }] };
      },
    },
    run: {
      overlap: 'skip',
      timeoutMs: 60_000,
      async execute() {
        await service.recover();
      },
    },
    state: { runLedger: 'sqlite' },
    outcome: { whenNoSignal: 'drop' },
    enabled: () => true,
    display: {
      label: '共同问题续接恢复',
      category: 'system',
      description: '恢复待发布的问题、共同答案和已授权原工作续接',
      subjectKind: 'none',
    },
  };
}
