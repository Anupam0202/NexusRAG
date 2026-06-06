import { expect, request, test, type APIRequestContext } from "@playwright/test";

const required = {
  supabaseUrl: process.env.E2E_SUPABASE_URL,
  supabaseAnonKey: process.env.E2E_SUPABASE_ANON_KEY,
  backendUrl: process.env.E2E_BACKEND_URL,
  userAEmail: process.env.E2E_USER_A_EMAIL,
  userAPassword: process.env.E2E_USER_A_PASSWORD,
  userBEmail: process.env.E2E_USER_B_EMAIL,
  userBPassword: process.env.E2E_USER_B_PASSWORD,
};

const configured = Object.values(required).every(Boolean);

async function accessToken(email: string, password: string) {
  const auth = await request.newContext();
  const response = await auth.post(`${required.supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: {
      apikey: required.supabaseAnonKey!,
      "Content-Type": "application/json",
    },
    data: { email, password },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = await response.json();
  await auth.dispose();
  return body.access_token as string;
}

async function backend(token: string) {
  return request.newContext({
    baseURL: required.backendUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

async function createWorkspace(api: APIRequestContext, suffix: string) {
  const response = await api.post("/api/v1/workspaces", {
    data: {
      name: `NexusRAG E2E ${suffix}`,
      slug: `nexusrag-e2e-${suffix}`,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = await response.json();
  return body.id as string;
}

async function deleteWorkspace(api: APIRequestContext, workspaceId: string) {
  return api.delete("/api/v1/workspaces/current", {
    headers: workspaceHeaders(workspaceId),
    data: { confirmation: "DELETE WORKSPACE" },
  });
}

function workspaceHeaders(workspaceId: string) {
  return { "X-Nexus-Workspace-Id": workspaceId };
}

test.describe("authenticated workspace isolation", () => {
  test.skip(!configured, "Dedicated authenticated E2E accounts and aligned Supabase/backend are required.");
  test.skip(({ browserName }) => browserName !== "chromium", "The API-backed isolation flow runs once.");

  test("two users cannot read or query each other's workspace document", async () => {
    const tokenA = await accessToken(required.userAEmail!, required.userAPassword!);
    const tokenB = await accessToken(required.userBEmail!, required.userBPassword!);
    const apiA = await backend(tokenA);
    const apiB = await backend(tokenB);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const workspaceA = await createWorkspace(apiA, `${suffix}-a`);
    const workspaceB = await createWorkspace(apiB, `${suffix}-b`);

    try {
      expect(workspaceA).not.toBe(workspaceB);

      const marker = `nexusrag-isolation-${suffix}`;
      const upload = await apiA.post("/api/v1/documents/upload", {
        headers: workspaceHeaders(workspaceA),
        multipart: {
          file: {
            name: `${marker}.txt`,
            mimeType: "text/plain",
            buffer: Buffer.from(`Private marker: ${marker}`),
          },
        },
      });
      expect(upload.ok(), await upload.text()).toBeTruthy();
      const uploaded = await upload.json();
      const documentId = uploaded.document.document_id as string;

      await expect
        .poll(async () => {
          const status = await apiA.get(`/api/v1/documents/${documentId}/status`, {
            headers: workspaceHeaders(workspaceA),
          });
          return (await status.json()).status;
        })
        .toBe("completed");

      const aDocuments = await apiA.get("/api/v1/documents", {
        headers: workspaceHeaders(workspaceA),
      });
      expect(await aDocuments.text()).toContain(marker);

      const aChat = await apiA.post("/api/v1/chat", {
        headers: workspaceHeaders(workspaceA),
        data: {
          question: "What is the private marker? Return the exact marker.",
          chat_scope: "documents",
          document_ids: [documentId],
        },
      });
      expect(aChat.ok(), await aChat.text()).toBeTruthy();
      const aChatBody = await aChat.json();
      expect(JSON.stringify(aChatBody)).toContain(marker);
      expect(aChatBody.sources.length).toBeGreaterThan(0);

      const bDocuments = await apiB.get("/api/v1/documents", {
        headers: workspaceHeaders(workspaceB),
      });
      expect(await bDocuments.text()).not.toContain(marker);

      const forbidden = await apiB.get("/api/v1/documents", {
        headers: workspaceHeaders(workspaceA),
      });
      expect(forbidden.status()).toBe(403);

      const bChat = await apiB.post("/api/v1/chat", {
        headers: workspaceHeaders(workspaceB),
        data: { question: `What is the private marker ${marker}?` },
      });
      expect(await bChat.text()).not.toContain(`Private marker: ${marker}`);
    } finally {
      const deletedA = await deleteWorkspace(apiA, workspaceA);
      expect(deletedA.ok(), await deletedA.text()).toBeTruthy();
      const deletedB = await deleteWorkspace(apiB, workspaceB);
      expect(deletedB.ok(), await deletedB.text()).toBeTruthy();
      await apiA.dispose();
      await apiB.dispose();
    }
  });
});
