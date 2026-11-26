import Link from 'next/link'
import type { LeagueGroupView } from '@/lib/league-groups/leagueGroups'

/**
 * The body of /league-groups. `groups === null` means the read failed, which is said plainly: an empty
 * list would claim "no groups" for someone who has some.
 * Styled by app/tournament-hub/[tournamentId]/tournament-hub.css, which the page imports.
 */
function teamsLabel(n: number | null): string | null {
  return n ? `${n} teams` : null
}

export function LeagueGroupsView({ groups }: { groups: LeagueGroupView[] | null }) {
  return (
    <main className="af-th">
      <div className="af-th-topbar">
        <span className="af-th-brand-word">LEAGUE GROUPS</span>
        <div className="af-th-brand">
          <span className="af-th-brand-mark" aria-hidden="true">AF</span>
          <span className="af-th-brand-word">ALLFANTASY</span>
        </div>
      </div>

      <header className="af-th-head">
        <div className="af-th-identity">
          <div>
            <h1 className="af-th-title">Your league groups</h1>
            <p className="af-th-sub">Leagues your commissioner keeps together, in one place.</p>
          </div>
        </div>
      </header>

      {groups === null ? (
        <section className="af-th-league" data-testid="league-groups-error">
          <h2 className="af-th-league-name">Could not read your leagues</h2>
          <p className="af-th-note">Nothing has changed. Try again in a minute.</p>
        </section>
      ) : groups.length === 0 ? (
        <section className="af-th-league" data-testid="league-groups-empty">
          <h2 className="af-th-league-name">No groups yet</h2>
          <p className="af-th-note">
            A commissioner makes one from each league&apos;s settings: League format → League group, with the same
            name on every league that belongs.
          </p>
        </section>
      ) : (
        groups.map((g) => (
          // `main` spaces its own children; a group's cards sit inside this section, so it spaces them itself,
          // a little tighter than the 18px between groups.
          <section key={g.key} data-testid="league-group" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 className="af-th-league-name">
              {g.name}
              <span className="af-th-linknote">
                {g.leagues.length} {g.leagues.length === 1 ? 'league' : 'leagues'}
                {g.yours ? ' · yours' : ''}
              </span>
            </h2>
            {g.leagues.map((l) => (
              <Link key={l.id} href={`/league/${l.id}`} className="af-th-league af-th-card">
                <h3 className="af-th-league-name">
                  {l.name}
                  {l.youCommission ? <span className="af-th-linknote">commissioner</span> : null}
                </h3>
                <p className="af-th-pick-meta">
                  {[l.sport, l.platform, teamsLabel(l.teams), String(l.season)].filter(Boolean).join(' · ')}
                </p>
              </Link>
            ))}
          </section>
        ))
      )}
    </main>
  )
}
