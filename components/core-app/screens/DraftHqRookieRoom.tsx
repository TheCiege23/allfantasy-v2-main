'use client'

import { GraduationCap } from 'lucide-react'
import { useMessages } from '@/components/i18n/useMessages'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { draftHqRookieRoomMessages } from '@/lib/core-app/messages/draftHqRookieRoom'
import { draftHqUiCopy } from '@/lib/core-app/draftHqUiCopy'
import type { RookieDraftRoom } from '@/lib/core-app/draftHqRookieRoom'
import '@/components/core-app/af-draft-hq-dynasty.css'

/**
 * Draft HQ for a dynasty league: the draft as a rookie-draft room. Rendered only when the loader built
 * one (`DraftHqData.rookieRoom`, lib/core-app/draftHqRookieRoom.ts) — a dynasty league.
 *
 * The band always draws (it is what says "this is the rookie draft"); every block under it is absent
 * when its data is — the builder decides that, this file only draws. House style is the Dynasty Era
 * deck on Home (DynastyHomeDeck.tsx): a band that stays dark in every mode, cards on --surface with a
 * gold top edge. Gold TEXT is `var(--accent)` (re-pointed by af-core-dynasty.css to gold or bronze);
 * `--dyn-gold` is a fill and line colour only.
 */

/** More taxi slots than this draw as a count only — a row of 20 dots says nothing a number does not. */
const MAX_SLOT_DOTS = 8

