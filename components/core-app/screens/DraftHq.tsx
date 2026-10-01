'use client'

import '@/components/core-app/af-draft-hq.css'
import type { DraftHqData } from '@/lib/core-app/draftHq'
import { draftAfText, draftAfTitle } from '@/lib/core-app/draftAfLabel'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import { DraftCompetitiveEdge, type DraftEdgeState } from '@/components/core-app/screens/DraftCompetitiveEdge'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

/**
 * Screen 8 — Draft HQ.
 *
 * "Before the draft: your picks, the lottery, the board settings and a prepared
 * queue."
 *
 * Your picks carry the draft's recorded pick trades — "from @dre" on a pick you
 * acquired, and a separate line for the ones you traded away. Where the league
 * trades on its provider and those trades are not synced, the loader's note says
 * so beside the heading: it is a correctness statement, not a footnote.
 */

export type DraftHqProps = {
  data: DraftHqData
  /** Competitive Edge — loaded by the page only when the viewer's plan includes it. */
  edge?: DraftEdgeState | null
  edgeAccess?: CoreDepthAccess | null
}

function Unavailable({ reason }: { reason: string }) {
  const language = useOptionalLanguage().language
  return <p className="af-dh-unavailable">{coreUiCopy(reason, language)}</p>
}

const STATUS_TONE: Record<string, string> = {
  pre_draft: 'future',
  in_progress: 'live',
  paused: 'warn',
  completed: 'done',
}

