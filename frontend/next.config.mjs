/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  },
  // Vercel rewrites — proxy REST calls to the backend
  // Upload is handled by the API route at /api/v1/documents/upload/route.ts
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return {
      // These rewrites are checked BEFORE API routes
      beforeFiles: [],
      // These rewrites are checked AFTER API routes (so /api/v1/documents/upload goes to our route.ts)
      afterFiles: [
        {
          source: "/api/v1/:path*",
          destination: `${backendUrl}/api/v1/:path*`,
        },
        {
          source: "/health",
          destination: `${backendUrl}/health`,
        },
      ],
      // Fallback rewrites
      fallback: [],
    };
  },
};

export default config;
