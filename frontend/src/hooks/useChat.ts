"use client";

import { useCallback, useEffect, useRef } from "react";
import { chatQuery, getSessionMessages } from "@/lib/api";
import { useStore } from "@/hooks/useStore";
import { canUseWorkspaceApi } from "@/hooks/useAuthGate";
import type { QueryRequest, UIMessage } from "@/types";
import { generateId } from "@/lib/utils";

export type ChatSendOptions = {
  nonSensitiveAttested?: boolean;
  chatScope?: "workspace" | "documents";
  documentIds?: string[];
  fileTypes?: string[];
  filename?: string;
  uploadedBy?: string;
  minPage?: number;
  maxPage?: number;
  uploadedAfter?: string;
  uploadedBefore?: string;
  metadataFilters?: Record<string, string | number | boolean>;
};

export function useChat() {
  const store = useStore();
  const canAccessWorkspaceApi = canUseWorkspaceApi(store.authMode);
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
          metadata: message.metadata,
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

  const runRestFallback = useCallback(async (id: string, req: QueryRequest) => {
    try {
      const response = await chatQuery(req);
      store.appendToken(id, response.answer);
      store.finishAssistant(id, {
        sources: response.sources,
        queryType: response.query_type,
        confidence: response.confidence,
        responseTime: response.response_time_seconds,
        metadata: response.metadata,
      });
      store.setConnectionStatus("online");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to reach the backend";
      if (/quota|rate.limit|429|resource.exhausted/i.test(message)) {
        store.setError(id, "The free-tier limit or workspace budget blocks this request. No paid fallback was used.");
        store.setConnectionStatus("online");
      } else {
        store.setError(id, message);
        store.setConnectionStatus(/connection was interrupted|Failed to reach the backend/i.test(message) ? "offline" : "online");
      }
    }
  }, [store]);

  useEffect(() => {
    if (!canAccessWorkspaceApi) {
      store.setConnectionStatus(store.authMode === "loading" ? "checking" : "auth_setup_required");
      return;
    }

    // The Cloudflare candidate exposes an authenticated REST gateway, not the
    // legacy WebSocket backend. Keeping chat on REST ensures the same
    // classification, rights, and quota gates protect every request.
    store.setConnectionStatus("online");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccessWorkspaceApi, store.authMode]);

  const sendMessage = useCallback((text: string, options: ChatSendOptions = {}) => {
    if (!text.trim()) return;
    if (!canAccessWorkspaceApi) {
      return;
    }
    store.addUserMessage(text);
    const asstId = generateId();
    store.addAssistantMessage(asstId);

    const history = messagesRef.current
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.content }));

    const request: QueryRequest = {
      question: text,
      non_sensitive_attested: options.nonSensitiveAttested === true,
      session_id: store.sessionId,
      conversation_history: history,
      chat_scope: options.chatScope ?? "workspace",
    };
    if (options.documentIds?.length) {
      request.document_ids = options.documentIds;
      request.chat_scope = "documents";
    }
    if (options.fileTypes?.length) request.file_types = options.fileTypes;
    if (options.filename) request.filename = options.filename;
    if (options.uploadedBy) request.uploaded_by = options.uploadedBy;
    if (options.minPage !== undefined) request.min_page = options.minPage;
    if (options.maxPage !== undefined) request.max_page = options.maxPage;
    if (options.uploadedAfter) request.uploaded_after = options.uploadedAfter;
    if (options.uploadedBefore) request.uploaded_before = options.uploadedBefore;
    if (options.metadataFilters) request.metadata_filters = options.metadataFilters;

    store.setConnectionStatus("reconnecting");
    void runRestFallback(asstId, request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.sessionId, runRestFallback, canAccessWorkspaceApi]);

  return { sendMessage, messages: store.messages };
}
