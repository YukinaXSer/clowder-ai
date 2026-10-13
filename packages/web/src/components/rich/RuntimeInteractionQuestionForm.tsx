import type { RuntimeInteractionRequest, RuntimeInteractionResponse } from '@cat-cafe/shared';
import { useId, useMemo, useRef, useState } from 'react';
import { useIMEGuard } from '@/hooks/useIMEGuard';
import { useQuestionKeyboard } from './useQuestionKeyboard';

type QuestionRequest = Extract<RuntimeInteractionRequest, { kind: 'question' }>;
type Question = QuestionRequest['questions'][number];

export function RuntimeInteractionQuestionForm({
  request,
  disabled,
  onSubmit,
  onReject,
  rejectLabel = '不回答',
  initialAnswers,
}: {
  request: QuestionRequest;
  disabled: boolean;
  onSubmit: (response: RuntimeInteractionResponse) => void;
  onReject: () => void;
  rejectLabel?: string;
  initialAnswers?: Record<string, string[]>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      request.questions.map((question) => {
        const answer = initialAnswers?.[question.id]?.[0] ?? '';
        return [
          question.id,
          !question.options || question.options.some((option) => option.label === answer) ? answer : '',
        ];
      }),
    ),
  );
  const [otherValues, setOtherValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      request.questions.map((question) => {
        const answer = initialAnswers?.[question.id]?.[0] ?? '';
        return [
          question.id,
          question.options && !question.options.some((option) => option.label === answer) ? answer : '',
        ];
      }),
    ),
  );
  const ime = useIMEGuard();
  const answers = useMemo(
    () =>
      Object.fromEntries(
        request.questions.map((question) => [
          question.id,
          otherValues[question.id]?.trim() || values[question.id]?.trim() || '',
        ]),
      ),
    [otherValues, request.questions, values],
  );
  const complete = Object.values(answers).every((answer) => answer.length > 0);

  return (
    <form
      className="space-y-3"
      onCompositionStart={ime.onCompositionStart}
      onCompositionEnd={ime.onCompositionEnd}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.nativeEvent.isComposing || ime.isComposing())) event.preventDefault();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!complete || disabled || ime.isComposing()) return;
        onSubmit({
          kind: 'answers',
          answers: Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, [answer]])),
        });
      }}
    >
      {request.questions.map((question) => (
        <QuestionField
          key={question.id}
          question={question}
          value={values[question.id] ?? ''}
          otherValue={otherValues[question.id] ?? ''}
          disabled={disabled}
          onValueChange={(value) => {
            setValues((current) => ({ ...current, [question.id]: value }));
            if (value) setOtherValues((current) => ({ ...current, [question.id]: '' }));
          }}
          onOtherValueChange={(value) => {
            setOtherValues((current) => ({ ...current, [question.id]: value }));
            if (value) setValues((current) => ({ ...current, [question.id]: '' }));
          }}
        />
      ))}
      <p className="hidden text-xs text-cafe-muted sm:block">选项获焦后，可用 ↑↓ 选择、Enter 确认。</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onReject}
          className="min-h-10 rounded-xl border border-cafe px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {rejectLabel}
        </button>
        <button
          type="submit"
          disabled={!complete || disabled}
          className="min-h-10 rounded-xl bg-[var(--cafe-accent)] px-3 py-2 text-sm font-medium text-[var(--cafe-accent-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          提交回答
        </button>
      </div>
    </form>
  );
}

function QuestionField({
  question,
  value,
  otherValue,
  disabled,
  onValueChange,
  onOtherValueChange,
}: {
  question: Question;
  value: string;
  otherValue: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
  onOtherValueChange: (value: string) => void;
}) {
  const uniqueId = useId();
  const inputId = `runtime-question-${uniqueId}-${question.id}`;
  const otherInputId = `${inputId}-other`;
  const fieldRef = useRef<HTMLFieldSetElement>(null);
  const optionProps = useQuestionKeyboard({
    ids: (question.options ?? []).map((option) => option.label),
    selectedId: value || null,
    disabled,
    onSelect: onValueChange,
    onConfirm: () => fieldRef.current?.closest('form')?.requestSubmit(),
  });
  return (
    <fieldset ref={fieldRef} className="space-y-1.5" disabled={disabled}>
      <legend className="text-sm font-semibold">{question.header}</legend>
      <p className="text-xs text-cafe-muted">{question.question}</p>
      {!question.options ? (
        <label htmlFor={inputId} className="sr-only">
          {question.question}
        </label>
      ) : null}
      {question.options ? (
        <div id={inputId} role="radiogroup" aria-label={question.question} className="space-y-2">
          {question.options.map((option, index) => (
            <button
              key={option.label}
              type="button"
              disabled={disabled}
              {...optionProps(option.label, index)}
              onClick={() => onValueChange(option.label)}
              className={`min-h-10 w-full rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cafe-accent)] ${value === option.label ? 'border-[var(--cafe-accent)] bg-cafe-surface-elevated' : 'border-cafe bg-cafe-surface'}`}
            >
              <span>{option.label}</span>
              {option.description ? (
                <span className="mt-1 block text-xs text-cafe-muted">{option.description}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <input
          id={inputId}
          name={question.id}
          type={question.isSecret ? 'password' : 'text'}
          autoComplete={question.isSecret ? 'off' : undefined}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          className="min-h-10 w-full rounded-xl border border-cafe bg-cafe-surface px-3 text-sm"
        />
      )}
      {question.isOther ? (
        <>
          <label htmlFor={otherInputId} className="sr-only">
            其他答案：{question.question}
          </label>
          <input
            id={otherInputId}
            name={`${question.id}-other`}
            type={question.isSecret ? 'password' : 'text'}
            placeholder="其他答案"
            value={otherValue}
            onChange={(event) => onOtherValueChange(event.target.value)}
            className="min-h-10 w-full rounded-xl border border-cafe bg-cafe-surface px-3 text-sm"
          />
        </>
      ) : null}
    </fieldset>
  );
}
