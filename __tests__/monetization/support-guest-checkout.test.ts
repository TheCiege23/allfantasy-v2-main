/**
 * The no-account support checkout (lib/monetization/supportGuestCheckout + supportGuestAccount).
 * The load-bearing property is the account-takeover guard: the email typed on Stripe's page is
 * not proof of anything, so only an account THIS checkout made may be signed into from the
 * paying browser. Every token is single-use and of one kind only.
 */
import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

type User = { id: string; email: string; username: string; displayName: string | null; emailVerified: Date | null; avatarUrl: null }
type Tok = { identifier: string; token: string; expires: Date }
type Sub = { userId: string; source: string; sku: string; status: string; stripeCheckoutSessionId: string | null; stripeSubscriptionId: string | null; currentPeriodEnd: Date | null; gracePeriodEnd: null; expiresAt: null }

const db = vi.hoisted(() => ({ users: [] as any[], tokens: [] as any[], subs: [] as any[], seq: 0 }))
const profile = vi.hoisted(() => ({ ensure: vi.fn(async () => undefined) }))

const sha = (s: string) => createHash("sha256").update(s).digest("hex")
const ci = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

vi.mock("@/lib/auth/SharedAccountBootstrapService", () => ({ ensureSharedAccountProfile: profile.ensure }))
vi.mock("@/lib/moderation/accountSuspension", () => ({
  activeAccountRestriction: async () => null,
  ACCOUNT_SUSPENDED_ERROR: "ACCOUNT_SUSPENDED",
}))
vi.mock("@/lib/prisma", () => {
  const appUser = {
    findFirst: async ({ where }: any) => {
      if (where.email) return db.users.find((u: User) => ci(u.email, where.email.equals)) ?? null
      if (where.username) return db.users.find((u: User) => ci(u.username, where.username.equals)) ?? null
      return null
    },
    findUnique: async ({ where }: any) => db.users.find((u: User) => u.id === where.id) ?? null,
    create: async ({ data }: any) => {
      if (db.users.some((u: User) => ci(u.email, data.email))) throw Object.assign(new Error("dup"), { code: "P2002" })
      const u = { id: `user-${++db.seq}`, emailVerified: null, avatarUrl: null, ...data }
      db.users.push(u)
      return u
    },
    update: async ({ where, data }: any) => Object.assign(db.users.find((u: User) => u.id === where.id), data),
  }
  const authVerificationToken = {
    create: async ({ data }: any) => {
      db.tokens.push({ ...data })
      return data
    },
    findFirst: async ({ where }: any) =>
      db.tokens.find(
        (t: Tok) =>
          t.token === where.token &&
          (typeof where.identifier === "string" ? t.identifier === where.identifier : t.identifier.startsWith(where.identifier.startsWith)) &&
          (!where.expires || t.expires > where.expires.gt),
      ) ?? null,
    findUnique: async ({ where }: any) => db.tokens.find((t: Tok) => t.token === where.token) ?? null,
    deleteMany: async ({ where }: any) => {
      const before = db.tokens.length
      db.tokens = db.tokens.filter((t: Tok) => t.token !== where.token)
      return { count: before - db.tokens.length }
    },
  }
  const userSubscription = {
    findFirst: async ({ where }: any) => db.subs.find((s: Sub) => s.stripeCheckoutSessionId === where.stripeCheckoutSessionId) ?? null,
    findMany: async ({ where }: any) =>
      db.subs.filter(
        (s: Sub) =>
          s.userId === where.userId &&
          !where.NOT.some(
            (n: any) =>
              (n.stripeCheckoutSessionId && s.stripeCheckoutSessionId === n.stripeCheckoutSessionId) ||
              (n.stripeSubscriptionId && s.stripeSubscriptionId === n.stripeSubscriptionId),
          ),
      ),
  }
  const prisma: any = { appUser, authVerificationToken, userSubscription }
  prisma.$transaction = async (fn: any) => fn(prisma)
  return { prisma }
})

