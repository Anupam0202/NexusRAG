"use client";

import { useEffect } from "react";
import { navigateStatic } from "@/lib/static-navigation";

export default function RootPage() {
  useEffect(() => {
    navigateStatic("/chat");
  }, []);

  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold">Opening NexusRAG Chat</h1>
      <a className="mt-2 underline underline-offset-4" href="/chat">
        Continue
      </a>
    </main>
  );
}