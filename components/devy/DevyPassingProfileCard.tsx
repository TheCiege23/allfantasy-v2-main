'use client'

/**
 * The CFBD passing profile — air yards, ADOT, YAC and the short/deep × left/middle/right
 * grid — rendered for one passer.
 *
 * 🛑 EVERY FIGURE SHOWS ITS DENOMINATOR, AND THAT IS THE ENTIRE POINT OF THE COMPONENT.
 * CFBD's air-yard and location coverage is partial: it says so itself, and the measured
 * case is stark. Gunner Stockton, Georgia 2025 — 385 attempts, 153 of them carrying an
 * air-yard value. His ADOT of 7.2 describes 40% of his season. `totalAirYards / attempts`
 * would give 2.88, which is a 2.5x deflation that still reads as a plausible ADOT.
 *
 * So an ADOT rendered alone is not a smaller version of the truth, it is a different
 * claim. This component refuses to print one: `Stat` takes `measured` and `of`, and shows
 * the coverage beside the number every time. A caller cannot accidentally omit it.
 *
 * ⚠ THE SAME RULE GOVERNS THE GRID. Six cells summing to 30 look like a complete tendency
 * chart whether the passer threw 40 measured balls or 400. `located` / `attempts` is
 * therefore rendered as a header on the grid rather than a footnote, and a passer whose
 * plays carried no location at all gets an explicit "not tagged" panel rather than six
 * empty boxes — empty boxes say "he never threw there", which is false.
 *
 * Presentational on purpose: props in, no fetching, no league logic. `/api/legacy/cfb-players?action=passing`
 * returns exactly this shape.
 */

export interface PassLocationCell {
  attempts: number
  completions: number | null
  completionsMeasured: number
  yards: number | null
  yardsMeasured: number
  touchdowns: number | null
  touchdownsMeasured: number
  interceptions: number | null
  interceptionsMeasured: number
}

export interface PassLocations {
  season: number
  attempts: number
  located: number
  grid: Partial<Record<'short' | 'deep', Partial<Record<'left' | 'middle' | 'right', PassLocationCell>>>>
}

export interface PassingProfile {
  name: string
  school: string
  position: string
  season: number | null
  attempts: number | null
  completions: number | null
  airYards: number | null
  adot: number | null
  airYardsAttempts: number | null
  yardsAfterCatch: number | null
  yacCompletions: number | null
  locations: PassLocations | null
  teamPassAdot: number | null
  teamPassYacPerComp: number | null
}

const DEPTHS = ['deep', 'short'] as const
const DIRECTIONS = ['left', 'middle', 'right'] as const

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(digits)
}

/** Coverage as a percentage, or null when there is no denominator to speak of. */
function pct(measured: number | null, of: number | null): number | null {
  if (measured == null || of == null || of <= 0) return null
  return (measured / of) * 100
}

/**
 * One headline figure, with the sample it was computed over.
 *
 * ⚠ `measured` IS NOT OPTIONAL. Making it required is what stops a future caller
 * rendering a bare ADOT — the omission this whole feature exists to prevent, and which
 * production shipped once already with `airYardsAttempts` NULL on every row.
 */
function Stat({
  label,
  value,
  measured,
  of,
  unit,
  compare,
  compareLabel,
}: {
  label: string
  value: number | null
  measured: number | null
  of: number | null
  unit?: string
  compare?: number | null
  compareLabel?: string
}) {
  const coverage = pct(measured, of)
  const thin = coverage != null && coverage < 50
  const delta = value != null && compare != null ? value - compare : null

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="text-xs uppercase tracking-wide text-white/50">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-white">{fmt(value)}</span>
        {unit ? <span className="text-xs text-white/40">{unit}</span> : null}
        {delta != null ? (
          <span
            className={`ml-1 text-xs tabular-nums ${delta >= 0 ? 'text-emerald-300/80' : 'text-amber-300/80'}`}
            title={`${compareLabel ?? 'team'} ${fmt(compare)}`}
          >
            {delta >= 0 ? '+' : ''}
            {fmt(delta)} vs {compareLabel ?? 'team'}
          </span>
        ) : null}
      </div>
      {/* The denominator, always. `—` when the feed gave none, never a silent omission. */}
      <div className={`mt-1 text-xs tabular-nums ${thin ? 'text-amber-300/90' : 'text-white/40'}`}>
        {measured == null || of == null ? (
          'sample unknown'
        ) : (
          <>
            over {measured.toLocaleString()} of {of.toLocaleString()}
            {coverage != null ? ` (${coverage.toFixed(0)}%)` : ''}
          </>
        )}
      </div>
    </div>
  )
}

