import Link from 'next/link'
import { getLevelIcon } from '@/lib/rank/levels'
import { GRADE_SCALE, type CompareData, type CompareManager, type CompareResult } from '@/lib/core-app/rankings'
import '@/components/core-app/af-rankings-screen.css'

/**
 * Compare managers — handoff 14c.
 *
 * ⚠ THIS DOES NOT REPLACE `/manager-compare`, AND DELIBERATELY SO. That screen
 * is a client component that calls the Sleeper API directly from the browser,
 * which is the db-first boundary the repo's own guard exists to stop. Rather
 * than port that fetching into a new surface, this one compares what the
 * database already holds. The two can be reconciled once the older screen's
 * provider calls move server-side.
 *
 * ⚠ THE SEARCH IS A PLAIN GET FORM. No client JavaScript, so a comparison URL is
 * shareable and the back button behaves. The `FOUND` validation tag in the
 * design is rendered after the round-trip, on a handle that actually resolved,
 * rather than guessed at while typing.
 *
 * ⚠ SEASON-BY-SEASON AND HEAD-TO-HEAD RENDER AS UNANSWERED, NOT AS ZERO. Both
 * need per-season rows scoped to leagues the two managers shared, and the stored
 * career figures are lifetime totals with no league, season or opponent
 * dimension. Build rule 2 says a season one manager sat out is never scored as a
 * loss for them — with nothing per-season to compare, the honest table is an
 * empty one that explains itself.
 */

function initials(handle: string): string {
  return handle.replace(/^@/, '').slice(0, 1).toUpperCase() || '?'
}

function Suspect({ what }: { what: string }) {
  return (
    <span
      className="af-rk-suspect"
      title={`${what} is derived from career counters that contradict each other — this manager's championship and playoff totals exceed their recorded league-seasons.`}
      aria-label={`${what} unreliable`}
    >
      !
    </span>
  )
}

function SearchBar({ value }: { value: string }) {
  return (
    <form className="af-rk-search" action="/core/rankings" method="get">
      <input type="hidden" name="view" value="compare" />
      <label className="af-rk-input">
        <span aria-hidden="true">@</span>
        <input
          type="text"
          name="user"
          defaultValue={value}
          placeholder="username"
          aria-label="Manager username to compare against"
          autoComplete="off"
        />
      </label>
      <button type="submit" className="af-rk-btn af-rk-btn--primary">
        Compare
      </button>
    </form>
  )
}

