import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractiveBlock } from '@/components/rich/InteractiveBlock';
import type { RichInteractiveBlock } from '@/stores/chat-types';

vi.mock('@/stores/chatStore', () => ({ useChatStore: { getState: () => ({ updateRichBlock: vi.fn() }) } }));
vi.mock('@/utils/api-client', () => ({ apiFetch: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/utils/userId', () => ({ getUserId: () => 'keyboard-user' }));

const block: RichInteractiveBlock = {
  id: 'keyboard-question',
  kind: 'interactive',
  v: 1,
  interactiveType: 'select',
  title: '导出格式',
  options: [
    { id: 'pdf', label: 'PDF' },
    { id: 'md', label: 'Markdown' },
    { id: 'other', label: '其他', customInput: true },
  ],
};

describe('question keyboard interaction', () => {
  let container: HTMLDivElement;
  let root: Root;
  let sent: ReturnType<typeof vi.fn<(event: Event) => void>>;
  beforeEach(() => {
    Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    sent = vi.fn<(event: Event) => void>();
    window.addEventListener('cat-cafe:interactive-send', sent);
    act(() => root.render(<InteractiveBlock block={block} messageId="question-message" />));
  });
  afterEach(() => {
    window.removeEventListener('cat-cafe:interactive-send', sent);
    act(() => root.unmount());
    container.remove();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });
  function key(element: Element, value: string, isComposing = false) {
    act(() =>
      element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, isComposing })),
    );
  }
  it('moves within the question with arrows and sends only on explicit Enter', () => {
    const pdf = [...container.querySelectorAll('button')].find((b) => b.textContent === 'PDF')!;
    pdf.focus();
    key(pdf, 'ArrowDown');
    expect(document.activeElement?.textContent).toBe('Markdown');
    expect(sent).not.toHaveBeenCalled();
    key(document.activeElement!, 'Enter');
    expect(sent).toHaveBeenCalledTimes(1);
    expect((sent.mock.calls[0][0] as CustomEvent).detail.text).toContain('Markdown');
  });
  it('does not steal focus or turn composition Enter into an answer', () => {
    const input = document.createElement('input');
    container.appendChild(input);
    input.focus();
    key(input, 'ArrowDown');
    expect(document.activeElement).toBe(input);
    const pdf = [...container.querySelectorAll('button')].find((b) => b.textContent === 'PDF')!;
    act(() => pdf.click());
    key(pdf, 'Enter', true);
    expect(sent).not.toHaveBeenCalled();
  });
  it('wraps navigation and lets Escape leave the choices without submitting', () => {
    const pdf = [...container.querySelectorAll('button')].find((b) => b.textContent === 'PDF')!;
    pdf.focus();
    key(pdf, 'ArrowUp');
    expect(document.activeElement?.textContent).toBe('其他');
    key(document.activeElement!, 'Escape');
    expect(document.activeElement?.textContent).not.toBe('其他');
    expect(sent).not.toHaveBeenCalled();
  });
});
