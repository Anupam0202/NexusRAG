/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Production builds type-check application code only. Tests import fixtures and
  // gateway modules from outside frontend/, which the frontend-only Docker build
  // context does not contain; `npx tsc --noEmit` in CI still type-checks them.
  typescript: {
    tsconfigPath: "tsconfig.build.json",
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default config;
