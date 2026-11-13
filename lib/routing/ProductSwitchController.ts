/**
 * ProductSwitchController — resolve target route when switching product.
 * Ensures product switcher and nav links use canonical entry routes.
 */

import {
  getProductEntryRoute,
  getProductRouteConfigs,
} from "./CrossProductRouteResolver"
import type { ProductId } from "@/lib/shell"

/** Get the href to use when switching to a product (for links and redirects). */
export function getProductSwitchHref(productId: ProductId): string {
  return getProductEntryRoute(productId)
}

/** All switch targets (same order as nav: Home, WebApp, Bracket, Legacy). */
export function getProductSwitchItems(): { productId: ProductId; href: string; label: string }[] {
  const preferredOrder: NonNullable<ProductId>[] = ["home", "bracket", "legacy"]
  const configById = new Map(
    getProductRouteConfigs().map((config) => [config.productId, config] as const)
  )
  return preferredOrder.map((productId) => {
    const config = configById.get(productId)
    return {
      productId,
      href: config?.entryRoute ?? getProductSwitchHref(productId),
      label: config?.label ?? productId,
    }
  })
}

