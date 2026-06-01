"use client";

import { useCallback, useEffect, useRef } from "react";
import { createChatSocket } from "@/lib/websocket";
import { chatQuery, getSessionMessages } from "@/lib/api";
import { useStore } from "@/hooks/useStore";
import { canUseWorkspaceApi } from "@/hooks/useAuthGate";
import type { QueryRequest, WSFrame, SourceChunk, UIMessage } from "@/types";
import { generateId } from "@/lib/utils";

export function useChat() {
  const store = useStore();
  const canAccessWorkspaceApi = canUseWorkspaceApi(store.authMode);
  const socketRef = useRef<ReturnType<typeof createChatSocket> | null>(null);
  const currentAsstId = useRef<string | null>(null);
  const sourcesBuffer = useRef<SourceChunk[]>([]);

  // Use ref to always have latest messages for history
  const messagesRef = useRef(store.messages);
  useEffect(() => { messagesRef.current = store.messages; }, [store.messages]);

  useEffect(() => {
    let cancelled = false;
    if (!canAccessWorkspaceApi) return;
    if (store.messages.length > 0) return;

    getSessionMessages(store.sessionId)
      .then((history) => {
        if (cancelled || history.total === 0 || store.messages.length > 0) return;
        const restored: UIMessage[] = history.messages.map((message) => ({
          id: generateId(),
          role: message.role,
          content: message.content,
          timestamp: message.created_at ?? undefined,
          sources: message.sources,
          queryType:
            typeof message.metadata.query_type === "string"
              ? message.metadata.query_type
              : undefined,
          confidence:
            typeof message.metadata.confidence === "number"
              ? message.metadata.confidence
              : undefined,
          responseTime:
            typeof message.metadata.response_time_seconds === "number"
              ? message.metadata.response_time_seconds
              : undefined,
        }));
        store.setMessages(restored);
      })
      .catch(() => {
        // Chat history is an enhancement; live chat should not depend on it.
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.sessionId, canAccessWorkspaceApi]);

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
          store.setIsQuotaBlocked(true);
          store.setShowApiKeyModal(true);
        } else {
          store.setError(id, frame.content);
        }
        currentAsstId.current = null;
        sourcesBuffer.current = [];
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleQuotaError = useCallback((id: string) => {
    store.setError(id, "API quota exceeded - please provide your own Google API key.");
    store.setIsQuotaBlocked(true);
    store.setShowApiKeyModal(true);
    currentAsstId.current = null;
    sourcesBuffer.current = [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runRestFallback = useCallback(async (id: string, req: QueryRequest) => {
    try {
      const response = await chatQuery(req);
      store.appendToken(id, response.answer);
      store.finishAssistant(id, {
        sources: response.sources,
        queryType: response.query_type,
        confidence: response.confidence,
        responseTime: response.response_time_seconds,
      });
      store.setConnectionStatus("online");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to reach the backend";
      if (/quota|rate.limit|429|resource.exhausted/i.test(message)) {
        handleQuotaError(id);
      } else {
        store.setError(id, `Backend connection failed: ${message}`);
        store.setConnectionStatus("offline");
      }
    } finally {
      currentAsstId.current = null;
      sourcesBuffer.current = [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleQuotaError]);

  useEffect(() => {
    if (!canAccessWorkspaceApi) {
      socketRef.current?.close();
      socketRef.current = null;
      store.setConnectionStatus(store.authMode === "loading" ? "checking" : "auth_setup_required");
      return;
    }

    store.setConnectionStatus("checking");
    socketRef.current = createChatSocket(
      handleFrame,
      () => store.setConnectionStatus("reconnecting"),
      undefined,
      (status) => store.setConnectionStatus(status)
    );
    return () => { socketRef.current?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleFrame, canAccessWorkspaceApi, store.authMode]);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    if (!canAccessWorkspaceApi) {
      return;
    }
    store.addUserMessage(text);
    const asstId = generateId();
    currentAsstId.current = asstId;
    store.addAssistantMessage(asstId);

    const history = messagesRef.current
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.content }));

    const request: QueryRequest = {
      question: text,
      session_id: store.sessionId,
      conversation_history: history,
    };

    const sent = socketRef.current?.send(request) ?? false;
    if (!sent) {
      store.setConnectionStatus("reconnecting");
      void runRestFallback(asstId, request);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.sessionId, runRestFallback, canAccessWorkspaceApi]);

  return { sendMessage, messages: store.messages };
}
