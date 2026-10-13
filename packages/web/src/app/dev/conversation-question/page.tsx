'use client';

import { useEffect, useState } from 'react';
import { ChatContainer } from '@/components/ChatContainer';
import { type ChatMessage, DEFAULT_THREAD_STATE, type Thread, useChatStore } from '@/stores/chatStore';
import { apiFetch } from '@/utils/api-client';

/** Browser proof supplies only persisted messages and transport; the production Chat owns the UI. */
export default function ConversationQuestionFixture() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void apiFetch('/api/dev/conversation-question')
      .then(async (response) => {
        if (!response.ok) throw new Error('该验证页面需要隔离的测试服务。');
        const payload = (await response.json()) as { thread: Thread; messages: ChatMessage[] };
        if (!live) return;
        const state = { ...DEFAULT_THREAD_STATE, messages: payload.messages, hasMore: false };
        useChatStore.setState({
          ...state,
          currentThreadId: payload.thread.id,
          threads: [payload.thread],
          threadStates: { [payload.thread.id]: state },
        });
        setThreadId(payload.thread.id);
      })
      .catch((caught) => {
        if (live) setError(String(caught));
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <main data-testid="conversation-question-chat" data-hydrated={Boolean(threadId)}>
      {error ? <p role="alert">{error}</p> : null}
      {threadId ? <ChatContainer threadId={threadId} /> : <p>正在加载对话…</p>}
    </main>
  );
}
