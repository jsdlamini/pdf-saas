import { describe, expect, it } from "vitest";
import { hasClerkQueryParams } from "./clerk-query-params";

describe("hasClerkQueryParams", () => {
  it("returns false for a clean / visit", () => {
    expect(hasClerkQueryParams(new URLSearchParams())).toBe(false);
    expect(hasClerkQueryParams(new URLSearchParams("utm_source=google"))).toBe(false);
  });

  it("detects Clerk handshake and redirect-flow params", () => {
    expect(hasClerkQueryParams(new URLSearchParams("__clerk_handshake=abc"))).toBe(true);
    expect(hasClerkQueryParams(new URLSearchParams("__clerk_handshake_nonce=abc"))).toBe(true);
    expect(hasClerkQueryParams(new URLSearchParams("__clerk_status=verified"))).toBe(true);
    expect(hasClerkQueryParams(new URLSearchParams("__clerk_created_session=sess_1"))).toBe(true);
    expect(hasClerkQueryParams(new URLSearchParams("__clerk_ticket=abc"))).toBe(true);
    expect(hasClerkQueryParams(new URLSearchParams("__clerk_invitation_token=abc"))).toBe(true);
    expect(hasClerkQueryParams(new URLSearchParams("__clerk_db_jwt=abc"))).toBe(true);
    expect(hasClerkQueryParams(new URLSearchParams("__clerk_redirect_url=/"))).toBe(true);
  });

  it("detects the suffixed-cookies probe param", () => {
    expect(hasClerkQueryParams(new URLSearchParams("suffixed_cookies=true"))).toBe(true);
  });

  it("detects Clerk params among unrelated params", () => {
    expect(hasClerkQueryParams(new URLSearchParams("utm_source=x&__clerk_handshake=abc"))).toBe(true);
  });
});
