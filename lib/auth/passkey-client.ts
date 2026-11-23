import { signIn } from "next-auth/react"
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser"

import { isInIosAppClient } from "@/lib/platform/iosApp"
import { biometricName, passkeyDevice } from "@/lib/auth/passkeyConfig"

/**
 * The page half of passkeys (server: lib/auth/passkeys.ts).
 *
 * NOT IN THE iOS APP, YET. The app is a WKWebView, which can only use a passkey for a domain the
 * app is entitled to (`webcredentials:`), and that needs native code and a new build. iPhone app
 * users already have Face ID through "Continue with Apple". The website on an iPhone, the Android
 * app (Chrome) and computers all work today.
 */

/** True when this device can sign in with Face ID / a fingerprint / Windows Hello. */
export async function canUsePasskeys(): Promise<boolean> {
  if (typeof window === "undefined") return false
  if (isInIosAppClient()) return false
  if (!browserSupportsWebAuthn()) return false
  try {
    return await platformAuthenticatorIsAvailable()
  } catch {
    return false
  }
}

/** "Face ID", "your fingerprint", "Windows Hello"… for this device. */
export function deviceUnlockName(): string {
  return biometricName(passkeyDevice(typeof navigator === "undefined" ? null : navigator.userAgent))
}

function cancelled(error: unknown): boolean {
  const name = (error as { name?: string })?.name
  // The person closed the sheet, or no saved passkey matched — neither is a failure to report loudly.
  return name === "NotAllowedError" || name === "AbortError"
}

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, status: res.status, data }
}

export type PasskeyResult = { ok: true } | { ok: false; cancelled?: boolean; error?: string }

/** Opens the device's sheet, then signs in. Resolves once the session cookie is set. */
export async function signInWithPasskey(): Promise<PasskeyResult> {
  try {
    const start = await postJson("/api/auth/passkey/signin/options")
    if (!start.ok || !start.data.options) {
      return { ok: false, error: (start.data.message as string) || "That didn't work. Please try again." }
    }
    let response
    try {
      response = await startAuthentication({ optionsJSON: start.data.options as never })
    } catch (error) {
      if (cancelled(error)) return { ok: false, cancelled: true }
      throw error
    }
    const result = await signIn("passkey", { response: JSON.stringify(response), redirect: false })
    if (result?.ok && !result.error) return { ok: true }
    if (result?.error === "ACCOUNT_SUSPENDED") {
      return { ok: false, error: "This account can't sign in right now. Email support@allfantasy.ai." }
    }
    return {
      ok: false,
      error: "We couldn't sign you in with that. If you removed it in Settings, sign in another way and add it again.",
    }
  } catch {
    return { ok: false, error: "That didn't work. Please try again." }
  }
}

/** Adds a passkey for this device to the signed-in account. */
export async function addPasskey(): Promise<PasskeyResult> {
  try {
    const start = await postJson("/api/auth/passkey/register/options")
    if (!start.ok || !start.data.options) {
      return { ok: false, error: (start.data.message as string) || "That didn't work. Please try again." }
    }
    let response
    try {
      response = await startRegistration({ optionsJSON: start.data.options as never })
    } catch (error) {
      if ((error as { name?: string })?.name === "InvalidStateError") {
        return { ok: false, error: "This device is already set up." }
      }
      if (cancelled(error)) return { ok: false, cancelled: true }
      throw error
    }
    const finish = await postJson("/api/auth/passkey/register/verify", { response })
    if (finish.ok) return { ok: true }
    return { ok: false, error: (finish.data.message as string) || "That didn't work. Please try again." }
  } catch {
    return { ok: false, error: "That didn't work. Please try again." }
  }
}

/** Has the signed-in person saved any passkey yet? null when unknown (signed out, offline). */
export async function hasSavedPasskey(): Promise<boolean | null> {
  try {
    const res = await fetch("/api/user/passkeys", { cache: "no-store" })
    if (!res.ok) return null
    const data = (await res.json()) as { passkeys?: unknown[] }
    return Array.isArray(data.passkeys) ? data.passkeys.length > 0 : null
  } catch {
    return null
  }
}
