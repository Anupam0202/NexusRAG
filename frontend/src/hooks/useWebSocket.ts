"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WSFrame } from "@/types";

const WS_BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000")
    .replace("http://", "ws://")
    .replace("https://", "wss://");

/**
 * Low-level WebSocket hook — manages connection lifecycle,
 * reconnection, and typed frame parsing.
 *
 * Higher-level `useChat` is built on top of this.
 */
export function useWebSocket(path: string = "/ws/chat") {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const [connected, setConnected] = useState(false);
  const [lastFrame, setLastFrame] = useState<WSFrame | null>(null);

  const listenersRef = useRef<Set<(frame: WSFrame) => void>>(new Set());

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_BASE}${path}`);

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (evt) => {
      try {
        const frame: WSFrame = JSON.parse(evt.data);
        setLastFrame(frame);
        listenersRef.current.forEach((fn) => fn(frame));
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = () => {
      setConnected(false);
    };

    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 3 seconds
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    wsRef.current = ws;
  }, [path]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const subscribe = useCallback((fn: (frame: WSFrame) => void) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  return { connected, send, subscribe, lastFrame };
}