const SESSION_ID = "cs_test_a1B2c3D4e5F6g7H8i9J0"

function session(email: string, extra: Record<string, unknown> = {}): any {
  return {
    id: SESSION_ID,
    subscription: "sub_new",
    metadata: { supportGuest: "1", ageConfirmed: "1", sku: "af_pro_monthly", purchaseType: "subscription" },
    customer_details: { email, name: "Linda Smith" },
    ...extra,
  }
}

beforeEach(() => {
  db.users = []
  db.tokens = []
  db.subs = []
  db.seq = 0
  profile.ensure.mockClear()
})

describe("buildSupportGuestCheckoutParams", () => {
  it("creates a subscription session with no account attached and the support marker set server-side", async () => {
    const { buildSupportGuestCheckoutParams, isSupportGuestCheckoutSession } = await import("@/lib/monetization/supportGuestCheckout")
    const params = buildSupportGuestCheckoutParams({
      ageConfirmed: true,
      env: { STRIPE_PRICE_AF_PRO_MONTHLY: "price_pro_m" } as any,
      baseUrl: "https://example.test",
    })!
    expect(params.mode).toBe("subscription")
    expect(params.line_items).toEqual([{ price: "price_pro_m", quantity: 1 }])
    expect(params.client_reference_id).toBeUndefined()
    expect(params.customer_email).toBeUndefined()
    expect(params.metadata).not.toHaveProperty("userId")
    expect(params.success_url).toBe("https://example.test/support/welcome?session_id={CHECKOUT_SESSION_ID}")
    expect(params.billing_address_collection).toBe("required")
    expect(isSupportGuestCheckoutSession({ metadata: params.metadata as any })).toBe(true)
    expect(isSupportGuestCheckoutSession({ metadata: { sku: "af_pro_monthly" } })).toBe(false)
  })

  it("returns null when the plan has no Stripe price", async () => {
    const { buildSupportGuestCheckoutParams } = await import("@/lib/monetization/supportGuestCheckout")
    expect(buildSupportGuestCheckoutParams({ ageConfirmed: true, env: {} as any, baseUrl: "https://x.test" })).toBeNull()
  })
})

describe("resolveSupportGuestBuyer", () => {
  it("makes a new account with no password, an automatic username and a claim for this checkout", async () => {
    const { resolveSupportGuestBuyer, supportCheckoutState } = await import("@/lib/monetization/supportGuestAccount")
    const buyer = await resolveSupportGuestBuyer(session("Linda@Example.com"))
    expect(buyer).toMatchObject({ email: "linda@example.com", created: true })
    expect(db.users).toHaveLength(1)
    expect(db.users[0].passwordHash).toBeNull()
    expect(db.users[0].displayName).toBe("Linda")
    expect(db.users[0].username).toMatch(/^linda/)
    expect(profile.ensure).toHaveBeenCalledWith(expect.objectContaining({ userId: buyer!.userId, ageConfirmed: true }))
    expect(await supportCheckoutState(SESSION_ID)).toBe("ready")
  })

  it("is idempotent: a retried webhook finds the same account and still calls it new", async () => {
    const { resolveSupportGuestBuyer } = await import("@/lib/monetization/supportGuestAccount")
    const first = await resolveSupportGuestBuyer(session("linda@example.com"))
    const second = await resolveSupportGuestBuyer(session("linda@example.com"))
    expect(second).toEqual(first)
    expect(db.users).toHaveLength(1)
  })

  it("🛑 an EXISTING account gets the payment but NO claim — the paying browser cannot sign into it", async () => {
    db.users.push({ id: "owner", email: "owner@example.com", username: "owner", displayName: "Owner", emailVerified: new Date(), avatarUrl: null })
    const { resolveSupportGuestBuyer, supportCheckoutState, authorizeSupportToken } = await import("@/lib/monetization/supportGuestAccount")
    const buyer = await resolveSupportGuestBuyer(session("OWNER@example.com"))
    expect(buyer).toMatchObject({ userId: "owner", created: false })
    expect(db.tokens).toHaveLength(0)
    expect(await supportCheckoutState(SESSION_ID)).toBe("pending")
    expect(await authorizeSupportToken("claim", SESSION_ID)).toBeNull()
  })

  it("returns null with no email", async () => {
    const { resolveSupportGuestBuyer } = await import("@/lib/monetization/supportGuestAccount")
    expect(await resolveSupportGuestBuyer(session(""))).toBeNull()
  })
})

