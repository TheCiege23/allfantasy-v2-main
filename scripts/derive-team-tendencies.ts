/**
 * Coaching spec Phases 2a + 2b — measured play-calling tendencies.
 *
 *   npx tsx scripts/derive-team-tendencies.ts [fromSeason] [toSeason]
 *
 * 2a: PROE, shotgun, no-huddle and pace from nflfastR play-by-play.
 * 2b: play-action, motion, RPO and screen from FTN charting (2022+).
 *
 * Both are free, so the spec says do them in one pass. Participation data
 * (personnel, coverage shell) is deliberately NOT here — it is postseason-delivery
 * only from 2023, so anything built on it cannot update in-season.
 */
import zlib from 'node:zlib'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const PBP = (s: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${s}.csv.gz`
const FTN = (s: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/ftn_charting/ftn_charting_${s}.csv`

const FROM = Number(process.argv[2] ?? 2022)
const TO = Number(process.argv[3] ?? 2025)

/** FTN charting begins in 2022 — earlier seasons get NULLs by coverage, not failure. */
const FTN_FIRST_SEASON = 2022
/** nflfastR `pass_oe` is NA before 2006 (scrambles were not marked). */
const PROE_FIRST_SEASON = 2006

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQ = !inQ
    else if (ch === ',' && !inQ) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

function num(v: string | undefined): number | null {
  if (v == null) return null
  const t = v.trim()
  if (!t || t === 'NA' || t === 'NULL') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

type Acc = {
  neutral: number
  proeSum: number; proeN: number
  shotgun: number; shotgunN: number
  noHuddle: number; noHuddleN: number
  paceSum: number; paceN: number
  pa: number; paN: number
  motion: number; motionN: number
  rpo: number; rpoN: number
  screen: number; screenN: number
}
const blank = (): Acc => ({
  neutral: 0, proeSum: 0, proeN: 0, shotgun: 0, shotgunN: 0, noHuddle: 0, noHuddleN: 0,
  paceSum: 0, paceN: 0, pa: 0, paN: 0, motion: 0, motionN: 0, rpo: 0, rpoN: 0, screen: 0, screenN: 0,
})

async function fetchText(url: string, gunzip: boolean): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return gunzip ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8')
}

async function main() {
  for (let season = FROM; season <= TO; season++) {
    console.log(`\n=== ${season} ===`)

    let pbpText: string
    try {
      pbpText = await fetchText(PBP(season), true)
    } catch (e) {
      console.log(`  pbp unavailable: ${(e as Error).message}`)
      continue
    }

    const lines = pbpText.split('\n')
    const hdr = splitCsvLine(lines[0])
    const col = (n: string) => hdr.indexOf(n)
    const iTeam = col('posteam'), iWp = col('wp'), iQtr = col('qtr')
    const iHalfSec = col('half_seconds_remaining'), iPassOe = col('pass_oe')
    const iShotgun = col('shotgun'), iNoHuddle = col('no_huddle')
    const iPlayType = col('play_type'), iGameId = col('game_id'), iPlayId = col('play_id')
    const iGameSec = col('game_seconds_remaining')

    if (iTeam < 0 || iWp < 0 || iPlayType < 0) {
      console.log('  ⚠ pbp shape drift — required columns missing; skipping')
      continue
    }

    const acc = new Map<string, Acc>()
    // (game_id|play_id) -> team, so FTN rows can be attributed without re-parsing pbp.
    const playTeam = new Map<string, string>()
    let totalPlays = 0
    let prevGameSecByGame = new Map<string, number>()

    for (let i = 1; i < lines.length; i++) {
      const c = splitCsvLine(lines[i])
      if (c.length < 10) continue
      const team = (c[iTeam] || '').trim()
      const playType = (c[iPlayType] || '').trim()
      if (!team || team === 'NA') continue
      if (playType !== 'pass' && playType !== 'run') continue
      totalPlays++

      /*
       * ⚠ NEUTRAL-SCRIPT FILTER, APPLIED BEFORE ANY RATE. Without it, blowouts
       * masquerade as philosophy: a team down 21 throws on every down and reads as
       * "pass-happy" when it is simply losing. This is the single most important
       * line in the derivation.
       */
      const wp = num(c[iWp])
      const qtr = num(c[iQtr])
      const halfSec = num(c[iHalfSec])
      const neutral =
        wp != null && wp >= 0.2 && wp <= 0.8 &&
        qtr != null && qtr <= 3 &&
        !(qtr === 2 && halfSec != null && halfSec < 120)
      if (!neutral) continue

      const a = acc.get(team) ?? blank()
      a.neutral++

      // PROE — NA before 2006, and NULL rows must not be coerced to 0.
      if (season >= PROE_FIRST_SEASON) {
        const oe = num(c[iPassOe])
        if (oe != null) { a.proeSum += oe; a.proeN++ }
      }
      const sg = num(c[iShotgun]); if (sg != null) { a.shotgun += sg; a.shotgunN++ }
      /*
       * ⚠ NO-HUDDLE IS DELIBERATELY NOT DERIVED — THE COLUMN DOES NOT MEAN WHAT IT
       * APPEARS TO. Computing it produced a 2024 spread from WAS 69.3% down to
       * KC 0.0% on neutral-script plays, which is not a football result: no team
       * runs no-huddle on two-thirds of its neutral snaps. Either `no_huddle`
       * encodes something other than a per-play hurry-up flag, or it interacts
       * badly with the neutral-script filter.
       *
       * The 320 rows written before this was caught have been nulled. A stored
       * number that is wrong is worse than an absent one: absence is visible and a
       * plausible-looking rate is not. Re-enable only after establishing what the
       * column actually encodes.
       */

      // Pace: seconds elapsed between consecutive neutral plays in the same game.
      const gid = (c[iGameId] || '').trim()
      const gsec = num(c[iGameSec])
      if (gid && gsec != null) {
        const prev = prevGameSecByGame.get(gid)
        if (prev != null) {
          const delta = prev - gsec
          // Guard against clock stoppages and quarter breaks producing absurd gaps.
          if (delta > 0 && delta < 60) { a.paceSum += delta; a.paceN++ }
        }
        prevGameSecByGame.set(gid, gsec)
      }

      acc.set(team, a)
      if (gid && iPlayId >= 0) playTeam.set(`${gid}|${(c[iPlayId] || '').trim()}`, team)
    }

    console.log(`  pbp: ${totalPlays} run/pass plays, ${[...acc.values()].reduce((s, a) => s + a.neutral, 0)} neutral-script`)

    // ── 2b: FTN charting, 2022+
    if (season >= FTN_FIRST_SEASON) {
      try {
        const ftnText = await fetchText(FTN(season), false)
        const fl = ftnText.split('\n')
        const fh = splitCsvLine(fl[0])
        const fc = (n: string) => fh.indexOf(n)
        const fGid = fc('nflverse_game_id'), fPid = fc('nflverse_play_id')
        const fPa = fc('is_play_action'), fMo = fc('is_motion'), fRpo = fc('is_rpo'), fScr = fc('is_screen_pass')
        if (fGid < 0 || fPid < 0) {
          console.log('  ⚠ FTN shape drift — join keys missing; charting fields left NULL')
        } else {
          let matched = 0
          for (let i = 1; i < fl.length; i++) {
            const c = splitCsvLine(fl[i])
            if (c.length < 5) continue
            const key = `${(c[fGid] || '').trim()}|${(c[fPid] || '').trim()}`
            const team = playTeam.get(key)
            // Only neutral-script plays are in playTeam, so the charting rates
            // share the same denominator as everything else.
            if (!team) continue
            const a = acc.get(team); if (!a) continue
            matched++
            const b = (idx: number) => {
              if (idx < 0) return null
              const v = (c[idx] || '').trim().toUpperCase()
              if (v === 'TRUE' || v === '1') return 1
              if (v === 'FALSE' || v === '0') return 0
              return null
            }
            const pa = b(fPa); if (pa != null) { a.pa += pa; a.paN++ }
            const mo = b(fMo); if (mo != null) { a.motion += mo; a.motionN++ }
            const rp = b(fRpo); if (rp != null) { a.rpo += rp; a.rpoN++ }
            const sc = b(fScr); if (sc != null) { a.screen += sc; a.screenN++ }
          }
          console.log(`  ftn: ${matched} charted plays joined to neutral-script pbp`)
        }
      } catch (e) {
        console.log(`  ftn unavailable: ${(e as Error).message}`)
      }
    } else {
      console.log(`  ftn: skipped — charting starts ${FTN_FIRST_SEASON}`)
    }

    // ── Persist
    const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10000) / 10000 : null)
    let written = 0
    for (const [team, a] of acc) {
      if (a.neutral < 50) continue // too thin to mean anything
      await prisma.teamTendencySeason.upsert({
        where: { teamId_season: { teamId: team, season } },
        update: {},
        create: { teamId: team, season, source: 'NFLFASTR+FTN', neutralPlays: a.neutral },
      })
      await prisma.teamTendencySeason.update({
        where: { teamId_season: { teamId: team, season } },
        data: {
          neutralPlays: a.neutral,
          proe: a.proeN > 0 ? Math.round((a.proeSum / a.proeN) * 100) / 100 : null,
          proeN: a.proeN || null,
          shotgunRate: rate(a.shotgun, a.shotgunN), shotgunN: a.shotgunN || null,
          noHuddleRate: rate(a.noHuddle, a.noHuddleN), noHuddleN: a.noHuddleN || null,
          secPerPlay: a.paceN > 0 ? Math.round((a.paceSum / a.paceN) * 100) / 100 : null,
          secPerPlayN: a.paceN || null,
          playActionRate: rate(a.pa, a.paN), playActionN: a.paN || null,
          motionRate: rate(a.motion, a.motionN), motionN: a.motionN || null,
          rpoRate: rate(a.rpo, a.rpoN), rpoN: a.rpoN || null,
          screenRate: rate(a.screen, a.screenN), screenN: a.screenN || null,
          source: 'NFLFASTR+FTN',
          computedAt: new Date(),
        },
      })
      written++
    }
    console.log(`  wrote ${written} team rows`)
  }

  const total = await prisma.teamTendencySeason.count()
  console.log(`\nTeamTendencySeason rows: ${total}`)
  process.exit(0)
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
