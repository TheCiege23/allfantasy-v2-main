import { getServerSession } from "next-auth"
import { NextResponse } from "next/server"
import { authOptions } from "@/lib/auth"
import { getMonetizationCatalog } from "@/lib/monetization/catalog"
import { appleIapConfigured } from "@/lib/monetization/appleStore"

export async function GET() {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!appleIapConfigured()) {
    return NextResponse.json({ error: "Apple purchases are not configured" }, { status: 503 })
  }
  return NextResponse.json({
    // AppUser.id is a UUID. Pass it to StoreKit as Product.PurchaseOption.appAccountToken.
    appAccountToken: session.user.id,
    subscriptions: getMonetizationCatalog().subscriptions.map(({ sku }) => sku),
    tokenPacks: getMonetizationCatalog().tokenPacks.map(({ sku }) => sku),
  })
}