describe("authorizeSupportToken", () => {
  it("the claim signs in once, and never again", async () => {
    const { resolveSupportGuestBuyer, authorizeSupportToken, supportCheckoutState } = await import("@/lib/monetization/supportGuestAccount")
    const buyer = await resolveSupportGuestBuyer(session("linda@example.com"))
    db.subs.push({ userId: buyer!.userId, source: "stripe", sku: "af_pro_monthly", status: "active", stripeCheckoutSessionId: SESSION_ID, stripeSubscriptionId: "sub_new", currentPeriodEnd: new Date(Date.now() + 1e9), gracePeriodEnd: null, expiresAt: null })
    const user = await authorizeSupportToken("claim", SESSION_ID)
    expect(user?.id).toBe(buyer!.userId)
    expect(await authorizeSupportToken("claim", SESSION_ID)).toBeNull()
    expect(await supportCheckoutState(SESSION_ID)).toBe("check_email")
    // The claim proves a browser paid, not that anyone owns the inbox.
    expect(db.users[0].emailVerified).toBeNull()
  })

  it("a claim cannot be used as a link, nor a link as a claim", async () => {
    const { resolveSupportGuestBuyer, authorizeSupportToken, createSupportSignInLinkToken } = await import("@/lib/monetization/supportGuestAccount")
    const buyer = await resolveSupportGuestBuyer(session("linda@example.com"))
    expect(await authorizeSupportToken("link", SESSION_ID)).toBeNull()
    const raw = await createSupportSignInLinkToken(buyer!.userId)
    expect(await authorizeSupportToken("claim", raw)).toBeNull()
    // A wrong-kind attempt must not SPEND the token: both still work as their own kind.
    expect((await authorizeSupportToken("claim", SESSION_ID))?.id).toBe(buyer!.userId)
    expect((await authorizeSupportToken("link", raw))?.id).toBe(buyer!.userId)
  })

  it("the emailed link signs in once and marks the email verified", async () => {
    const { resolveSupportGuestBuyer, authorizeSupportToken, createSupportSignInLinkToken } = await import("@/lib/monetization/supportGuestAccount")
    const buyer = await resolveSupportGuestBuyer(session("linda@example.com"))
    const raw = await createSupportSignInLinkToken(buyer!.userId)
    expect(db.tokens.some((t: Tok) => t.token === raw)).toBe(false) // stored hashed
    expect(db.tokens.some((t: Tok) => t.token === sha(raw))).toBe(true)
    expect((await authorizeSupportToken("link", raw))?.id).toBe(buyer!.userId)
    expect(db.users[0].emailVerified).toBeInstanceOf(Date)
    expect(await authorizeSupportToken("link", raw)).toBeNull()
  })

  it("an expired token is refused (and spent)", async () => {
    const { authorizeSupportToken } = await import("@/lib/monetization/supportGuestAccount")
    db.users.push({ id: "u1", email: "a@b.c", username: "a", displayName: null, emailVerified: null, avatarUrl: null })
    db.tokens.push({ identifier: "support-link:u1", token: sha("x".repeat(40)), expires: new Date(Date.now() - 1000) })
    expect(await authorizeSupportToken("link", "x".repeat(40))).toBeNull()
    expect(db.tokens).toHaveLength(0)
  })

  it("rejects an unknown kind and junk tokens", async () => {
    const { authorizeSupportToken } = await import("@/lib/monetization/supportGuestAccount")
    expect(await authorizeSupportToken("admin", "x".repeat(40))).toBeNull()
    expect(await authorizeSupportToken("link", "short")).toBeNull()
  })
})

