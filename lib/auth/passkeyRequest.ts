import "server-only"

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getServedOrigin } from "@/lib/http/served-origin"

/** The page's origin, for the relying party outside production (see passkeyConfig). */
export function requestOriginOf(req: Request): string | null {
  const header = req.headers.get("origin")
  if (header && header !== "null") return header
  // Never req.url's origin: a route handler sees the BIND address there (0.0.0.0:8080 on Railway).
  return getServedOrigin(req) || null
}

export async function signedInUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  const id = (session?.user as { id?: unknown } | undefined)?.id
  return typeof id === "string" && id ? id : null
}

export const PASSKEY_ERROR_MESSAGES: Record<string, string> = {
  NOT_CONFIGURED: "This isn't available here. Please sign in with your password or a text code.",
  NO_USER: "Please sign in again.",
  TOO_MANY: "You've saved the most passkeys allowed. Remove one in Settings first.",
  INVALID: "That didn't work. Please try again.",
  ALREADY_ADDED: "This device is already set up.",
}

/** A database or library failure: a clear JSON answer the page can show, never an empty 500. */
export function unavailable() {
  return NextResponse.json(
    { error: "UNAVAILABLE", message: "This isn't working right now. Please sign in with your password or a text code." },
    { status: 503 }
  )
}