export function DraftHq({ data, edge = null, edgeAccess = null }: DraftHqProps) {
  const language = useOptionalLanguage().language
  const copy = (value: string) => coreUiCopy(value, language)
  const pickTradeNote = (note: string) => {
    const match = note.match(/^pick trades made on (.+) are not synced into this draft, so a pick shown here may have changed hands there$/)
    return language === 'es' && match
      ? `Los intercambios de selecciones hechos en ${match[1]} no se sincronizan con este draft. Una selección mostrada aquí podría haber cambiado de dueño allí.`
      : copy(note)
  }
  return (
    <div className="af-dh">
      {/* ── Board settings ──────────────────────────────────────────── */}
      <section className="af-frame af-dh-board">
        {data.session.available ? (
          <>
            <div className="af-dh-board-head">
              <h1 className="af-display af-dh-title">{copy('Draft HQ')}</h1>
              <span
                className="af-dh-status af-num"
                data-tone={STATUS_TONE[data.session.data.status] ?? 'future'}
              >
                {copy(data.session.data.status.replace(/_/g, ' '))}
              </span>
            </div>

            <div className="af-dh-facts">
              <div className="af-dh-fact">
                <div className="af-dh-fact-value af-num">{data.session.data.draftType}</div>
                <div className="af-label">{copy('Format')}</div>
              </div>
              <div className="af-dh-fact">
                <div className="af-dh-fact-value af-num">{data.session.data.rounds}</div>
                <div className="af-label">{copy('Rounds')}</div>
              </div>
              <div className="af-dh-fact">
                <div className="af-dh-fact-value af-num">{data.session.data.teamCount}</div>
                <div className="af-label">{copy('Teams')}</div>
              </div>
              <div className="af-dh-fact" data-missing={data.session.data.yourSlot == null}>
                <div className="af-dh-fact-value af-num">
                  {data.session.data.yourSlot != null ? `#${data.session.data.yourSlot}` : '—'}
                </div>
                <div className="af-label">{copy('Your slot')}</div>
              </div>
            </div>
          </>
        ) : (
          <>
            <h1 className="af-display af-dh-title">{copy('Draft HQ')}</h1>
            <Unavailable reason={data.session.reason} />
          </>
        )}
      </section>

      {/* ── Pick inventory ──────────────────────────────────────────── */}
      {/*
        Left out when it would only repeat the board's own sentence word for word ("no upcoming
        draft is scheduled…" printed twice, one card under the other).
      */}
      {!data.pickSlots.available &&
      !data.session.available &&
      data.pickSlots.reason === data.session.reason ? null : (
      <section className="af-frame af-dh-section">
        <header className="af-dh-section-head">
          <h2 className="af-label">{copy('Your picks')}</h2>
          {data.pickSlots.available && data.pickSlots.data.note ? (
            <span className="af-dh-section-note" data-testid="draft-hq-picks-note">
              {pickTradeNote(data.pickSlots.data.note)}
            </span>
          ) : null}
        </header>

        {data.pickSlots.available ? (
          <>
            {data.pickSlots.data.held.length > 0 ? (
              <ol className="af-dh-picks" data-testid="draft-hq-picks-held">
                {data.pickSlots.data.held.map((p) => (
                  <li
                    key={p.overall}
                    className="af-dh-pick"
                    data-acquired={p.acquiredFrom ? 'true' : undefined}
                  >
                    <span className="af-dh-pick-label af-num">{p.label}</span>
                    <span className="af-dh-pick-overall">#{p.overall} {copy('overall')}</span>
                    {p.acquiredFrom ? (
                      <span className="af-dh-pick-from">{copy('From')} {p.acquiredFrom}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <Unavailable reason="you have traded away every pick you started this draft with" />
            )}
            {data.pickSlots.data.tradedAway.length > 0 ? (
              <ul className="af-dh-picks-away" data-testid="draft-hq-picks-away">
                {data.pickSlots.data.tradedAway.map((p) => (
                  <li key={p.overall} className="af-dh-pick-away">
                    <span className="af-num">{p.label}</span> {copy('traded to')} {p.to}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <Unavailable reason={data.pickSlots.reason} />
        )}
      </section>
      )}

      {/* ── What you drafted ────────────────────────────────────────── */}
      <section className="af-frame af-dh-section">
        <header className="af-dh-section-head">
          <h2 className="af-label">{copy('What you drafted')}</h2>
          {data.madePicks.available ? (
            <span className="af-chip af-num">{data.madePicks.data.length}</span>
          ) : null}
        </header>

        {data.madePicks.available ? (
          <ul className="af-dh-made">
            {data.madePicks.data.map((p) => (
              <li key={p.overall} className="af-dh-made-row">
                <span className="af-dh-pick-label af-num">{p.label}</span>
                {/*
                  A face on your own picks. `imageUrl` is vetted server-side, so
                  a value here is always something a `src` can take — the
                  fallback is an initial for a pick we could not resolve, or for
                  a non-Sleeper league where only a name is on file.
                */}
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="af-dh-made-face"
                    src={p.imageUrl}
                    alt=""
                    width={28}
                    height={28}
                    loading="lazy"
                  />
                ) : (
                  <span className="af-dh-made-face af-dh-made-face--none" aria-hidden>
                    {p.playerName.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="af-dh-made-name">{p.playerName}</span>
                <span className="af-dh-made-meta">
                  {[p.position, p.team].filter(Boolean).join(' · ')}
                  {/* AllFantasy's own projection for your pick; season total on hover. */}
                  {draftAfText(p.af) ? (
                    <span className="af-dh-af af-num" title={draftAfTitle(p.af)}>
                      {' · '}{draftAfText(p.af)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Unavailable reason={data.madePicks.reason} />
        )}
      </section>

      {/* -- The completed draft, every team -------------------------- */}
      {/* -- Draft grades, one card per team ------------------------- */}
      <section className="af-frame af-dh-section af-dh-grades">
        <header className="af-dh-section-head">
          <h2 className="af-label">{copy('Draft grades')}</h2>
          {data.grades.available ? (
            <span className="af-dh-board-meta af-num">
              {data.grades.data.season} &middot; {data.grades.data.gradedPicks}/
              {data.grades.data.totalPicks} {copy('picks graded')}
            </span>
          ) : null}
        </header>

        {data.grades.available ? (
          <>
            {/*
              Said before the letters, not after. A reader who sees a B and then finds
              the caveat underneath has already formed the belief the caveat corrects.
            */}
            {data.grades.data.scoringNote ? (
              <p className="af-dh-grade-approx">{copy(data.grades.data.scoringNote)}</p>
            ) : null}
            <p className="af-dh-grade-scale">{copy(data.grades.data.scale)}</p>

            {/*
              ⚠ `partial` MEANS THE SEASON IS STILL BEING PLAYED (draftReportService: any graded
              season whose status is not 'complete'). This used to read "Some picks could not be
              graded" — beside a header saying 96/96 were. Missing picks are their own sentence,
              from the counts.
            */}
            {data.grades.data.partial ? (
              <p className="af-dh-grade-partial">
                {language === 'es'
                  ? `La temporada ${data.grades.data.season} sigue en curso; estas calificaciones cambiarán cuando se sumen puntos.`
                  : `The ${data.grades.data.season} season is still being played, so these grades will move as the points come in.`}
              </p>
            ) : null}
            {data.grades.data.gradedPicks < data.grades.data.totalPicks ? (
              <p className="af-dh-grade-partial">
                {language === 'es'
                  ? `${data.grades.data.totalPicks - data.grades.data.gradedPicks} de ${data.grades.data.totalPicks} selecciones no pudieron calificarse; estas letras solo cubren las demás.`
                  : `${data.grades.data.totalPicks - data.grades.data.gradedPicks} of ${data.grades.data.totalPicks} picks could not be graded, so these letters cover only the ones that could.`}
              </p>
            ) : null}

            <ul className="af-dh-gradelist">
              {data.grades.data.teams.map((t) => (
                <li key={t.ownerId} className="af-dh-gradecard">
                  <span className="af-dh-grade-letter" data-grade={t.currentGrade}>
                    {t.currentGrade}
                  </span>
                  <span className="af-dh-grade-who">
                    <span className="af-dh-grade-team">{t.teamName ?? t.name}</span>
                    <span className="af-dh-grade-sub af-num">
                      {t.picks} {copy(t.picks === 1 ? 'pick' : 'picks')}
                    </span>
                  </span>
                  {/*
                    Only shown when it moved. In redraft the two grades are the same by
                    construction, and a permanent "steady" badge would be noise.
                  */}
                  {t.trend !== 'steady' ? (
                    <span className="af-dh-grade-trend" data-trend={t.trend}>
                      {t.trend === 'improved' ? '↑' : '↓'} {copy('from')} {t.initialGrade}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Unavailable reason={data.grades.reason} />
        )}
      </section>

      {/*
        -- Competitive Edge: how the others draft -------------------------
        After the grades, which say how each draft TURNED OUT; this says what each manager
        actually TAKES, draft after draft (lib/competitive-edge/draftEdge.ts). Counts, never labels.
      */}
      <DraftCompetitiveEdge access={edgeAccess} edge={edge} />

      <section className="af-frame af-dh-section af-dh-boardfull">
        <header className="af-dh-section-head">
          <h2 className="af-label">{copy('Draft board')}</h2>
          {data.board.available ? (
            <span className="af-dh-board-meta af-num">
              {data.board.data.season} &middot; {data.board.data.teams.length} {copy('teams')} &middot;{' '}
              {data.board.data.totalPicks} {copy('picks')}
            </span>
          ) : null}
        </header>

        {data.board.available ? (
          <>
            {/*
              Team strip first: a board is unreadable without knowing whose column is
              whose, and yours is the one a person looks for.
            */}
            <ul className="af-dh-teamstrip">
              {data.board.data.teams.map((t) => (
                <li
                  key={t.teamKey}
                  className="af-dh-teamchip"
                  data-you={t.isYou ? 'true' : undefined}
                >
                  <span className="af-dh-teamchip-name">{t.name ?? t.teamKey}</span>
                  <span className="af-dh-teamchip-n af-num">{t.picks}</span>
                </li>
              ))}
            </ul>

            {/*
              Rounds in order, picks in pick order within each. The snake is only
              visible this way -- grouping by team would hide the thing the board is for.
            */}
            {data.board.data.rounds.map((r) => (
              <div key={r.round} className="af-dh-round">
                <h3 className="af-dh-round-title af-num">{copy('Round')} {r.round}</h3>
                <div className="af-dh-round-scroll">
                  <ul className="af-dh-round-picks">
                    {r.picks.map((p) => (
                      <li
                        key={`${p.round}:${p.overall}:${p.teamKey}`}
                        className="af-dh-bpick"
                        data-you={p.isYou ? 'true' : undefined}
                      >
                        <span className="af-dh-pick-label af-num">{p.label}</span>
                        <span className="af-dh-bpick-player">{p.playerName}</span>
                        <span className="af-dh-bpick-meta">
                          {p.position !== '\u2014' ? p.position : ''}
                          {/* AllFantasy's own projection for the pick; season total on hover. */}
                          {draftAfText(p.af) ? (
                            <span className="af-dh-af af-num" title={draftAfTitle(p.af)}>
                              {' '}{draftAfText(p.af)}
                            </span>
                          ) : null}
                        </span>
                        <span className="af-dh-bpick-team">{p.teamName ?? p.teamKey}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </>
        ) : (
          <Unavailable reason={data.board.reason} />
        )}
      </section>

      {/* -- Lottery -------------------------------------------------- */}
      <section className="af-frame af-dh-section">
        <header className="af-dh-section-head">
          <h2 className="af-label">{copy('Weighted lottery')}</h2>
        </header>
        {/*
          Odds from the lottery engine's read-only preview for THIS league's settings
          and standings — only ever drawn for a league configured to run one. Anywhere
          else the loader's sentence says why there is no table.
        */}
        {data.lottery.available ? (
          <>
            <p className="af-dh-lottery-rule">
              {language === 'es'
                ? `Probabilidad de obtener la selección #1. Se sortean las primeras ${data.lottery.data.pickCount} selecciones; las demás siguen ${copy(data.lottery.data.fallbackOrder)}.`
                : `Odds of landing the #1 pick. The first ${data.lottery.data.pickCount} picks are drawn; the rest follow in ${data.lottery.data.fallbackOrder}.`}
              {data.lottery.data.alreadyRunAt ? ` ${copy('This league has already run its lottery.')}` : ''}
            </p>
            <table className="af-dh-lottery" data-testid="draft-hq-lottery">
              <thead>
                <tr>
                  <th scope="col">{copy('Team')}</th>
                  <th scope="col">{copy('Record')}</th>
                  <th scope="col">{copy('Odds #1')}</th>
                </tr>
              </thead>
              <tbody>
                {data.lottery.data.teams.map((t) => (
                  <tr key={t.rosterId} data-you={t.isYou ? 'true' : undefined}>
                    <td>
                      {t.name}
                      {t.isYou ? <span className="af-dh-lottery-you"> {copy('you')}</span> : null}
                    </td>
                    <td className="af-num">{t.record}</td>
                    <td className="af-num">{t.oddsPercent.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <div className="af-dh-empty">
            <span className="af-dh-empty-mark af-num" aria-hidden>
              —
            </span>
            <p className="af-dh-empty-text">{copy(data.lottery.reason)}</p>
          </div>
        )}
      </section>

      {/* ── Queue & keepers ─────────────────────────────────────────── */}
      <div className="af-dh-pair">
        <section className="af-card af-dh-section">
          <h2 className="af-label">{copy('Prepared queue')}</h2>
          {data.queue.available ? (
            <>
              <ol className="af-dh-queue" data-testid="draft-hq-queue">
                {data.queue.data.players.map((p) => (
                  <li key={`${p.rank}:${p.playerName}`} className="af-dh-queue-row">
                    <span className="af-dh-queue-rank af-num">{p.rank}</span>
                    <span className="af-dh-made-name">{p.playerName}</span>
                    <span className="af-dh-made-meta">
                      {[p.position, p.team].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ol>
              {data.queue.data.total > data.queue.data.players.length ? (
                <p className="af-dh-unavailable">
                  {data.queue.data.total - data.queue.data.players.length} {copy('more in your queue')}
                </p>
              ) : null}
            </>
          ) : (
            <Unavailable reason={data.queue.reason} />
          )}
        </section>
        <section className="af-card af-dh-section">
          <h2 className="af-label">{copy('Keepers')}</h2>
          {data.keepers.available ? (
            <>
              <p className="af-dh-unavailable">
                {data.keepers.data.source === 'imported'
                  ? language === 'es'
                    ? `Conservados en tu draft ${data.keepers.data.season ?? 'anterior'}, según Sleeper`
                    : `kept in your ${data.keepers.data.season ?? 'last'} draft, as Sleeper recorded it`
                  : data.keepers.data.maxKeepers != null
                    ? language === 'es'
                      ? `Declarados para este draft · máximo ${data.keepers.data.maxKeepers}`
                      : `declared for this draft · up to ${data.keepers.data.maxKeepers} allowed`
                    : copy('declared for this draft')}
              </p>
              <ul className="af-dh-made" data-testid="draft-hq-keepers">
                {data.keepers.data.players.map((k) => (
                  <li key={`${k.round}:${k.playerName}`} className="af-dh-made-row">
                    <span className="af-dh-pick-label af-num">{copy('Rd')} {k.round}</span>
                    <span className="af-dh-made-name">{k.playerName}</span>
                    <span className="af-dh-made-meta">
                      {[k.position, k.team].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Unavailable reason={data.keepers.reason} />
          )}
        </section>
      </div>
    </div>
  )
}

export default DraftHq
