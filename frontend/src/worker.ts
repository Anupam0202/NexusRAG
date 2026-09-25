import openNextWorker from "../.open-next/worker.js";

interface StaticAssets {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: StaticAssets;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const staticDocumentPath = "/documents/__static_document__";
const documentIdPath = /^\/documents\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i;

const candidateWorker = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContextLike
  ): Promise<Response> {
    const url = new URL(request.url);
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      url.pathname === staticDocumentPath
    ) {
      return env.ASSETS.fetch(request);
    }

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      documentIdPath.test(url.pathname)
    ) {
      url.pathname = staticDocumentPath;
      return env.ASSETS.fetch(new Request(url, request));
    }

    return openNextWorker.fetch(request, env, ctx);
  },
};

export default candidateWorker;