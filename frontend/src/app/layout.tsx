import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { Toaster } from "sonner";
import { ApiKeyModal } from "@/components/chat/ApiKeyModal";

export const metadata: Metadata = {
  title: "NexusRAG",
  description: "NexusRAG — Enterprise Document Intelligence Platform. Upload documents and ask AI-powered questions.",
  keywords: ["RAG", "AI", "document intelligence", "enterprise", "retrieval augmented generation", "NexusRAG"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="flex h-[100dvh] overflow-hidden font-sans">
        <ThemeProvider>
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden min-w-0">
            <Header />
            <main className="flex-1 overflow-hidden">{children}</main>
          </div>
          <ApiKeyModal />
          <Toaster
            richColors
            position="top-center"
            toastOptions={{
              style: { fontFamily: "'Inter', system-ui, sans-serif" },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}