import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import {
  AD_OPT_OUT_COOKIE,
  AD_OPT_OUT_COOKIE_MAX_AGE_SECONDS,
  hasGpcHeader,
  type AdOptOutSource,
} from "@/lib/privacy/adMeasurementOptOut"
import { isUserAdOptedOut, setUserAdOptOut } from "@/lib/privacy/adOptOutStore"

export const dynamic = "force-dynamic"

/**
 * "Do Not Sell or Share" — the account half (lib/privacy/adMeasurementOptOut).
 *
 * GET  → { signedIn, accountOptedOut }
 * POST { optOut: boolean, source? } → records or clears the account opt-out and sets the
 *      browser cookie to match. Signed out, only the cookie is set: the choice still holds
 *      for this browser, and /privacy/choices says so.
 */

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET() {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ signedIn: false, accountOptedOut: false })
  return NextResponse.json({ signedIn: true, accountOptedOut: await isUserAdOptedOut(userId) })
}

const SOURCES: readonly AdOptOutSource[] = ["choices_page", "settings", "gpc"]

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { optOut?: unknown; source?: unknown } | null
  if (typeof body?.optOut !== "boolean") {
    return NextResponse.json({ error: "optOut must be true or false" }, { status: 400 })
  }
  const optOut = body.optOut
  const source: AdOptOutSource = SOURCES.includes(body.source as AdOptOutSource)
    ? (body.source as AdOptOutSource)
    : "choices_page"

  // Opting back IN while the browser still sends GPC would be undone on the next request;
  // refuse it rather than show a setting that does not hold.
  if (!optOut && hasGpcHeader(req.headers)) {
    return NextResponse.json(
      { error: "Your browser is sending Global Privacy Control, which keeps you opted out.", code: "gpc_active" },
      { status: 409 },
    )
  }

  const userId = await sessionUserId()
  let accountSaved = false
  if (userId) {
    accountSaved = await setUserAdOptOut(userId, optOut ? { source } : null).catch(() => false)
    if (!accountSaved) {
      return NextResponse.json({ error: "Could not save your choice. Please try again." }, { status: 503 })
    }
  }

  const res = NextResponse.json({ ok: true, optedOut: optOut, signedIn: Boolean(userId), accountSaved })
  if (optOut) {
    res.cookies.set(AD_OPT_OUT_COOKIE, "1", {
      maxAge: AD_OPT_OUT_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      // Read by the inline tag guards in app/layout.tsx, so it cannot be httpOnly. It holds
      // nothing but "1".
      httpOnly: false,
    })
  } else {
    res.cookies.set(AD_OPT_OUT_COOKIE, "", { maxAge: 0, path: "/" })
  }
  return res
}
