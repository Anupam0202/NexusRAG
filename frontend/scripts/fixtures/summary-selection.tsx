import React from "react";
import { createRoot } from "react-dom/client";
import ChatInterface from "../../src/components/chat/ChatInterface";
import { useStore } from "../../src/hooks/useStore";
import "../../src/app/globals.css";

useStore.setState({ ...useStore.getInitialState(), authMode: "demo",
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceDiscovery: "ready" });
document.title = "NexusRAG synthetic chat component fixture";
document.documentElement.classList.toggle("dark", new URLSearchParams(window.location.search).get("theme") === "dark");
createRoot(document.getElementById("root")!).render(
  <React.StrictMode><main style={{ height: "100dvh", maxWidth: 1100, margin: "0 auto" }}>
    <ChatInterface />
  </main></React.StrictMode>
);
