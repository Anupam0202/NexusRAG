import React from "react";
import { createRoot } from "react-dom/client";
import ResearchPage from "../../src/app/research/page";
import { useStore } from "../../src/hooks/useStore";
import "../../src/app/globals.css";
const actor=new URLSearchParams(window.location.search).get("actor") || "22222222-2222-4222-8222-222222222222";
useStore.setState({...useStore.getInitialState(), authMode: "authenticated", authUser: {id: actor, email: null},
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceDiscovery: "ready"});
document.title="NexusRAG synthetic research workflow";
document.documentElement.classList.toggle("dark",new URLSearchParams(window.location.search).get("theme")==="dark");
createRoot(document.getElementById("root")!).render(<React.StrictMode><main style={{height: "100dvh"}}><ResearchPage /></main></React.StrictMode>);
