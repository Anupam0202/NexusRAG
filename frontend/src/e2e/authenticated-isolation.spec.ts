import { expect, request, test } from "@playwright/test";

// OAuth-only application: use approved, short-lived real sessions, never password grants.
const required = {
  supabaseUrl: process.env.E2E_SUPABASE_URL,
  supabaseAnonKey: process.env.E2E_SUPABASE_ANON_KEY,
  backendUrl: process.env.E2E_BACKEND_URL,
  tokenA: process.env.E2E_USER_A_ACCESS_TOKEN,
  tokenB: process.env.E2E_USER_B_ACCESS_TOKEN,
  workspaceA: process.env.E2E_WORKSPACE_A_ID,
  workspaceB: process.env.E2E_WORKSPACE_B_ID,
  storageA: process.env.E2E_USER_A_STORAGE_STATE,
  storageB: process.env.E2E_USER_B_STORAGE_STATE,
};
const enabled = process.env.E2E_AUTHENTICATED_REQUIRED === "true";
const configured = Object.values(required).every(Boolean);
if (enabled && (!configured || process.env.E2E_ALLOW_SYNTHETIC_PROVIDER_PROCESSING !== "true")) {
  throw new Error("BLOCKED: authenticated acceptance requires two approved OAuth sessions, isolated workspaces, browser states and synthetic-provider consent.");
}
const headers = (workspace: string) => ({ "X-Nexus-Workspace-Id": workspace });

