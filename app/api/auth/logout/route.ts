import { withApiUsage } from "@/lib/telemetry/usage"
import { relativeRedirect } from "@/lib/http/relative-redirect";

export const POST = withApiUsage({ endpoint: "/api/auth/logout", tool: "AuthLogout" })(async () => {
  /*
   * 🛑 THIS RETURNED 500 IN PRODUCTION, MEASURED 2026-09-02 — logging out was broken.
   *
   * The intent was right and the comment said so: a relative redirect is what avoids
   * the 0.0.0.0 origin. But NextResponse.redirect cannot express one. Its validateURL
   * does `new URL(String(url))` and throws on anything without a scheme, so this line
   * raised "URL is malformed" on every call and the handler 500'd instead of clearing
   * the cookie. relativeRedirect builds the response directly.
   */
  const res = relativeRedirect("/login", 303);

  res.cookies.set("admin_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return res;
})