function formatWhen(at: string, kind: 'starts' | 'opens', locale: string): string {
  const d = new Date(at)
  // A fixed zone, so the server render and the browser agree. An open date is a calendar day (UTC).
  if (kind === 'opens') {
    return d.toLocaleDateString(locale, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
  }
  const day = d.toLocaleDateString(locale, { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(locale, { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
  return `${day} · ${time} ET`
}

export function DraftHqRookieRoom({ room, leagueId }: { room: RookieDraftRoom; leagueId: string }) {
  const m = useMessages(draftHqRookieRoomMessages)
  const language = useOptionalLanguage().language ?? 'en'
  const { picks, taxi, board, date } = room
  const when = date ? formatWhen(date.at, date.kind, m.intlLocale) : null
  const myTeamHref = `/core/my-team?league=${encodeURIComponent(leagueId)}`

  return (
    <section className="af-dh-dy" aria-label={m.roomLabel} data-testid="draft-hq-rookie-room" data-kind={room.kind}>
      {/* ── Band ─────────────────────────────────────────────────────── */}
      <div className="af-dh-dy-band">
        <div className="af-dh-dy-era">
          <span className="af-dh-dy-crest" aria-hidden>
            <GraduationCap size={26} strokeWidth={1.8} />
          </span>
          <div className="af-dh-dy-era-text">
            <p className="af-dh-dy-eyebrow">{m.dynasty}</p>
            <h2 className="af-dh-dy-title" data-testid="draft-hq-rookie-title">{m.title(room.kind, room.season)}</h2>
            <p className="af-dh-dy-tagline">{m.tagline(room.kind)}</p>
          </div>
        </div>

        {room.rounds != null || room.teams != null || room.status != null || date ? (
          <dl className="af-dh-dy-facts">
            {date && when ? (
              <div className="af-dh-dy-fact af-dh-dy-countdown" data-testid="draft-hq-rookie-date">
                <dt>{date.kind === 'opens' ? m.opens(when) : m.starts(when)}</dt>
                <dd>
                  <strong>{date.daysAway}</strong> <span>{m.daysUnit(date.daysAway)}</span>
                </dd>
              </div>
            ) : null}
            {room.rounds != null ? (
              <div className="af-dh-dy-fact" data-testid="draft-hq-rookie-rounds">
                <dt>{m.rounds}</dt>
                <dd><strong>{room.rounds}</strong></dd>
              </div>
            ) : null}
            {room.teams != null ? (
              <div className="af-dh-dy-fact">
                <dt>{m.teams}</dt>
                <dd><strong>{room.teams}</strong></dd>
              </div>
            ) : null}
            {room.status != null ? (
              <div className="af-dh-dy-fact" data-status={room.status}>
                <dt>{m.statusLabel}</dt>
                <dd><span className="af-dh-dy-status">{m.status(room.status)}</span></dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>

      {/* ── Your picks · taxi room ───────────────────────────────────── */}
      {picks || taxi ? (
        <div className="af-dh-dy-grid" data-single={!(picks && taxi) || undefined}>
          {picks ? (
            <section className="af-dh-dy-card" aria-labelledby="af-dh-dy-picks" data-testid="draft-hq-rookie-picks">
              <header className="af-dh-dy-card-head">
                <h3 id="af-dh-dy-picks">{m.picksTitle}</h3>
              </header>
              {picks.list.length > 0 ? (
                <>
                  <p className="af-dh-dy-big">
                    <strong>{picks.list.length}</strong> <span>{m.picksHeld(picks.list.length)}</span>
                    {picks.firstRounders > 0 ? <em>{m.firstRounders(picks.firstRounders)}</em> : null}
                  </p>
                  <ul className="af-dh-dy-chips">
                    {picks.list.map((p, i) => (
                      <li key={`${p.label}-${i}`} className="af-dh-dy-chip" data-round={p.round === 1 ? '1' : undefined}>
                        <span className="af-dh-dy-chip-label">{p.label}</span>
                        {p.via ? <small>{m.via(p.via)}</small> : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="af-dh-dy-note">{m.noPicks}</p>
              )}
              {picks.tradedAway.length > 0 ? (
                <p className="af-dh-dy-away" data-testid="draft-hq-rookie-away">
                  <span>{m.tradedAway}</span> {picks.tradedAway.map((t) => m.tradedTo(t.label, t.to)).join(' · ')}
                </p>
              ) : null}
              {picks.note ? (
                <p className="af-dh-dy-note af-dh-dy-sync" data-testid="draft-hq-rookie-sync-note">{draftHqUiCopy(picks.note, language)}</p>
              ) : null}
              {picks.partial ? <p className="af-dh-dy-note">{m.partial}</p> : !picks.exact && picks.list.length > 0 ? <p className="af-dh-dy-note">{m.roundLevel}</p> : null}
            </section>
          ) : null}

          {taxi ? (
            <section className="af-dh-dy-card" aria-labelledby="af-dh-dy-taxi" data-testid="draft-hq-rookie-taxi">
              <header className="af-dh-dy-card-head">
                <h3 id="af-dh-dy-taxi">{m.taxiTitle}</h3>
                <a href={myTeamHref}>{m.myTeam}</a>
              </header>
              <p className="af-dh-dy-big">
                <strong>{taxi.count}</strong>
                <span>{taxi.slots > 0 ? m.taxiUsed(taxi.count, taxi.slots) : m.taxiCount(taxi.count)}</span>
              </p>
              {taxi.slots > 0 && taxi.slots <= MAX_SLOT_DOTS ? (
                <ol className="af-dh-dy-slots">
                  {Array.from({ length: taxi.slots }, (_, i) => (
                    <li key={i} data-filled={i < taxi.count || undefined} aria-label={i < taxi.count ? m.slotFilled : m.slotOpen} />
                  ))}
                </ol>
              ) : null}
              {taxi.slots > 0 ? (
                <p className="af-dh-dy-note">{taxi.count >= taxi.slots ? m.taxiFull : m.taxiRoom(taxi.slots - taxi.count)}</p>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}

      {/* ── The board: every pick, owner resolved, yours in gold ─────── */}
      {board && board.length > 0 ? (
        <section className="af-dh-dy-card af-dh-dy-boardcard" aria-labelledby="af-dh-dy-board" data-testid="draft-hq-rookie-board">
          <header className="af-dh-dy-card-head">
            <h3 id="af-dh-dy-board">{m.boardTitle}</h3>
          </header>
          {/*
            One column per round where they fit (a rookie draft is 3–5 rounds), so no round is left
            alone on a second row: wide = every round up to five, narrow (tablet) = two or three.
          */}
          <div
            className="af-dh-dy-rounds"
            style={{
              ['--af-dh-dy-wide' as string]: board.length <= 5 ? board.length : 4,
              ['--af-dh-dy-narrow' as string]: board.length <= 3 ? board.length : board.length % 3 === 0 ? 3 : 2,
            }}
          >
            {board.map((r) => (
              <div key={r.round} className="af-dh-dy-round">
                <span className="af-dh-dy-round-label">{m.round(r.round)}</span>
                <ol className="af-dh-dy-cells">
                  {r.picks.map((p) => (
                    <li
                      key={p.overall}
                      className="af-dh-dy-cell"
                      data-you={p.isYou || undefined}
                      data-round={r.round === 1 ? '1' : undefined}
                      aria-label={p.isYou ? m.yourPickAria(p.label) : undefined}
                    >
                      <span className="af-dh-dy-cell-label">{p.label}</span>
                      <span className="af-dh-dy-cell-team">{p.isYou ? m.you : p.team}</span>
                      {p.via ? <small className="af-dh-dy-cell-via">{m.via(p.via)}</small> : null}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  )
}

