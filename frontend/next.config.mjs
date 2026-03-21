/** @type {import('next').NextConfig} */
const config = {
  // "standalone" is only needed for Docker; Vercel ignores it
  // but keeping it ensures both Docker and Vercel work
  output: "standalone",
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  },
  // Vercel rewrites for proxying API calls to the backend
  // (avoids CORS issues entirely in production)
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendUrl}/api/v1/:path*`,
      },
      {
        source: "/ws/:path*",
        destination: `${backendUrl}/ws/:path*`,
      },
      {
        source: "/health",
        destination: `${backendUrl}/health`,
      },
    ];
  },
};

export default config;
