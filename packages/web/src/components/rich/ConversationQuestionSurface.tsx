'use client';

import type { RuntimeInteractionRecord, RuntimeInteractionResponse } from '@cat-cafe/shared';
import { useState } from 'react';
import { RuntimeInteractionQuestionForm } from './RuntimeInteractionQuestionForm';

export function ConversationQuestionSurface({
  record,
  disabled,
  onAction,
}: {
  record: RuntimeInteractionRecord;
  disabled: boolean;
  onAction: (
    action: 'answer' | 'defer' | 'cancel' | 'retry',
    response?: RuntimeInteractionResponse,
  ) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!record.conversation || record.request.kind !== 'question') return null;
  const state = record.conversation;
  const latest = state.history.at(-1);
  const pending = record.status === 'pending';
  const buttonClass = 'min-h-10 rounded-xl border border-cafe px-3 py-2 text-sm disabled:opacity-50';
  return (
    <div className="space-y-3" data-testid="conversation-question">
      <p className="text-sm text-cafe-muted" role="status">
        {record.status === 'cancelled'
          ? '这项待答工作已取消。'
          : pending
            ? state.deferred
              ? '暂不决定 · 问题已保留，相关工作继续等待。'
              : '等你决定，以下工作暂缓；其他讨论可以继续。'
            : state.needsRecovery
              ? '回答已保存，正在安排原工作续接。'
              : '回答已保存并共享。'}
      </p>
      <ul className="space-y-1 text-xs text-cafe-muted">
        {state.continuations
          .filter((work) => !work.supersededBy)
          .map((work) => (
            <li key={work.id}>
              {work.work} ·{' '}
              {record.status === 'cancelled'
                ? '已取消'
                : pending
                  ? '等你决定'
                  : work.consumedVersion === latest?.version
                    ? '已读取最新决定'
                    : work.deliveryState === 'terminal_owned'
                      ? '先前这一步已结束，修改不会自动重复执行'
                      : work.deliveredVersion === latest?.version
                        ? '已安排续接'
                        : '待恢复续接'}
            </li>
          ))}
      </ul>
      {state.notes.length > 0 ? (
        <div className="space-y-2 border-l-2 border-cafe pl-3 text-sm">
          {state.notes.map((note, index) => (
            <p key={`${note.at}-${index}`} className="whitespace-pre-wrap break-words">
              {note.text}
            </p>
          ))}
        </div>
      ) : null}
      {latest ? (
        <div className="rounded-xl bg-cafe-surface-elevated p-3 text-sm">
          <p className="mb-1 text-xs text-cafe-muted">你的回答 · 第 {latest.version} 版</p>
          {latest.questions.map((question) => (
            <p key={question.id} className="whitespace-pre-wrap break-words">
              {question.header}：{latest.answers[question.id]?.join('；')}
            </p>
          ))}
          {state.history.length > 1 ? (
            <details className="mt-2 text-xs">
              <summary>查看之前的回答</summary>
              {state.history.slice(0, -1).map((answer) => (
                <p key={answer.version} className="mt-2 whitespace-pre-wrap break-words">
                  第 {answer.version} 版：{Object.values(answer.answers).flat().join('；')}
                </p>
              ))}
            </details>
          ) : null}
        </div>
      ) : null}
      {(pending || editing) && record.status !== 'cancelled' ? (
        <RuntimeInteractionQuestionForm
          key={JSON.stringify(record.request.questions)}
          request={record.request}
          disabled={disabled}
          initialAnswers={editing ? latest?.answers : undefined}
          rejectLabel={editing ? '放弃修改' : '暂不决定'}
          onReject={() => {
            if (editing) setEditing(false);
            else void onAction('defer');
          }}
          onSubmit={(response) => {
            void onAction('answer', response).then((ok) => {
              if (ok) setEditing(false);
            });
          }}
        />
      ) : null}
      {pending ? (
        <div>
          {confirmCancel ? (
            <div className="space-y-2">
              <p className="text-sm">取消上面列出的待答工作？其他工作不会取消。</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={disabled}
                  onClick={() => {
                    void onAction('cancel').then((ok) => {
                      if (ok) setConfirmCancel(false);
                    });
                  }}
                >
                  确认取消这项工作
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={disabled}
                  onClick={() => setConfirmCancel(false)}
                >
                  保留等待
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={buttonClass} disabled={disabled} onClick={() => setConfirmCancel(true)}>
              取消这项工作
            </button>
          )}
        </div>
      ) : null}
      {record.status === 'answered' && !editing ? (
        <button type="button" className={buttonClass} disabled={disabled} onClick={() => setEditing(true)}>
          修改回答
        </button>
      ) : null}
      {editing ? (
        <p className="text-xs text-cafe-muted">修改将同步给尚未执行的工作；已经发生的操作不会自动撤销。</p>
      ) : null}
      {state.needsRecovery && record.status !== 'staged' ? (
        <button
          type="button"
          className={buttonClass}
          disabled={disabled}
          onClick={() => {
            void onAction('retry');
          }}
        >
          重新同步续接状态
        </button>
      ) : null}
    </div>
  );
}
