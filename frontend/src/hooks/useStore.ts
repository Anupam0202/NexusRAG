import { create } from "zustand";
import type { UIMessage, DocumentMetadata, SourceChunk } from "@/types";
import { generateId } from "@/lib/utils";

interface AppState {
  messages: UIMessage[];
  addUserMessage: (content: string) => string;
  addAssistantMessage: (id: string) => void;
  appendToken: (id: string, token: string) => void;
  finishAssistant: (id: string, meta: {
    sources?: SourceChunk[];
    queryType?: string;
    confidence?: number;
    responseTime?: number;
  }) => void;
  setError: (id: string, error: string) => void;
  clearMessages: () => void;

  documents: DocumentMetadata[];
  setDocuments: (docs: DocumentMetadata[]) => void;
  addDocument: (doc: DocumentMetadata) => void;
  removeDocument: (filename: string) => void;

  sessionId: string;
  darkMode: boolean;
  setDarkMode: (dark: boolean) => void;
  toggleDark: () => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;

  // Quota / API key
  showApiKeyModal: boolean;
  setShowApiKeyModal: (show: boolean) => void;
  userApiKey: string | null;
  setUserApiKey: (key: string | null) => void;
}

export const useStore = create<AppState>((set) => ({
  messages: [],
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
  addDocument: (doc) => set((s) => ({ documents: [...s.documents, doc] })),
  removeDocument: (filename) => set((s) => ({ documents: s.documents.filter((d) => d.filename !== filename) })),

  sessionId: generateId(),
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
  userApiKey: null,
  setUserApiKey: (key) => set({ userApiKey: key }),
}));