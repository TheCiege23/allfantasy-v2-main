/**
 * Server-side redaction for the owner-only contract capture (`contractCaptureService.ts`).
 *
 * The capture is a one-time JSON download meant to become a committed fixture in a PUBLIC repo, so it
 * must carry the provider's SHAPE and none of the people. This is the TypeScript sibling of
 * `contracts/espn/scripts/redact-fantasy.mjs` (which redacts files written by `probe.sh`) and keeps
 * that script's one hard guarantee: after rewriting, it searches the finished document for every
 * original value it replaced and REFUSES — throws, so the route returns an error and no body — if
 * any survives. The two are kept separate because the script is a standalone CLI with no build step;
 * a rule changed in one should be checked against the other.
 *
 * Replaced, consistently across the whole document (one original -> one synthetic value):
 *   - manager / member names, nicknames, emails, avatar URLs, member ids (ESPN SWIDs) and Yahoo guids
 *   - team names, locations, nicknames, abbreviations and logos; the league name
 *   - the league id / league key, wherever it appears inside a string (team keys, URLs) or as a number
 *   - free text written by people (trade notes, messages)
 * Verified absent as well: every credential value the capture held (OAuth tokens, ESPN cookies), any
 * braced GUID, and anything shaped like a cookie or bearer header.
 * Kept: NFL player names and ids, NFL teams, stats, points, settings — public sports data.
 */

export type CaptureProvider = 'yahoo' | 'espn'

export type CaptureRequestInput = {
  /** Stable label, e.g. `team_roster_week_stats`. */
  resource: string
  /** The request with placeholders instead of real keys, e.g. `league/{league_key}/scoreboard;week=12`. */
  requestTemplate: string
  httpStatus: number
  body: unknown | null
  candidate?: boolean
}

export type RedactCaptureInput = {
  provider: CaptureProvider
  capturedAt: string
  sport: 'NFL'
  season: number | null
  week: number | null
  /** The real league id and/or key, e.g. Yahoo `['423.l.12345', '12345']`, ESPN `['12345']`. */
  leagueIdentifiers: string[]
  ownerTeamKey: string | null
  /** Every credential value held during the capture. Verified absent; never written anywhere. */
  credentialValues: string[]
  requests: CaptureRequestInput[]
  notes: string[]
}

export class ContractCaptureRedactionError extends Error {
  constructor(readonly survivingCount: number) {
    // Count only — naming a surviving value would put it in a log or a response.
    super(`Refusing to return the capture: ${survivingCount} identifying value(s) survived redaction.`)
    this.name = 'ContractCaptureRedactionError'
  }
}

export const SYNTHETIC_YAHOO_LEAGUE_NUMBER = '999001'
export const SYNTHETIC_ESPN_LEAGUE_ID = 123456
const REDACTED_IMAGE = 'https://example.invalid/redacted.png'
const REDACTED_TEXT = '[redacted free text]'

const BRACED_GUID = /\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}/g
/** Shapes a credential takes in transit. None belongs in a provider response body. */
const CREDENTIAL_SHAPES = [/espn_s2\s*=/i, /\bSWID\s*=/i, /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/, /"(access_token|refresh_token)"\s*:/i]

