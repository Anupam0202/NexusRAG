import type { Metadata } from "next";

export const metadata: Metadata = {
  referrer: "no-referrer",
};

export default function AuthConfirmLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}