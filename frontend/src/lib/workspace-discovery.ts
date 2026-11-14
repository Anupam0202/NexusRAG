/** Account recovery and membership bootstrap do not require a selected workspace. */
export function isWorkspaceRoute(path: string): boolean {
  try {
    const url = new URL(path, "https://nexusrag.invalid");
    if (url.origin !== "https://nexusrag.invalid") return true;
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (["/settings/security", "/workspaces"].includes(pathname)) return false;
    return pathname === "/" || ["/chat", "/documents", "/analytics", "/evaluations", "/settings", "/findings", "/workspaces"]
      .some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
  } catch {
    return true;
  }
}

// Bound read-only discovery, without treating provider outages as no membership.
// Callers must fence late results against their current identity and lifecycle.
export async function boundedDiscoveryRead<T>(read: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Workspace discovery timed out")), 15_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
