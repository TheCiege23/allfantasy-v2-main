import type { ReactNode } from 'react'
import { runNflRedraftFullSeasonSimulation } from '@/lib/redraft-season-simulation/canonicalNflRedraftFullSeasonSimulation'

function formatScore(score: number | null | undefined): string {
  if (score == null) return '-'
  return score.toFixed(2)
}

function labelForInvariant(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (char) => char.toUpperCase())
}

export default function G43NflRedraftFullSeasonHarness() {
  const result = runNflRedraftFullSeasonSimulation()
  const finalWeek = result.weeklyResults[result.weeklyResults.length - 1]
  const champion = result.rosterSummaries.find((team) => team.rosterId === result.playoffs.championRosterId)
  const eventTypes = Array.from(new Set(result.events.map((event) => event.type)))

  return (
    <main className="min-h-screen bg-[#061015] px-4 py-5 text-white sm:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="g43-full-season-harness">
        <header className="border border-white/10 bg-white/[0.04] p-4" data-testid="g43-league-home">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-200/75">AF NFL Redraft League</p>
          <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-black sm:text-3xl">G43 Full Season Runtime Proof</h1>
              <p className="mt-2 max-w-3xl text-sm text-white/60">
                Deterministic canonical simulation for league setup, draft, rosters, schedule, scoring, waivers, trades,
                communication, playoffs, champion, and final history.
              </p>
            </div>
            <div className="border border-emerald-300/25 bg-emerald-300/10 px-4 py-3" data-testid="g43-playoff-champion">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-100/70">Champion Crowned</p>
              <p className="mt-1 text-xl font-black text-emerald-100">{champion?.displayName ?? result.playoffs.championRosterId}</p>
            </div>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-4" data-testid="g43-season-summary">
          <Stat testId="g43-draft-complete" label="Draft" value={result.draft.completed ? 'Complete' : 'Open'} />
          <Stat label="Rosters" value={`${result.rosterSummaries.length} valid`} />
          <Stat label="Weeks Scored" value={String(result.weeklyResults.length)} />
          <Stat label="Events" value={String(result.events.length)} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]" data-testid="g43-mobile-layout">
          <Panel title="Rosters" testId="g43-roster-visible">
            <div className="grid gap-3 sm:grid-cols-2">
              {result.rosterSummaries.map((team) => (
                <article key={team.rosterId} className="border border-white/10 bg-black/20 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-base font-black">{team.displayName}</h2>
                      <p className="mt-1 text-xs text-white/55">
                        {team.starters.length} starters, {team.bench.length} bench
                      </p>
                    </div>
                    <StatusPill ok={team.valid} label={team.valid ? 'Valid' : 'Invalid'} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {team.starters.map((playerId) => (
                      <span key={playerId} className="border border-white/10 bg-white/[0.05] px-2 py-1 text-xs text-white/75">
                        {playerId}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </Panel>

          <Panel title="Invariants" testId="g43-invariants">
            <div className="grid gap-2">
              {Object.entries(result.invariants).map(([key, ok]) => (
                <div key={key} className="flex items-center justify-between gap-3 border border-white/10 bg-black/20 px-3 py-2" data-testid="g43-invariant-row">
                  <span className="text-sm text-white/75">{labelForInvariant(key)}</span>
                  <StatusPill ok={ok} label={ok ? 'Passed' : 'Failed'} />
                </div>
              ))}
            </div>
          </Panel>
        </section>

        <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <Panel title="Schedule" testId="g43-schedule-visible">
            <div className="grid gap-2">
              {result.schedule.matchups.map((matchup) => (
                <div key={matchup.id} className="grid grid-cols-[4rem_1fr] gap-2 border border-white/10 bg-black/20 px-3 py-2 text-sm">
                  <span className="font-bold text-cyan-100">W{matchup.week}</span>
                  <span className="text-white/75">
                    {matchup.homeRosterId} vs {matchup.awayRosterId ?? 'bye'}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Matchups And Standings" testId="g43-matchup-visible">
            <div className="space-y-3">
              {result.weeklyResults.map((week) => (
                <article key={week.week} className="border border-white/10 bg-black/20 p-3">
                  <h2 className="text-sm font-black uppercase tracking-[0.12em] text-white/65">Week {week.week}</h2>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {week.matchupScores.map((matchup) => (
                      <div key={matchup.matchupId} className="bg-white/[0.04] px-3 py-2 text-sm">
                        <p className="font-bold text-white/85">
                          {matchup.homeRosterId} {formatScore(matchup.homeScore)}
                        </p>
                        <p className="text-white/65">
                          {matchup.awayRosterId ?? 'bye'} {formatScore(matchup.awayScore)}
                        </p>
                        <p className="mt-1 text-xs text-emerald-100/75">Winner: {matchup.winnerRosterId}</p>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
              <div className="border border-white/10 bg-black/20 p-3" data-testid="g43-standings-visible">
                <h2 className="text-sm font-black uppercase tracking-[0.12em] text-white/65">Final Standings</h2>
                <div className="mt-2 grid gap-2">
                  {finalWeek?.standings.map((standing) => (
                    <div key={standing.rosterId} className="grid grid-cols-[2rem_1fr_auto] gap-2 text-sm text-white/75">
                      <span>{standing.playoffSeed}</span>
                      <span>{standing.rosterId}</span>
                      <span>
                        {standing.wins}-{standing.losses}-{standing.ties}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <Panel title="Waiver Flow" testId="g43-waiver-flow">
            <TimelineItem label="Processed" value={result.waiver.processed ? 'Yes' : 'No'} />
            <TimelineItem label="Added" value={result.waiver.addedPlayerId} />
            <TimelineItem label="Dropped" value={result.waiver.droppedPlayerId} />
          </Panel>

          <Panel title="Trade Flow" testId="g43-trade-flow">
            <TimelineItem label="Processed" value={result.trade.processed ? 'Yes' : 'No'} />
            <TimelineItem label="Proposal" value={result.trade.proposalId} />
            <TimelineItem label="Moved" value={result.trade.movedPlayerIds.join(', ')} />
          </Panel>

          <Panel title="Notification Feed" testId="g43-notification-feed">
            <TimelineItem label="Notifications" value={String(result.communication.notificationCount)} />
            <TimelineItem label="Feed items" value={String(result.communication.feedCount)} />
            <TimelineItem label="Chat mirrors" value={String(result.communication.chatCount)} />
          </Panel>
        </section>

        <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <Panel title="Playoffs" testId="g43-playoff-visible">
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-black uppercase tracking-[0.12em] text-white/65">Seeds</h2>
                <div className="mt-2 grid gap-2">
                  {result.playoffs.seeds.map((seed) => (
                    <div key={seed.rosterId} className="flex justify-between border border-white/10 bg-black/20 px-3 py-2 text-sm">
                      <span>Seed {seed.seed}</span>
                      <span>{seed.rosterId}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="text-sm font-black uppercase tracking-[0.12em] text-white/65">Final History</h2>
                <p className="mt-2 text-sm text-white/75">
                  {result.leagueHistory.championName} recorded as the {result.leagueHistory.season} champion.
                </p>
              </div>
            </div>
          </Panel>

          <Panel title="Canonical Events" testId="g43-canonical-events">
            <div className="flex flex-wrap gap-1.5">
              {eventTypes.map((type) => (
                <span key={type} className="border border-white/10 bg-white/[0.05] px-2 py-1 text-xs text-white/75">
                  {type}
                </span>
              ))}
            </div>
          </Panel>
        </section>
      </div>
    </main>
  )
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="border border-white/10 bg-white/[0.035] p-3" data-testid={testId}>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/45">{label}</p>
      <p className="mt-1 text-xl font-black">{value}</p>
    </div>
  )
}

function Panel({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <section className="border border-white/10 bg-white/[0.035] p-4" data-testid={testId}>
      <h2 className="mb-3 text-sm font-black uppercase tracking-[0.14em] text-white/65">{title}</h2>
      {children}
    </section>
  )
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? 'bg-emerald-300/15 px-2 py-1 text-xs font-bold text-emerald-100' : 'bg-rose-300/15 px-2 py-1 text-xs font-bold text-rose-100'}>
      {label}
    </span>
  )
}

function TimelineItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-white/10 bg-black/20 px-3 py-2">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-white/45">{label}</p>
      <p className="mt-1 break-words text-sm font-bold text-white/80">{value}</p>
    </div>
  )
}
