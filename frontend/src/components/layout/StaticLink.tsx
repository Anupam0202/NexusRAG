import type { AnchorHTMLAttributes, ReactNode } from "react";

type StaticLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  children: ReactNode;
};

/**
 * Local page navigation deliberately uses native document requests.
 *
 * Cloudflare Workers Free caps dynamic Worker CPU at 10 ms per request.
 * Static HTML requests are served by Workers Static Assets without invoking
 * the Worker, whereas Next client-router/RSC transitions invoke the SSR
 * Worker. Keep ordinary navigation on the static-asset path.
 */
export default function StaticLink({ href, children, ...props }: StaticLinkProps) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}