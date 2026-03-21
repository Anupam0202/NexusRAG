"use client";

import { useCallback, useEffect, useRef } from "react";
import { createChatSocket } from "@/lib/websocket";
import { useStore } from "@/hooks/useStore";
import type { WSFrame, SourceChunk } from "@/types";
import { generateId } from "@/lib/utils";

export function useChat() {
  const store = useStore();
  const socketRef = useRef<ReturnType<typeof createChatSocket> | null>(null);
  const currentAsstId = useRef<string | null>(null);
  const sourcesBuffer = useRef<SourceChunk[]>([]);

  // Use ref to always have latest messages for history
  const messagesRef = useRef(store.messages);
  useEffect(() => { messagesRef.current = store.messages; }, [store.messages]);

  const handleFrame = useCallback((frame: WSFrame) => {
    const id = currentAsstId.current;
    if (!id) return;
    switch (frame.type) {
      case "token":
        store.appendToken(id, frame.content);
        break;
      case "sources":
        sourcesBuffer.current = frame.sources;
        break;
      case "done":
        store.finishAssistant(id, {
          sources: sourcesBuffer.current,
          queryType: frame.metadata?.query_type as string,
          confidence: frame.metadata?.confidence as number,
          responseTime: frame.metadata?.response_time_seconds as number,
        });
        currentAsstId.current = null;
        sourcesBuffer.current = [];
        break;
      case "error": {
        const raw = frame as unknown as Record<string, unknown>;
        const errorCode = raw.error_code ?? "";
        const isQuota =
          errorCode === "QUOTA_EXCEEDED" ||
          (typeof frame.content === "string" &&
            /quota|rate.limit|429|resource.exhausted/i.test(frame.content));

        if (isQuota) {
          store.setError(id, "API quota exceeded — please provide your own Google API key.");
          store.setShowApiKeyModal(true);
        } else {
          store.setError(id, frame.content);
        }
        currentAsstId.current = null;
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    socketRef.current = createChatSocket(handleFrame);
    return () => { socketRef.current?.close(); };
  }, [handleFrame]);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    store.addUserMessage(text);
    const asstId = generateId();
    currentAsstId.current = asstId;
    store.addAssistantMessage(asstId);

    const history = messagesRef.current
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.content }));

    socketRef.current?.send({
      question: text,
      session_id: store.sessionId,
      conversation_history: history,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.sessionId]);

  return { sendMessage, messages: store.messages };
}