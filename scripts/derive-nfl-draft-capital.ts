/**
 * NFL draft capital for defenders, derived from the nflverse players release.
 *
 *   npx tsx scripts/derive-nfl-draft-capital.ts [outFile]
 *
 * WHY THIS EXISTS. `loadLeagueIdpVorp` prices defenders purely on production rank, so a young
 * edge rusher with a full season on file lands on the curve's floor beside a replacement-level
 * veteran. Measured against real trades (2026-08-28), the market pays 1sts and 2nds for exactly
 * those floor-priced players — Walter Nolen cost a 2027 2nd, Chop Robinson a 3rd plus a 2nd.
 * The disagreement is about ORDERING, and draft capital is the cheapest fact that speaks to it.
 *
 * ⚠ WRITES A JSON ARTIFACT, NOT THE DATABASE — same rule as
 * `derive-team-defense-tendencies.ts`. Whether draft capital ever earns a column is a question
 * a backtest answers, and the backtest cannot be run yet: a dynasty VALUE term has 9 real
 * observations against the 5,291 out-of-sample player-weeks that were available when team
 * tendencies were tested (and those made the model WORSE — see `teamTendencies.ts`). So this
 * ships as a DISPLAYED FACT, never as a price input.
 *
 * ⚠ `birth_date` IS CARRIED DELIBERATELY, AND IS HALF THE POINT. `SportsPlayer.dob` is
 * populated on 0 of 583 rostered defenders, so the only join available today is
 * name + college + position — and the college vocabularies DISAGREE between Sleeper and
 * nflverse ("Ole Miss" vs "Mississippi"), which pushed 25% of the join onto a unique-name
 * fallback. Backfilling dob from this same file (`scripts/backfill-player-dob.ts`) makes the
 * join deterministic and unblocks the exact-age work in `lib/sports-data/playerAge.ts`.
 *
 * Source: the players release the repo already trusts. Its URL sat in
 * `scripts/ingest-nflverse-stats.ts` as a dead constant that nothing read.
 */
import { writeFileSync } from 'node:fs'

const PLAYERS =
  'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv'

const OUT = process.argv[2] ?? 'data/nfl-draft-capital.json'

/**
 * Defensive position groups only. Widening to offence is a one-line change here, and was not
 * done because nothing asks for it yet and every row costs bundle size on a static import.
 */
const DEFENSIVE_GROUPS = new Set(['DL', 'LB', 'DB'])

/**
 * ⚠ THE ARTIFACT IS BUNDLED INTO EVERY FUNCTION THAT TRANSITIVELY IMPORTS IT, so its size is a
 * real cost, not a detail. Every defender in the release — drafted or not, back to the 1970s —
 * is 11,483 rows and **1.6 MB**, which would ride along into decision-os, rankings, the Defense
 * Hub and the Chimmy grounding alike.
 *
 * Two cuts bring it to something a bundle can carry, and neither loses anything asked for:
 *
 *  1. DRAFTED players only. An undrafted defender's "draft capital" is the absence of it, which
 *     the lookup already expresses by returning null. The undrafted rows were only ever here
 *     for the dob backfill, and `backfill-player-dob.ts` reads the release itself.
 *  2. Recent drafts only. This exists to explain why a YOUNG player the market pays picks for
 *     sits on the production floor. Where a 2009 third-rounder went is not going to inform a
 *     dynasty price in 2026, and he has a decade of production to be judged on instead.
 */
const EARLIEST_DRAFT_YEAR = 2015

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/**
 * The match key. Accents stripped, punctuation dropped, generational suffixes removed — a
 * roster says "Jr." about as often as it does not.
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

/**
 * nflverse positions are finer-grained than ours (SAF/CB/DT/DE against our DB/DL). Collapsed
 * the same way `ingest-nflverse-stats.ts` already does, so both sides of the join agree.
 */
