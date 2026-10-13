import { z } from 'zod';

const ref = z.string().trim().min(1).max(240);
const question = z
  .object({
    id: ref.describe('Stable question key, retained for follow-up clarification.'),
    header: z.string().trim().min(1).max(40).describe('Short section label.'),
    question: z.string().trim().min(1).max(2000).describe('The question the owner should answer.'),
    options: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(500).describe('Choice shown to the owner.'),
            description: z.string().max(1000).optional().describe('Consequence or tradeoff of this choice.'),
          })
          .strict(),
      )
      .min(1)
      .max(10)
      .optional()
      .describe('Optional choices; custom answers are always available.'),
  })
  .strict();
export const conversationQuestionWorkSchema = z
  .object({
    catId: ref.describe('Canonical cat id that owns this already-authorized next step.'),
    workRef: ref.describe('Stable reference for the exact dependent step, e.g. task:work:123:report-format.'),
    work: z.string().trim().min(1).max(500).describe('User-visible description of the work waiting on this answer.'),
    afterAnswer: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .describe('Original-task context and next step to resume after the shared answer. Grants no new authority.'),
  })
  .strict();
export const conversationQuestionCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('ask'),
      subjectRef: ref.describe('Exact shared decision reference; reuse it instead of creating a second question.'),
      title: z.string().trim().min(1).max(200).describe('User-facing title.'),
      questions: z.array(question).min(1).max(10).describe('Questions presented together in one shared card.'),
      continuations: z
        .array(conversationQuestionWorkSchema)
        .min(1)
        .max(10)
        .describe('Only these declared next steps wait. Independent discussion may continue.'),
    })
    .strict(),
  z
    .object({
      action: z.literal('join'),
      interactionId: ref.describe('Existing shared question id.'),
      continuations: z
        .array(conversationQuestionWorkSchema)
        .min(1)
        .max(10)
        .describe('Additional original-task steps that require the same answer.'),
    })
    .strict(),
  z
    .object({
      action: z.literal('read'),
      interactionId: ref.describe('Read the current answer before resuming dependent work.'),
    })
    .strict(),
  z
    .object({
      action: z.literal('clarify'),
      interactionId: ref.describe('Existing shared question id; keep the original card.'),
      expectedRevision: z.number().int().positive().describe('Revision returned by the last read.'),
      text: z.string().trim().min(1).max(4000).describe('Explanation or clarification added to the shared question.'),
      questions: z
        .array(question)
        .min(1)
        .max(10)
        .optional()
        .describe(
          'Only the original asking cat may replace questions to request missing conditions; omission adds explanation without reopening.',
        ),
    })
    .strict(),
]);
export type ConversationQuestionCommand = z.infer<typeof conversationQuestionCommandSchema>;
