"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WSFrame } from "@/types";

const WS_BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000")
    .replace("http://", "ws://")
    .replace("https://", "wss://");

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Low-level WebSocket hook — manages connection lifecycle,
 * exponential-backoff reconnection, and typed frame parsing.
 *
 * Higher-level `useChat` is built on top of this.
 */
export function useWebSocket(path: string = "/ws/chat") {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const retriesRef = useRef(0);
  const mountedRef = useRef(true);
  const [connected, setConnected] = useState(false);
  const [lastFrame, setLastFrame] = useState<WSFrame | null>(null);

  const listenersRef = useRef<Set<(frame: WSFrame) => void>>(new Set());

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_BASE}${path}`);

    ws.onopen = () => {
      setConnected(true);
      retriesRef.current = 0; // Reset backoff on successful connection
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
      if (!mountedRef.current) return;
      // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s
      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, retriesRef.current),
        RECONNECT_MAX_MS
      );
      retriesRef.current++;
      reconnectTimer.current = setTimeout(connect, delay);
    };

    wsRef.current = ws;
  }, [path]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
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
