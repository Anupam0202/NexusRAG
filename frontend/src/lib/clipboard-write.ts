export const clipboardConfirmationMs = 10000;
const unconfirmed = "Copy was not confirmed. The browser write may finish later; check the clipboard before retrying.";

class ClipboardConfirmationTimeout extends Error {}

export async function writeClipboardText(text: string): Promise<void> {
  // Invoke in the click's activation context; this deadline cannot cancel the OS write.
  const writing = navigator.clipboard.writeText(text);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([writing, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ClipboardConfirmationTimeout(unconfirmed)), clipboardConfirmationMs);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function clipboardFailureMessage(error: unknown): string {
  return error instanceof ClipboardConfirmationTimeout ? unconfirmed : "The clipboard was unavailable.";
}
