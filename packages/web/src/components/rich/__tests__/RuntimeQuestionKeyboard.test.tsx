import type { RuntimeInteractionRequest } from '@cat-cafe/shared';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RuntimeInteractionQuestionForm } from '../RuntimeInteractionQuestionForm';
import { owner, provider } from './runtime-interaction-test-fixtures';

it('answers a native question with arrows and Enter without sending a new chat message', () => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onSubmit = vi.fn();
  const request: Extract<RuntimeInteractionRequest, { kind: 'question' }> = {
    version: 1,
    interactionId: 'keyboard-native',
    owner,
    provider,
    createdAt: 1,
    title: '格式',
    kind: 'question',
    questions: [
      {
        id: 'format',
        header: '格式',
        question: '导出什么格式？',
        options: [{ label: 'PDF' }, { label: 'Markdown' }],
        isOther: true,
      },
    ],
  };
  try {
    act(() =>
      root.render(
        <RuntimeInteractionQuestionForm request={request} disabled={false} onSubmit={onSubmit} onReject={vi.fn()} />,
      ),
    );
    const first = container.querySelector<HTMLButtonElement>('[role="radio"]');
    expect(first).not.toBeNull();
    first!.focus();
    act(() =>
      first!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })),
    );
    expect(document.activeElement?.textContent).toContain('Markdown');
    expect(onSubmit).not.toHaveBeenCalled();
    act(() =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      ),
    );
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ kind: 'answers', answers: { format: ['Markdown'] } });
  } finally {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  }
});
