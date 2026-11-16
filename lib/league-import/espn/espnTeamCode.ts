import { createHmac } from 'node:crypto'

import { resolveAuthSecret } from '@/lib/auth/resolve-auth-secret'

/**
 * The ESPN team code — how a commissioner proves which team is theirs FROM A PHONE.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * Every other way to tell us "this ESPN team is mine" reads the SWID cookie, and the only ways to get
 * that cookie are a desktop browser's devtools or an unpublished extension. Phones can do neither.
 * Measured 2026-11-15: a commissioner on Android sat on the connect screen polling for a connection
 * that could never arrive, and left. Members of a public league already import with no cookies
 * (`espnPublicMemberImport.ts`); commissioners could not, because a picked team proves nothing.
 *
 * A code proves CONTROL, which is what the cookie proved. We show the person a short code; they set
 * their team's abbreviation (or name) to it in the ESPN app; we read the league and find the team
 * carrying it. Only someone who can edit that team on ESPN — its owner, or the league manager —
 * can put it there. That is the same bar as "your ESPN login can see this team", reached without
 * the cookie.
 *
 * ── WHY IT IS DERIVED, NOT STORED ────────────────────────────────────────────────────────────────
 * The code is an HMAC of (user, ESPN league id), so there is no table, no migration and no expiry
 * to manage: the same person asking about the same league always gets the same code, and nobody
 * else can compute it. It is keyed off the auth secret with its own suffix, the same construction
 * as `lib/chimmy/actions/actionToken.ts`, so it can never collide with another signed value.
 *
 * ⚠ WHAT A CODE DOES NOT PROVE. It proves edit access to one team, not that you are the league's
 * commissioner. Commissioner status still comes from ESPN's own member flags, or from the recorded
 * attestation when ESPN does not say — exactly as it does after a cookie proves the team.
 *
 * ⚠ THE COINCIDENCE BOUND. Four characters from a 31-symbol alphabet, always mixing a letter and a
 * digit, matched only as the whole abbreviation or a whole word of the name. A real team called
 * "K9X2" for some other reason is roughly a one-in-a-million event per team, and a code that matches
 * two teams in one league is refused rather than guessed between.
 */

/** No 0/O, 1/I/L — a code someone reads off a phone and types into another app. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const DIGITS = '23456789'
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ'
export const ESPN_TEAM_CODE_LENGTH = 4

function signingKey(): string | null {
  const secret = resolveAuthSecret()
  return secret ? `${secret}:espn-team-code:v1` : null
}

/** The bare numeric ESPN league id — the code must not change with the season or the URL pasted. */
function normalizeLeagueKey(espnLeagueId: string): string {
  return String(espnLeagueId ?? '').trim().replace(/^0+(?=\d)/, '')
}

/**
 * The code this user sets on their ESPN team to prove it is theirs. Null when no signing secret is
 * configured — callers must then simply not offer this path.
 */
export function espnTeamCodeFor(userId: string, espnLeagueId: string, key: string | null = signingKey()): string | null {
  const user = String(userId ?? '').trim()
  const league = normalizeLeagueKey(espnLeagueId)
  if (!key || !user || !league) return null
  const digest = createHmac('sha256', key).update(`${user}\u0000${league}`).digest()
  const chars = Array.from({ length: ESPN_TEAM_CODE_LENGTH }, (_, i) => ALPHABET[digest[i] % ALPHABET.length])
  if (!chars.some((c) => DIGITS.includes(c))) chars[digest[4] % ESPN_TEAM_CODE_LENGTH] = DIGITS[digest[5] % DIGITS.length]
  if (!chars.some((c) => LETTERS.includes(c))) chars[digest[6] % ESPN_TEAM_CODE_LENGTH] = LETTERS[digest[7] % LETTERS.length]
  return chars.join('')
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function words(value: string): string[] {
  return value.split(/[^A-Z0-9]+/).filter(Boolean)
}

function teamCarriesCode(team: Record<string, unknown>, code: string): boolean {
  if (str(team.abbrev) === code) return true
  for (const field of [team.location, team.nickname, team.name]) {
    if (words(str(field)).includes(code)) return true
  }
  return false
}

/**
 * The id of the ONE team in a raw ESPN league payload carrying this code, or null. Two or more
 * teams carrying it is null too: a code is proof only when it points at exactly one team.
 */
export function findEspnTeamIdByCode(raw: unknown, code: string | null | undefined): string | null {
  const want = str(code)
  if (want.length !== ESPN_TEAM_CODE_LENGTH || !raw || typeof raw !== 'object') return null
  const teams = Array.isArray((raw as Record<string, unknown>).teams)
    ? ((raw as Record<string, unknown>).teams as unknown[])
    : []
  const hits: string[] = []
  for (const team of teams) {
    if (!team || typeof team !== 'object') continue
    const id = String((team as Record<string, unknown>).id ?? '').trim()
    if (id && teamCarriesCode(team as Record<string, unknown>, want)) hits.push(id)
  }
  return hits.length === 1 ? hits[0] : null
}

export type EspnViewerTeamProof = 'swid' | 'team_code'

/**
 * Which team in `raw` is this user's, and how we know. The SWID cookie wins whenever it answers;
 * the team code is consulted only when it does not, so a connected account is never overridden.
 */
export function resolveEspnViewerTeamWithCode(args: {
  raw: unknown
  swidTeamId: string | null
  userId: string | null | undefined
  espnLeagueId: string
}): { teamId: string | null; proof: EspnViewerTeamProof | null } {
  if (args.swidTeamId) return { teamId: args.swidTeamId, proof: 'swid' }
  const code = args.userId ? espnTeamCodeFor(args.userId, args.espnLeagueId) : null
  const byCode = findEspnTeamIdByCode(args.raw, code)
  return byCode ? { teamId: byCode, proof: 'team_code' } : { teamId: null, proof: null }
}
