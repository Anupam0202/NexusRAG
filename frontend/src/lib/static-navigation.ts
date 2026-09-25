/** Perform a real document navigation so Cloudflare can serve pre-rendered HTML. */
export function navigateStatic(href: string) {
  window.location.replace(href);
}

export function reloadStatic() {
  window.location.reload();
}