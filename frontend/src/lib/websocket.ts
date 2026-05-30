import type { QueryRequest, WSFrame } from "@/types";
import { getBackendWsBaseUrl } from "@/lib/backend-url";

/**
 * WebSocket connections go directly to the backend because Vercel rewrites
 * cannot proxy WebSockets.
 */
export function createChatSocket(
  onFrame: (frame: WSFrame) => void,
  onError?: (err: Event | Error) => void,
  onClose?: () => void,
  onStatus?: (status: "online" | "reconnecting" | "offline") => void
) {
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let closed = false;

  let WS_BASE: string | null = null;

  try {
    WS_BASE = getBackendWsBaseUrl();
  } catch (err) {
    onError?.(err instanceof Error ? err : new Error("Invalid backend URL"));
  }

  if (!WS_BASE) {
    onStatus?.("offline");
    return {
      send: () => false,
      close: () => {
        closed = true;
      },
      isOpen: () => false,
    };
  }

  function connect() {
    if (closed) return;
    try {
      ws = new WebSocket(`${WS_BASE}/ws/chat`);
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      retries = 0;
      onStatus?.("online");
    };
    ws.onmessage = (evt) => {
      try { onFrame(JSON.parse(evt.data)); } catch { /* skip */ }
    };
    ws.onerror = (evt) => onError?.(evt);
    ws.onclose = () => {
      if (closed) return;
      onClose?.();
      onStatus?.("reconnecting");
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (closed) return;
    if (retries >= 8) {
      onStatus?.("offline");
      return;
    }
    const delay = Math.min(1000 * 2 ** retries, 30000);
    retries++;
    timer = setTimeout(connect, delay);
  }

  connect();

  return {
    send(req: QueryRequest) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(req));
        return true;
      }
      return false;
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    },
    isOpen: () => ws?.readyState === WebSocket.OPEN,
  };
}
