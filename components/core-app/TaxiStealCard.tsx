'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreLocale } from '@/lib/core-app/messages/coreLocale'
import type { TaxiStealView } from '@/lib/taxi/taxiStealingService'

/**
 * Taxi stealing (lib/taxi/taxiStealing.ts) on the Waivers page: claims on your players (protect them
 * or let them go), your own claims (withdraw), and every other team's taxi players to claim. Renders
 * nothing unless the league runs the rule or the viewer still has a claim open. The route checks every
 * action again. Strings: taxiSteal.* (EN/ES).
 */
const K = 'taxiSteal.'

const CODE_KEYS: Record<string, string> = {
  RULE_OFF: 'err.off',
  OWN_PLAYER: 'err.own',
  NOT_ON_TAXI: 'err.notOnTaxi',
  ALREADY_CLAIMED: 'err.claimed',
  NO_CLAIMS_LEFT: 'err.noneLeft',
}

export function TaxiStealCard({ leagueId }: { leagueId: string }) {
  const { language, t, tInterpolate } = useOptionalLanguage()
  const tx = (key: string, vars?: Record<string, string | number>) => (vars ? tInterpolate(K + key, vars) : t(K + key))
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/taxi-steals`
  const [view, setView] = useState<TaxiStealView | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const when = (iso: string) => new Date(iso).toLocaleString(coreLocale(language).usLocale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) return
      setView((await r.json()) as TaxiStealView)
    } catch {
      // Nothing to show is the right answer when the claims cannot be read.
    }
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  if (!view?.supported || !view.myTeam) return null
  if (!view.active && !view.againstMe.length && !view.mine.length) return null

  const act = async (body: Record<string, unknown>, done: string, confirmKey?: string) => {
    if (confirmKey && !window.confirm(tx(confirmKey))) return
    setBusy(true)
    setMessage('')
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const out = (await r.json().catch(() => ({}))) as { error?: string; code?: string }
      if (!r.ok) throw new Error(out.code && CODE_KEYS[out.code] ? tx(CODE_KEYS[out.code]!) : out.error || '')
      setMessage(tx(done))
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : tx('failed'))
    } finally {
      setBusy(false)
    }
  }

  const left = view.myTeam.claimsLeft
  const canClaim = view.active && left !== 0

  return (
    <section id="taxi-steals" className="af-wv-taxi-steal" data-testid="taxi-steals">
      <h2>{tx('title')}</h2>
      <p>{tx('intro', { hours: view.rule.protectHours })}</p>

      {view.againstMe.length ? (
        <div data-testid="taxi-steals-against">
          <h3>{tx('againstTitle')}</h3>
          <ul>
            {view.againstMe.map((c) => (
              <li key={c.claimId}>
                {tx('againstLine', { player: c.player, claimer: c.claimer, when: when(c.deadline) })}{' '}
                <button type="button" className="af-btn" disabled={busy} onClick={() => void act({ action: 'protect', claimId: c.claimId }, 'protected')} data-testid="taxi-steals-protect">
                  {tx('protect')}
                </button>{' '}
                <button type="button" className="af-btn" disabled={busy} onClick={() => void act({ action: 'release', claimId: c.claimId }, 'released', 'releaseConfirm')} data-testid="taxi-steals-release">
                  {tx('release')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.mine.length ? (
        <div data-testid="taxi-steals-mine">
          <h3>{tx('mineTitle')}</h3>
          <ul>
            {view.mine.map((c) => (
              <li key={c.claimId}>
                {tx('mineLine', { player: c.player, owner: c.owner, when: when(c.deadline) })}{' '}
                <button type="button" className="af-btn" disabled={busy} onClick={() => void act({ action: 'withdraw', claimId: c.claimId }, 'withdrawn')} data-testid="taxi-steals-withdraw">
                  {tx('withdraw')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.active ? (
        <div data-testid="taxi-steals-available">
          <h3>{tx('availableTitle')}</h3>
          <p>{left == null ? tx('leftUnlimited') : tx('left', { n: left })}</p>
          {view.available.length === 0 ? (
            <p>{tx('none')}</p>
          ) : (
            <ul>
              {view.available.map((p) => (
                <li key={p.playerId}>
                  {p.name}
                  {p.position || p.team ? ` · ${[p.position, p.team].filter(Boolean).join(' ')}` : ''} · {tx('on', { team: p.ownerTeam })}{' '}
                  {p.claimed ? (
                    <span>{tx('alreadyClaimed')}</span>
                  ) : (
                    <button type="button" className="af-btn" disabled={busy || !canClaim} onClick={() => void act({ action: 'claim', playerId: p.playerId }, 'claimed', 'claimConfirm')} data-testid="taxi-steals-claim">
                      {tx('claim')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {view.recent.length ? (
        <div data-testid="taxi-steals-recent">
          <h3>{tx('recentTitle')}</h3>
          <ul>
            {view.recent.map((r, i) => (
              <li key={`${r.player}-${i}`}>{tx(r.status === 'stolen' ? 'recentStolen' : 'recentProtected', { player: r.player, owner: r.owner, claimer: r.claimer })}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p role="status">{message}</p>
    </section>
  )
}
