/**
 * CrossProductRouteResolver — canonical entry routes and route prefixes for each product.
 * Single source of truth for cross-product navigation and product switcher.
 */

import type { ProductId } from "@/lib/shell"

interface ProductRouteConfig {
  productId: ProductId
  label: string
  /** Main entry route for the product (used by product switcher and deep links). */
  entryRoute: string
  /** Path prefixes that belong to this product (for active state and protection). */
  pathPrefixes: string[]
}

const PRODUCT_ROUTE_CONFIGS: ProductRouteConfig[] = [
  { productId: "home", label: "Home", entryRoute: "/dashboard", pathPrefixes: ["/dashboard"] },
  {
    productId: "webapp",
    label: "WebApp",
    entryRoute: "/dashboard",
    pathPrefixes: ["/dashboard", "/league", "/leagues", "/import"],
  },
  { productId: "bracket", label: "Bracket", entryRoute: "/brackets", pathPrefixes: ["/brackets", "/bracket"] },
  { productId: "legacy", label: "Legacy", entryRoute: "/af-legacy", pathPrefixes: ["/af-legacy", "/legacy"] },
]

/** Resolve the main entry route for a product (for switcher and "go to product" links). */
export function getProductEntryRoute(productId: ProductId): string {
  const config = PRODUCT_ROUTE_CONFIGS.find((c) => c.productId === productId)
  return config?.entryRoute ?? "/dashboard"
}

/** All product route configs for switcher and nav. */
export function getProductRouteConfigs(): ProductRouteConfig[] {
  return [...PRODUCT_ROUTE_CONFIGS]
}

/** Check if pathname belongs to a given product. */
export function isPathInProduct(pathname: string | null, productId: ProductId): boolean {
  if (!pathname) return false
  const config = PRODUCT_ROUTE_CONFIGS.find((c) => c.productId === productId)
  if (!config) return false
  return config.pathPrefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )
}
