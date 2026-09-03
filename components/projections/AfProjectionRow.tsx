'use client'

/**
 * Phase 6.1 — one projection, with its basis, confidence and reason.
 *
 * ── 🛑 THE TWO NUMBERS ARE DIFFERENT UNITS AND ARE NEVER SHOWN IN ONE COLUMN ───────────────
 * `perGame` is points per game. `restOfSeason` is a season total. Confusing them understates a
 * player by roughly the number of weeks remaining — the 17× error the entire projections audit
 * began with, and one that looks completely plausible on screen. So they get separate columns,
 * separate labels, and the rest-of-season figure carries its week count.
 *
 * ── 🛑 A MISSING REST-OF-SEASON IS A DASH, NEVER A ZERO ────────────────────────────────────
 * The schema says it outright: null means "not computed", and 0 is a real claim the value engine
 * acts on. The census found this null on all 19,556 rows before the writer was fixed — a surface
 * rendering `0` would have told every manager their whole league was projected to score nothing.
 */

export interface AfProjectionView {
  playerId: string
  playerName: string
  position: string
  week: number | null
  perGame: number
  baseline: number
  weatherAdjustment: number
  restOfSeason: number | null
  restOfSeasonWeeks: number | null
  confidence: string
  reason: string | null
  isOutdoorGame: boolean
  computedAt: string
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  medium: 'border-sky-400/25 bg-sky-400/10 text-sky-200',
  low: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
}

const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })

export function AfProjectionRow({ p }: { p: AfProjectionView }) {
  const conf = p.confidence?.toLowerCase() ?? 'medium'
  const weather = Math.abs(p.weatherAdjustment) >= 0.05 ? p.weatherAdjustment : 0

  return (
    <li className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5" data-testid="af-proj-row">
      <div className="flex items-baseline gap-2">
        <span className="flex-1 truncate text-[12px] font-medium text-white">
          {p.playerName}
          <span className="ml-1.5 text-[10px] text-white/35">{p.position}</span>
          {p.week != null ? (
            <span className="ml-1.5 text-[10px] text-white/30">wk {p.week}</span>
          ) : (
            /*
             * ⚠ SAY WHICH ROW THIS IS. A season baseline and a week-scoped row are different
             * claims, and an unlabelled number invites the reader to assume the more specific one.
             */
            <span className="ml-1.5 text-[10px] text-white/30">season baseline</span>
          )}
        </span>

        <span className="w-16 text-right" data-testid="af-proj-pergame">
          <span className="text-[14px] font-bold tabular-nums text-white">{num(p.perGame)}</span>
          <span className="ml-0.5 text-[9px] text-white/35">/gm</span>
        </span>

        <span className="w-20 text-right" data-testid="af-proj-ros">
          {p.restOfSeason == null ? (
            /*
             * Not "0". See the header — and the title tells a curious reader why rather than
             * leaving a bare dash to be read as zero anyway.
             */
            <span
              className="text-[12px] text-white/25"
              title="Rest-of-season has not been computed for this player. This is not a projection of zero."
            >
              —
            </span>
          ) : (
            <>
              <span className="text-[13px] font-semibold tabular-nums text-white/85">
                {num(p.restOfSeason)}
              </span>
              <span className="ml-0.5 text-[9px] text-white/35">
                {p.restOfSeasonWeeks != null ? `/${p.restOfSeasonWeeks}wk` : 'ROS'}
              </span>
            </>
          )}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
            CONFIDENCE_STYLE[conf] ?? CONFIDENCE_STYLE.medium
          }`}
          data-testid="af-proj-confidence"
        >
          {conf} confidence
        </span>

        {/*
          * The basis, shown as an arithmetic the reader can check: baseline, then what weather did
          * to it. A single figure with no derivation is the thing this phase exists to replace.
          */}
        <span className="text-[9px] text-white/35" data-testid="af-proj-basis">
          {num(p.baseline)} baseline
          {weather !== 0 ? (
            <>
              {' '}
              <span className={weather > 0 ? 'text-emerald-300/70' : 'text-amber-300/70'}>
                {weather > 0 ? '+' : ''}
                {num(weather)} weather
              </span>
            </>
          ) : p.isOutdoorGame ? (
            <span className="text-white/25"> · weather considered, no change</span>
          ) : (
            <span className="text-white/25"> · indoors, weather not applied</span>
          )}
        </span>
      </div>

      {p.reason ? (
        <p className="mt-1 text-[10px] text-white/45" data-testid="af-proj-reason">
          {p.reason}
        </p>
      ) : null}
    </li>
  )
}
