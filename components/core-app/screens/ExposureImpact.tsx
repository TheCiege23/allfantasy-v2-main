'use client'

import { useId, useState } from 'react'
import MiniPlayerImg from '@/components/MiniPlayerImg'
import type { ExposureRow } from '@/lib/core-app/dash3aPanels'
import type { ImpactSlot, LeagueImpactRow, PlayerLeagueImpact } from '@/lib/core-app/playerLeagueImpact'

/**
 * One row of the home "Portfolio & exposure" card, with its "if he sits" breakdown.
 *
 * User decisions, 2026-09-14: tap a player on 2+ of your rosters to see, per league,
 * your win chance this week now vs. with him scoring 0 — the Matchup screen's own model.
 * Fetched on tap from the existing player-card route (`impact=1`), because the home has
 * already rendered and pricing every league for every row on each load is not free.
 *
 * ⚠ A LEAGUE WITHOUT A NUMBER SAYS WHY. Benched, no matchup, or a matchup the model
 * cannot price each render as that, never as a blank or a 0% — a missing probability
 * shown as zero would read as "he is irrelevant there", the opposite of "we don't know".
 */

type Load =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; data: PlayerLeagueImpact }

export const SLOT_LABEL: Record<ImpactSlot, string> = { starter: 'starting', bench: 'bench', ir: 'IR', taxi: 'taxi' }

const pct = (p: number) => `${Math.round(p * 100)}%`

export function impactText(row: LeagueImpactRow): { text: string; title?: string; drop?: number } {
  const i = row.impact
  if (i.kind === 'priced') {
    const drop = Math.round((i.now - i.without) * 100)
    return { text: `${pct(i.now)} → ${pct(i.without)}${drop > 0 ? ` (−${drop})` : ''}`, drop }
  }
  if (i.kind === 'not_starting') return { text: 'not in this week’s lineup — no effect' }
  return { text: 'can’t price this matchup', title: i.reason }
}

export function ExposureRowItem({ row }: { row: ExposureRow }) {
  const [open, setOpen] = useState(false)
  const [load, setLoad] = useState<Load>({ state: 'idle' })
  const panelId = useId()
  /* The breakdown is for concentration: a player on one roster has one league to check. */
  const canExpand = row.count > 1

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || load.state === 'loading' || load.state === 'ready') return
    setLoad({ state: 'loading' })
    try {
      const res = await fetch(
        `/api/core/player-card?sport=NFL&sleeperId=${encodeURIComponent(row.playerId)}&impact=1`,
        { cache: 'no-store' },
      )
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { impact?: PlayerLeagueImpact }
      if (!body.impact) throw new Error('no impact in response')
      setLoad({ state: 'ready', data: body.impact })
    } catch {
      setLoad({ state: 'error' })
    }
  }

  return (
    <div className="af3a-exp-item" data-open={open}>
      <div className="af3a-exp">
        <MiniPlayerImg sleeperId={row.playerId} name={row.name} size={24} className="af3a-exp-img" />
        <span className="af3a-exp-name">
          {row.name}
          {row.position ? <em> {row.position}</em> : null}
        </span>
        <span className="af3a-exp-bar">
          <span
            className={row.count === row.of ? 'af3a-exp-full' : 'af3a-exp-part'}
            style={{ width: `${Math.round((row.count / Math.max(1, row.of)) * 100)}%` }}
          />
        </span>
        <span className="af3a-exp-count af3a-mono">
          {row.count} of {row.of}
        </span>
        {canExpand ? (
          <button
            type="button"
            className="af3a-exp-more"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={toggle}
          >
            {open ? 'Hide' : 'If he sits'}
          </button>
        ) : null}
      </div>

      {open ? (
        <div id={panelId} className="af3a-exp-impact" aria-live="polite">
          {load.state === 'loading' || load.state === 'idle' ? <p className="af3a-impact-note">Pricing your matchups…</p> : null}
          {load.state === 'error' ? (
            <p className="af3a-impact-note">Couldn’t load his leagues right now. Try again in a moment.</p>
          ) : null}
          {load.state === 'ready' ? (
            load.data.rows.length === 0 ? (
              <p className="af3a-impact-note">None of your rosters we could read hold him this week.</p>
            ) : (
              <>
                <p className="af3a-impact-note">Your win chance this week — now → if he scores 0 from here.</p>
                <ul className="af3a-impact-list">
                  {load.data.rows.map((r) => {
                    const { text, title, drop } = impactText(r)
                    return (
                      <li
                        key={r.leagueId}
                        className="af3a-impact-row"
                        data-kind={r.impact.kind}
                        data-drop={drop != null && drop >= 15 ? 'big' : undefined}
                      >
                        <span className="af3a-impact-league">{r.leagueName}</span>
                        <span className="af3a-impact-slot">{SLOT_LABEL[r.slot]}</span>
                        <span className="af3a-impact-value" title={title}>
                          {text}
                        </span>
                      </li>
                    )
                  })}
                </ul>
                {load.data.notPriced > 0 ? (
                  <p className="af3a-impact-note">
                    {load.data.notPriced} more league{load.data.notPriced === 1 ? '' : 's'} not priced here — open the
                    Matchup screen for those.
                  </p>
                ) : null}
              </>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default ExposureRowItem