/** Free text written by people, on any provider. The value is replaced whatever it says. */
const FREE_TEXT_KEYS = new Set(['trade_note', 'note', 'notes', 'message', 'comment', 'comments', 'text'])
/** Yahoo keys whose STRING value identifies a person, team or league. A player's `name` is an object and is kept. */
const YAHOO_IDENTITY_KEYS: Record<string, string> = {
  name: 'name',
  nickname: 'person',
  guid: 'guid',
  email: 'email',
  manager_name: 'person',
  source_team_name: 'team',
  destination_team_name: 'team',
  trader_team_name: 'team',
  tradee_team_name: 'team',
  owner_team_name: 'team',
}
const YAHOO_IMAGE_KEYS = new Set(['image_url', 'logo_url'])
/** ESPN identity fields, by the array that holds them. */
const ESPN_MEMBER_KEYS = new Set(['displayName', 'firstName', 'lastName'])
const ESPN_TEAM_KEYS = new Set(['name', 'location', 'nickname', 'abbrev'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

class SyntheticValues {
  private readonly map = new Map<string, string>()
  private readonly counters = new Map<string, number>()

  label(original: string, kind: string): string {
    const existing = this.map.get(original)
    if (existing) return existing
    const n = (this.counters.get(kind) ?? 0) + 1
    this.counters.set(kind, n)
    const value =
      kind === 'member'
        ? `fixture-manager-${n}`
        : kind === 'team'
          ? `Fixture Team ${n}`
          : kind === 'league'
            ? 'Fixture League'
            : `redacted-${kind}-${n}`
    this.map.set(original, value)
    return value
  }

  /** Originals long enough to search for safely inside other strings, longest first. */
  searchable(): Array<[string, string]> {
    return [...this.map.entries()].filter(([from]) => from.length >= 4).sort((a, b) => b[0].length - a[0].length)
  }

  originals(): string[] {
    return [...this.map.keys()]
  }
}

/* ── collection: find what identifies people before rewriting anything ─────────────────────── */

function collectYahoo(node: unknown, values: SyntheticValues): void {
  if (Array.isArray(node)) return node.forEach((x) => collectYahoo(x, values))
  if (!isRecord(node)) return
  for (const [key, value] of Object.entries(node)) {
    const kind = YAHOO_IDENTITY_KEYS[key]
    if (kind && typeof value === 'string' && value.trim()) {
      values.label(value, 'is_league' in node || 'league_key' in node ? 'league' : kind === 'name' ? 'team' : kind)
    } else {
      collectYahoo(value, values)
    }
  }
}

function collectEspn(body: unknown, values: SyntheticValues): void {
  if (!isRecord(body)) return
  for (const m of Array.isArray(body.members) ? body.members : []) {
    if (!isRecord(m)) continue
    if (typeof m.id === 'string' && m.id) values.label(m.id, 'member')
    for (const k of ESPN_MEMBER_KEYS) if (typeof m[k] === 'string' && (m[k] as string).trim()) values.label(m[k] as string, 'person')
  }
  for (const t of Array.isArray(body.teams) ? body.teams : []) {
    if (!isRecord(t)) continue
    for (const k of ESPN_TEAM_KEYS) if (typeof t[k] === 'string' && (t[k] as string).trim()) values.label(t[k] as string, k === 'name' ? 'team' : `team-${k}`)
  }
  const settings = isRecord(body.settings) ? body.settings : null
  if (settings && typeof settings.name === 'string' && settings.name.trim()) values.label(settings.name, 'league')
}

/* ── rewrite ─────────────────────────────────────────────────────────────────────────────── */

type LeagueRewrite = { pattern: RegExp; replace: string; numeric: Set<number> }

function buildLeagueRewrite(provider: CaptureProvider, identifiers: string[]): { rewrites: LeagueRewrite[]; originals: string[] } {
  const originals: string[] = []
  const rewrites: LeagueRewrite[] = []
  for (const raw of identifiers) {
    const id = String(raw ?? '').trim()
    if (!id) continue
    const yahooKey = id.match(/^(\d+)\.l\.(\d+)$/)
    const number = yahooKey ? yahooKey[2]! : id.replace(/\D/g, '')
    if (!number) continue
    originals.push(number)
    if (yahooKey) originals.push(id)
    const synthetic = provider === 'yahoo' ? SYNTHETIC_YAHOO_LEAGUE_NUMBER : String(SYNTHETIC_ESPN_LEAGUE_ID)
    rewrites.push({
      // The league number wherever it stands alone as a digit run: `423.l.12345`, `.../f1/12345/3`, `"12345"`.
      pattern: new RegExp(`(?<!\\d)${escapeRegExp(number)}(?!\\d)`, 'g'),
      replace: synthetic,
      numeric: new Set([Number(number)].filter(Number.isSafeInteger)),
    })
  }
  return { rewrites, originals: [...new Set(originals)] }
}

function rewriteString(text: string, values: SyntheticValues, rewrites: LeagueRewrite[]): string {
  let out = text
  for (const [from, to] of values.searchable()) if (out.includes(from)) out = out.split(from).join(to)
  out = out.replace(BRACED_GUID, (guid) => values.label(guid, 'member'))
  for (const r of rewrites) out = out.replace(r.pattern, r.replace)
  return out
}

function rewrite(
  node: unknown,
  ctx: { provider: CaptureProvider; values: SyntheticValues; rewrites: LeagueRewrite[]; path: string[] },
  counts: { freeText: number; images: number },
): unknown {
  const { provider, values, rewrites, path } = ctx
  if (Array.isArray(node)) return node.map((x) => rewrite(x, ctx, counts))
  if (isRecord(node)) {
    const out: Record<string, unknown> = {}
    for (const [rawKey, value] of Object.entries(node)) {
      const key = rewriteString(rawKey, values, rewrites)
      const child = { ...ctx, path: [...path, rawKey] }
      if (typeof value === 'string' && FREE_TEXT_KEYS.has(rawKey) && value.length > 0) {
        out[key] = REDACTED_TEXT
        counts.freeText++
        continue
      }
      if (provider === 'yahoo') {
        if (YAHOO_IMAGE_KEYS.has(rawKey) && typeof value === 'string') {
          out[key] = REDACTED_IMAGE
          counts.images++
          continue
        }
        if (rawKey === 'team_logos') {
          out[key] = [{ team_logo: { size: 'large', url: REDACTED_IMAGE } }]
          counts.images++
          continue
        }
        const kind = YAHOO_IDENTITY_KEYS[rawKey]
        if (kind && typeof value === 'string' && value.trim()) {
          out[key] = values.label(value, kind === 'name' ? 'team' : kind)
          continue
        }
      }
      if (provider === 'espn') {
        // Arrays add no path segment, so a member object's own path ends in `members`.
        const parent = path[path.length - 1]
        if (parent === 'members' && ESPN_MEMBER_KEYS.has(rawKey) && typeof value === 'string') {
          out[key] = values.label(value, 'person')
          continue
        }
        if (parent === 'teams' && ESPN_TEAM_KEYS.has(rawKey) && typeof value === 'string') {
          out[key] = values.label(value, rawKey === 'name' ? 'team' : `team-${rawKey}`)
          continue
        }
        if (parent === 'teams' && rawKey === 'logo' && typeof value === 'string') {
          out[key] = REDACTED_IMAGE
          counts.images++
          continue
        }
      }
      out[key] = rewrite(value, child, counts)
    }
    return out
  }
  if (typeof node === 'string') return rewriteString(node, values, rewrites)
  if (typeof node === 'number') {
    for (const r of rewrites) if (r.numeric.has(node)) return provider === 'espn' ? SYNTHETIC_ESPN_LEAGUE_ID : Number(r.replace)
  }
  return node
}

/* ── verify ──────────────────────────────────────────────────────────────────────────────── */

/**
 * Every finding in `text`, as a count. Public for the tests; the route only ever sees the count.
 */
export function countSurvivingSensitiveValues(
  text: string,
  args: { originals: string[]; leagueOriginals: string[]; credentialValues: string[] },
): number {
  let found = 0
  const lower = text.toLowerCase()
  for (const value of args.originals) {
    if (value.length >= 3 && text.includes(value)) found++
  }
  for (const id of args.leagueOriginals) {
    if (new RegExp(`(?<!\\d)${escapeRegExp(id)}(?!\\d)`).test(text)) found++
  }
  for (const secret of args.credentialValues) {
    const s = String(secret ?? '').trim()
    if (s.length < 6) continue
    const forms = new Set([s, encodeURIComponent(s), JSON.stringify(s).slice(1, -1)])
    for (const form of forms) if (lower.includes(form.toLowerCase())) found++
  }
  found += (text.match(BRACED_GUID) ?? []).length
  for (const shape of CREDENTIAL_SHAPES) if (shape.test(text)) found++
  return found
}

/**
 * Build the downloadable capture document, redacted, and prove it. Returns the serialized JSON.
 * Throws `ContractCaptureRedactionError` instead of returning anything if a value survived.
 */
export function buildRedactedCaptureDocument(input: RedactCaptureInput): { json: string; summary: Record<string, number> } {
  const values = new SyntheticValues()
  for (const r of input.requests) {
    if (input.provider === 'yahoo') collectYahoo(r.body, values)
    else collectEspn(r.body, values)
  }
  // Braced GUIDs anywhere (a former member still named on an old transaction), as redact-fantasy.mjs does.
  for (const r of input.requests) {
    for (const guid of JSON.stringify(r.body ?? null).match(BRACED_GUID) ?? []) values.label(guid, 'member')
  }
  const { rewrites, originals: leagueOriginals } = buildLeagueRewrite(input.provider, input.leagueIdentifiers)

  const counts = { freeText: 0, images: 0 }
  const ctx = { provider: input.provider, values, rewrites, path: [] as string[] }
  const requests = input.requests.map((r) => ({
    resource: r.resource,
    request: r.requestTemplate,
    ...(r.candidate ? { candidate: true } : {}),
    httpStatus: r.httpStatus,
    body: r.body == null ? null : rewrite(r.body, ctx, counts),
  }))

  const document = {
    capturedAt: input.capturedAt,
    provider: input.provider,
    sport: input.sport,
    season: input.season,
    week: input.week,
    league: input.provider === 'yahoo' ? `{game}.l.${SYNTHETIC_YAHOO_LEAGUE_NUMBER}` : SYNTHETIC_ESPN_LEAGUE_ID,
    ownerTeam: input.ownerTeamKey ? rewriteString(input.ownerTeamKey, values, rewrites) : null,
    purpose: 'One-time contract capture for contracts/' + input.provider + '/ (owner decision 2026-11-25). Redacted server-side.',
    notes: input.notes,
    redaction: {
      syntheticValues: values.originals().length,
      leagueIdentifiersReplaced: leagueOriginals.length,
      freeTextFieldsReplaced: counts.freeText,
      imagesReplaced: counts.images,
      credentialValuesVerifiedAbsent: input.credentialValues.filter((v) => String(v ?? '').trim().length >= 6).length,
    },
    requests,
  }

  const json = `${JSON.stringify(document, null, 2)}\n`
  const surviving = countSurvivingSensitiveValues(json, {
    originals: values.originals(),
    leagueOriginals,
    credentialValues: input.credentialValues,
  })
  if (surviving > 0) throw new ContractCaptureRedactionError(surviving)
  return { json, summary: { ...document.redaction, requests: requests.length } }
}
