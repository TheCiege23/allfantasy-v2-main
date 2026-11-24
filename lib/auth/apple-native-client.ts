import { signIn } from "next-auth/react"

/**
 * The page half of native Sign in with Apple in the iOS app (ios-app/ AppleSignInHandler.swift;
 * server: lib/auth/appleNativeSignIn.ts). Same message protocol as lib/monetization/apple-iap-client:
 * post to `messageHandlers["apple-signin"]`, answer arrives as an `allfantasy:apple-signin` event.
 */

type Handler = { postMessage: (message: Record<string, string>) => void }
type NativeResult = { requestId: string; identityToken?: string; name?: string; cancelled?: boolean; error?: string }

function handler(): Handler | undefined {
  if (typeof window === "undefined") return undefined
  return (window as typeof window & { webkit?: { messageHandlers?: { "apple-signin"?: Handler } } })
    .webkit?.messageHandlers?.["apple-signin"]
}

/** True only in an iOS app build that ships the Sign in with Apple entitlement. */
export function hasNativeAppleSignIn(): boolean {
  return Boolean(handler())
}

function randomNonce(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

function ask(nonceHash: string, timeoutMs = 120_000): Promise<NativeResult> {
  const bridge = handler()
  if (!bridge) return Promise.reject(new Error("Update the AllFantasy app to sign in with Apple."))
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("allfantasy:apple-signin", listener)
      reject(new Error("Apple did not respond. Please try again."))
    }, timeoutMs)
    function listener(event: Event) {
      const detail = (event as CustomEvent<NativeResult>).detail
      if (detail?.requestId !== requestId) return
      window.clearTimeout(timeout)
      window.removeEventListener("allfantasy:apple-signin", listener)
      resolve(detail)
    }
    window.addEventListener("allfantasy:apple-signin", listener)
    bridge.postMessage({ action: "signin", requestId, nonce: nonceHash })
  })
}

export type AppleNativeSignInResult = { ok: true } | { ok: false; cancelled?: boolean; error?: string }

/**
 * Open Apple's sheet and sign in with what it returns. Resolves `{ ok: true }` once the session
 * cookie is set; the caller decides where to go next. A cancel is not an error.
 */
export async function signInWithAppleNative(): Promise<AppleNativeSignInResult> {
  try {
    const nonce = randomNonce()
    const result = await ask(await sha256Hex(nonce))
    if (result.cancelled) return { ok: false, cancelled: true }
    if (result.error || !result.identityToken) return { ok: false, error: result.error || "Sign in with Apple didn't work." }
    const response = await signIn("apple-native", {
      identityToken: result.identityToken,
      nonce,
      name: result.name ?? "",
      redirect: false,
    })
    if (response?.ok && !response.error) return { ok: true }
    if (response?.error === "ACCOUNT_SUSPENDED") return { ok: false, error: "This account can't sign in right now. Email support@allfantasy.ai." }
    return { ok: false, error: "Sign in with Apple didn't work. Please try again." }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Sign in with Apple didn't work." }
  }
}
