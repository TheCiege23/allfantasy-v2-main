'use client'

import '@/components/core-app/af-draft-hq.css'
import type { DraftHqData } from '@/lib/core-app/draftHq'

/**
 * Screen 8 — Draft HQ.
 *
 * "Before the draft: your picks, the lottery, the board settings and a prepared
 * queue."
 *
 * Pick slots are COMPUTED from snake order and shown as such. The handoff labels
 * one pick "From @dre · acquired Wk 6"; we cannot say that, because pick trades
 * are not ingested — so every slot here is captioned as an original slot, and
 * the caption is part of the design rather than a footnote.
 */

export type DraftHqProps = {
  data: DraftHqData
}

function Unavailable({ reason }: { reason: string }) {
  return <p className="af-dh-unavailable">{reason}</p>
}

const STATUS_TONE: Record<string, string> = {
  pre_draft: 'future',
  in_progress: 'live',
  paused: 'warn',
  completed: 'done',
}

export function DraftHq({ data }: DraftHqProps) {
  return (
    <div className="af-dh">
      {/* ── Board settings ──────────────────────────────────────────── */}
      <section className="af-frame af-dh-board">
        {data.session.available ? (
          <>
            <div className="af-dh-board-head">
              <h1 className="af-display af-dh-title">Draft HQ</h1>
              <span
                className="af-dh-status af-num"
                data-tone={STATUS_TONE[data.session.data.status] ?? 'future'}
              >
                {data.session.data.status.replace(/_/g, ' ')}
              </span>
            </div>

            <div className="af-dh-facts">
              <div className="af-dh-fact">
                <div className="af-dh-fact-value af-num">{data.session.data.draftType}</div>
                <div className="af-label">Format</div>
              </div>
              <div className="af-dh-fact">
                <div className="af-dh-fact-value af-num">{data.session.data.rounds}</div>
                <div className="af-label">Rounds</div>
              </div>
              <div className="af-dh-fact">
                <div className="af-dh-fact-value af-num">{data.session.data.teamCount}</div>
                <div className="af-label">Teams</div>
              </div>
              <div className="af-dh-fact" data-missing={data.session.data.yourSlot == null}>
                <div className="af-dh-fact-value af-num">
                  {data.session.data.yourSlot != null ? `#${data.session.data.yourSlot}` : '—'}
                </div>
                <div className="af-label">Your slot</div>
              </div>
            </div>
          </>
        ) : (
          <Unavailable reason={data.session.reason} />
        )}
      </section>

      {/* ── Pick inventory ──────────────────────────────────────────── */}
      <section className="af-frame af-dh-section">
        <header className="af-dh-section-head">
          <h2 className="af-label">Your picks</h2>
          {data.pickSlots.available ? (
            <span className="af-dh-section-note">
              Original slots — pick trades are not ingested, so a pick you have traded away still
              shows here
            </span>
          ) : null}
        </header>

        {data.pickSlots.available ? (
          <ol className="af-dh-picks">
            {data.pickSlots.data.map((p) => (
              <li key={p.overall} className="af-dh-pick">
                <span className="af-dh-pick-label af-num">{p.label}</span>
                <span className="af-dh-pick-overall">#{p.overall} overall</span>
              </li>
            ))}
          </ol>
        ) : (
          <Unavailable reason={data.pickSlots.reason} />
        )}
      </section>

      {/* ── What you drafted ────────────────────────────────────────── */}
      <section className="af-frame af-dh-section">
        <header className="af-dh-section-head">
          <h2 className="af-label">What you drafted</h2>
          {data.madePicks.available ? (
            <span className="af-chip af-num">{data.madePicks.data.length}</span>
          ) : null}
        </header>

        {data.madePicks.available ? (
          <ul className="af-dh-made">
            {data.madePicks.data.map((p) => (
              <li key={p.overall} className="af-dh-made-row">
                <span className="af-dh-pick-label af-num">{p.label}</span>
                <span className="af-dh-made-name">{p.playerName}</span>
                <span className="af-dh-made-meta">
                  {[p.position, p.team].filter(Boolean).join(' · ')}
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
          <h2 className="af-label">Draft grades</h2>
          {data.grades.available ? (
            <span className="af-dh-board-meta af-num">
              {data.grades.data.season} &middot; {data.grades.data.gradedPicks}/
              {data.grades.data.totalPicks} picks graded
            </span>
          ) : null}
        </header>

        {data.grades.available ? (
          <>
            {/*
              Said before the letters, not after. A reader who sees a B and then finds
              the caveat underneath has already formed the belief the caveat corrects.
            */}
            {data.grades.data.approximationNote ? (
              <p className="af-dh-grade-approx">{data.grades.data.approximationNote}</p>
            ) : null}
            <p className="af-dh-grade-scale">{data.grades.data.scale}</p>

            {/*
              Partial coverage is said out loud. A grade built on two thirds of a draft is
              still worth showing -- silently presenting it as complete is not.
            */}
            {data.grades.data.partial ? (
              <p className="af-dh-grade-partial">
                Some picks could not be graded, so these letters cover only the picks that
                could be.
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
                    <span className="af-dh-grade-sub af-num">{t.picks} picks</span>
                  </span>
                  {/*
                    Only shown when it moved. In redraft the two grades are the same by
                    construction, and a permanent "steady" badge would be noise.
                  */}
                  {t.trend !== 'steady' ? (
                    <span className="af-dh-grade-trend" data-trend={t.trend}>
                      {t.trend === 'improved' ? '↑' : '↓'} from {t.initialGrade}
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

      <section className="af-frame af-dh-section af-dh-boardfull">
        <header className="af-dh-section-head">
          <h2 className="af-label">Draft board</h2>
          {data.board.available ? (
            <span className="af-dh-board-meta af-num">
              {data.board.data.season} &middot; {data.board.data.teams.length} teams &middot;{' '}
              {data.board.data.totalPicks} picks
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
                <h3 className="af-dh-round-title af-num">Round {r.round}</h3>
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
          <h2 className="af-label">Weighted lottery</h2>
        </header>
        {/*
          The handoff shows a full lottery table — teams, ball counts, odds of the
          #1 pick. There is no lottery model in this system at all. Odds computed
          from standings would look exactly like a real lottery and would be
          entirely ours, so the table is not drawn.
        */}
        <div className="af-dh-empty">
          <span className="af-dh-empty-mark af-num" aria-hidden>
            —
          </span>
          <p className="af-dh-empty-text">{data.lottery.reason}</p>
        </div>
      </section>

      {/* ── Queue & keepers ─────────────────────────────────────────── */}
      <div className="af-dh-pair">
        <section className="af-card af-dh-section">
          <h2 className="af-label">Prepared queue</h2>
          <Unavailable reason={data.queue.reason} />
        </section>
        <section className="af-card af-dh-section">
          <h2 className="af-label">Keepers</h2>
          <Unavailable reason={data.keepers.reason} />
        </section>
      </div>
    </div>
  )
}

export default DraftHq
