import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for file uploads.
 *
 * Vercel edge-level rewrites can fail silently with multipart/form-data
 * POST requests. This API route handles the upload server-side, streaming
 * the request body directly to the backend — no CORS, no edge issues.
 *
 * The client calls POST /api/v1/documents/upload (same origin).
 * This route forwards it to the Render backend.
 */

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    // Stream the raw request body to the backend
    const backendUrl = `${BACKEND_URL}/api/v1/documents/upload`;

    // Get the content-type (includes the multipart boundary)
    const contentType = request.headers.get("content-type") || "";

    // Forward the request to the backend
    const backendResponse = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
      },
      body: request.body,
      // @ts-ignore — duplex is needed for streaming request bodies
      duplex: "half",
    });

    // Get the response from the backend
    const data = await backendResponse.json();

    return NextResponse.json(data, { status: backendResponse.status });
  } catch (error: any) {
    console.error("[upload-proxy] Error:", error.message);
    return NextResponse.json(
      { detail: `Upload proxy error: ${error.message}` },
      { status: 502 }
    );
  }
}

// Increase the body size limit for this route (default is 4.5MB)
export const config = {
  api: {
    bodyParser: false,
  },
};
