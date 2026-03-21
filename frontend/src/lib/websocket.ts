import type { QueryRequest, WSFrame } from "@/types";

const WS_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000")
  .replace("http://", "ws://")
  .replace("https://", "wss://");

export function createChatSocket(
  onFrame: (frame: WSFrame) => void,
  onError?: (err: Event | Error) => void,
  onClose?: () => void
) {
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let closed = false;

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
    const delay = Math.min(1000 * 2 ** retries, 15000);
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