import { type KeyboardEvent, useRef } from 'react';
import { useIMEGuard } from '@/hooks/useIMEGuard';

/** Local roving focus: the composer and other questions retain their own keys. */
export function useQuestionKeyboard({
  ids,
  selectedId,
  disabled,
  onSelect,
  onConfirm,
}: {
  ids: string[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onConfirm: (id: string) => void;
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const ime = useIMEGuard();
  const selectAndFocus = (index: number) => {
    const id = ids[index];
    if (!id) return;
    onSelect(id);
    buttons.current.get(id)?.focus();
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.nativeEvent.isComposing || ime.isComposing()) {
      if (event.key === 'Enter') event.preventDefault();
      return;
    }
    if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key;
    const next = nextOption(key, index, ids.length);
    if (next !== null) {
      event.preventDefault();
      selectAndFocus(next);
    } else if (key === 'Enter') {
      event.preventDefault();
      const id = ids[index];
      if (selectedId === id) onConfirm(id);
      else onSelect(id);
    } else if (key === 'Escape') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };
  return (id: string, index: number) => ({
    ref: (node: HTMLButtonElement | null) => {
      if (node) buttons.current.set(id, node);
      else buttons.current.delete(id);
    },
    role: 'radio' as const,
    'aria-checked': selectedId === id,
    tabIndex: disabled ? -1 : (selectedId ? selectedId === id : index === 0) ? 0 : -1,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => keyDown(event, index),
    onCompositionStart: ime.onCompositionStart,
    onCompositionEnd: ime.onCompositionEnd,
  });
}

function nextOption(key: string, index: number, length: number): number | null {
  if (!length) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  if (key === 'ArrowDown') return (index + 1) % length;
  if (key === 'ArrowUp') return (index - 1 + length) % length;
  if (/^[1-9]$/.test(key) && Number(key) <= length) return Number(key) - 1;
  return null;
}
