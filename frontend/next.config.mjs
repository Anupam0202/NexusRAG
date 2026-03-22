/** @type {import('next').NextConfig} */
const config = {
  // "standalone" is only needed for Docker; Vercel ignores it
  output: "standalone",
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  },
  // Vercel rewrites — proxy REST calls to the backend
  // WebSocket connections go directly to the backend (Vercel doesn't proxy WS)
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendUrl}/api/v1/:path*`,
      },
      {
        source: "/health",
        destination: `${backendUrl}/health`,
      },
    ];
  },
};

export default config;
