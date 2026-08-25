/**
 * Defensive counterpart to `derive-team-tendencies.ts`.
 *
 *   npx tsx scripts/derive-team-defense-tendencies.ts [fromSeason] [toSeason] [outFile]
 *
 * `TeamTendencySeason` describes what an OFFENSE does. Nothing in this schema describes what
 * a defense does, or what it faces, and both drive individual defensive production: a
 * linebacker behind a run-heavy schedule makes more tackles, and an edge rusher on a
 * blitz-heavy defense gets more chances at the quarterback.
 *
 * Sources are the same free nflverse release files the offensive script already reads:
 *   play_by_play_{season}.csv.gz   defteam, down, distance, play type, clock
 *   ftn_charting_{season}.csv      n_blitzers, n_pass_rushers, n_defense_box  (2022+)
 *
 * ⚠ WRITES A JSON ARTIFACT, NOT THE DATABASE. Whether these columns earn a migration is a
 * question the backtest answers, not this script — see `probe-idp-backtest.ts`. Shipping a
 * table for a signal that has not been shown to improve anything is how schemas rot.
 */
import zlib from 'node:zlib'
import { writeFileSync } from 'node:fs'

const PBP = (s: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${s}.csv.gz`
const FTN = (s: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/ftn_charting/ftn_charting_${s}.csv`

const FROM = Number(process.argv[2] ?? 2024)
const TO = Number(process.argv[3] ?? 2025)
const OUT = process.argv[4] ?? 'data/team-defense-tendencies.json'

/** FTN charting begins in 2022 — earlier seasons get nulls by coverage, not by failure. */
const FTN_FIRST_SEASON = 2022

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQ = !inQ
    else if (ch === ',' && !inQ) {
      out.push(cur)
      cur = ''
    } else cur += ch
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
  /** Every run/pass play faced, unfiltered — the exposure denominator. */
  playsFaced: number
  neutralFaced: number
  passFaced: number
  thirdDownFaced: number
  paceSum: number
  paceN: number
  blitzPlays: number
  blitzN: number
  rushersSum: number
  rushersN: number
  boxSum: number
  boxN: number
}
const blank = (): Acc => ({
  playsFaced: 0,
  neutralFaced: 0,
  passFaced: 0,
  thirdDownFaced: 0,
  paceSum: 0,
  paceN: 0,
  blitzPlays: 0,
  blitzN: 0,
  rushersSum: 0,
  rushersN: 0,
  boxSum: 0,
  boxN: 0,
})

async function fetchText(url: string, gunzip: boolean): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return gunzip ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8')
}

export type DefenseTendency = {
  teamId: string
  season: number
  playsFaced: number
  neutralPlaysFaced: number
  /** Share of neutral plays faced that were passes. Drives DB vs LB opportunity. */
  passRateFaced: number | null
  /** Share of plays faced that were third down. */
  thirdDownRateFaced: number | null
  /** Seconds per play faced — how fast opponents operate against this defense. */
  secPerPlayFaced: number | null
  /**
   * This team's OWN offensive pass rate on neutral plays.
   *
   * Carried on the same row because the consumer needs it for the OPPONENT: a linebacker
   * facing a run-heavy offense sees more tackle opportunity, and a secondary facing a
   * pass-heavy one sees more coverage work.
   */
  offensePassRate: number | null
  /** Share of charted dropbacks on which this defense sent at least one blitzer. */
  blitzRate: number | null
  blitzN: number
  meanPassRushers: number | null
  meanDefendersInBox: number | null
  source: string
}

