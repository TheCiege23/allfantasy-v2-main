export function resolveSafeReturnPath(input: unknown, fallbackPath = "/pricing"): string {
  if (typeof input !== "string") return fallbackPath
  const trimmed = input.trim()
  if (!trimmed.startsWith("/")) return fallbackPath
  if (trimmed.startsWith("//")) return fallbackPath
  if (trimmed.includes("\n") || trimmed.includes("\r")) return fallbackPath
  return trimmed
}

export function withQueryParam(path: string, key: string, value: string): string {
  const url = new URL(path, "https://allfantasy.local")
  url.searchParams.set(key, value)
  return `${url.pathname}${url.search}${url.hash}`
}

