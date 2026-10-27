import React from "react";
import {createRoot} from "react-dom/client";
import RadarPage from "../../src/app/radar/page";
import FindingsPage from "../../src/app/findings/page";
import {useStore} from "../../src/hooks/useStore";
import "../../src/app/globals.css";

const query=new URLSearchParams(location.search);
const actor=query.get("actor")||sessionStorage.getItem("synthetic-research-actor")||"22222222-2222-4222-8222-222222222222";
sessionStorage.setItem("synthetic-research-actor",actor);
const theme=query.get("theme")||sessionStorage.getItem("synthetic-radar-theme")||"light";
sessionStorage.setItem("synthetic-radar-theme",theme);document.documentElement.classList.toggle("dark",theme==="dark");
useStore.setState({...useStore.getInitialState(),authMode:"authenticated",authUser:{id:actor,email:null},
  workspaceId:"11111111-1111-4111-8111-111111111111",workspaceDiscovery:"ready"});
document.title="NexusRAG synthetic supplied-snapshot Radar workflow";
createRoot(document.getElementById("root")!).render(<React.StrictMode><main style={{height:"100dvh"}}>
  {location.pathname==="/findings"?<FindingsPage/>:<RadarPage/>}
</main></React.StrictMode>);
