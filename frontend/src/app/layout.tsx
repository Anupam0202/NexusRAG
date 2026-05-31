import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { PageTransition } from "@/components/layout/PageTransition";
import { Toaster } from "sonner";
import { ApiKeyModal } from "@/components/chat/ApiKeyModal";
import { AuthProvider } from "@/components/auth/AuthProvider";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "NexusRAG",
  description: "NexusRAG — Enterprise Document Intelligence Platform. Upload documents and ask AI-powered questions.",
  keywords: ["RAG", "AI", "document intelligence", "enterprise", "retrieval augmented generation", "NexusRAG"],
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className="flex h-[100dvh] overflow-hidden font-sans">
        <ThemeProvider>
          <AuthProvider />
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden min-w-0">
            <Header />
            <PageTransition>{children}</PageTransition>
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