function ManagerCard({ m, side }: { m: CompareManager; side: 'you' | 'them' }) {
  return (
    <section
      className="af-rk-card"
      style={
        side === 'you'
          ? { background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }
          : undefined
      }
    >
      <div className="af-rk-vsman">
        {m.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="af-rk-crest" src={m.avatarUrl} alt="" width={54} height={54} />
        ) : (
          <span className="af-rk-crest" aria-hidden="true">
            {getLevelIcon(m.tierGroup)}
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          <p className="af-rk-vsname">@{m.handle}</p>
          <p className="af-rk-vsmeta">
            Lvl {m.level} {m.levelName}
            {m.suspect ? '' : ` · ${m.seasons.toLocaleString()} league-seasons`}
          </p>
        </div>
        <div className="af-rk-vsgrade">
          <b>
            {m.grade}
            {m.suspect ? <Suspect what="This grade" /> : null}
          </b>
          <span>{m.gradeScore.toFixed(1)}</span>
        </div>
      </div>
    </section>
  )
}

function LifetimeTable({ data }: { data: CompareData }) {
  return (
    <section className="af-rk-card" style={{ padding: 0, overflowX: 'auto' }}>
      <table className="af-rk-table">
        <thead>
          <tr>
            <th style={{ textAlign: 'right' }}>@{data.you.handle}</th>
            <th style={{ textAlign: 'center' }}>Lifetime</th>
            <th>@{data.them.handle}</th>
          </tr>
        </thead>
        <tbody>
          {data.metrics.map((m) => (
            <tr key={m.label} className={m.signature ? 'sig' : undefined}>
              <td className={`n${m.leader === 'you' ? ' lead' : ''}`}>{m.you}</td>
              <td style={{ textAlign: 'center', color: 'var(--muted)' }}>
                {m.label}
                {m.unavailable ? (
                  <span
                    style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginTop: 3 }}
                  >
                    {m.unavailable}
                  </span>
                ) : null}
              </td>
              <td className={`n${m.leader === 'them' ? ' lead' : ''}`} style={{ textAlign: 'left' }}>
                {m.them}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function pctBar(v: number | null): number {
  return v == null ? 0 : Math.max(0, Math.min(100, Math.round(v * 100)))
}

export function RankingsCompare({
  result,
  query,
}: {
  result: CompareResult | null
  query: string
}) {
  return (
    <div className="af-rk">
      <header className="af-rk-head">
        <div>
          <h1 className="af-rk-title">Compare managers</h1>
          <p className="af-rk-sub">Career against career, on the same scale as everyone else.</p>
        </div>
        <div className="af-rk-headact">
          <SearchBar value={query} />
          <Link className="af-rk-btn" href="/core/rankings">
            ← Rankings
          </Link>
        </div>
      </header>

      {result == null ? (
        <section className="af-rk-card">
          <p className="af-rk-a">
            Enter a manager&apos;s username above. Only managers whose careers have been ranked can be
            compared — the comparison reads the same scored figures the ladder does, so an unranked
            account has nothing to put on the table.
          </p>
        </section>
      ) : !result.ok ? (
        <section className="af-rk-card">
          <h2 className="af-rk-q">No comparison</h2>
          <p className="af-rk-a">{result.message}</p>
          {result.reason === 'not-found' ? (
            <p className="af-rk-note">
              Handles are matched against display names and usernames exactly, without fuzzy
              matching — a near miss is reported as a miss rather than quietly compared against
              somebody else.
            </p>
          ) : null}
        </section>
      ) : (
        <CompareBody data={result.data} />
      )}
    </div>
  )
}

function CompareBody({ data }: { data: CompareData }) {
  return (
    <>
      <div className="af-rk-vs">
        <ManagerCard m={data.you} side="you" />
        <div className="af-rk-vsmid">
          <b>VS</b>
          {/*
            The design puts the raw head-to-head record here. There is no
            opponent ledger behind it, so this says so in the one place a reader
            would otherwise take a number on trust.
          */}
          <span style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.4 }}>
            H2H not recorded
          </span>
        </div>
        <ManagerCard m={data.them} side="them" />
      </div>

      <div className="af-rk-head" style={{ minHeight: 0 }}>
        <span className="af-rk-tab" aria-current="true">
          Lifetime
        </span>
        <span
          style={{ fontSize: 11.5, color: 'var(--faint)', marginLeft: 'auto' }}
          className="af-rk-mono"
        >
          Grade scale {GRADE_SCALE.map((g) => `${g.grade} ${g.min === 0 ? 'below' : g.min}`).join(' · ')}
        </span>
      </div>

      <LifetimeTable data={data} />

      <div className="af-rk-cmpfoot">
        <section className="af-rk-card">
          <p className="af-rk-eyebrow">
            Season by season
            <span className="af-rk-spacer" />
            <span>shared leagues only</span>
          </p>
          {data.sharedSeasons.length === 0 ? (
            <p className="af-rk-empty">{data.sharedSeasonsNote}</p>
          ) : (
            <table className="af-rk-table">
              <tbody>
                {data.sharedSeasons.map((s) => (
                  <tr key={s.season}>
                    <td className="af-rk-mono">{s.season}</td>
                    <td>{s.you}</td>
                    <td>{s.them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="af-rk-note">
            Only seasons both managers actually played would be compared. Years one of you sat out are
            excluded rather than counted as a loss.
          </p>
        </section>

        <div className="af-rk-col">
          {data.verdict ? (
            <section className="af-rk-card">
              <p className="af-rk-eyebrow">The verdict</p>
              <p className="af-rk-verdict-h">{data.verdict.headline}</p>
              <p className="af-rk-a">{data.verdict.body}</p>
            </section>
          ) : null}

          <section className="af-rk-card">
            <p className="af-rk-eyebrow">Head to head</p>
            <p className="af-rk-empty">{data.headToHeadNote}</p>
          </section>

          <section className="af-rk-card">
            <p className="af-rk-eyebrow">Title rate</p>
            <div className="af-rk-ratebar">
              <div className="af-rk-ratebar-l">
                <span>@{data.you.handle}</span>
                <b>{data.titleRate.you == null ? '—' : `${pctBar(data.titleRate.you)}%`}</b>
              </div>
              <div className="af-rk-split">
                <i className="you" style={{ width: `${pctBar(data.titleRate.you)}%` }} />
              </div>
            </div>
            <div className="af-rk-ratebar">
              <div className="af-rk-ratebar-l">
                <span>@{data.them.handle}</span>
                <b>{data.titleRate.them == null ? '—' : `${pctBar(data.titleRate.them)}%`}</b>
              </div>
              <div className="af-rk-split">
                <i className="them" style={{ width: `${pctBar(data.titleRate.them)}%` }} />
              </div>
            </div>
            {/*
              Build rule 5: the denominator is stated in the card, so the ratio
              cannot be misread as a raw title count.
            */}
            <p className="af-rk-note">
              Championships divided by playoff appearances — not by seasons played. A manager who
              never reached the playoffs has no rate rather than a zero.
            </p>
          </section>
        </div>
      </div>
    </>
  )
}
