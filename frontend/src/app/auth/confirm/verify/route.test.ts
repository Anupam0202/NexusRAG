import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyOtp } = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { verifyOtp },
  })),
}));

import { POST } from "./route";

function confirmationRequest(values: Record<string, string>) {
  return new Request("https://nexusrag.vercel.app/auth/confirm/verify", {
    method: "POST",
    headers: {
      origin: "https://nexusrag.vercel.app",
    },
    body: new URLSearchParams(values),
  });
}

describe("POST /auth/confirm/verify", () => {
  beforeEach(() => {
    verifyOtp.mockReset();
  });

  it("verifies an email token hash and redirects to the requested internal path", async () => {
    verifyOtp.mockResolvedValue({ error: null });

    const response = await POST(
      confirmationRequest({
        token_hash: "valid-hash",
        type: "email",
        next: "/documents?status=ready",
      })
    );

    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "valid-hash",
      type: "email",
    });
    expect(response.headers.get("location")).toBe(
      "https://nexusrag.vercel.app/auth/callback?next=%2Fdocuments%3Fstatus%3Dready"
    );
    expect(response.status).toBe(303);
  });

  it("rejects missing or unsupported verification parameters without calling Supabase", async () => {
    const response = await POST(
      confirmationRequest({
        token_hash: "hash",
        type: "signup",
      })
    );

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://nexusrag.vercel.app/auth/callback?error_description=This+sign-in+link+is+invalid+or+expired.+Request+a+new+one."
    );
    expect(response.status).toBe(303);
  });

  it("does not expose Supabase errors and rejects external redirect targets", async () => {
    verifyOtp.mockResolvedValue({
      error: new Error("sensitive provider detail"),
    });

    const response = await POST(
      confirmationRequest({
        token_hash: "expired",
        type: "email",
        next: "https://evil.example/steal",
      })
    );

    const location = response.headers.get("location");
    expect(location).toBe(
      "https://nexusrag.vercel.app/auth/callback?error_description=This+sign-in+link+is+invalid+or+expired.+Request+a+new+one."
    );
    expect(location).not.toContain("sensitive");
    expect(location).not.toContain("evil.example");
  });

  it("rejects cross-origin verification attempts to prevent login CSRF", async () => {
    const request = confirmationRequest({
      token_hash: "attacker-hash",
      type: "email",
      next: "/documents",
    });
    request.headers.set("origin", "https://evil.example");

    const response = await POST(request);

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://nexusrag.vercel.app/auth/callback?error_description=This+sign-in+link+is+invalid+or+expired.+Request+a+new+one."
    );
  });
});
