import Link from 'next/link'

/**
 * 8a — Draft HQ.
 *
 * ⚠ EVERY NUMBER ON THIS SCREEN IS THIS LEAGUE'S (handoff build rule 1). Lottery odds come from
 * `previewLotteryOdds` against this league's real standings; the queue is the manager's own saved
 * shortlist for this league's draft; the settings are read from the league. Nothing here is a
 * universal big board or a generic mock ADP.
 *
 * ⚠ PICK OWNERSHIP COMES FROM THE SAME RESOLVER THE LIVE BOARD USES.
 * The inventory is built with `resolvePickOwner`, so a pick labelled "from @dre" here is labelled
 * the same way on the draft board once the room opens. (An earlier version of this file claimed
 * pick ownership was not modelled. It is — `lib/live-draft-engine/PickOwnershipResolver` handles
 * traded picks — and that claim was wrong.)
 *
 * ⚠ WHAT IS NOT BUILT, AND WHY — the honest half of the handoff.
 *   Chimmy verdict   An AI generation, and AI is gated at the provider boundary and on-demand
 *                    only. A canned "your roster is a WR away from a title window" would be
 *                    fabricated analysis on a planning screen — the worst place for it.
 *   confidence       The handoff scores each queue row 89/81/68. That is
 *                    RecommendationEngine output, which needs the live player pool and this
 *                    manager's roster loaded; wiring it is real work, not a formatting pass, and
 *                    a made-up number would drive the sort order AND the colour.
 *   need bars        Same source (`needScore`), same reason.
 * Each is omitted rather than mocked. The screen says what it knows.
 */