export function positionGroup(pos: string): string {
  const p = pos.toUpperCase().trim()
  if (['CB', 'S', 'SS', 'FS', 'SAF', 'DB'].includes(p)) return 'DB'
  if (['DE', 'DT', 'NT', 'DL', 'EDGE'].includes(p)) return 'DL'
  if (['LB', 'OLB', 'ILB', 'MLB'].includes(p)) return 'LB'
  return p
}

async function main() {
  const res = await fetch(PLAYERS)
  if (!res.ok) throw new Error(`${res.status} fetching players.csv`)
  const text = await res.text()

  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  const header = splitCsvLine(lines[0])
  const col = (n: string) => {
    const i = header.indexOf(n)
    /*
     * Fail loudly on a renamed column. A silent -1 index yields `undefined` for every row and
     * writes a well-formed file full of nulls, which looks like "the draft data is missing"
     * rather than "the script broke".
     */
    if (i < 0) throw new Error(`players.csv has no column "${n}" — header changed upstream`)
    return i
  }

  const iName = col('display_name')
  const iCollege = col('college_name')
  const iPos = col('position')
  const iGroup = col('position_group')
  const iBirth = col('birth_date')
  const iRound = col('draft_round')
  const iPick = col('draft_pick')
  const iYear = col('draft_year')

  type Row = {
    name: string
    college: string | null
    position: string
    birthDate: string | null
    draftRound: number | null
    draftPick: number | null
    draftYear: number | null
  }

  const rows: Row[] = []
  const seen = new Set<string>()
  let scanned = 0
  let skippedNonDefensive = 0

  for (let i = 1; i < lines.length; i++) {
    const f = splitCsvLine(lines[i])
    scanned++

    const group = positionGroup(f[iGroup] || f[iPos] || '')
    if (!DEFENSIVE_GROUPS.has(group)) {
      skippedNonDefensive++
      continue
    }

    const name = normalizeName(f[iName] ?? '')
    if (!name) continue

    const round = Number.parseInt((f[iRound] ?? '').trim(), 10)
    const pick = Number.parseInt((f[iPick] ?? '').trim(), 10)
    const year = Number.parseInt((f[iYear] ?? '').trim(), 10)
    const birth = (f[iBirth] ?? '').trim().slice(0, 10)

    const hasBirth = /^\d{4}-\d{2}-\d{2}$/.test(birth)
    if (!Number.isFinite(round)) continue
    if (!Number.isFinite(year) || year < EARLIEST_DRAFT_YEAR) continue

    /*
     * De-duplicate on the full key rather than the name. nflverse carries distinct players who
     * share a name, and collapsing them would silently attach one man's draft slot to another.
     */
    const key = `${name}|${birth}|${group}`
    if (seen.has(key)) continue
    seen.add(key)

    /*
     * nflverse lists every school a transfer attended, semicolon-separated
     * ("UNLV; University of South Florida; Kansas State"). Only the first is kept: the fallback
     * join compares against Sleeper's single `college`, and the full list is pure bundle weight.
     */
    const college = ((f[iCollege] ?? '').split(';')[0] ?? '').trim() || null

    rows.push({
      name,
      college,
      position: group,
      birthDate: hasBirth ? birth : null,
      draftRound: round,
      draftPick: Number.isFinite(pick) ? pick : null,
      draftYear: year,
    })
  }

  // Sorted so the committed file has a stable diff between runs.
  rows.sort((a, b) =>
    a.name === b.name
      ? (a.birthDate ?? '').localeCompare(b.birthDate ?? '')
      : a.name.localeCompare(b.name),
  )

  writeFileSync(OUT, JSON.stringify(rows, null, 0) + '\n')

  const drafted = rows.filter((r) => r.draftRound != null).length
  const withDob = rows.filter((r) => r.birthDate != null).length
  console.log(`scanned ${scanned} rows (${skippedNonDefensive} non-defensive skipped)`)
  console.log(`wrote ${rows.length} defenders to ${OUT}`)
  console.log(`  with draft capital: ${drafted}`)
  console.log(`  with birth date:    ${withDob}`)
}

void main()
