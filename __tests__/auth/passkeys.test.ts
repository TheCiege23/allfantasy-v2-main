// @vitest-environment node
/**
 * Passkeys (lib/auth/passkeys + passkeyConfig). The WebAuthn library is NOT mocked: a small
 * software authenticator below makes real P-256 keys, real authenticator data and real signatures,
 * exactly as a phone would, so every check in @simplewebauthn/server runs for real. Only Prisma is
 * replaced, by an in-memory store. Each refusal changes ONE thing from an answer that is accepted.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { encodeCBOR } from "@levischuck/tiny-cbor"

// ── In-memory Prisma ─────────────────────────────────────────────────────────────────────────
type Token = { identifier: string; token: string; expires: Date }
type Passkey = {
  id: string
  userId: string
  credentialId: string
  publicKey: Buffer
  counter: bigint
  transports: string[]
  deviceType: string
  backedUp: boolean
  label: string | null
  createdAt: Date
  lastUsedAt: Date | null
}
const db = vi.hoisted(() => ({
  tokens: [] as Token[],
  passkeys: [] as Passkey[],
  users: new Map<string, { id: string; email: string | null; username: string; displayName: string | null; avatarUrl: string | null }>(),
  seq: 0,
}))
const restriction = vi.hoisted(() => ({ value: null as unknown }))

function matchesToken(t: Token, where: Record<string, any>) {
  if (where.identifier !== undefined && t.identifier !== where.identifier) return false
  if (where.token !== undefined && t.token !== where.token) return false
  if (where.expires?.gt && !(t.expires > where.expires.gt)) return false
  if (where.expires?.lt && !(t.expires < where.expires.lt)) return false
  return true
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    authVerificationToken: {
      create: async ({ data }: { data: Token }) => {
        db.tokens.push({ ...data })
        return data
      },
      deleteMany: async ({ where }: { where: Record<string, any> }) => {
        const before = db.tokens.length
        db.tokens = db.tokens.filter((t) => !matchesToken(t, where))
        return { count: before - db.tokens.length }
      },
    },
    appUser: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const user = db.users.get(where.id)
        if (!user) return null
        return {
          ...user,
          passkeys: db.passkeys.filter((p) => p.userId === user.id).map((p) => ({ credentialId: p.credentialId, transports: p.transports })),
        }
      },
    },
    authPasskey: {
      create: async ({ data }: { data: Omit<Passkey, "id" | "createdAt" | "lastUsedAt"> }) => {
        if (db.passkeys.some((p) => p.credentialId === data.credentialId)) throw Object.assign(new Error("unique"), { code: "P2002" })
        const row: Passkey = { ...data, id: `pk-${++db.seq}`, createdAt: new Date(), lastUsedAt: null }
        db.passkeys.push(row)
        return { id: row.id, label: row.label }
      },
      findUnique: async ({ where }: { where: { credentialId: string } }) => {
        const row = db.passkeys.find((p) => p.credentialId === where.credentialId)
        if (!row) return null
        return { ...row, user: db.users.get(row.userId)! }
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Passkey> }) => {
        const row = db.passkeys.find((p) => p.id === where.id)!
        Object.assign(row, data)
        return row
      },
      findMany: async ({ where }: { where: { userId: string } }) => db.passkeys.filter((p) => p.userId === where.userId),
      deleteMany: async ({ where }: { where: { id: string; userId: string } }) => {
        const before = db.passkeys.length
        db.passkeys = db.passkeys.filter((p) => !(p.id === where.id && p.userId === where.userId))
        return { count: before - db.passkeys.length }
      },
    },
  },
}))
vi.mock("@/lib/moderation/accountSuspension", () => ({
  activeAccountRestriction: async () => restriction.value,
  ACCOUNT_SUSPENDED_ERROR: "ACCOUNT_SUSPENDED",
}))

import {
  MAX_PASSKEYS_PER_USER,
  authorizePasskey,
  finishPasskeyRegistration,
  listPasskeys,
  removePasskey,
  startPasskeyRegistration,
  startPasskeySignIn,
} from "@/lib/auth/passkeys"
import { biometricName, passkeyDevice, passkeyLabel, passkeyRelyingParty } from "@/lib/auth/passkeyConfig"

// ── A software authenticator: what a phone's secure chip does, in ~60 lines ─────────────────
const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64url")
const sha256 = (b: Uint8Array | Buffer | string) => createHash("sha256").update(b).digest()
const FLAG_UP = 0x01
const FLAG_UV = 0x04
const FLAG_AT = 0x40

class SoftAuthenticator {
  readonly credentialId = randomBytes(16)
  private readonly privateKey: KeyObject
  private readonly publicJwk: { x: string; y: string }
  constructor() {
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" })
    this.privateKey = pair.privateKey
    this.publicJwk = pair.publicKey.export({ format: "jwk" }) as { x: string; y: string }
  }

  private cosePublicKey(): Uint8Array {
    return encodeCBOR(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, new Uint8Array(Buffer.from(this.publicJwk.x, "base64url"))],
        [-3, new Uint8Array(Buffer.from(this.publicJwk.y, "base64url"))],
      ])
    )
  }

  private authData(rpID: string, flags: number, counter: number, withCredential: boolean): Buffer {
    const parts = [sha256(rpID), Buffer.from([flags]), Buffer.alloc(4)]
    parts[2].writeUInt32BE(counter)
    if (withCredential) {
      const len = Buffer.alloc(2)
      len.writeUInt16BE(this.credentialId.length)
      parts.push(Buffer.alloc(16), len, this.credentialId, Buffer.from(this.cosePublicKey()))
    }
    return Buffer.concat(parts)
  }

  register(options: { challenge: string; rp: { id?: string } }, origin: string, opts: { flags?: number } = {}) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }))
    const authData = this.authData(options.rp.id!, opts.flags ?? FLAG_UP | FLAG_UV | FLAG_AT, 0, true)
    const attestationObject = encodeCBOR(new Map<string, any>([["fmt", "none"], ["attStmt", new Map()], ["authData", new Uint8Array(authData)]]))
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: "public-key",
      response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ["internal"] },
      clientExtensionResults: {},
    }
  }

  assert(
    options: { challenge: string; rpId?: string },
    origin: string,
    opts: { flags?: number; counter?: number; rpID?: string; signWith?: KeyObject } = {}
  ) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }))
    const authData = this.authData(opts.rpID ?? options.rpId!, opts.flags ?? FLAG_UP | FLAG_UV, opts.counter ?? 0, false)
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), opts.signWith ?? this.privateKey)
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
        userHandle: b64u(Buffer.from("user-1")),
      },
      clientExtensionResults: {},
    }
  }
}

const SITE = "https://www.allfantasy.ai"
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1"

async function enrol(auth: SoftAuthenticator, userId = "user-1") {
  const start = await startPasskeyRegistration(userId, SITE)
  if (!start.ok) throw new Error(start.error)
  return finishPasskeyRegistration(userId, auth.register(start.options, SITE), SITE, IPHONE_UA)
}

async function signInAnswer(auth: SoftAuthenticator, opts: Parameters<SoftAuthenticator["assert"]>[2] = {}, origin = SITE) {
  const start = await startPasskeySignIn(SITE)
  if (!start.ok) throw new Error(start.error)
  return JSON.stringify(auth.assert(start.options, origin, opts))
}

beforeEach(() => {
  db.tokens = []
  db.passkeys = []
  db.seq = 0
  db.users = new Map([
    ["user-1", { id: "user-1", email: "linda@example.com", username: "linda", displayName: "Linda", avatarUrl: null }],
    ["user-2", { id: "user-2", email: "sam@example.com", username: "sam", displayName: "Sam", avatarUrl: null }],
  ])
  restriction.value = null
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("PASSKEY_RP_ID", "")
  vi.stubEnv("PASSKEY_EXTRA_ORIGINS", "")
})
afterEach(() => vi.unstubAllEnvs())

describe("relying party", () => {
  it("is fixed to www.allfantasy.ai in production, whatever origin the request claims", () => {
    expect(passkeyRelyingParty("https://evil.example")).toEqual({ rpID: "www.allfantasy.ai", origins: [SITE] })
    expect(passkeyRelyingParty(null)).toEqual({ rpID: "www.allfantasy.ai", origins: [SITE] })
  })

  it("comes from the page itself on a dev box", () => {
    vi.stubEnv("NODE_ENV", "development")
    expect(passkeyRelyingParty("http://localhost:3771")).toEqual({ rpID: "localhost", origins: ["http://localhost:3771"] })
    expect(passkeyRelyingParty(null)).toBeNull()
    expect(passkeyRelyingParty("javascript:alert(1)")).toBeNull()
  })

  it("names the unlock and the device the way people say them", () => {
    expect(biometricName(passkeyDevice(IPHONE_UA))).toBe("Face ID")
    expect(passkeyLabel(passkeyDevice(IPHONE_UA))).toBe("iPhone")
    expect(biometricName(passkeyDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9)"))).toBe("your fingerprint")
    expect(biometricName(passkeyDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"))).toBe("Windows Hello")
    expect(biometricName(passkeyDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"))).toBe("Touch ID")
  })
})

describe("adding a passkey", () => {
  it("saves the public key, named after the device, and stores the challenge only as a hash", async () => {
    const auth = new SoftAuthenticator()
    const start = await startPasskeyRegistration("user-1", SITE)
    expect(start.ok).toBe(true)
    if (!start.ok) return
    expect(start.options.rp.id).toBe("www.allfantasy.ai")
    expect(start.options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" })
    expect(db.tokens).toHaveLength(1)
    expect(db.tokens[0].identifier).toBe("passkey-reg:user-1")
    expect(db.tokens[0].token).not.toBe(start.options.challenge)

    const done = await finishPasskeyRegistration("user-1", auth.register(start.options, SITE), SITE, IPHONE_UA)
    expect(done).toEqual({ ok: true, passkey: { id: "pk-1", label: "iPhone" } })
    expect(db.passkeys[0]).toMatchObject({ userId: "user-1", credentialId: b64u(auth.credentialId), transports: ["internal"] })
    expect(db.tokens).toHaveLength(0) // spent
  })

  it("refuses a passkey made without Face ID / fingerprint (presence only)", async () => {
    const start = await startPasskeyRegistration("user-1", SITE)
    if (!start.ok) throw new Error()
    const done = await finishPasskeyRegistration("user-1", new SoftAuthenticator().register(start.options, SITE, { flags: FLAG_UP | FLAG_AT }), SITE, IPHONE_UA)
    expect(done).toEqual({ ok: false, error: "INVALID" })
    expect(db.passkeys).toHaveLength(0)
  })

  it("refuses an answer made for another site", async () => {
    const start = await startPasskeyRegistration("user-1", SITE)
    if (!start.ok) throw new Error()
    const done = await finishPasskeyRegistration("user-1", new SoftAuthenticator().register(start.options, "https://evil.example"), SITE, IPHONE_UA)
    expect(done).toEqual({ ok: false, error: "INVALID" })
  })

  it("will not add to one account with a challenge issued to another", async () => {
    const start = await startPasskeyRegistration("user-2", SITE)
    if (!start.ok) throw new Error()
    const done = await finishPasskeyRegistration("user-1", new SoftAuthenticator().register(start.options, SITE), SITE, IPHONE_UA)
    expect(done).toEqual({ ok: false, error: "INVALID" })
    expect(db.passkeys).toHaveLength(0)
  })

  it("will not accept a sign-in challenge as an add-a-passkey challenge", async () => {
    const signin = await startPasskeySignIn(SITE)
    if (!signin.ok) throw new Error()
    const answer = new SoftAuthenticator().register({ challenge: signin.options.challenge, rp: { id: "www.allfantasy.ai" } }, SITE)
    expect(await finishPasskeyRegistration("user-1", answer, SITE, IPHONE_UA)).toEqual({ ok: false, error: "INVALID" })
  })

  it("says so when the same passkey is added twice, and stops at the limit", async () => {
    const auth = new SoftAuthenticator()
    expect((await enrol(auth)).ok).toBe(true)
    expect(await enrol(auth)).toEqual({ ok: false, error: "ALREADY_ADDED" })

    for (let i = db.passkeys.length; i < MAX_PASSKEYS_PER_USER; i++) await enrol(new SoftAuthenticator())
    expect(await startPasskeyRegistration("user-1", SITE)).toEqual({ ok: false, error: "TOO_MANY" })
  })
})

describe("signing in", () => {
  it("signs in the owner, and records the use", async () => {
    const auth = new SoftAuthenticator()
    await enrol(auth)
    const user = await authorizePasskey(await signInAnswer(auth, { counter: 7 }), SITE)
    expect(user).toEqual({ id: "user-1", email: "linda@example.com", name: "Linda", username: "linda", image: null })
    expect(db.passkeys[0].counter).toBe(7n)
    expect(db.passkeys[0].lastUsedAt).toBeInstanceOf(Date)
  })

  it("will not take the same signed answer twice", async () => {
    const auth = new SoftAuthenticator()
    await enrol(auth)
    const answer = await signInAnswer(auth)
    expect(await authorizePasskey(answer, SITE)).not.toBeNull()
    expect(await authorizePasskey(answer, SITE)).toBeNull()
  })

  it("refuses a signature from a different key under the same credential id", async () => {
    const auth = new SoftAuthenticator()
    await enrol(auth)
    const otherKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey
    expect(await authorizePasskey(await signInAnswer(auth, { signWith: otherKey }), SITE)).toBeNull()
  })

  it("refuses an answer given on another site", async () => {
    const auth = new SoftAuthenticator()
    await enrol(auth)
    expect(await authorizePasskey(await signInAnswer(auth, {}, "https://evil.example"), SITE)).toBeNull()
    expect(await authorizePasskey(await signInAnswer(auth, { rpID: "evil.example" }), SITE)).toBeNull()
  })

  it("refuses a tap without Face ID / fingerprint", async () => {
    const auth = new SoftAuthenticator()
    await enrol(auth)
    expect(await authorizePasskey(await signInAnswer(auth, { flags: FLAG_UP }), SITE)).toBeNull()
  })

  it("refuses a counter that went backwards (a cloned key)", async () => {
    const auth = new SoftAuthenticator()
    await enrol(auth)
    expect(await authorizePasskey(await signInAnswer(auth, { counter: 9 }), SITE)).not.toBeNull()
    expect(await authorizePasskey(await signInAnswer(auth, { counter: 3 }), SITE)).toBeNull()
  })

  it("refuses an answer to a challenge this server never issued", async () => {
    const auth = new SoftAuthenticator()
    await enrol(auth)
    const forged = JSON.stringify(auth.assert({ challenge: b64u(randomBytes(32)), rpId: "www.allfantasy.ai" }, SITE))
    expect(await authorizePasskey(forged, SITE)).toBeNull()
  })

  it("returns null for a passkey nobody saved, or a removed one, and for junk", async () => {
    expect(await authorizePasskey(await signInAnswer(new SoftAuthenticator()), SITE)).toBeNull()
    const auth = new SoftAuthenticator()
    const added = await enrol(auth)
    if (!added.ok) throw new Error()
    expect(await removePasskey("user-1", added.passkey.id)).toBe(true)
    expect(await authorizePasskey(await signInAnswer(auth), SITE)).toBeNull()
    expect(await authorizePasskey("not json", SITE)).toBeNull()
    expect(await authorizePasskey(undefined, SITE)).toBeNull()
  })

  it("throws ACCOUNT_SUSPENDED for a suspended account", async () => {
    const auth = new SoftAuthenticator()
    await enrol(auth)
    restriction.value = { reason: "x" }
    await expect(authorizePasskey(await signInAnswer(auth), SITE)).rejects.toThrow("ACCOUNT_SUSPENDED")
  })
})

describe("settings", () => {
  it("lists only your own passkeys and removes only your own", async () => {
    const added = await enrol(new SoftAuthenticator(), "user-1")
    await enrol(new SoftAuthenticator(), "user-2")
    if (!added.ok) throw new Error()
    expect((await listPasskeys("user-1")).map((p) => p.id)).toEqual([added.passkey.id])
    expect(await removePasskey("user-2", added.passkey.id)).toBe(false)
    expect(db.passkeys).toHaveLength(2)
    expect(await removePasskey("user-1", added.passkey.id)).toBe(true)
    expect(db.passkeys).toHaveLength(1)
  })
})
