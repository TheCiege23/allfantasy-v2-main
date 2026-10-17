// @vitest-environment node
/**
 * Sign in with Apple, as it will run once the four APPLE_* variables are set.
 *
 * Two failures this guards against, both silent in production:
 *  - a pasted client-secret JWT expires after at most 6 months and every Apple
 *    sign-in then fails, so the secret is generated from the .p8 key instead;
 *  - Apple's callback is a cross-site POST, and NextAuth's default SameSite=Lax
 *    PKCE cookie is not sent on it, so every Apple sign-in fails at callback.
 *
 * The JWT is VERIFIED with the matching public key (jose), not string-matched,
 * so a malformed signature cannot pass.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import crypto from "node:crypto"
import { decodeProtectedHeader, importSPKI, jwtVerify } from "jose"

import {
  APPLE_SECRET_LIFETIME_S,
  __resetAppleClientSecretCache,
  appleFormPostCookies,
  buildAppleClientSecret,
  resolveAppleClientSecret,
} from "@/lib/auth/appleClientSecret"
import { hasAppleSignInCredentials } from "@/lib/auth/appleSignInEnv"

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString()
/** How the .p8 usually arrives in an env var: one line, literal "\n". */
const PRIVATE_ONE_LINE = PRIVATE_PEM.trim().replace(/\n/g, "\\n")

const KEYED_ENV = {
  APPLE_CLIENT_ID: "ai.allfantasy.web",
  APPLE_TEAM_ID: "TEAMID1234",
  APPLE_KEY_ID: "KEYID56789",
  APPLE_PRIVATE_KEY: PRIVATE_ONE_LINE,
}

async function verify(token: string) {
  const key = await importSPKI(PUBLIC_PEM, "ES256")
  return jwtVerify(token, key, { audience: "https://appleid.apple.com", issuer: "TEAMID1234", subject: "ai.allfantasy.web" })
}

beforeEach(() => __resetAppleClientSecretCache())

describe("the generated client secret", () => {
  it("is an ES256 JWT Apple can verify, with the claims Apple requires", async () => {
    const now = 1_790_000_000
    const token = buildAppleClientSecret({ clientId: "ai.allfantasy.web", teamId: "TEAMID1234", keyId: "KEYID56789", privateKey: PRIVATE_ONE_LINE, nowS: now })
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: "ES256", kid: "KEYID56789" })
    // `now` is fixed, so verify as of just after it rather than against the real clock.
    const key = await importSPKI(PUBLIC_PEM, "ES256")
    const { payload } = await jwtVerify(token, key, {
      currentDate: new Date((now + 60) * 1000),
      audience: "https://appleid.apple.com",
      issuer: "TEAMID1234",
      subject: "ai.allfantasy.web",
    })
    expect(payload.iat).toBe(now)
    expect(payload.exp).toBe(now + APPLE_SECRET_LIFETIME_S)
  })

  it("stays inside Apple's 6-month ceiling (15,777,000 s)", () => {
    expect(APPLE_SECRET_LIFETIME_S).toBeLessThan(15_777_000)
  })

  it("control: a signature from a different key is rejected", async () => {
    const other = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    const token = buildAppleClientSecret({ clientId: "ai.allfantasy.web", teamId: "TEAMID1234", keyId: "K", privateKey: other })
    await expect(verify(token)).rejects.toThrow()
  })
})

describe("resolveAppleClientSecret", () => {
  it("generates from the key, reuses it, and re-signs after 30 days", async () => {
    const t0 = Math.floor(Date.now() / 1000)
    const first = resolveAppleClientSecret(KEYED_ENV, t0)
    await expect(verify(first)).resolves.toBeTruthy()
    expect(resolveAppleClientSecret(KEYED_ENV, t0 + 29 * 86_400)).toBe(first)
    const renewed = resolveAppleClientSecret(KEYED_ENV, t0 + 31 * 86_400)
    expect(renewed).not.toBe(first)
  })

  it("falls back to a pasted APPLE_CLIENT_SECRET only when there is no key", () => {
    expect(resolveAppleClientSecret({ APPLE_CLIENT_ID: "x", APPLE_CLIENT_SECRET: "pasted.jwt.value" })).toBe("pasted.jwt.value")
    expect(resolveAppleClientSecret({ ...KEYED_ENV, APPLE_CLIENT_SECRET: "pasted.jwt.value" })).not.toBe("pasted.jwt.value")
    expect(resolveAppleClientSecret({})).toBe("")
  })
})

describe("hasAppleSignInCredentials", () => {
  it("needs a client id plus either the full key set or a pasted secret", () => {
    expect(hasAppleSignInCredentials(KEYED_ENV)).toBe(true)
    expect(hasAppleSignInCredentials({ APPLE_CLIENT_ID: "x", APPLE_CLIENT_SECRET: "y" })).toBe(true)
    expect(hasAppleSignInCredentials({ ...KEYED_ENV, APPLE_KEY_ID: "" })).toBe(false)
    expect(hasAppleSignInCredentials({ ...KEYED_ENV, APPLE_CLIENT_ID: undefined })).toBe(false)
    expect(hasAppleSignInCredentials({})).toBe(false)
  })
})

describe("cookies for Apple's cross-site POST callback", () => {
  it("re-declares the PKCE and callback-url cookies SameSite=None; Secure", () => {
    const c = appleFormPostCookies(true)
    expect(c.pkceCodeVerifier).toMatchObject({ name: "__Secure-next-auth.pkce.code_verifier", options: { sameSite: "none", secure: true, httpOnly: true } })
    expect(c.callbackUrl).toMatchObject({ name: "__Secure-next-auth.callback-url", options: { sameSite: "none", secure: true, httpOnly: true } })
  })

  it("changes nothing on plain http, where SameSite=None cannot be set", () => {
    expect(appleFormPostCookies(false)).toEqual({})
  })
})

describe("lib/auth wiring", () => {
  const KEYS = ["APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY", "APPLE_CLIENT_SECRET", "NEXTAUTH_URL"] as const
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    vi.resetModules()
  })

  it("registers Apple with a verifiable generated secret and the SameSite=None cookies", async () => {
    for (const k of KEYS) delete process.env[k]
    Object.assign(process.env, KEYED_ENV, { NEXTAUTH_URL: "https://www.allfantasy.ai" })
    vi.resetModules()
    const { authOptions } = await import("@/lib/auth")
    const apple = authOptions.providers.find((p) => p.id === "apple") as { options?: { clientId?: string; clientSecret?: string } } | undefined
    expect(apple?.options?.clientId).toBe("ai.allfantasy.web")
    await expect(verify(apple!.options!.clientSecret as string)).resolves.toBeTruthy()
    expect(authOptions.cookies?.pkceCodeVerifier?.options.sameSite).toBe("none")
  })

  it("control: with nothing configured there is no Apple provider and NextAuth's cookies are untouched", async () => {
    for (const k of KEYS) delete process.env[k]
    process.env.NEXTAUTH_URL = "https://www.allfantasy.ai"
    vi.resetModules()
    const { authOptions } = await import("@/lib/auth")
    expect(authOptions.providers.find((p) => p.id === "apple")).toBeUndefined()
    expect(authOptions.cookies).toBeUndefined()
  })
})
