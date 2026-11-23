// @vitest-environment node
/**
 * Native Sign in with Apple (lib/auth/appleNativeSignIn). Tokens are signed here with a local key
 * standing in for Apple's, so nothing calls Apple. Each refusal case changes ONE thing from a token
 * that is accepted, so every "null" is shown to come from that one difference.
 */
import { createHash } from "node:crypto"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey, type KeyLike } from "jose"

const link = vi.hoisted(() => ({ fn: vi.fn() }))
const restriction = vi.hoisted(() => ({ value: null as unknown }))
vi.mock("@/lib/auth/SocialAccountLinkingService", () => ({ linkSocialAccountToAppUser: link.fn }))
vi.mock("@/lib/moderation/accountSuspension", () => ({
  activeAccountRestriction: async () => restriction.value,
  ACCOUNT_SUSPENDED_ERROR: "ACCOUNT_SUSPENDED",
}))

const AUD = "ai.allfantasy.app"
const NONCE = "f".repeat(64)
const sha = (v: string) => createHash("sha256").update(v).digest("hex")

let privateKey: KeyLike
let otherKey: KeyLike
let jwks: JWTVerifyGetKey

beforeAll(async () => {
  const pair = await generateKeyPair("RS256")
  privateKey = pair.privateKey
  otherKey = (await generateKeyPair("RS256")).privateKey
  const jwk = await exportJWK(pair.publicKey)
  jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" }] })
})

beforeEach(() => {
  link.fn.mockReset()
  link.fn.mockResolvedValue({ id: "user-1", email: "a@privaterelay.appleid.com", username: "apple_fan", displayName: "Linda", avatarUrl: null })
  restriction.value = null
})

async function token(over: { iss?: string; aud?: string; nonce?: string; iatOffset?: number; key?: KeyLike; sub?: string; claims?: Record<string, unknown> } = {}) {
  const now = Math.floor(Date.now() / 1000) + (over.iatOffset ?? 0)
  return new SignJWT({
    nonce: over.nonce ?? sha(NONCE),
    email: "a@privaterelay.appleid.com",
    email_verified: "true",
    ...(over.claims ?? {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(over.iss ?? "https://appleid.apple.com")
    .setAudience(over.aud ?? AUD)
    .setSubject(over.sub ?? "001234.abcdef.0001")
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .sign(over.key ?? privateKey)
}

async function verify(t: string, nonce = NONCE) {
  const { verifyAppleNativeIdentityToken } = await import("@/lib/auth/appleNativeSignIn")
  return verifyAppleNativeIdentityToken(t, nonce, { jwks, audience: AUD })
}

describe("verifyAppleNativeIdentityToken", () => {
  it("accepts a fresh Apple token for our app and this nonce", async () => {
    expect(await verify(await token())).toEqual({ sub: "001234.abcdef.0001", email: "a@privaterelay.appleid.com", emailVerified: true })
  })

  it("refuses a token issued to another app", async () => {
    expect(await verify(await token({ aud: "com.someone.else" }))).toBeNull()
  })

  it("refuses a token not issued by Apple", async () => {
    expect(await verify(await token({ iss: "https://evil.example" }))).toBeNull()
  })

  it("refuses a token signed by a key that is not Apple's", async () => {
    expect(await verify(await token({ key: otherKey }))).toBeNull()
  })

  it("refuses a token carrying a different nonce (replayed from another sign-in)", async () => {
    expect(await verify(await token({ nonce: sha("a".repeat(64)) }))).toBeNull()
  })

  it("refuses the raw nonce in place of its hash", async () => {
    expect(await verify(await token({ nonce: NONCE }))).toBeNull()
  })

  it("refuses a token older than 10 minutes", async () => {
    expect(await verify(await token({ iatOffset: -11 * 60 }))).toBeNull()
  })

  it("refuses junk without throwing", async () => {
    expect(await verify("not.a.jwt")).toBeNull()
    expect(await verify(await token(), "short")).toBeNull()
  })

  it("reads an unverified email as unverified", async () => {
    const id = await verify(await token({ claims: { email_verified: false } }))
    expect(id?.emailVerified).toBe(false)
  })
})

describe("authorizeAppleNative", () => {
  it("returns null and links nothing for a bad token", async () => {
    const { authorizeAppleNative } = await import("@/lib/auth/appleNativeSignIn")
    expect(await authorizeAppleNative({ identityToken: "junk", nonce: NONCE })).toBeNull()
    expect(link.fn).not.toHaveBeenCalled()
  })
})

describe("authorizeAppleNative with a verified identity", () => {
  it("calls the shared linker with provider apple and returns the session user", async () => {
    vi.resetModules()
    vi.doMock("jose", async (orig) => {
      const real = (await orig()) as typeof import("jose")
      return { ...real, createRemoteJWKSet: () => jwks }
    })
    const prev = process.env.APPLE_IOS_BUNDLE_ID
    process.env.APPLE_IOS_BUNDLE_ID = AUD
    try {
      const { authorizeAppleNative } = await import("@/lib/auth/appleNativeSignIn")
      const user = await authorizeAppleNative({ identityToken: await token(), nonce: NONCE, name: "Linda Smith" })
      expect(link.fn).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "apple",
          providerAccountId: "001234.abcdef.0001",
          email: "a@privaterelay.appleid.com",
          emailVerified: true,
          name: "Linda Smith",
        }),
      )
      expect(user).toMatchObject({ id: "user-1", username: "apple_fan", name: "Linda" })

      restriction.value = { kind: "suspended" }
      await expect(authorizeAppleNative({ identityToken: await token(), nonce: NONCE })).rejects.toThrow("ACCOUNT_SUSPENDED")
    } finally {
      process.env.APPLE_IOS_BUNDLE_ID = prev
      vi.doUnmock("jose")
    }
  })
})
