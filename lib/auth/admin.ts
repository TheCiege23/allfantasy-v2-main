export type AllFantasyEntitlementUser = {
  email?: string | null
  username?: string | null
  name?: string | null
}

const STATIC_ALL_ACCESS_EMAILS = ["cjabar.henson@gmail.com"]
const STATIC_ALL_ACCESS_USERNAMES = ["theciege26"]

function parseList(value: string | undefined): string[] {
  return (value || '')
    .split(/[\n\r,;]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
}

function parseUsernameList(value: string | undefined): string[] {
  return (value || '')
    .split(/[\n\r,;]+/)
    .map((v) => v.trim())
    .filter(Boolean)
}

export function normalizeAdminEmail(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase()
}

export function isAllFantasyTestEmail(email: string | null | undefined): boolean {
  const normalized = normalizeAdminEmail(email)
  if (!normalized) return false
  if (STATIC_ALL_ACCESS_EMAILS.includes(normalized)) return true
  return [
    ...parseList(process.env.ALL_ACCESS_EMAILS),
    ...parseList(process.env.ADMIN_EMAILS),
  ].includes(normalized)
}

export function isAllFantasyTestUsername(username: string | null | undefined): boolean {
  const normalized = String(username ?? "").trim().toLowerCase()
  if (!normalized) return false
  if (STATIC_ALL_ACCESS_USERNAMES.includes(normalized)) return true
  return parseUsernameList(process.env.ALL_ACCESS_USERNAMES).map((u) => u.toLowerCase()).includes(normalized)
}

export function hasAllFantasyTestAccess(user: AllFantasyEntitlementUser | null | undefined): boolean {
  return isAllFantasyTestEmail(user?.email) ||
    isAllFantasyTestUsername(user?.username) ||
    isAllFantasyTestUsername(user?.name)
}

export function resolveAdminEmail(email: string | null | undefined): boolean {
  return isAllFantasyTestEmail(email)
}

export function isSiteAdmin(user: AllFantasyEntitlementUser | null | undefined): boolean {
  return hasAllFantasyTestAccess(user)
}

export function isAfCommissioner(user: AllFantasyEntitlementUser | null | undefined): boolean {
  return hasAllFantasyTestAccess(user)
}

export function hasAiAccess(user: AllFantasyEntitlementUser | null | undefined): boolean {
  return hasAllFantasyTestAccess(user)
}

export function hasPoolAdminAccess(user: AllFantasyEntitlementUser | null | undefined): boolean {
  return hasAllFantasyTestAccess(user)
}

export function hasChatAdminAccess(user: AllFantasyEntitlementUser | null | undefined): boolean {
  return hasAllFantasyTestAccess(user)
}
