import type { QueryRequest, WSFrame } from "@/types";

/**
 * Determine the WebSocket URL.
 * - In production (Vercel): use the current host with wss://
 * - Locally: fall back to ws://localhost:8000
 *
 * Note: Vercel doesn't support WebSocket proxying via rewrites.
 * WebSocket connections go directly to the backend.
 */
function getWsBase(): string {
  if (typeof window !== "undefined" && window.location.hostname !== "localhost") {
    // Production: connect directly to the backend's WebSocket
    const backendUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
    if (backendUrl) {
      return backendUrl.replace("http://", "ws://").replace("https://", "wss://");
    }
    // Fallback: try same origin (won't work on Vercel, but safe default)
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}`;
  }
  // Local dev
  return "ws://localhost:8000";
}

export function createChatSocket(
  onFrame: (frame: WSFrame) => void,
  onError?: (err: Event | Error) => void,
  onClose?: () => void
) {
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let closed = false;

  const WS_BASE = getWsBase();

  function connect() {
    if (closed) return;
    try {
      ws = new WebSocket(`${WS_BASE}/ws/chat`);
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => { retries = 0; };
    ws.onmessage = (evt) => {
      try { onFrame(JSON.parse(evt.data)); } catch { /* skip */ }
    };
    ws.onerror = (evt) => onError?.(evt);
    ws.onclose = () => {
      onClose?.();
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (closed) return;
    const delay = Math.min(1000 * 2 ** retries, 30000);
    retries++;
    timer = setTimeout(connect, delay);
  }

  connect();

  return {
    send(req: QueryRequest) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(req));
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    },
    isOpen: () => ws?.readyState === WebSocket.OPEN,
  };
}