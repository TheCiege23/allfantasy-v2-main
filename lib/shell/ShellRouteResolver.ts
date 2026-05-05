/**
 * Resolves shell variant and product context from pathname.
 * Used to decide minimal vs full shell and active product highlighting.
 */

export type ShellVariant = "minimal" | "full"

/**
 * Paths that use minimal shell (landing, marketing, public tools).
 * All other authenticated app routes use full shell.
 */
const MINIMAL_PATHS_PREFIXES = [
  "/",
  "/chimmy",
  "/tools-hub",
  "/tools/",
  "/sports/",
  "/login",
  "/signup",
  "/forgot-password",
  "/verify",
]

export function getShellVariant(pathname: string | null, isAuthenticated: boolean): ShellVariant {
  if (!pathname) return isAuthenticated ? "full" : "minimal"
  const exactMinimal = pathname === "/"
  const prefixMinimal = MINIMAL_PATHS_PREFIXES.some(
    (p) => p !== "/" && pathname.startsWith(p)
  )
  if (exactMinimal || prefixMinimal) return "minimal"
  return "full"
}

export type ProductId = "home" | "webapp" | "bracket" | "legacy" | null

const PRODUCT_PATHS: { prefix: string; product: ProductId }[] = [
  { prefix: "/dashboard", product: "home" },
  { prefix: "/league", product: "webapp" },
  { prefix: "/import", product: "webapp" },
  { prefix: "/discover", product: "webapp" },
  { prefix: "/app", product: "webapp" },
  { prefix: "/leagues", product: "webapp" },
  { prefix: "/brackets", product: "bracket" },
  { prefix: "/bracket", product: "bracket" },
  { prefix: "/af-legacy", product: "legacy" },
  { prefix: "/legacy", product: "legacy" },
]

export function getProductFromPath(pathname: string | null): ProductId {
  if (!pathname) return null
  for (const { prefix, product } of PRODUCT_PATHS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`))
      return product
  }
  return null
}
