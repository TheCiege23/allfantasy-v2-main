/**
 * How much player news is REACHABLE from a player card, and how much could be?
 *
 * READ-ONLY. Run: npx tsx scripts/probe-news-attribution.ts
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `lib/core-app/playerCard.ts` matches news to a player by NAME STRING:
 *
 *     playerName == name (case-insensitive)  OR  playerNames[] has name (exact)
 *
 * `SportsNews.playerId` exists in the schema and is 0% populated, so there is no
 * id to join on. Measured 2026-09-07: 641 of 12,314 NFL players (5.2%) have any
 * item the card can find, and 82.7% of the names the ingest stores are not
 * players at all — they are n-grams lifted out of headlines ("What Eli",
 * "Which Panthers", "Highmark Stadium", "Mel Kiper").
 *
 * This probe sizes the gap before anything is built: of the players the card
 * cannot serve, how many are actually NAMED in the text we already store?
 * That difference is the recoverable ceiling, and it decides whether the fix is
 * worth its risk.
 *
 * ── 🛑 WHAT IT MEASURED, 2026-09-07: DO NOT BUILD THE REWRITE ───────────────
 *
 *   reachable today                    434 of 1,661 rostered players   26.1%
 *   ceiling from ALL stored text       514                             30.9%
 *   -> recoverable                      83 players                     +4.8pts
 *   genuinely ambiguous names           32 of 514                        6.2%
 *
 * Perfect attribution moves 26% to 31%. **The bottleneck is SOURCE COVERAGE,
 * not parsing**: 69% of rostered players are never named in any of the 5,565
 * items we hold, and no amount of better matching invents coverage that is not
 * in the feed. Getting to 80% needs a per-player news product, which is a
 * data-source decision, not a code change.
 *
 * ⚠ AND THE 6.2% IS A REAL COST, NOT A ROUNDING ERROR. Among the matches are
 * `justin jefferson` (WR/Vikings and LB/Browns), `jermaine johnson` (LB/Titans
 * and LB/Jets) and `quinn ewers` (QB/Dolphins and QB/Jaguars) — different men
 * sharing a name. A name-only attribution puts one man's injury on another
 * man's card, which is worse than an empty section.
 *
 * ⚠ THE ONE BIG-LOOKING LEVER IS A CORPSE. `clearsports` holds 598 NFL items
 * with ZERO attribution, and 82.3% of them name a real player in their text —
 * 492 rows apparently free to recover. They are worthless: the source last
 * published **2026-04-26** and has produced nothing in 4.5 months, so its
 * draft-week content could never outrank current news in a `publishedAt desc`
 * top-N. The cause is provider-side, already diagnosed — a TLS SNI
 * misconfiguration (`ERR_SSL_TLSV1_UNRECOGNIZED_NAME`) on ClearSports' host.
 *
 * ⚠ `SportsNews.playerName` IS NOT THE CARD'S PROBLEM ALONE. Chimmy grounds on
 * it (`where: { playerName: { in: … } }`) and so does decision-OS news
 * enrichment, so the 82.7% junk rate degrades AI answers too.
 *
 * ⚠ IT USES THE REPO'S OWN `normalizePlayerName`, NOT A LOCAL COPY. Two
 * implementations of one normalisation rule is a bug this repo has already paid
 * for — a SQL re-implementation disagreed with the JS original on 7.2% of rows,
 * which would have written ~42,000 rows no reader could ever look up.
 *
 * ⚠ AND IT REPORTS AMBIGUITY, WHICH IS THE REASON NOT TO SHIP A NAIVE FIX.
 * "Josh Allen" is a Bills quarterback and a Jaguars linebacker; this repo
 * carries 178 known NFL duplicate name groups and forbids merging them. A
 * name-only attribution attaches one man's news to another, so the count of
 * AMBIGUOUS matches is as load-bearing as the count of recoverable ones.
 */
import { PrismaClient } from '@prisma/client'

import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'

const prisma = new PrismaClient()

/** Longest player name we will look for, in words. Calibrated below, not guessed. */
const MAX_WORDS = 5
const MIN_WORDS = 2

function words(text: string): string[] {
  return normalizePlayerName(text).split(' ').filter(Boolean)
}

