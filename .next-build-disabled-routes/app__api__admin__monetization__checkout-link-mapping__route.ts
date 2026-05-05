import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"
import { getMonetizationCatalog } from "@/lib/monetization/catalog"
import { listStripeCheckoutLinkResolutions } from "@/lib/monetization/StripeCheckoutLinkRegistry"

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.res

  const catalog = getMonetizationCatalog()
  const resolutions = listStripeCheckoutLinkResolutions()

  const resolutionBySku = new Map(resolutions.map((r) => [r.sku, r]))

  const products = catalog.all.map((product) => {
    const resolution = resolutionBySku.get(product.sku)
    const expectedPurchaseType = product.type === "subscription" ? "subscription" : "tokens"
    const mappedPurchaseType = resolution?.purchaseType ?? expectedPurchaseType
    const checkoutConfigured = resolution?.configured ?? false
    const checkoutDestination = resolution?.checkoutUrl ?? undefined

    const issue = !checkoutConfigured ? "checkout_link_missing_or_invalid" : null

    return {
      sku: product.sku,
      title: product.title,
      checkoutConfigured,
      expectedPurchaseType,
      mappedPurchaseType,
      ...(checkoutDestination ? { checkoutDestination } : {}),
      issue,
    }
  })

  const configuredProducts = products.filter((p) => p.checkoutConfigured).length
  const missingSkus = products.filter((p) => !p.checkoutConfigured).map((p) => p.sku)

  return NextResponse.json({
    summary: {
      totalProducts: products.length,
      configuredProducts,
      missingProducts: products.length - configuredProducts,
    },
    missingSkus,
    products,
  })
}
