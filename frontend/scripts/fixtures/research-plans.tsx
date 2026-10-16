import React from "react";
import { createRoot } from "react-dom/client";
import ResearchPage from "../../src/app/research/page";
import FindingsPage from "../../src/app/findings/page";
import DocumentsPage from "../../src/app/documents/page";
import DocumentDetailClient from "../../src/components/documents/DocumentDetailClient";
import { PathParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
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
const path=window.location.pathname;
// Use the installed Next hook/context, not a duplicate document view or API.
const documentId=/^\/documents\/([^/]+)$/.exec(path)?.[1];
createRoot(document.getElementById("root")!).render(<React.StrictMode><PathParamsContext.Provider value={documentId?{documentId}:{}}>
  <main style={{height: "100dvh"}}>{path==="/findings"?<FindingsPage/>:path==="/documents"?<DocumentsPage/>:documentId?<DocumentDetailClient/>:<ResearchPage/>}</main>
</PathParamsContext.Provider></React.StrictMode>);
