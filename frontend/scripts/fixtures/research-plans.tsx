import React from "react";
import { createRoot } from "react-dom/client";
import ResearchPage from "../../src/app/research/page";
import FindingsPage from "../../src/app/findings/page";
import { useStore } from "../../src/hooks/useStore";
import "../../src/app/globals.css";
const parameters=new URLSearchParams(window.location.search);
const actor=parameters.get("actor") || sessionStorage.getItem("synthetic-research-actor") || "22222222-2222-4222-8222-222222222222";
sessionStorage.setItem("synthetic-research-actor",actor);
useStore.setState({...useStore.getInitialState(), authMode: "authenticated", authUser: {id: actor, email: null},
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceDiscovery: "ready"});
document.title="NexusRAG synthetic research workflow";
const theme=parameters.get("theme") || sessionStorage.getItem("synthetic-research-theme") || "light";
sessionStorage.setItem("synthetic-research-theme",theme);
document.documentElement.classList.toggle("dark",theme==="dark");
createRoot(document.getElementById("root")!).render(<React.StrictMode><main style={{height: "100dvh"}}>{window.location.pathname==="/findings"?<FindingsPage/>:<ResearchPage/>}</main></React.StrictMode>);
