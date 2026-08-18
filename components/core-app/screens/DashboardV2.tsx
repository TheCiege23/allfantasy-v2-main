import { LeaguePanel } from '@/components/core-app/dash-v2/LeaguePanel'
import { SectionHeader } from '@/components/core-app/dash-v2/SectionHeader'
import type { Dash34Data } from '@/components/core-app/screens/Dashboard34'
// af-core.css carries the .af-core token layer. This screen renders OUTSIDE
// AfCoreShell (it brings its own left panel), so the shell does not import it
// here — without this line every var(--surface) / var(--line) below computes to
// nothing and the page paints as text on a void. That exact failure shipped on
// the landing page and on /login before being caught, so it is loaded explicitly.
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-dash-v2.css'

/**
 * Dashboard v2 — shell slice.
 *
 * This is the structural half of the v2 handoff: the 300px league panel and the
 * section-header system every module drops into. The modules themselves (season
 * timeline, today's priorities, draft HQ, your week, needs your call, portfolio,
 * exposure, legacy) are not built here yet; each section below is present with a
 * real header and an explicit statement of what it is waiting on.
 *
 * ⚠ THE PLACEHOLDER LINES ARE DELIBERATE AND SPECIFIC. They name the missing
 * source rather than saying "Loading…" — the handoff's own build rule is that no
 * module ships a loading or empty state, and a vague placeholder is how a screen
 * ends up looking broken rather than honest. Where a number cannot be shown, the
 * reason is the copy.
 */
export function DashboardV2({
  data,
  weekLabel = null,
}: {
  data: Dash34Data | null
  /** From the loader's result, not from Dash34Data — passed in rather than
   *  widening this prop to the server-only return type. */
  weekLabel?: string | null
}) {
  const leagues = data?.leagues ?? []
  const total = data?.totalLeagues ?? 0
  const quiet = data?.quiet ?? null

  return (
    <div className="af-core af-d2 af-d2-shell">
      <LeaguePanel
        leagues={leagues}
        totalLeagues={total}
        /*
         * `quiet` only — never quiet + overflow. The Dash34Data type carries an
         * explicit warning that adding them printed "53 leagues are quiet —
         * nothing needs you" over an account where nearly all 53 had a flagged
         * starter. An overflowed league is hidden by a list cap; a quiet one has
         * been looked at and cleared. They are different claims.
         */
        quietSummary={
          quiet && quiet.count > 0
            ? {
                count: quiet.count,
                text: quiet.sample
                  ? `${quiet.sample} — nothing needs you.`
                  : `${quiet.count} ${quiet.count === 1 ? 'league is' : 'leagues are'} quiet — nothing needs you.`,
              }
            : null
        }
      />

      <main className="af-d2-main">
        <section>
          <SectionHeader label="Season timeline" counter={weekLabel} />
          <div className="af-d2-card">
            <p className="af-d2-empty">
              Timeline nodes are derived from each league&rsquo;s season dates. Not wired
              yet — this is the next module.
            </p>
          </div>
        </section>

        <section>
          <SectionHeader
            label="Today's priorities"
            counter={leagues.length > 0 ? `${leagues.length} LEAGUES RANKED` : null}
          />
          <div className="af-d2-card">
            <p className="af-d2-empty">
              Ranked by what needs you first, using the signals that exist today: an
              unavailable starter, a draft in progress, and being the commissioner.
              Live scores are not among them — no league has ever synced, so no
              result is on file to rank against.
            </p>
          </div>
        </section>

        <section>
          <SectionHeader label="Draft Season HQ" />
          <div className="af-d2-card">
            <p className="af-d2-empty">
              Draft states come from the draft-HQ loader, which already exists. Not
              composed into this screen yet.
            </p>
          </div>
        </section>

        <section>
          <SectionHeader label="Your week — every matchup" />
          <div className="af-d2-card">
            <p className="af-d2-empty">
              Win probability needs a projection per matchup. The projection loader
              exists; the matchup results it scores against do not — 0 of 893 team
              rows carry a result.
            </p>
          </div>
        </section>

        <section>
          <SectionHeader label="Portfolio — roster market value" />
          <div className="af-d2-card">
            <p className="af-d2-empty">
              Backed by the existing portfolio loader. Not composed into this screen
              yet.
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}

export default DashboardV2