async function main() {
  const out: DefenseTendency[] = []

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
    const iDef = col('defteam')
    const iPos = col('posteam')
    const iWp = col('wp')
    const iQtr = col('qtr')
    const iHalfSec = col('half_seconds_remaining')
    const iPlayType = col('play_type')
    const iDown = col('down')
    const iGameId = col('game_id')
    const iPlayId = col('play_id')
    const iGameSec = col('game_seconds_remaining')

    if (iDef < 0 || iPlayType < 0) {
      console.log('  ⚠ pbp shape drift — defteam/play_type missing; skipping')
      continue
    }

    const acc = new Map<string, Acc>()
    /*
     * The offensive side of the same plays, keyed by `posteam`.
     *
     * Projecting a defender needs the profile of the offense he FACES this week, not the
     * season-average profile of the offenses his own defense happened to play. Those are
     * different quantities and only one of them is knowable in advance.
     */
    const offense = new Map<string, { neutral: number; pass: number }>()
    /** (game_id|play_id) -> DEFENDING team, so FTN rows attribute to the right side. */
    const playDef = new Map<string, string>()
    const prevGameSec = new Map<string, number>()

    for (let i = 1; i < lines.length; i++) {
      const c = splitCsvLine(lines[i])
      if (c.length < 10) continue
      const team = (c[iDef] || '').trim()
      const playType = (c[iPlayType] || '').trim()
      if (!team || team === 'NA') continue
      if (playType !== 'pass' && playType !== 'run') continue

      const posteam = iPos >= 0 ? (c[iPos] || '').trim() : ''
      const a = acc.get(team) ?? blank()
      a.playsFaced++
      if (num(c[iDown]) === 3) a.thirdDownFaced++

      /*
       * ⚠ THE NEUTRAL-SCRIPT FILTER MATTERS MORE ON DEFENSE, NOT LESS. A defense protecting a
       * three-score lead faces nothing but passes and looks like it is playing a pass-happy
       * schedule; one being run out of the building looks run-heavy. Both are the scoreboard,
       * not the opponent. Same thresholds as the offensive script so the two are comparable.
       */
      const wp = num(c[iWp])
      const qtr = num(c[iQtr])
      const halfSec = num(c[iHalfSec])
      const neutral =
        wp != null &&
        wp >= 0.2 &&
        wp <= 0.8 &&
        qtr != null &&
        qtr <= 3 &&
        !(qtr === 2 && halfSec != null && halfSec < 120)

      if (neutral) {
        a.neutralFaced++
        if (playType === 'pass') a.passFaced++
        if (posteam && posteam !== 'NA') {
          const o = offense.get(posteam) ?? { neutral: 0, pass: 0 }
          o.neutral++
          if (playType === 'pass') o.pass++
          offense.set(posteam, o)
        }

        const gid = (c[iGameId] || '').trim()
        const gsec = num(c[iGameSec])
        if (gid && gsec != null) {
          const prev = prevGameSec.get(gid)
          if (prev != null) {
            const delta = prev - gsec
            if (delta > 0 && delta < 60) {
              a.paceSum += delta
              a.paceN++
            }
          }
          prevGameSec.set(gid, gsec)
        }
      }

      acc.set(team, a)
      const gid = (c[iGameId] || '').trim()
      if (gid && iPlayId >= 0) playDef.set(`${gid}|${(c[iPlayId] || '').trim()}`, team)
    }

    console.log(
      `  pbp: ${[...acc.values()].reduce((s, a) => s + a.playsFaced, 0)} plays faced, ` +
        `${[...acc.values()].reduce((s, a) => s + a.neutralFaced, 0)} neutral`,
    )

    // ── FTN charting: blitzers, pass rushers, box count ────────────────────────────────
    if (season >= FTN_FIRST_SEASON) {
      try {
        const ftnText = await fetchText(FTN(season), false)
        const fl = ftnText.split('\n')
        const fh = splitCsvLine(fl[0])
        const fc = (n: string) => fh.indexOf(n)
        const iFGame = fc('nflverse_game_id')
        const iFPlay = fc('nflverse_play_id')
        const iBlitz = fc('n_blitzers')
        const iRush = fc('n_pass_rushers')
        const iBox = fc('n_defense_box')

        if (iFGame < 0 || iFPlay < 0) {
          console.log('  ⚠ ftn shape drift — join keys missing; skipping charting')
        } else {
          let matched = 0
          for (let i = 1; i < fl.length; i++) {
            const c = splitCsvLine(fl[i])
            if (c.length < 5) continue
            const key = `${(c[iFGame] || '').trim()}|${(c[iFPlay] || '').trim()}`
            const team = playDef.get(key)
            if (!team) continue
            matched++
            const a = acc.get(team) ?? blank()

            const box = num(c[iBox])
            if (box != null) {
              a.boxSum += box
              a.boxN++
            }
            /*
             * ⚠ BLITZ IS ONLY DEFINED ON A DROPBACK. `n_blitzers` is charted on pass plays;
             * counting run plays in the denominator would report every defense as roughly
             * half as aggressive as it is, and the ranking would still look plausible.
             */
            const rushers = num(c[iRush])
            const blitzers = num(c[iBlitz])
            if (rushers != null) {
              a.rushersSum += rushers
              a.rushersN++
            }
            if (blitzers != null) {
              a.blitzN++
              if (blitzers > 0) a.blitzPlays++
            }
            acc.set(team, a)
          }
          console.log(`  ftn: ${matched} charted plays joined to a defense`)
        }
      } catch (e) {
        console.log(`  ftn unavailable: ${(e as Error).message}`)
      }
    }

    for (const [teamId, a] of acc) {
      out.push({
        teamId,
        season,
        playsFaced: a.playsFaced,
        neutralPlaysFaced: a.neutralFaced,
        passRateFaced: a.neutralFaced > 0 ? round(a.passFaced / a.neutralFaced) : null,
        thirdDownRateFaced: a.playsFaced > 0 ? round(a.thirdDownFaced / a.playsFaced) : null,
        secPerPlayFaced: a.paceN > 0 ? round(a.paceSum / a.paceN) : null,
        offensePassRate: (() => {
          const o = offense.get(teamId)
          return o && o.neutral > 0 ? round(o.pass / o.neutral) : null
        })(),
        blitzRate: a.blitzN > 0 ? round(a.blitzPlays / a.blitzN) : null,
        blitzN: a.blitzN,
        meanPassRushers: a.rushersN > 0 ? round(a.rushersSum / a.rushersN) : null,
        meanDefendersInBox: a.boxN > 0 ? round(a.boxSum / a.boxN) : null,
        source: season >= FTN_FIRST_SEASON ? 'NFLFASTR+FTN' : 'NFLFASTR',
      })
    }

    const rows = out.filter((r) => r.season === season)
    const withBlitz = rows.filter((r) => r.blitzRate != null)
    console.log(`  teams: ${rows.length}, with blitz rate: ${withBlitz.length}`)
    const ranked = withBlitz.slice().sort((a, b) => (b.blitzRate ?? 0) - (a.blitzRate ?? 0))
    for (const r of ranked.slice(0, 3)) {
      console.log(`    most blitz  ${r.teamId} ${((r.blitzRate ?? 0) * 100).toFixed(1)}%`)
    }
    for (const r of ranked.slice(-3)) {
      console.log(`    least blitz ${r.teamId} ${((r.blitzRate ?? 0) * 100).toFixed(1)}%`)
    }
  }

  writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8')
  console.log(`\nwrote ${out.length} team-season rows -> ${OUT}`)
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000
}

main().catch((e) => {
  console.error('failed:', e instanceof Error ? e.message.slice(0, 300) : e)
  process.exitCode = 1
})
