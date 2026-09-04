/**
 * MEASUREMENT ONLY — read-only. Proves (or disproves) that resolving player news through the
 * canonical normalizer + PlayerIdentityMap recovers the news items the current raw
 * case-insensitive name join misses.
 *
 * Why this exists before the fix: the current join in `lib/decision-os/world/port.ts` matches
 * `playerName` with `mode: 'insensitive'` and nothing else — no suffix, apostrophe or hyphen
 * handling — while `normalizePlayerName` sits unused in `lib/player-identity/`. This script
 * measures what that costs, so the fix is justified by a number rather than by the fact that a
 * better normalizer exists.
 *
 * ⚠ Uses the JS normalizer, never a SQL copy. CLAUDE.md records a SQL reimplementation of this
 * exact function disagreeing with the real one on 7.2% of players — two implementations of one
 * rule is the bug.
 *
 * Run: npx tsx scripts/measure-news-identity-recovery.ts
 */
import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'

const LOOKBACK_DAYS = 7
const PLACEHOLDERS = ['General Update', 'Preferred Source', '']

async function main() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const news = await prisma.playerNewsRecord.findMany({
    where: { createdAt: { gte: since }, fantasyRelevant: true },
    select: { id: true, sport: true, playerName: true, team: true, source: true },
  })

  const playerScoped = news.filter(
    (n) => n.playerName && !PLACEHOLDERS.includes(n.playerName.trim()),
  )

  // One index per sport, built from the CANONICAL registry rather than the per-source
  // SportsPlayer cache — PlayerIdentityMap is ~98% unique by normalizedName for NFL, where
  // sports_players collides on ~52% of names because it stores one row per provider.
  const sports = Array.from(new Set(playerScoped.map((n) => n.sport.toUpperCase())))
  const indexBySport = new Map<string, Map<string, string[]>>()

  for (const sport of sports) {
    const rows = await prisma.playerIdentityMap.findMany({
      where: { sport },
      select: { id: true, canonicalName: true, currentTeam: true, position: true },
    })
    const idx = new Map<string, string[]>()
    for (const r of rows) {
      const key = normalizePlayerName(r.canonicalName)
      if (!key) continue
      const bucket = idx.get(key)
      if (bucket) bucket.push(r.id)
      else idx.set(key, [r.id])
      // Second key including team, so a collision the name alone cannot settle is
      // resolvable when the news row names a team.
      const t = (r.currentTeam ?? '').trim().toUpperCase()
      if (t) {
        const tkey = `${key}|${t}`
        const tb = idx.get(tkey)
        if (tb) tb.push(r.id)
        else idx.set(tkey, [r.id])
      }
    }
    indexBySport.set(sport, idx)
  }

  // The join as it behaves TODAY: case-insensitive exact string match.
  const rawIndexBySport = new Map<string, Set<string>>()
  for (const sport of sports) {
    const rows = await prisma.playerIdentityMap.findMany({
      where: { sport },
      select: { canonicalName: true },
    })
    rawIndexBySport.set(sport, new Set(rows.map((r) => r.canonicalName.trim().toLowerCase())))
  }

  let rawHit = 0
  let normHit = 0
  let ambiguous = 0
  let stillMissing = 0
  const recoveredSamples: string[] = []
  const missingSamples: string[] = []
  const missingBySource = new Map<string, number>()
  const totalBySource = new Map<string, number>()

  for (const n of playerScoped) {
    const sport = n.sport.toUpperCase()
    const name = (n.playerName ?? '').trim()

    const raw = rawIndexBySport.get(sport)?.has(name.toLowerCase()) ?? false
    if (raw) rawHit++

    const key = normalizePlayerName(name)
    const idx = indexBySport.get(sport)
    const team = (n.team ?? '').trim().toUpperCase()

    // Name alone first; if that collides, let the news row's own team break the tie.
    let bucket = idx?.get(key)
    if (bucket && bucket.length > 1 && team) {
      const byTeam = idx?.get(`${key}|${team}`)
      if (byTeam && byTeam.length === 1) bucket = byTeam
    }

    if (bucket && bucket.length === 1) {
      normHit++
      if (!raw && recoveredSamples.length < 12) recoveredSamples.push(`${name} [${sport}]`)
    } else if (bucket && bucket.length > 1) {
      // Deliberately NOT resolved. Attaching news to the wrong player is worse than no match.
      ambiguous++
    } else {
      stillMissing++
      const src = n.source ?? 'unknown'
      missingBySource.set(src, (missingBySource.get(src) ?? 0) + 1)
      if (missingSamples.length < 12) missingSamples.push(`${name} [${sport}]`)
    }
    const src0 = n.source ?? 'unknown'
    totalBySource.set(src0, (totalBySource.get(src0) ?? 0) + 1)
  }

  const total = playerScoped.length
  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`

  console.log(`\nplayer-scoped fantasy-relevant news, last ${LOOKBACK_DAYS}d: ${total}`)
  console.log(`  matched TODAY  (raw case-insensitive) : ${rawHit}  ${pct(rawHit)}`)
  console.log(`  matched WITH normalizer + registry     : ${normHit}  ${pct(normHit)}`)
  console.log(`  RECOVERED by the fix                   : ${normHit - rawHit}`)
  console.log(`  ambiguous (>1 player, left unresolved) : ${ambiguous}`)
  console.log(`  still unmatched                        : ${stillMissing}  ${pct(stillMissing)}`)

  if (recoveredSamples.length) {
    console.log(`\n  recovered examples:`)
    for (const s of recoveredSamples) console.log(`    + ${s}`)
  }
  if (missingSamples.length) {
    console.log(`\n  still-missing examples (is this a player at all?):`)
    for (const s of missingSamples) console.log(`    - ${s}`)
  }
  console.log(`
  unmatched by SOURCE (where the bad names come from):`)
  const rows = [...totalBySource.entries()].sort((a, b) => b[1] - a[1])
  for (const [src, tot] of rows) {
    const miss = missingBySource.get(src) ?? 0
    const rate = tot ? ((miss / tot) * 100).toFixed(0) : '0'
    console.log(`    ${src.padEnd(22)} ${String(miss).padStart(4)} / ${String(tot).padStart(4)}  ${rate}% unmatched`)
  }
  console.log('')
}

main()
  .catch((e) => {
    console.error('ERROR:', e?.message ?? e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
