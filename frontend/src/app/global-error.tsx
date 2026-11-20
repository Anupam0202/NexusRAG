"use client";

import { useEffect } from "react";

/**
 * Shown when the app's own frame fails. It replaces the whole document, so it carries its own minimal styles and
 * follows the system's light or dark setting.
 */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: "16px", colorScheme: "light dark" }}>
        <title>NexusRAG could not start</title>
        <main role="alert" style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem" }}>NexusRAG could not start</h1>
          <p style={{ lineHeight: 1.6 }}>
            Something went wrong while loading the app. Nothing you saved was lost. Try again in a moment.
          </p>
          <button type="button" onClick={() => retry()} style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer", fontWeight: 600 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