async function main() {
  const host = (process.env.DATABASE_URL ?? '').replace(/.*@/, '').replace(/\/.*/, '')
  console.log(`endpoint: ${host}`)
  console.log(`now: ${new Date().toISOString()}\n`)

  const [news, allPlayers, rosters] = await Promise.all([
    prisma.sportsNews.findMany({
      where: { sport: 'NFL' },
      select: { id: true, title: true, content: true, description: true, playerName: true, playerNames: true },
    }),
    prisma.sportsPlayer.findMany({
      where: { sport: 'NFL' },
      select: { name: true, position: true, team: true, sleeperId: true },
    }),
    prisma.roster.findMany({ select: { playerData: true } }),
  ])

  /*
   * 🛑 THE DENOMINATOR IS ROSTERED PLAYERS, NOT EVERY ROW IN `SportsPlayer`.
   *
   * Measured 2026-09-07, and the first version of this probe got it wrong in a
   * way that made the product look five times worse than it is. `SportsPlayer`
   * holds 24,136 NFL rows / 12,235 distinct names — practice squad, retired
   * players, duplicate rows for one man, and team D/ST entries (the three
   * most-"mentioned" names it found were "seattle seahawks", "dallas cowboys"
   * and "green bay packers"). Nobody opens a card for those. Coverage against
   * that denominator reads 5.3%; against players actually rostered in our
   * leagues — the only ones a card can be opened for — it is 26.0%.
   *
   * A coverage percentage is a claim about a POPULATION. Naming the wrong one
   * turns a mediocre number into an alarming one.
   */
  const rosteredIds = new Set<string>()
  for (const r of rosters) {
    const d = r.playerData as unknown
    const arr = Array.isArray(d) ? d : d && typeof d === 'object' ? Object.values(d as object).flat() : []
    for (const x of arr) {
      if (typeof x === 'string') rosteredIds.add(x)
      else if (x && typeof x === 'object') {
        for (const k of ['player_id', 'playerId', 'sleeperId', 'id']) {
          const v = (x as Record<string, unknown>)[k]
          if (v) { rosteredIds.add(String(v)); break }
        }
      }
    }
  }
  const players = allPlayers.filter((p) => p.sleeperId && rosteredIds.has(p.sleeperId))
  console.log(`news rows: ${news.length}`)
  console.log(`player rows: ${allPlayers.length} total, ${players.length} ROSTERED (from ${rosteredIds.size} distinct rostered ids)`)

  /* ── the player index, keyed on the normalised name ───────────────────── */
  const byNorm = new Map<string, typeof players>()
  for (const p of players) {
    const n = normalizePlayerName(p.name)
    if (!n) continue
    const list = byNorm.get(n)
    if (list) list.push(p)
    else byNorm.set(n, [p])
  }
  console.log(`distinct normalised player names: ${byNorm.size}`)

  // Calibrate the window: how long ARE these names once normalised?
  const lenHist = new Map<number, number>()
  for (const n of byNorm.keys()) {
    const w = n.split(' ').length
    lenHist.set(w, (lenHist.get(w) ?? 0) + 1)
  }
  console.log(
    '  name length (words): ' +
      [...lenHist.entries()].sort((a, b) => a[0] - b[0]).map(([w, c]) => `${w}w=${c}`).join('  ')
  )

  /* ── what the card can serve TODAY ────────────────────────────────────── */
  const reachable = new Set<string>()
  for (const r of news) {
    if (r.playerName) {
      const n = normalizePlayerName(r.playerName)
      if (byNorm.has(n)) reachable.add(n)
    }
    for (const raw of r.playerNames ?? []) {
      // The array arm is an EXACT `has:`, so only an exact string hits today.
      const exact = players.some((p) => p.name === raw)
      if (exact) reachable.add(normalizePlayerName(raw))
    }
  }
  console.log(`\nreachable TODAY: ${reachable.size} players (${pct(reachable.size, byNorm.size)})`)

  /* ── the ceiling: who is NAMED in the text we already hold? ───────────── */
  const mentioned = new Map<string, Set<string>>() // normalised name -> news ids
  for (const r of news) {
    const text = [r.title, r.content, r.description].filter(Boolean).join(' . ')
    const w = words(text)
    for (let size = MIN_WORDS; size <= MAX_WORDS; size++) {
      for (let i = 0; i + size <= w.length; i++) {
        const gram = w.slice(i, i + size).join(' ')
        if (!byNorm.has(gram)) continue
        const set = mentioned.get(gram) ?? new Set<string>()
        set.add(r.id)
        mentioned.set(gram, set)
      }
    }
  }
  console.log(`NAMED anywhere in title/content/description: ${mentioned.size} players (${pct(mentioned.size, byNorm.size)})`)

  const gained = [...mentioned.keys()].filter((n) => !reachable.has(n))
  console.log(`  -> recoverable (named but unreachable today): ${gained.length}`)

  /* ── the risk: how many of those names identify more than one man? ────── */
  /*
   * ⚠ COUNT PEOPLE, NOT ROWS. The first version keyed on `sleeperId`, so three
   * duplicate rows for ONE man ("max iheanachor -> OT/Steelers, OT/Steelers,
   * OT/Steelers") counted as a three-way ambiguity and inflated this to 69.5%.
   * `SportsPlayer` carries 178 known NFL duplicate groups. Two rows are two
   * PEOPLE only when something about them actually differs.
   */
  let ambiguous = 0
  const ambiguousExamples: string[] = []
  for (const n of mentioned.keys()) {
    const rows = byNorm.get(n) ?? []
    const people = new Set(rows.map((r) => `${r.position ?? '?'}|${r.team ?? '?'}`))
    if (people.size > 1) {
      ambiguous++
      if (ambiguousExamples.length < 10) {
        ambiguousExamples.push(`${n} -> ${[...people].join('  vs  ')}`)
      }
    }
  }
  console.log(`\n⚠ GENUINELY ambiguous (two distinct position/team pairs): ${ambiguous} (${pct(ambiguous, mentioned.size)})`)
  for (const e of ambiguousExamples) console.log(`    ${e}`)

  /* ── volume, not just breadth: how many ROWS gain an attribution? ─────── */
  const rowsWithAny = new Set<string>()
  for (const ids of mentioned.values()) for (const id of ids) rowsWithAny.add(id)
  console.log(`\nnews rows naming >=1 real player: ${rowsWithAny.size} of ${news.length} (${pct(rowsWithAny.size, news.length)})`)

  const top = [...mentioned.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 10)
  console.log('  most-mentioned players:')
  for (const [n, ids] of top) console.log(`    ${n}: ${ids.size} items`)

  await prisma.$disconnect()
}

function pct(a: number, b: number): string {
  return b === 0 ? 'n/a' : `${((100 * a) / b).toFixed(1)}%`
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
