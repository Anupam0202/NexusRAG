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