import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { NextResponse } from "next/server"
import { playBillingCatalog } from "@/lib/google-play/billingCatalog"
import { playCheckoutEnabled } from "@/lib/google-play/billingConfig"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function GET() {
  const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
  return NextResponse.json({ enabled: playCheckoutEnabled(session?.user?.id), products: playBillingCatalog().map(({ sku, productId, type, interval }) => ({ sku, productId, type, interval })) }, { headers: { "cache-control": "no-store" } })
}
