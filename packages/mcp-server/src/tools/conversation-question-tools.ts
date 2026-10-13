import { conversationQuestionCommandSchema } from '@cat-cafe/shared';
import { defineMcpCanonicalFactory } from '../tool-governance-migration.js';
import { callbackPost } from './callback-tools.js';
import { errorResult, type ToolResult } from './file-tools.js';

const defineCanonicalTool = defineMcpCanonicalFactory('conversation-question-tools.ts', undefined, {
  resourceFamily: 'runtime-interaction',
  authority: 'callback-owner',
});
export async function handleConversationQuestion(input: { command: unknown }): Promise<ToolResult> {
  const parsed = conversationQuestionCommandSchema.safeParse(input.command);
  if (!parsed.success)
    return errorResult(
      `Invalid command: ${parsed.error.message}. Example: command={action:"read",interactionId:"question-..."}`,
    );
  return callbackPost('/api/callbacks/conversation-question', parsed.data);
}
export const conversationQuestionTools = [
  defineCanonicalTool({
    name: 'cat_cafe_conversation_question',
    description:
      'Publish or join one durable shared question and hold the explicitly declared next steps until the owner answers. ' +
      'Use when: 对话内选择、共同决定、等待用户回答; read the latest decision before continuing its original work. ' +
      'NOT for permission approval, secrets, ordinary explanatory lists, or already-authorized routine choices. ' +
      'Output: one keyboard-operable chat card, persistent answer history, and automatic original-work continuation for the listed cats; returns immediately without holding an RPC open. ' +
      'GOTCHA: reuse the same subjectRef or join the existing interactionId; only listed work waits, independent discussion may continue. Never treat defer or elapsed time as consent. Clarify the original card instead of making another question.',
    inputSchema: {
      command: conversationQuestionCommandSchema.describe(
        'ask / join / read / clarify command. Cat, user and thread authority are bound by the active invocation, not caller-selected.',
      ),
    },
    handler: handleConversationQuestion,
    governance: {
      implementationExport: 'handleConversationQuestion',
      action: 'question',
      risk: { level: 'write', openWorld: false },
      runtimeProfiles: ['full'],
      standaloneReason: {
        disposition: 'accepted-boundary',
        kind: 'resource-entry',
        admissionRef: 'file:feature-specs/2026-10-13-interactive-decisions.md',
      },
    },
  }),
] as const;