describe("supportGuestDuplicateReason", () => {
  const live = (over: Partial<Sub>): Sub => ({
    userId: "owner", source: "stripe", sku: "af_pro_monthly", status: "active",
    stripeCheckoutSessionId: "cs_old", stripeSubscriptionId: "sub_old",
    currentPeriodEnd: new Date(Date.now() + 1e9), gracePeriodEnd: null, expiresAt: null, ...over,
  })

  it("flags an account already paying for Pro", async () => {
    db.subs.push(live({}))
    const { supportGuestDuplicateReason } = await import("@/lib/monetization/supportGuestAccount")
    expect(await supportGuestDuplicateReason("owner", { id: SESSION_ID, subscription: "sub_new" } as any)).toBe("same_plan")
  })

  it("does NOT count the row this very checkout wrote (a webhook retry must not refund a first purchase)", async () => {
    db.subs.push(live({ stripeCheckoutSessionId: SESSION_ID, stripeSubscriptionId: "sub_new" }))
    const { supportGuestDuplicateReason } = await import("@/lib/monetization/supportGuestAccount")
    expect(await supportGuestDuplicateReason("owner", { id: SESSION_ID, subscription: "sub_new" } as any)).toBeNull()
  })

  it("ignores an expired plan", async () => {
    db.subs.push(live({ status: "canceled", currentPeriodEnd: new Date(Date.now() - 1e9) }))
    const { supportGuestDuplicateReason } = await import("@/lib/monetization/supportGuestAccount")
    expect(await supportGuestDuplicateReason("owner", { id: SESSION_ID, subscription: "sub_new" } as any)).toBeNull()
  })
})

describe("buildSupportWelcomeEmail", () => {
  const base = {
    buyer: { email: "linda@example.com", username: "linda_smith", created: true },
    signInUrl: "https://www.allfantasy.ai/support/sign-in?token=abc123",
    setPasswordUrl: "https://www.allfantasy.ai/forgot-password?method=email",
  }

  it("names the email and username they can sign in with, the one-tap button and a choose-a-password link", async () => {
    const { buildSupportWelcomeEmail } = await import("@/lib/monetization/supportGuestEmail")
    const { subject, html } = buildSupportWelcomeEmail(base)
    expect(subject).toBe("Thank you for supporting AllFantasy")
    expect(html).toContain("linda@example.com")
    expect(html).toContain("linda_smith")
    expect(html).toContain("Your username")
    expect(html).toContain("Sign in to AllFantasy")
    expect(html).toContain(base.signInUrl.replace("&", "&amp;"))
    expect(html).toContain("https://www.allfantasy.ai/forgot-password?method=email")
    expect(html).toContain("Choose one here")
  })

  it("🛑 never contains a password", async () => {
    const { buildSupportWelcomeEmail } = await import("@/lib/monetization/supportGuestEmail")
    const { html } = buildSupportWelcomeEmail(base)
    expect(html).not.toMatch(/password\s*:/i)
    expect(html).not.toMatch(/temporary password/i)
  })

  it("escapes what it shows", async () => {
    const { buildSupportWelcomeEmail } = await import("@/lib/monetization/supportGuestEmail")
    const { html } = buildSupportWelcomeEmail({ ...base, buyer: { ...base.buyer, username: "<b>x</b>" } })
    expect(html).not.toContain("<b>x</b>")
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;")
  })

  it("the double-payment email says it was refunded", async () => {
    const { buildSupportWelcomeEmail } = await import("@/lib/monetization/supportGuestEmail")
    const { subject, html } = buildSupportWelcomeEmail({ ...base, duplicate: true })
    expect(subject).toBe("You're already supporting AllFantasy")
    expect(html).toContain("refunded in full")
  })
})