function LocationGrid({ locations }: { locations: PassLocations }) {
  const coverage = pct(locations.located, locations.attempts)
  const thin = coverage != null && coverage < 50

  // Scale cell shading against the busiest cell so the chart reads as a distribution
  // rather than as absolute volume, which varies hugely by passer.
  let busiest = 0
  for (const d of DEPTHS) {
    for (const dir of DIRECTIONS) {
      const c = locations.grid[d]?.[dir]
      if (c && c.attempts > busiest) busiest = c.attempts
    }
  }

  if (locations.located === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/60">
        <div className="font-medium text-white/80">No location detail</div>
        <p className="mt-1">
          None of this passer&apos;s {locations.attempts.toLocaleString()} attempts carried a depth and
          direction. CFBD tags location only when the play data provides it — so this is
          &ldquo;not recorded&rdquo;, not &ldquo;he never threw there&rdquo;.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-white/50">Where he throws</div>
        <div className={`text-xs tabular-nums ${thin ? 'text-amber-300/90' : 'text-white/40'}`}>
          {locations.located.toLocaleString()} of {locations.attempts.toLocaleString()} attempts placed
          {coverage != null ? ` (${coverage.toFixed(0)}%)` : ''}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[auto_repeat(3,minmax(0,1fr))] gap-1.5">
        <div />
        {DIRECTIONS.map((dir) => (
          <div key={dir} className="text-center text-[11px] uppercase tracking-wide text-white/40">
            {dir}
          </div>
        ))}

        {DEPTHS.map((depth) => (
          <div key={depth} className="contents">
            <div className="flex items-center pr-2 text-[11px] uppercase tracking-wide text-white/40">
              {depth}
            </div>
            {DIRECTIONS.map((dir) => {
              const cell = locations.grid[depth]?.[dir]
              if (!cell) {
                return (
                  <div
                    key={dir}
                    className="rounded border border-dashed border-white/10 p-2 text-center text-xs text-white/25"
                    title="No attempt recorded here"
                  >
                    —
                  </div>
                )
              }
              const share = busiest > 0 ? cell.attempts / busiest : 0
              const compPct =
                cell.completions != null && cell.completionsMeasured > 0
                  ? (cell.completions / cell.completionsMeasured) * 100
                  : null
              const ypa = cell.yards != null && cell.yardsMeasured > 0 ? cell.yards / cell.yardsMeasured : null
              return (
                <div
                  key={dir}
                  className="rounded border border-white/10 p-2 text-center"
                  // Opacity carries the distribution; the number carries the fact.
                  style={{ backgroundColor: `rgba(56, 189, 248, ${0.06 + share * 0.28})` }}
                  title={[
                    `${cell.attempts} attempts`,
                    cell.completions != null ? `${cell.completions}/${cell.completionsMeasured} complete` : 'completions not recorded',
                    ypa != null ? `${ypa.toFixed(1)} yds/att over ${cell.yardsMeasured}` : 'yards not recorded',
                    cell.touchdowns != null ? `${cell.touchdowns} TD` : null,
                    cell.interceptions != null ? `${cell.interceptions} INT` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  <div className="text-sm font-semibold tabular-nums text-white">{cell.attempts}</div>
                  <div className="text-[11px] tabular-nums text-white/50">
                    {compPct != null ? `${compPct.toFixed(0)}%` : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-white/35">
        Attempts, and completion rate over the attempts whose result was recorded. Hover a cell for
        yards, touchdowns and interceptions with their own counts.
      </p>
    </div>
  )
}

export function DevyPassingProfileCard({ profile }: { profile: PassingProfile }) {
  const compPct =
    profile.completions != null && profile.attempts != null && profile.attempts > 0
      ? (profile.completions / profile.attempts) * 100
      : null

  const yacPerComp =
    profile.yardsAfterCatch != null && profile.yacCompletions != null && profile.yacCompletions > 0
      ? profile.yardsAfterCatch / profile.yacCompletions
      : null

  return (
    <section className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-white">{profile.name}</h3>
          <p className="text-xs text-white/50">
            {profile.position} · {profile.school}
            {profile.season != null ? ` · ${profile.season}` : ''}
          </p>
        </div>
        <div className="text-xs tabular-nums text-white/50">
          {profile.completions ?? '—'}/{profile.attempts ?? '—'}
          {compPct != null ? ` · ${compPct.toFixed(1)}%` : ''}
        </div>
      </header>

      <div className="grid gap-2 sm:grid-cols-3">
        <Stat
          label="ADOT"
          value={profile.adot}
          measured={profile.airYardsAttempts}
          of={profile.attempts}
          unit="yds"
          compare={profile.teamPassAdot}
          compareLabel="school"
        />
        <Stat
          label="YAC / completion"
          value={yacPerComp}
          measured={profile.yacCompletions}
          of={profile.completions}
          unit="yds"
          compare={profile.teamPassYacPerComp}
          compareLabel="school"
        />
        <Stat
          label="Air yards"
          value={profile.airYards}
          measured={profile.airYardsAttempts}
          of={profile.attempts}
          unit="total"
        />
      </div>

      {profile.locations ? (
        <LocationGrid locations={profile.locations} />
      ) : (
        <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/60">
          <div className="font-medium text-white/80">No location data</div>
          <p className="mt-1">
            Pass locations come from play-level data and are folded in on a rotating schedule —
            twelve schools a day. This passer&apos;s school has not been swept yet, which is
            different from his plays carrying no location.
          </p>
        </div>
      )}
    </section>
  )
}
