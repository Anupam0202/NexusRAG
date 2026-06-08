import { NextResponse } from "next/server";
import { AUTH_LINK_ERROR_MESSAGE, sanitizeAuthNextPath } from "@/lib/auth-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const DEFAULT_AUTH_DESTINATION = "/documents";
const RECOVERY_DESTINATION = "/auth/update-password";
const ALLOWED_OTP_TYPES = new Set(["email", "recovery"]);

function isAllowedOtpType(value: FormDataEntryValue | null): value is "email" | "recovery" {
  return typeof value === "string" && ALLOWED_OTP_TYPES.has(value);
}

function callbackUrl(requestUrl: URL, nextPath?: string) {
  const callback = new URL("/auth/callback", requestUrl.origin);
  if (nextPath) {
    callback.searchParams.set("next", nextPath);
  } else {
    callback.searchParams.set("error_description", AUTH_LINK_ERROR_MESSAGE);
  }
  return callback;
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  if (request.headers.get("origin") !== requestUrl.origin) {
    return NextResponse.redirect(callbackUrl(requestUrl), 303);
  }

  const formData = await request.formData();
  const tokenHash = formData.get("token_hash");
  const type = formData.get("type");
  const requestedNextPath = formData.get("next");

  if (typeof tokenHash !== "string" || !tokenHash || !isAllowedOtpType(type)) {
    return NextResponse.redirect(callbackUrl(requestUrl), 303);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error) {
    return NextResponse.redirect(callbackUrl(requestUrl), 303);
  }

  const nextPath =
    type === "recovery"
      ? RECOVERY_DESTINATION
      : sanitizeAuthNextPath(
          typeof requestedNextPath === "string" ? requestedNextPath : null,
          DEFAULT_AUTH_DESTINATION
        );
  return NextResponse.redirect(callbackUrl(requestUrl, nextPath), 303);
}
