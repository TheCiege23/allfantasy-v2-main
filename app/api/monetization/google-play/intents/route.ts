import { hasTrustedPlayOrigin } from "@/lib/google-play/billingRequest"
import { getServerSession } from "next-auth"
import { NextResponse } from "next/server"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { playCheckoutEnabled, obfuscatedPlayAccountId } from "@/lib/google-play/billingConfig"
import { playProductForSku } from "@/lib/google-play/billingCatalog"
import { enforcePaidSubscriptionGeo } from "@/lib/geo/enforcePaidSubscriptionGeo"
import { enforcePaidAccountLock } from "@/lib/geo/enforcePaidAccountLock"
import { EntitlementResolver } from "@/lib/subscription/EntitlementResolver"
export const runtime = "nodejs"
export async function POST(request: Request) {
  const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!playCheckoutEnabled(session.user.id)) return NextResponse.json({ error: "Google Play purchases are not available yet." }, { status: 503 })
  if (!hasTrustedPlayOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 })
  const geo = await enforcePaidSubscriptionGeo(request)
  if (geo) return geo
  const locked = await enforcePaidAccountLock(session.user.id)
  if (locked) return locked
  let body: { sku?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }
  const item = playProductForSku(String(body?.sku || ""))
  if (!item) return NextResponse.json({ error: "Unknown product." }, { status: 400 })
  if (item.type === "subscription") {
    const snapshot = await new EntitlementResolver().resolveSnapshot(session.user.id, undefined, { strictReads: true })
    const family = item.planFamily === "af_war_room" ? "war_room" : item.planFamily?.replace("af_", "")
    if (snapshot.plans.includes(family as any) ||
        (snapshot.plans.includes("supreme") && ["pro", "commissioner", "supreme"].includes(family || "")) ||
        (family === "supreme" && snapshot.plans.some(p => p === "pro" || p === "commissioner"))) {
      return NextResponse.json({ error: "You already have this access. Manage your existing subscription before buying another." }, { status: 409 })
    }
  }
  const intent = await prisma.googlePlayCheckoutIntent.create({ data: { userId: session.user.id, sku: item.sku, expiresAt: new Date(Date.now() + 7 * 86400_000) } })
  return NextResponse.json({ intentId: intent.id, productId: item.productId, obfuscatedAccountId: obfuscatedPlayAccountId(session.user.id), ownerId: session.user.id }, { headers: { "cache-control": "no-store" } })
}