test.describe("real OAuth workspace and record isolation", () => {
  test.skip(!enabled, "Not run by public smoke. The explicit authenticated acceptance command fails closed on missing prerequisites.");
  test("two real identities cannot access another tenant and private findings require sharing", async ({ browser }) => {
    test.setTimeout(180_000);
    const auth = await request.newContext();
    const identify = async (token: string) => {
      const response = await auth.get(`${required.supabaseUrl}/auth/v1/user`, {
        headers: { apikey: required.supabaseAnonKey!, Authorization: `Bearer ${token}` },
      });
      expect(response.status(), "OAuth session must be valid").toBe(200);
      const body = await response.json();
      return body.id as string;
    };
    const userA = await identify(required.tokenA!);
    const userB = await identify(required.tokenB!);
    expect(userA).not.toBe(userB);
    expect(required.workspaceA).not.toBe(required.workspaceB);
    const apiA = await request.newContext({ baseURL: required.backendUrl,
      extraHTTPHeaders: { Authorization: `Bearer ${required.tokenA}`, ...headers(required.workspaceA!) } });
    const apiB = await request.newContext({ baseURL: required.backendUrl,
      extraHTTPHeaders: { Authorization: `Bearer ${required.tokenB}`, ...headers(required.workspaceB!) } });
    const marker = `synthetic-isolation-${Date.now()}-${crypto.randomUUID()}`;
    let documentId: string | undefined;
    let findingId: string | undefined;
    let sessionId: string | undefined;
    let addedMember = false;
    const contextA = await browser.newContext({ storageState: required.storageA });
    const contextB = await browser.newContext({ storageState: required.storageB });
    try {
      for (const [api, workspace] of [[apiA, required.workspaceA!], [apiB, required.workspaceB!]] as const) {
        const current = await api.get("/api/v1/workspaces/current");
        expect(current.status()).toBe(200);
        expect((await current.json()).workspace_id).toBe(workspace);
      }
      const forbidden = await apiB.get("/api/v1/documents", { headers: headers(required.workspaceA!) });
      expect(forbidden.status()).toBe(403);
      const upload = await apiA.post("/api/v1/documents/upload", {
        headers: { "Idempotency-Key": crypto.randomUUID() },
        multipart: { file: { name: `${marker}.txt`, mimeType: "text/plain", buffer: Buffer.from(`Synthetic test marker: ${marker}`) },
          data_classification: "non_sensitive", non_sensitive_attested: "true" },
      });
      expect(upload.status()).toBe(202);
      const uploaded = await upload.json(); documentId = uploaded.document.document_id;
      await expect.poll(async () => {
        const status = await apiA.get(`/api/v1/documents/${documentId}/status`);
        expect(status.status()).toBe(200);
        return (await status.json()).status;
      }, { timeout: 90_000 }).toBe("completed");
      const answer = await apiA.post("/api/v1/chat", { headers: { "Idempotency-Key": crypto.randomUUID() },
        data: { question: "What is the synthetic test marker? Quote it exactly.", chat_scope: "documents",
          document_ids: [documentId], non_sensitive_attested: true } });
      expect(answer.status()).toBe(200);
      const answerBody = await answer.json();
      sessionId = answerBody.metadata.session_id;
      expect(answerBody.answer).toContain(marker); expect(answerBody.sources.length).toBeGreaterThan(0);
      const bDocuments = await apiB.get("/api/v1/documents");
      expect(await bDocuments.text()).not.toContain(marker);
      const created = await apiA.post("/api/v2/findings", { headers: { "Idempotency-Key": `${marker}-finding` },
        data: { title: marker, authored_markdown: "Synthetic authored note. Not a verified external claim." } });
      expect(created.status()).toBe(201); findingId = (await created.json()).id;
      // Add a real existing test identity to the synthetic workspace, then verify
      // membership alone does not expose private findings.
      const add = await apiA.post("/api/v1/workspaces/current/members", { data: { email_or_user_id: userB, role: "editor" } });
      expect(add.status()).toBe(201); addedMember = true;
      const privateRead = await apiB.get(`/api/v2/findings/${findingId}`, { headers: headers(required.workspaceA!) });
      expect(privateRead.status()).toBe(403);
      const mcp = await apiB.post("/api/v2/mcp/execute", { headers: headers(required.workspaceA!), data: { operation: "finding_retrieval" } });
      expect(mcp.status()).toBe(200); expect(await mcp.text()).not.toContain(marker);
      const shared = await apiA.post(`/api/v2/findings/${findingId}/share`, { data: { user_id: userB, permission: "contribute" } });
      expect(shared.status()).toBe(200);
      const reviewed = await apiB.post(`/api/v2/findings/${findingId}/review`, { headers: headers(required.workspaceA!),
        data: { revision: 1, decision: "approved", comment: "Reviewed synthetic acceptance fixture." } });
      expect(reviewed.status()).toBe(200);
      const pageA = await contextA.newPage(); const pageB = await contextB.newPage();
      await pageA.goto(`${process.env.E2E_BASE_URL}/findings`);
      await pageB.goto(`${process.env.E2E_BASE_URL}/findings`);
      await expect(pageA.getByRole("button", { name: new RegExp(marker) })).toBeVisible();
      await expect(pageB.getByRole("button", { name: new RegExp(marker) })).toHaveCount(0);
      const exported = await apiA.post(`/api/v2/findings/${findingId}/export`);
      expect(exported.status()).toBe(201); expect((await exported.json()).manifest_hash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      // Never erase pre-provisioned workspaces or unrelated records. Each cleanup
      // is attempted independently, and failure makes acceptance fail.
      const failures: string[] = [];
      const cleanup = async (label: string, operation: () => Promise<{ ok(): boolean }>) => {
        try { if (!(await operation()).ok()) failures.push(`${label} cleanup failed`); }
        catch { failures.push(`${label} cleanup unavailable`); }
      };
      if (sessionId) await cleanup("chat", () => apiA.post(`/api/v1/chat/sessions/${sessionId}/clear`));
      if (findingId) await cleanup("finding", () => apiA.delete(`/api/v2/findings/${findingId}`));
      if (documentId) await cleanup("document", () => apiA.post(`/api/v1/documents/${documentId}/delete`));
      if (addedMember) await cleanup("member", () => apiA.delete(`/api/v1/workspaces/current/members/${userB}`));
      await Promise.all([contextA.close(), contextB.close(), apiA.dispose(), apiB.dispose(), auth.dispose()]);
      expect(failures, "Synthetic fixtures must be cleaned").toEqual([]);
    }
  });
});
