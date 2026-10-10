import { create } from "zustand";
import type { UIMessage, DocumentMetadata, SourceChunk } from "@/types";
import { getStoredWorkspaceId, setStoredWorkspaceId } from "@/lib/api-context";
import { generateId } from "@/lib/utils";

export type AuthMode = "loading" | "demo" | "signed_out" | "authenticated";
export type WorkspaceDiscovery = "loading" | "ready" | "missing" | "error";
const SESSION_STORAGE_KEY = "nexusrag_chat_session_id";
const SESSION_SCOPE_KEY = "nexusrag_chat_session_scope";

function bindSession(userId: string | null, workspaceId: string | null, currentId: string) {
  const scope = JSON.stringify([userId, workspaceId]);
  if (typeof window === "undefined") return currentId;
  if (window.localStorage.getItem(SESSION_SCOPE_KEY) === scope) return currentId;
  const next = generateId();
  window.localStorage.setItem(SESSION_STORAGE_KEY, next);
  window.localStorage.setItem(SESSION_SCOPE_KEY, scope);
  return next;
}

function getInitialSessionId() {
  if (typeof window === "undefined") return generateId();
  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;
  const next = generateId();
  window.localStorage.setItem(SESSION_STORAGE_KEY, next);
  return next;
}

interface AuthUser {
  id: string;
  email: string | null;
}

interface AppState {
  messages: UIMessage[];
  setMessages: (messages: UIMessage[]) => void;
  addUserMessage: (content: string) => string;
  addAssistantMessage: (id: string) => void;
  appendToken: (id: string, token: string) => void;
  finishAssistant: (id: string, meta: {
    sources?: SourceChunk[];
    queryType?: string;
    confidence?: number;
    responseTime?: number;
    metadata?: Record<string, unknown>;
  }) => void;
  setError: (id: string, error: string) => void;
  clearMessages: () => void;

  documents: DocumentMetadata[];
  setDocuments: (docs: DocumentMetadata[]) => void;
  addDocument: (doc: DocumentMetadata) => void;
  removeDocument: (identifier: string) => void;

  sessionId: string;
  darkMode: boolean;
  setDarkMode: (dark: boolean) => void;
  toggleDark: () => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;

  // Quota / API key
  showApiKeyModal: boolean;
  setShowApiKeyModal: (show: boolean) => void;
  isQuotaBlocked: boolean;
  setIsQuotaBlocked: (blocked: boolean) => void;
  userApiKey: string | null;
  setUserApiKey: (key: string | null) => void;

  connectionStatus:
    | "checking"
    | "auth_required"
    | "online"
    | "auth_setup_required"
    | "data_setup_required"
    | "reconnecting"
    | "offline";
  setConnectionStatus: (status: AppState["connectionStatus"]) => void;

  authMode: AuthMode;
  authUser: AuthUser | null;
  setAuthState: (mode: AuthMode, user?: AuthUser | null) => void;
  workspaceId: string | null;
  workspaceDiscovery: WorkspaceDiscovery;
  setWorkspaceDiscovery: (status: WorkspaceDiscovery) => void;
  setWorkspaceId: (workspaceId: string | null) => void;
}

export const useStore = create<AppState>((set) => ({
  messages: [],
  setMessages: (messages) => set({ messages }),
  addUserMessage(content) {
    const id = generateId();
    set((s) => ({
      messages: [...s.messages, { id, role: "user", content, timestamp: new Date().toISOString() }],
    }));
    return id;
  },
  addAssistantMessage(id) {
    set((s) => ({
      messages: [...s.messages, { id, role: "assistant", content: "", timestamp: new Date().toISOString(), isStreaming: true }],
    }));
  },
  appendToken(id, token) {
    set((s) => ({
      messages: s.messages.map((m) => m.id === id ? { ...m, content: m.content + token } : m),
    }));
  },
  finishAssistant(id, meta) {
    set((s) => ({
      messages: s.messages.map((m) => m.id === id ? { ...m, isStreaming: false, ...meta } : m),
    }));
  },
  setError(id, error) {
    set((s) => ({
      messages: s.messages.map((m) => m.id === id ? { ...m, content: `⚠️ ${error}`, isStreaming: false } : m),
    }));
  },
  clearMessages: () => set({ messages: [] }),

  documents: [],
  setDocuments: (docs) => set({ documents: docs }),
  addDocument: (doc) => set((s) => ({
    documents: [
      ...s.documents.filter(
        (item) => item.document_id !== doc.document_id && item.filename !== doc.filename
      ),
      doc,
    ],
  })),
  removeDocument: (identifier) => set((s) => ({
    documents: s.documents.filter(
      (d) => d.document_id !== identifier && d.filename !== identifier
    ),
  })),

  sessionId: getInitialSessionId(),
  darkMode: false,
  setDarkMode: (dark) => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", dark);
      localStorage.setItem("theme", dark ? "dark" : "light");
    }
    set({ darkMode: dark });
  },
  toggleDark: () => set((s) => {
    const next = !s.darkMode;
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
    }
    return { darkMode: next };
  }),
  sidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  // Quota / API key
  showApiKeyModal: false,
  setShowApiKeyModal: (show) => set({ showApiKeyModal: show }),
  isQuotaBlocked: false,
  setIsQuotaBlocked: (blocked) => set({ isQuotaBlocked: blocked }),
  userApiKey: null,
  setUserApiKey: (key) => set({ userApiKey: key }),

  connectionStatus: "checking",
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  authMode: "loading",
  authUser: null,
  setAuthState: (mode, user = null) => set((state) => {
    const signedOut = mode === "signed_out";
    const identityChanged = state.authUser?.id !== user?.id;
    if (signedOut || (identityChanged && state.authUser)) setStoredWorkspaceId(null);
    const workspaceId = signedOut || (identityChanged && state.authUser) ? null : state.workspaceId;
    const sessionId = mode === "loading" ? state.sessionId : bindSession(user?.id ?? null, workspaceId, state.sessionId);
    const reset = signedOut || identityChanged || sessionId !== state.sessionId;
    return {
      authMode: mode, authUser: user, workspaceId, sessionId,
      ...(signedOut || identityChanged ? { workspaceDiscovery: "loading" as const } : {}),
      ...(reset ? { messages: [], documents: [], userApiKey: null, isQuotaBlocked: false, showApiKeyModal: false } : {}),
    };
  }),
  workspaceId: getStoredWorkspaceId(),
  workspaceDiscovery: "loading",
  setWorkspaceDiscovery: (workspaceDiscovery) => set({ workspaceDiscovery }),
  setWorkspaceId: (workspaceId) => {
    setStoredWorkspaceId(workspaceId);
    set((state) => {
      if (state.workspaceId === workspaceId) return { workspaceId, ...(workspaceId ? { workspaceDiscovery: "ready" as const } : {}) };
      return {
        workspaceId,
        workspaceDiscovery: workspaceId ? "ready" : "loading",
        sessionId: bindSession(state.authUser?.id ?? null, workspaceId, state.sessionId),
        messages: [], documents: [], userApiKey: null, isQuotaBlocked: false, showApiKeyModal: false,
      };
    });
  },
}));
