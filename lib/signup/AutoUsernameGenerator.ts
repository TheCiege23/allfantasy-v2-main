/**
 * Server-side auto-username generation.
 *
 * The redesigned /signup form no longer asks for a username — it collects only
 * name/email/password/consent (username selection moves to a post-signup
 * onboarding flow, not built yet). But POST /api/auth/register still requires a
 * unique username to satisfy the account model. This module derives a valid,
 * unique, non-reserved, non-profane internal username from the user's display
 * name, entirely server-side.
 *
 * Rules (per product decision):
 *  - Prefer a sanitized, name-based slug; never derive from the email/domain.
 *  - Reserved and profane stems are never built on — they fall back to a themed
 *    base ("manager") plus a random suffix.
 *  - Always produces a value satisfying `validateUsername` (3–30 chars, [A-Za-z0-9_],
 *    not phone-like).
 *  - Uniqueness is resolved against an injected async `isTaken` checker so this is
 *    unit-testable without a database, and a collision-safe random suffix widens on
 *    repeated collisions.
 *
 * The generated username is an internal placeholder: accounts are created with
 * `profileComplete: false`, and onboarding lets the user pick their real handle.
 */

import { containsProfanity } from "@/lib/profanity"
import { validateUsername } from "@/lib/auth/username-validation"

/**
 * Handles a user must never be auto-assigned: platform/impersonation-adjacent
 * words and route/segment names. Exact matches only — a name-derived stem that
 * equals one of these falls back to the themed base instead of being suffixed,
 * so no user is ever handed e.g. `admin_4821`.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin", "administrator", "root", "superuser", "sysadmin", "system",
  "support", "help", "helpdesk", "staff", "team", "mod", "mods", "moderator",
  "allfantasy", "all_fantasy", "official", "billing", "security", "abuse",
  "api", "auth", "oauth", "login", "signin", "signup", "register", "logout",
  "settings", "account", "accounts", "profile", "me", "user", "users",
  "username", "owner", "commissioner", "chimmy", "bot", "robot", "test",
  "anonymous", "anon", "guest", "null", "undefined", "none", "www", "mail",
])

/** Themed base used when a name yields no usable stem (empty, reserved, profane). */
const FALLBACK_BASE = "manager"

/** Leave room for "_" + up to 6 digits within validateUsername's 30-char max. */
const MAX_BASE_LEN = 23

export function isReservedUsername(candidate: string): boolean {
  return RESERVED_USERNAMES.has(candidate.trim().toLowerCase())
}

/**
 * Slugify a display name into an ASCII `[a-z0-9_]` stem. Diacritics are folded
 * (José → jose); scripts with no ASCII fold (e.g. CJK) yield an empty string,
 * which the caller replaces with the themed base.
 */
export function slugifyName(name: string | null | undefined): string {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // strip combining marks (diacritics) exposed by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_") // any run of non-alphanumerics → single underscore
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") // trim leading/trailing underscores
    .slice(0, MAX_BASE_LEN)
    .replace(/_+$/g, "") // re-trim if the slice landed mid-underscore
}

function defaultRandomDigits(len: number): string {
  let out = ""
  for (let i = 0; i < len; i++) out += Math.floor(Math.random() * 10).toString()
  return out
}

/** A candidate is emittable only if it passes canonical validation, is not reserved, and is clean. */
function isEmittable(candidate: string, isReserved: (c: string) => boolean): boolean {
  const validation = validateUsername(candidate)
  if (!validation.ok) return false
  if (isReserved(candidate)) return false
  if (containsProfanity(candidate)) return false
  return true
}

export interface GenerateUsernameOptions {
  /** The user's display / full name. */
  name?: string | null
  /** Returns true if the candidate is already taken (case-insensitive DB check in prod). */
  isTaken: (candidate: string) => boolean | Promise<boolean>
  /** Override the reserved check (defaults to the RESERVED_USERNAMES set). */
  isReserved?: (candidate: string) => boolean
  /** Override the random-digit source (inject a deterministic stub in tests). */
  randomDigits?: (len: number) => string
  /** Safety cap on suffix attempts before giving up. */
  maxAttempts?: number
}

/**
 * Produce a valid, unique, non-reserved username derived from `name`.
 * Throws only if no unique candidate is found within `maxAttempts` (effectively
 * impossible with widening random suffixes; the caller treats a throw as a
 * transient failure).
 */
export async function generateUniqueUsername(opts: GenerateUsernameOptions): Promise<string> {
  const isReserved = opts.isReserved ?? isReservedUsername
  const randomDigits = opts.randomDigits ?? defaultRandomDigits
  const maxAttempts = opts.maxAttempts ?? 50

  const slug = slugifyName(opts.name)

  // A name-derived stem is usable as a base only if it is clean and not
  // impersonation-adjacent; otherwise we build on the themed fallback so no
  // user is handed a reserved/profane-derived handle.
  const baseUsable =
    slug.length >= 1 &&
    !isReserved(slug) &&
    !containsProfanity(slug) &&
    !/\d{7,}/.test(slug)
  const suffixBase = baseUsable ? slug : FALLBACK_BASE

  const tried = new Set<string>()
  const tryCandidate = async (candidate: string): Promise<string | null> => {
    if (!candidate || tried.has(candidate)) return null
    tried.add(candidate)
    if (!isEmittable(candidate, isReserved)) return null
    const taken = await opts.isTaken(candidate)
    return taken ? null : candidate
  }

  // 1) Bare name slug — only when it is a clean, non-reserved, 3+ char stem.
  if (slug.length >= 3 && baseUsable) {
    const bare = await tryCandidate(slug)
    if (bare) return bare
  }

  // 2) base_#### with a random suffix that widens on repeated collisions.
  const widths = [3, 3, 3, 3, 4, 4, 4, 5, 5, 6]
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const width = widths[Math.min(attempt, widths.length - 1)]
    const candidate = await tryCandidate(`${suffixBase}_${randomDigits(width)}`)
    if (candidate) return candidate
  }

  throw new Error("Unable to generate a unique username after multiple attempts.")
}
