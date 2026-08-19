import { type MonetizationSku } from "@/lib/monetization/catalog"

export type StripeCheckoutPurchaseType = "subscription" | "tokens"

export type StripeCheckoutLinkRegistryEntry = {
  sku: MonetizationSku
  purchaseType: StripeCheckoutPurchaseType
  checkoutLinkEnvVar: string
}

export type StripeCheckoutLinkResolution = StripeCheckoutLinkRegistryEntry & {
  checkoutUrl: string | null
  configured: boolean
}

type StripeCheckoutReferencePayload = {
  v: 1
  u: string
  s: MonetizationSku
  p: StripeCheckoutPurchaseType
  /** Normalized sponsor coupon code (WASSUPFRED) if user applied one at checkout */
  c?: string
}

const STRIPE_CHECKOUT_LINK_REGISTRY: readonly StripeCheckoutLinkRegistryEntry[] = [
  {
    sku: "af_pro_monthly",
    purchaseType: "subscription",
    checkoutLinkEnvVar: "STRIPE_CHECKOUT_LINK_AF_PRO_MONTHLY",
  },
  {
    sku: "af_pro_yearly",
    purchaseType: "subscription",
    checkoutLinkEnvVar: "STRIPE_CHECKOUT_LINK_AF_PRO_YEARLY",
  },
  {
    sku: "af_commissioner_monthly",
    purchaseType: "subscription",
    checkoutLinkEnvVar: "STRIPE_CHECKOUT_LINK_AF_COMMISSIONER_MONTHLY",
  },
  {
    sku: "af_commissioner_yearly",
    purchaseType: "subscription",
    checkoutLinkEnvVar: "STRIPE_CHECKOUT_LINK_AF_COMMISSIONER_YEARLY",
  },
  {
    sku: "af_war_room_monthly",
    purchaseType: "subscription",
    checkoutLinkEnvVar: "STRIPE_CHECKOUT_LINK_AF_WAR_ROOM_MONTHLY",
  },
  {
    sku: "af_war_room_yearly",
    purchaseType: "subscription",
    checkoutLinkEnvVar: "STRIPE_CHECKOUT_LINK_AF_WAR_ROOM_YEARLY",
  },
  {
    sku: "af_supreme_monthly",
    purchaseType: "subscription",
    checkoutLinkEnvVar: "STRIPE_CHECKOUT_LINK_AF_SUPREME_MONTHLY",
  },
  {
    sku: "af_supreme_yearly",
    purchaseType: "subscription",
    checkoutLinkEnvVar: "STRIPE_CHECKOUT_LINK_AF_SUPREME_YEARLY",
  },
  {
    sku: "af_tokens_5",
    purchaseType: "tokens",
    checkoutLinkEnvVar: "STRIPE_CHECKOUT_LINK_AF_TOKENS_5",
  },
  {
    sku: "af_tokens_10",
    purchaseType: "tokens",
    checkoutLinkEnvVar: "STRIPE_CHECKOUT_LINK_AF_TOKENS_10",
  },
  {
    sku: "af_tokens_25",
    purchaseType: "tokens",
    checkoutLinkEnvVar: "STRIPE_CHECKOUT_LINK_AF_TOKENS_25",
  },
] as const

const REGISTRY_BY_SKU = new Map<MonetizationSku, StripeCheckoutLinkRegistryEntry>(
  STRIPE_CHECKOUT_LINK_REGISTRY.map((entry) => [entry.sku, entry])
)

function isAllowedStripeCheckoutHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === "buy.stripe.com" || host.endsWith(".stripe.com")
}

function toSafeCheckoutUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== "https:") return null
    if (!isAllowedStripeCheckoutHost(parsed.hostname)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function resolveEnvValue(key: string, env: NodeJS.ProcessEnv): string | null {
  return toSafeCheckoutUrl(env[key] ?? null)
}

export function getStripeCheckoutLinkRegistry(): readonly StripeCheckoutLinkRegistryEntry[] {
  return STRIPE_CHECKOUT_LINK_REGISTRY
}

export function getStripeCheckoutLinkRegistryEntryBySku(
  sku: MonetizationSku
): StripeCheckoutLinkRegistryEntry | null {
  return REGISTRY_BY_SKU.get(sku) ?? null
}

export function getStripeCheckoutLinkForSku(
  sku: MonetizationSku,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const entry = getStripeCheckoutLinkRegistryEntryBySku(sku)
  if (!entry) return null
  return resolveEnvValue(entry.checkoutLinkEnvVar, env)
}

export function listStripeCheckoutLinkResolutions(
  env: NodeJS.ProcessEnv = process.env
): StripeCheckoutLinkResolution[] {
  return STRIPE_CHECKOUT_LINK_REGISTRY.map((entry) => {
    const checkoutUrl = resolveEnvValue(entry.checkoutLinkEnvVar, env)
    return {
      ...entry,
      checkoutUrl,
      configured: Boolean(checkoutUrl),
    }
  })
}

export function buildStripeCheckoutClientReferenceId(input: {
  userId: string
  sku: MonetizationSku
  purchaseType: StripeCheckoutPurchaseType
  /** Normalized sponsor coupon code to carry through to the webhook for redemption tracking */
  couponCode?: string | null
}): string {
  const payload: StripeCheckoutReferencePayload = {
    v: 1,
    u: input.userId,
    s: input.sku,
    p: input.purchaseType,
  }
  if (input.couponCode) {
    payload.c = input.couponCode
  }
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  return `af1_${encoded}`
}

export function parseStripeCheckoutClientReferenceId(
  value: string | null | undefined
): {
  userId: string
  sku: MonetizationSku
  purchaseType: StripeCheckoutPurchaseType
  /** Normalized sponsor coupon code if one was applied at checkout */
  couponCode: string | null
} | null {
  if (!value || !value.startsWith("af1_")) return null
  try {
    const encoded = value.slice(4)
    const decoded = Buffer.from(encoded, "base64url").toString("utf8")
    const parsed = JSON.parse(decoded) as Partial<StripeCheckoutReferencePayload>
    if (parsed.v !== 1) return null
    if (typeof parsed.u !== "string" || parsed.u.trim().length === 0) return null
    if (typeof parsed.s !== "string" || !REGISTRY_BY_SKU.has(parsed.s as MonetizationSku)) return null
    if (parsed.p !== "subscription" && parsed.p !== "tokens") return null
    return {
      userId: parsed.u.trim(),
      sku: parsed.s as MonetizationSku,
      purchaseType: parsed.p,
      couponCode: typeof parsed.c === "string" && parsed.c.trim() ? parsed.c.trim() : null,
    }
  } catch {
    return null
  }
}

export function buildStripeCheckoutDestinationForSku(input: {
  sku: MonetizationSku
  userId: string
  userEmail?: string | null
  returnPath?: string | null
  /** Normalized sponsor coupon code (e.g. "WASSUPFRED") — pre-fills Stripe promo code */
  couponCode?: string | null
  env?: NodeJS.ProcessEnv
}): { url: string; purchaseType: StripeCheckoutPurchaseType } | null {
  const env = input.env ?? process.env
  const registry = getStripeCheckoutLinkRegistryEntryBySku(input.sku)
  if (!registry) return null
  const checkoutBaseUrl = getStripeCheckoutLinkForSku(input.sku, env)
  if (!checkoutBaseUrl) return null

  const url = new URL(checkoutBaseUrl)
  url.searchParams.set(
    "client_reference_id",
    buildStripeCheckoutClientReferenceId({
      userId: input.userId,
      sku: input.sku,
      purchaseType: registry.purchaseType,
      couponCode: input.couponCode ?? null,
    })
  )
  if (input.userEmail && input.userEmail.trim()) {
    url.searchParams.set("prefilled_email", input.userEmail.trim())
  }
  if (input.returnPath && input.returnPath.trim()) {
    url.searchParams.set("af_return_path", input.returnPath.trim())
  }
  // Pre-fill Stripe's native promo code input — user sees 20% discount applied at checkout.
  // The Stripe promotion code "WASSUPFRED" must exist in the Stripe dashboard.
  if (input.couponCode && input.couponCode.trim()) {
    url.searchParams.set("prefilled_promo_code", input.couponCode.trim())
  }

  return {
    url: url.toString(),
    purchaseType: registry.purchaseType,
  }
}
