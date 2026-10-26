import { getServerSession } from "next-auth"
import { NextResponse } from "next/server"
import { authOptions } from "@/lib/auth"
import { getMonetizationCatalog } from "@/lib/monetization/catalog"
import { playBillingConfigured } from "@/lib/google-play/playDeveloperApi"

/** Play product ids the Android app may sell. Each one is the catalog SKU itself. */
export async function GET() {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!playBillingConfigured()) {
    return NextResponse.json({ error: "Google Play purchases are not configured" }, { status: 503 })
  }
  return NextResponse.json({
    subscriptions: getMonetizationCatalog().subscriptions.map(({ sku }) => sku),
    tokenPacks: getMonetizationCatalog().tokenPacks.map(({ sku }) => sku),
  })
}