export type DraftHQData = {
  leagueId: string
  leagueName: string
  platform: string | null
  settings: {
    leagueType: string | null
    teamCount: number | null
    orderMode: string
    lotteryPickCount: number | null
  }
  lottery: {
    pickCount: number
    playoffTeamCount: number
    alreadyRunAt: string | null
    message: string | null
    teams: {
      rosterId: string
      name: string
      record: string
      weight: number
      oddsPercent: number
      isViewer: boolean
    }[]
  } | null
  queue: { id: string; rank: number; playerName: string; position: string | null; team: string | null }[]
  lastMock: { id: string; createdAt: string; rounds: number } | null
  viewerHasRoster: boolean
  /** Slots this manager holds, traded picks included. Empty when the order isn't set yet. */
  pickInventory: { label: string; round: number; acquiredFrom: string | null }[]
  /**
   * Per-position strength, already INVERTED from the engine's need scale: high = solved,
   * low = hole. Null when the roster could not be resolved — never a guess.
   */
  positionalNeed: {
    rows: { position: string; solved: number }[]
    resolvedPlayers: number
    rosterSize: number
  } | null
  /**
   * Per-queue-row confidence from the recommendation engine, keyed by queue row id.
   * `unavailable` carries WHY, because "no score" and "pool still warming" are different
   * answers and a manager deserves to know which one they are looking at.
   */
  queueConfidence:
    | { status: 'ready'; scores: Record<string, number>; matched: number; total: number }
    | { status: 'unavailable'; reason: 'no_queue' | 'pool_cold' | 'pool_empty' }
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function relativeDay(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 'recently'
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export default function DraftHQ({ data }: { data: DraftHQData }) {
  const { lottery, queue, settings, lastMock, pickInventory, positionalNeed, queueConfidence } =
    data

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-[-0.02em] text-white">
            Draft HQ · {data.leagueName}
          </h1>
          <p className="mt-1 text-sm text-white/55">
            Planning surface. Nothing here changes your draft order.
          </p>
        </div>
        <span className="rounded-lg border border-white/10 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
          Read-only
        </span>
      </div>

      {/*
        Pick inventory. Rendered only when the draft order actually exists — before slots are set
        there is no such thing as "your 1.04", and a placeholder row would invent one.
      */}
      {pickInventory.length > 0 ? (
        <div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          data-testid="pick-inventory"
        >
          {pickInventory.map((p) => (
            <div
              key={p.label}
              className={`rounded-2xl border px-4 py-3 ${
                p.acquiredFrom
                  ? 'border-white/10 bg-white/[0.03]'
                  : 'border-cyan-400/40 bg-cyan-400/[0.07]'
              }`}
            >
              <span className="block font-mono text-lg font-black tracking-[-0.01em] text-white">
                {p.label}
              </span>
              <span className="mt-0.5 block text-xs text-white/50">
                {p.acquiredFrom ? `From ${p.acquiredFrom}` : `Round ${p.round} · your own`}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          {/* ── Weighted lottery ─────────────────────────────────────── */}
          {lottery ? (
            <Card title={`Weighted lottery · top ${lottery.pickCount} picks`}>
              {/*
                Handoff build rule 3: teams already in playoff position are never shown lottery
                balls. The engine's eligibility selection has already excluded them, and the note
                says so plainly rather than leaving a manager to infer why they are absent.
              */}
              <p className="rounded-xl bg-white/[0.04] px-3 py-2 text-xs leading-relaxed text-white/60">
                Non-playoff teams only. Picks {lottery.pickCount + 1}–{settings.teamCount ?? '—'} go
                to the {lottery.playoffTeamCount} playoff teams in reverse finish order.
                {lottery.alreadyRunAt ? ' This league has already run its lottery.' : ''}
              </p>

              {lottery.message ? (
                <p className="mt-3 text-sm text-white/50">{lottery.message}</p>
              ) : (
                <table className="mt-3 w-full text-sm" data-testid="lottery-odds-table">
                  <thead>
                    <tr className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
                      <th className="pb-2 text-left font-bold">Team</th>
                      <th className="pb-2 text-right font-bold">Record</th>
                      <th className="pb-2 text-right font-bold">Balls</th>
                      <th className="pb-2 text-right font-bold">Odds #1</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lottery.teams.map((t) => (
                      <tr
                        key={t.rosterId}
                        className={`border-t border-white/5 ${t.isViewer ? 'bg-cyan-400/[0.08]' : ''}`}
                        data-testid={`lottery-row-${t.rosterId}`}
                      >
                        <td className={`py-2 font-bold ${t.isViewer ? 'text-cyan-300' : 'text-white'}`}>
                          {t.name}
                          {t.isViewer ? <span className="ml-2 text-xs text-white/45">you</span> : null}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums text-white/70">
                          {t.record}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums text-white/70">
                          {t.weight}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums font-bold text-white">
                          {t.oddsPercent.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/*
                Handoff build rule 2. The lottery runs from a recorded seed so the result can be
                re-checked afterwards, only the commissioner can run it, and it cannot be undone —
                which is exactly why this screen only ever previews.
              */}
              <p className="mt-3 text-xs text-white/40">
                Commissioner runs the lottery · the result is seeded and auditable. These are
                current odds, not a draw.
              </p>
            </Card>
          ) : (
            <Card title="Draft order">
              <p className="text-sm text-white/60">
                This league sets its draft order by{' '}
                <span className="font-bold text-white">{settings.orderMode.replace(/_/g, ' ')}</span>
                , so there are no lottery odds to show.
              </p>
            </Card>
          )}

          {/* ── Prepared queue ───────────────────────────────────────── */}
          <Card title="Your prepared queue">
            {!data.viewerHasRoster ? (
              <p className="text-sm text-white/50">
                You don&apos;t have a roster in this league, so there&apos;s no queue to prepare.
              </p>
            ) : queue.length === 0 ? (
              <p className="text-sm text-white/50">
                Nothing queued yet. Players you add before the draft appear here in your order, and
                the room reads this list first when you&apos;re on the clock.
              </p>
            ) : (
              <ol className="space-y-1" data-testid="prepared-queue">
                {queue.map((q) => (
                  <li
                    key={q.id}
                    className="flex items-center gap-3 rounded-xl border border-white/5 px-3 py-2"
                  >
                    <span className="w-6 shrink-0 font-mono text-xs text-white/40">{q.rank}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold text-white">{q.playerName}</span>
                      {q.position || q.team ? (
                        <span className="block truncate text-xs text-white/45">
                          {[q.position, q.team].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                    </span>
                    {/*
                      Handoff: >=80 reads good, below reads borderline. A player the pool did not
                      match shows a dash rather than inheriting a neighbour's number.
                    */}
                    {queueConfidence.status === 'ready' ? (
                      <span
                        data-testid={`queue-confidence-${q.id}`}
                        className={`shrink-0 font-mono text-xs font-bold tabular-nums ${
                          queueConfidence.scores[q.id] == null
                            ? 'text-white/25'
                            : queueConfidence.scores[q.id] >= 80
                              ? 'text-emerald-400'
                              : 'text-amber-400'
                        }`}
                      >
                        {queueConfidence.scores[q.id] ?? '—'}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
            {queue.length > 0 && queueConfidence.status === 'ready' ? (
              <p className="mt-3 text-xs text-white/40">
                Confidence is this league&apos;s scoring and your roster holes, from the same engine
                the draft room uses.
                {queueConfidence.matched < queueConfidence.total
                  ? ` ${queueConfidence.matched} of ${queueConfidence.total} matched the current player pool.`
                  : ''}
              </p>
            ) : null}
            {queue.length > 0 && queueConfidence.status === 'unavailable' &&
            queueConfidence.reason === 'pool_cold' ? (
              <p className="mt-3 text-xs text-white/40">
                Confidence scores aren&apos;t ready — the player pool is still warming up. They
                appear next time you open this page.
              </p>
            ) : null}
          </Card>
        </div>

        {/* ── Right column ───────────────────────────────────────────── */}
        <aside className="space-y-5">
          <Card title="Draft settings">
            <dl className="space-y-2 text-sm">
              {[
                ['Format', settings.leagueType ?? '—'],
                ['Teams', settings.teamCount != null ? String(settings.teamCount) : '—'],
                ['Order', settings.orderMode.replace(/_/g, ' ')],
                ...(settings.lotteryPickCount != null
                  ? ([['Lottery picks', `Top ${settings.lotteryPickCount}`]] as [string, string][])
                  : []),
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <dt className="text-white/50">{k}</dt>
                  <dd className="font-bold text-white">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-white/40">
              Read from this league&apos;s settings. Change them where the league lives.
            </p>
          </Card>

          <Card title="Mock drafts">
            {lastMock ? (
              <p className="text-sm text-white/60">
                Last mock {relativeDay(lastMock.createdAt)} · {lastMock.rounds} rounds.
              </p>
            ) : (
              <p className="text-sm text-white/60">
                No mock yet. A mock runs against this league&apos;s real settings and roster slots,
                not a generic lobby.
              </p>
            )}
            <Link
              href={`/mock-draft?leagueId=${encodeURIComponent(data.leagueId)}`}
              className="mt-3 inline-block rounded-xl bg-cyan-400 px-4 py-2 text-sm font-black text-[#04121a]"
            >
              Run a mock draft
            </Link>
          </Card>

          {positionalNeed && positionalNeed.rows.length > 0 ? (
            <Card title="Positional need">
              <ul className="space-y-2" data-testid="positional-need">
                {positionalNeed.rows.map((r) => (
                  <li key={r.position} className="flex items-center gap-3">
                    <span className="w-10 shrink-0 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-white/50">
                      {r.position}
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                      <span
                        className={`block h-full rounded-full ${
                          r.solved >= 80
                            ? 'bg-emerald-400'
                            : r.solved >= 45
                              ? 'bg-amber-400'
                              : 'bg-rose-400'
                        }`}
                        style={{ width: `${Math.max(0, Math.min(100, r.solved))}%` }}
                      />
                    </span>
                    <span className="w-7 shrink-0 text-right font-mono text-[11px] tabular-nums text-white/70">
                      {r.solved}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-white/40">
                Higher is better covered. Built from your roster against this league&apos;s starting
                slots — the same need model the draft room and autopick use.
                {positionalNeed.resolvedPlayers < positionalNeed.rosterSize
                  ? ` ${positionalNeed.resolvedPlayers} of ${positionalNeed.rosterSize} rostered players matched.`
                  : ''}
              </p>
            </Card>
          ) : null}

          <Card title="Not computed yet">
            {/*
              Naming the gaps beats leaving four empty rectangles the reader has to interpret.
              Same principle as the standings source note.
            */}
            <p className="text-xs leading-relaxed text-white/50">
              Chimmy&apos;s draft verdict isn&apos;t here — that&apos;s a generated read on your
              roster, and we only generate it on demand rather than on every page view.
              {positionalNeed ? '' : ' Positional need is hidden here because your roster couldn’t be resolved.'}
            </p>
          </Card>
        </aside>
      </div>
    </div>
  )
}
