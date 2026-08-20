/**
 * True for `/brackets`, `/brackets/**`, and the legacy `/bracket` NCAA tree.
 * Used to hide the global primary quick-link row in `GlobalTopNav` where `BracketTopNav` is the product nav.
 */
export function isBracketProductSurfacePath(pathname: string | null | undefined): boolean {
  if (pathname == null || pathname === "") return false
  const pathOnly = pathname.split("?")[0].split("#")[0]
  const trimmed = pathOnly.replace(/\/+$/, "")
  const normalized = (trimmed === "" ? "/" : trimmed).toLowerCase()
  return (
    normalized === "/brackets" ||
    normalized.startsWith("/brackets/") ||
    normalized === "/bracket" ||
    normalized.startsWith("/bracket/")
  )
}
