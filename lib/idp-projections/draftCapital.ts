import raw from '@/data/nfl-draft-capital.json'

/**
 * Where a defender was taken in the NFL draft, from the nflverse players release via
 * `scripts/derive-nfl-draft-capital.ts`.
 *
 * ⚠ THIS IS A FACT TO DISPLAY, NOT A PRICE INPUT. `loadLeagueIdpVorp` ranks on production, so a
 * young edge rusher with a full season on file lands on the curve floor next to a
 * replacement-level veteran — and the market pays 1sts and 2nds for exactly those players
 * (Walter Nolen cost a 2027 2nd; Chop Robinson a 3rd plus a 2nd). Draft capital speaks to that
 * gap. It is still NOT wired into any value, and the reason is measured rather than cautious:
 *
 *   `teamTendencies.ts` records that adding those features to the IDP projection made it WORSE
 *   — MAE 4.681 and 4.696 against a 4.673 baseline over 5,291 out-of-sample player-weeks — so
 *   they ship at strength zero and a surface may state a blitz rate but may not grade a matchup
 *   on it. That test was possible because projections have 5,291 labels. A dynasty VALUE term
 *   has NINE: only 63 real trades exist across all 10 IDP leagues, 9 involving a floor-priced
 *   defender. Nothing here can be validated the same way, so nothing here moves a number.
 *
 * Show "2024 rd1 pk21" beside a floor price and let the reader weigh it. Do not multiply.
 *
 * Imported statically rather than read with `fs`: the file is committed under `data/`, and a
 * static import is bundled at build time instead of depending on the deployment happening to
 * ship the path — the same reasoning as `teamTendencies.ts`.
 */

export interface DraftCapital {
  /** 1–7. Undrafted players are absent from the table entirely, not stored as round 8. */
  draftRound: number
  /** Overall pick number, when the release carries it. */
  draftPick: number | null
  draftYear: number
  /** First school only; nflverse lists every transfer stop, semicolon-separated. */
  college: string | null
}

interface Row extends DraftCapital {
  name: string
  position: string
  birthDate: string | null
}

const ROWS = raw as Row[]

/**
 * The same normalisation the derive script applied — the two MUST agree or every lookup misses.
 * Exported so a test can assert that, rather than trusting two copies to stay in step.
 */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function positionGroup(pos: string): string {
  const p = pos.toUpperCase().trim()
  if (['CB', 'S', 'SS', 'FS', 'SAF', 'DB'].includes(p)) return 'DB'
  if (['DE', 'DT', 'NT', 'DL', 'EDGE'].includes(p)) return 'DL'
  if (['LB', 'OLB', 'ILB', 'MLB'].includes(p)) return 'LB'
  return p
}

/** name + birth date — deterministic, and the key to prefer once `dob` is backfilled. */
const byNameDob = new Map<string, Row>()
/**
 * name + college + position group.
 *
 * ⚠ A SET, NOT A ROW, BECAUSE THE KEY IS NOT UNIQUE. nflverse carries five Chris Johnsons in
 * the DB group; storing one row per key with last-write-wins hands a man another man's draft
 * slot. The identical bug in `scripts/backfill-player-dob.ts` wrote a 1971 birth date onto a
 * 2026 rookie before it was caught, so this refuses instead.
 */
const byNameCollegePos = new Map<string, Row[]>()
/** name alone, kept ONLY to detect ambiguity before a last-resort match. */
const byName = new Map<string, Row[]>()

for (const r of ROWS) {
  if (r.birthDate) byNameDob.set(`${r.name}|${r.birthDate}`, r)
  const c = (r.college ?? '').toLowerCase().trim()
  if (c) {
    const k = `${r.name}|${c}|${r.position}`
    const arr = byNameCollegePos.get(k) ?? []
    arr.push(r)
    byNameCollegePos.set(k, arr)
  }
  const arr = byName.get(r.name) ?? []
  arr.push(r)
  byName.set(r.name, arr)
}

export interface LookupInput {
  name: string
  /** `SportsPlayer.dob`. Populated on 0 of 583 rostered defenders TODAY — see the note below. */
  dob?: string | null
  college?: string | null
  position?: string | null
}

/**
 * Draft capital for one defender, or null when he is undrafted, absent, or ambiguous.
 *
 * ⚠ THE THREE KEYS ARE ORDERED BY TRUSTWORTHINESS, NOT CONVENIENCE, and the last one refuses
 * on ambiguity. Measured against the 583 rostered defenders (2026-08-28): the college key
 * carried 70% and a unique-name fallback carried a further 25%, because Sleeper says "Ole Miss"
 * where nflverse says "Mississippi". A name match that is NOT unique is dropped rather than
 * guessed — attaching one man's draft slot to another is the failure this ordering exists to
 * avoid.
 *
 * ⚠ THE DOB KEY SCORES ZERO UNTIL THE BACKFILL RUNS. It is first on purpose: once
 * `scripts/backfill-player-dob.ts` populates `SportsPlayer.dob`, the join stops depending on
 * two vendors agreeing about the name of a university.
 */
export function lookupDraftCapital(input: LookupInput): DraftCapital | null {
  const n = normalizeName(input.name ?? '')
  if (!n) return null

  const dob = (input.dob ?? '').slice(0, 10)
  if (dob) {
    const hit = byNameDob.get(`${n}|${dob}`)
    if (hit) return toCapital(hit)
  }

  const college = (input.college ?? '').toLowerCase().trim()
  const pos = positionGroup(input.position ?? '')
  if (college && pos) {
    const hits = byNameCollegePos.get(`${n}|${college}|${pos}`)
    // Exactly one, or nothing: two men sharing all three fields cannot be told apart here.
    if (hits && hits.length === 1) return toCapital(hits[0])
  }

  const cands = byName.get(n)
  if (cands && cands.length === 1) return toCapital(cands[0])

  /*
   * More than one drafted defender shares this name and nothing else matched. Returning either
   * would be a coin flip presented as a fact.
   */
  return null
}

function toCapital(r: Row): DraftCapital {
  return {
    draftRound: r.draftRound,
    draftPick: r.draftPick,
    draftYear: r.draftYear,
    college: r.college,
  }
}

/** How a draft slot reads in a sentence: "2024 rd1 pk21". */
export function formatDraftCapital(c: DraftCapital | null): string | null {
  if (!c) return null
  return c.draftPick != null
    ? `${c.draftYear} rd${c.draftRound} pk${c.draftPick}`
    : `${c.draftYear} rd${c.draftRound}`
}

/** Row count, so a caller or test can assert the artifact actually loaded. */
export const DRAFT_CAPITAL_ROW_COUNT = ROWS.length
