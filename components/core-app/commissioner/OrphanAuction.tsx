'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreLocale } from '@/lib/core-app/messages/coreLocale'
import type { OrphanAuctionView } from '@/lib/orphan-auction/orphanAuctionService'
import { CLOSE_AFTER_HOURS, DEFAULT_CLOSE_AFTER_HOURS, DEFAULT_MIN_BID } from '@/lib/orphan-auction/orphanAuction'

/**
 * The orphan team auction (lib/orphan-auction) on the Commissioner Hub: open one for the league's
 * orphan teams, watch who has bid (never the amounts), close it once bidding ends, or cancel it. The
 * route enforces the AF Commissioner plan; this card only reflects what it was told. Teams bid on the
 * Waivers page (components/core-app/OrphanAuctionBids.tsx). Strings: orphanAuction.* (EN/ES).
 */
const K = 'orphanAuction.'

export function OrphanAuction({ leagueId }: { leagueId: string }) {
  const { language, t, tInterpolate } = useOptionalLanguage()
  const tx = (key: string, vars?: Record<string, string | number>) => (vars ? tInterpolate(K + key, vars) : t(K + key))
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/orphan-auction`
  const [view, setView] = useState<OrphanAuctionView | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [hours, setHours] = useState<number>(DEFAULT_CLOSE_AFTER_HOURS)
  const [minBid, setMinBid] = useState<number>(DEFAULT_MIN_BID)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const when = (iso: string) => new Date(iso).toLocaleString(coreLocale(language).usLocale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      setView((await r.json()) as OrphanAuctionView)
    } catch {
      setMessage(tx('loadFailed'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(true)
    setMessage('')
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const out = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(out.error || '')
      setMessage(tx(done))
      setChosen([])
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : tx('saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (view && (!view.supported || view.role !== 'commissioner')) return null
  const auction = view?.supported ? view.auction : null
  const open = auction?.status === 'open'
  const due = open && Date.parse(auction.closesAt) <= Date.now()

  return (
    <section id="ch-orphan-auction" className="af-tw af-tw-panel" data-testid="orphan-auction">
      <h2>{tx('title')}</h2>
      <p>{tx('intro')}</p>
      {view === null && !message ? <p role="status">{tx('loading')}</p> : null}

      {view?.supported && open ? (
        <div data-testid="orphan-auction-open">
          <p>
            <strong>{tx(due ? 'statusDue' : 'statusOpen', { when: when(auction.closesAt) })}</strong> · {tx('teams', { teams: auction.teams.join(', ') })}
          </p>
          <p>{tx('progress', { assets: auction.assets.length, bid: auction.biddingTeams, eligible: auction.eligibleTeams, min: auction.minBid })}</p>
          <p>{tx('sealed')}</p>
          <button type="button" className="af-btn" disabled={busy || !due} onClick={() => void act({ action: 'close' }, 'closed')} data-testid="orphan-auction-close">
            {tx('close')}
          </button>{' '}
          <button
            type="button"
            className="af-btn"
            disabled={busy}
            onClick={() => {
              if (window.confirm(tx('cancelConfirm'))) void act({ action: 'cancel' }, 'cancelled')
            }}
            data-testid="orphan-auction-cancel"
          >
            {tx('cancel')}
          </button>
          {!due ? <p>{tx('closeLater')}</p> : null}
        </div>
      ) : null}

      {view?.supported && auction?.status === 'closed' && auction.results ? (
        <div data-testid="orphan-auction-results">
          <h3>{tx('resultsTitle', { teams: auction.teams.join(', ') })}</h3>
          {auction.results.length === 0 ? (
            <p>{tx('noWinners')}</p>
          ) : (
            <ul>
              {auction.results.map((r) => (
                <li key={r.assetId}>
                  {r.label} → <strong>{r.teamName}</strong> · ${r.amount}
                </li>
              ))}
            </ul>
          )}
          {auction.unsold > 0 ? <p>{tx('unsold', { count: auction.unsold })}</p> : null}
        </div>
      ) : null}

      {view?.supported && !open ? (
        <div data-testid="orphan-auction-form">
          <h3>{tx('openTitle')}</h3>
          {!view.canOpen ? <p data-testid="orphan-auction-plan">{tx('plan')}</p> : null}
          {view.orphanTeams.length === 0 ? (
            <p>{tx('noOrphans')}</p>
          ) : (
            <fieldset disabled={busy || !view.canOpen}>
              {view.orphanTeams.map((team) => (
                <label key={team.rosterId} style={{ display: 'block' }}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(team.rosterId)}
                    onChange={(e) => setChosen((c) => (e.target.checked ? [...c, team.rosterId] : c.filter((id) => id !== team.rosterId)))}
                    data-testid="orphan-auction-team"
                  />{' '}
                  {tx('orphanTeam', { team: team.teamName, players: team.players, picks: team.picks })}
                </label>
              ))}
              <label>
                {tx('closeAfter')}{' '}
                <select value={hours} onChange={(e) => setHours(Number(e.target.value))} data-testid="orphan-auction-hours">
                  {CLOSE_AFTER_HOURS.map((h) => (
                    <option key={h} value={h}>
                      {h % 24 === 0 ? tx('days', { count: h / 24 }) : tx('hours', { count: h })}
                    </option>
                  ))}
                </select>
              </label>{' '}
              <label>
                {tx('minBid')}{' '}
                <input type="number" min={0} max={100} step={1} value={minBid} onChange={(e) => setMinBid(Math.max(0, Math.floor(Number(e.target.value) || 0)))} data-testid="orphan-auction-min" />
              </label>
              <p>{tx('openNote')}</p>
              <button
                type="button"
                className="af-btn"
                disabled={chosen.length === 0}
                onClick={() => void act({ action: 'open', sourceRosterIds: chosen, closeAfterHours: hours, minBid }, 'opened')}
                data-testid="orphan-auction-start"
              >
                {busy ? tx('saving') : tx('open')}
              </button>
            </fieldset>
          )}
        </div>
      ) : null}
      <p role="status">{message}</p>
    </section>
  )
}
