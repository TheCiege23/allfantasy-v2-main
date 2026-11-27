'use client'

import { isZombieLeagueLike } from '@/lib/zombie/isZombieLeagueLike'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LeagueTeamSlot, UserLeague } from '@/app/dashboard/types'
import type { LeagueTradeAsset, LeagueTradeBlockPanelItem, LeagueTradeHistoryItem } from '@/components/league/types'
import { ProposeTradeModal } from '@/app/league/[leagueId]/tabs/ProposeTradeModal'
import { openChimmyWithPrompt } from '@/lib/dashboard/open-chimmy-with-prompt'
import { reviewIdFor } from '@/lib/trade-review/reviewIdStore'
import { useVisibleRefresh } from '@/hooks/useVisibleRefresh'
import { Card, PlayerAvatar, ScreenHead } from './NativeScreenParts'
import './native-trades.css'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { tradeCardState, tradeDeadlineState } from '@/lib/league-media/redraftScreens'
import { RedraftDeadlineBar, RedraftScreen, useRedraftScreen } from './RedraftScreenParts'
import { DynastyPickChip } from '@/components/dynasty/DynastyPickChip'
import { usesDynastyBackground } from '@/lib/league-media/dynastyBackground'

/**
 * Trades — handoff §3, `Trades.png` / `MobileTrades.png`.
 *
 * One read, the same as the Trades tab: `/api/league/trades-panel`. The AF grade on an offer is the
 * panel's own `leagueGrade` (THE grade every trade surface shows — `lib/decision-os/trade/tradeGrade.ts`);
 * nothing is re-graded here. Accept / Decline / Cancel / commissioner review call the same routes as
 * the Trades tab, and building or countering an offer opens the existing `ProposeTradeModal`, which
 * owns rosters, picks, FAAB and its own grade preview.
 */
/**
 * A block listing with its face and crest. The route adds `headshotUrl` / `teamLogoUrl` (the player-media
 * round); read optionally so a response without them still draws initials and the registry crest.
 */
type BlockItem = LeagueTradeBlockPanelItem & { headshotUrl?: string | null; teamLogoUrl?: string | null }

type Panel = {
  tradeBlock?: BlockItem[]
  activeTrades?: LeagueTradeHistoryItem[]
  historyTrades?: LeagueTradeHistoryItem[]
}

function gradeTone(letter: string | null | undefined): 'good' | 'warn' | 'bad' {
  const l = String(letter ?? '').trim().toUpperCase()
  if (l.startsWith('A') || l.startsWith('B')) return 'good'
  if (l.startsWith('C')) return 'warn'
  return 'bad'
}

function AssetList({ assets, dynasty = false, teamName, sport }: { assets: LeagueTradeAsset[]; dynasty?: boolean; teamName?: (rosterId: string) => string | null; sport?: string | null }) {
  if (!assets.length) return <p className="nls-muted">Nothing</p>
  return (
    <ul>
      {assets.map((a) => {
        // A player carries his face and club; a pick or FAAB line stays text.
        const isPlayer = !a.pick && Boolean(a.playerId || a.headshotUrl)
        return (
          <li key={a.id} data-media={isPlayer || undefined}>
            {isPlayer ? <PlayerAvatar name={a.label} headshotUrl={a.headshotUrl} teamLogoUrl={a.teamLogoUrl} team={a.team} sport={sport} /> : null}
            <span className="nls-asset-text">
              {/* Dynasty only: a pick is drawn as its chip; everything else, and every other league, as before. */}
              {dynasty && a.pick ? <DynastyPickChip pick={a.pick} teamName={teamName} /> : a.label}
              {a.sublabel && !(dynasty && a.pick) ? <small>{a.sublabel}</small> : null}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** "Kenneth Walker III" → "K. Walker III"; one word stays whole. */
function shortPlayerName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.length < 2 ? name.trim() : `${parts[0]![0]}. ${parts.slice(1).join(' ')}`
}

function ago(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const h = Math.round((Date.now() - t) / 3_600_000)
  if (h < 1) return 'just now'
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function NativeTradesScreen({ league, teams }: { league: UserLeague; teams: LeagueTeamSlot[] }) {
  const [panel, setPanel] = useState<Panel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [counterTradeId, setCounterTradeId] = useState<string | null>(null)
  // A trade-block tile opens the builder on that player (the builder finds whose roster holds him).
  const [blockPlayerId, setBlockPlayerId] = useState<string | null>(null)
  const openBuilder = (playerId: string | null = null) => {
    setCounterTradeId(null)
    setBlockPlayerId(playerId)
    setBuilderOpen(true)
  }
  // Redraft (lib/league-media/redraftIdentity.ts): deadline bar from settings, proposal cards with their state.
  const rd = useRedraftScreen(league)
  const dynasty = usesDynastyBackground(league)
  // A pick's original team, by roster id. A native team's `externalId` is its roster id.
  const teamName = useCallback((rosterId: string) => teams.find((t) => t.externalId === rosterId || t.id === rosterId)?.teamName ?? null, [teams])

  const load = useCallback(
    async (background = false) => {
      if (!background) {
        setLoading(true)
        setError(null)
      }
      try {
        const res = await fetch(`/api/league/trades-panel?leagueId=${encodeURIComponent(league.id)}${background ? '' : '&history=1'}`, { credentials: 'include', cache: 'no-store' })
        const json = (await res.json().catch(() => null)) as Panel | null
        if (!res.ok) {
          if (!background) setError('We could not load trades.')
          return
        }
        setPanel((prev) => (background && prev ? { ...prev, activeTrades: json?.activeTrades ?? prev.activeTrades, tradeBlock: json?.tradeBlock ?? prev.tradeBlock } : json))
      } catch {
        if (!background) setError('We could not load trades.')
      } finally {
        if (!background) setLoading(false)
      }
    },
    [league.id],
  )
  useEffect(() => {
    void load()
  }, [load])
  useVisibleRefresh(() => load(true))

  const active = useMemo(() => panel?.activeTrades ?? [], [panel])
  const offers = useMemo(
    () => active.filter((t) => (t.viewerIsReceiver && t.status === 'pending') || (t.viewerIsCommissioner && t.status === 'awaiting_commissioner')),
    [active],
  )
  const outgoing = useMemo(() => active.filter((t) => t.viewerIsProposer && t.status === 'pending'), [active])
  const recent = useMemo(() => (panel?.historyTrades ?? []).filter((t) => t.status === 'accepted' || t.direction === 'complete').slice(0, 5), [panel])
  const block = panel?.tradeBlock ?? []

  const act = async (tradeId: string, path: 'accept' | 'reject' | 'cancel') => {
    setBusy(tradeId)
    setActionErr(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(league.id)}/trades/${encodeURIComponent(tradeId)}/${path}`, { method: 'POST' })
      if (!res.ok) {
        setActionErr(`We could not ${path === 'reject' ? 'decline' : path} this trade. Nothing was changed.`)
        return
      }
      await load()
    } catch {
      setActionErr('That did not go through. Nothing was changed.')
    } finally {
      setBusy(null)
    }
  }
  const review = async (tradeId: string, decision: 'approve' | 'reject') => {
    setBusy(tradeId)
    setActionErr(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(league.id)}/trades/${encodeURIComponent(tradeId)}/commissioner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reviewId: reviewIdFor(tradeId) }),
      })
      if (!res.ok) {
        setActionErr('We could not save that commissioner decision. Nothing was changed.')
        return
      }
      await load()
    } finally {
      setBusy(null)
    }
  }
  const askChimmy = (t: LeagueTradeHistoryItem) =>
    openChimmyWithPrompt({
      leagueId: league.id,
      source: 'trade',
      prompt: `${t.partnerName} offered me ${t.received.map((a) => a.label).join(', ') || 'nothing'} for ${t.sent.map((a) => a.label).join(', ') || 'nothing'}. Should I accept, counter or decline?`,
    })

  const offerCards = offers.map((t) => {
        const g = t.leagueGrade && t.leagueGrade.graded ? t.leagueGrade : null
        const isReview = t.status === 'awaiting_commissioner'
        return (
          <section key={t.id} className={`nls-card${rd ? ' nls-rd-offer' : ''}`} data-tone="warn" data-rd-state={rd ? (isReview ? 'review' : 'offer') : undefined} aria-label={`Offer from ${t.partnerName}`}>
            <div className="nls-offer-head">
              <span className="nls-chip" data-tone={rd && !isReview ? 'accent' : 'warn'}>{isReview ? 'Needs your review' : 'Offer received'}</span>
              <strong>{isReview ? `${t.proposerName ?? t.partnerName} ⇄ ${t.receiverName ?? 'partner'}` : t.partnerName}</strong>
              <small>{ago(t.timestamp)}</small>
              {g && !isReview && !rd ? (
                <span className="nls-offer-grade" data-pts={gradeTone(g.letter) === 'good' ? 'good' : gradeTone(g.letter) === 'bad' ? 'bad' : undefined}>
                  AF grade for you · {g.letter}
                </span>
              ) : null}
              {g && !isReview && rd ? (
                <>
                  <span className="nls-rd-grade" data-pts={gradeTone(g.letter)}><span className="nls-sr">AF grade for you · </span>{g.letter}</span>
                  <span className="nls-rd-grade-label" aria-hidden>AF grade<br />for you</span>
                </>
              ) : null}
            </div>
            <div className="nls-givegets">
              <div>
                <h4 className="nls-label">{isReview ? `${t.proposerName ?? 'Proposer'} gives` : 'You give'}</h4>
                <AssetList assets={t.sent} dynasty={dynasty} teamName={teamName} sport={league.sport} />
              </div>
              <div>
                <h4 className="nls-label">{isReview ? `${t.receiverName ?? 'Receiver'} gives` : 'You get'}</h4>
                <AssetList assets={t.received} dynasty={dynasty} teamName={teamName} sport={league.sport} />
              </div>
            </div>
            {g && !isReview && g.recommendation ? <p className="nls-muted nls-offer-note">{g.recommendation}</p> : null}
            <div className="nls-actions nls-offer-actions">
              {isReview ? (
                <>
                  <button type="button" className="nls-btn" data-variant="primary" disabled={busy === t.id} onClick={() => void review(t.id, 'approve')}>Approve</button>
                  <button type="button" className="nls-btn" disabled={busy === t.id} onClick={() => void review(t.id, 'reject')}>Veto</button>
                </>
              ) : (
                <>
                  <button type="button" className="nls-btn" data-variant="primary" disabled={busy === t.id} onClick={() => void act(t.id, 'accept')}>Accept</button>
                  <button type="button" className="nls-btn" disabled={busy === t.id} onClick={() => { setBlockPlayerId(null); setCounterTradeId(isNativePlatform(league.platform) ? t.id : null); setBuilderOpen(true) }}>{isNativePlatform(league.platform) ? 'Counter' : 'Build new offer'}</button>
                  <button type="button" className="nls-btn" disabled={busy === t.id} onClick={() => void act(t.id, 'reject')}>Decline</button>
                  <button type="button" className="nls-btn" onClick={() => askChimmy(t)}>Ask Chimmy</button>
                </>
              )}
            </div>
          </section>
        )
      })

  const deadline = league.tradeDeadlineWeek ? `Deadline · Wk ${league.tradeDeadlineWeek}` : 'Deadline · none'
  const deadlineState = tradeDeadlineState(league.tradeDeadlineWeek, league.currentWeek)

  return (
    <RedraftScreen identity={rd}>
    <div className="nls" data-testid="native-trades-screen" data-rd-screen={rd ? 'trades' : undefined}>
      <ScreenHead eyebrow="Trades" title="Trade center">
        {!rd ? <span className="nls-chip">{deadline}</span> : null}
        <button type="button" className="nls-btn" data-variant="primary" onClick={() => openBuilder()}>Propose a trade</button>
      </ScreenHead>

      {isZombieLeagueLike(league) ? <p className="nls-zombie-trade-note">Survivors and Whisperers may trade. Zombies cannot trade.</p> : null}
      {rd ? <RedraftDeadlineBar state={deadlineState} currentWeek={league.currentWeek} /> : null}

      {error ? <p className="nls-error" role="alert">{error}</p> : null}
      {actionErr ? <p className="nls-error" role="alert">{actionErr}</p> : null}
      {loading && !panel ? <p className="nls-empty" role="status">Loading trades…</p> : null}

      {panel ? (
        <div className="nls-trades-wrap"><div className="nls-trades-split">
          <section className="nls-trades-active" aria-label="Active trades">
            <h3 className="nls-trades-title">Active trades <span className="nls-trades-count">{offers.length + outgoing.length}</span></h3>
            {offerCards}
            {outgoing.length ? (
              <Card label="Your open offers">
                <ul className="nls-list">
                  {outgoing.map((t) => {
                    const state = rd ? tradeCardState(t.status) : null
                    return (
                    <li key={t.id} className="nls-toolbar nls-offer-out">
                      <span className="nls-grow">
                        To <b>{t.partnerName}</b>: {t.sent.map((a) => a.label).join(', ') || 'nothing'} for {t.received.map((a) => a.label).join(', ') || 'nothing'}
                      </span>
                      {state ? <span className="nls-chip" data-tone={state.tone}>{state.label}</span> : null}
                      <button type="button" className="nls-btn" data-size="sm" disabled={busy === t.id} onClick={() => void act(t.id, 'cancel')}>Cancel</button>
                    </li>
                    )
                  })}
                </ul>
              </Card>
            ) : null}
            {offers.length + outgoing.length === 0 ? (
              <div className="nls-trades-empty" data-testid="trades-empty">
                <span className="nls-trades-empty-icon" aria-hidden>⇄</span>
                <p>No active trades yet.</p>
                <button type="button" className="nls-trades-link" onClick={() => openBuilder()}>Propose a trade</button>
              </div>
            ) : null}
            {recent.length ? (
              <Card label="Recent trades">
                <ul className="nls-list">
                  {recent.map((t) => (
                    <li key={t.id}>
                      <b>{t.proposerName ?? 'You'}</b> gets {t.received.map((a) => a.label).join(', ') || '—'}; <b>{t.receiverName ?? t.partnerName}</b> gets {t.sent.map((a) => a.label).join(', ') || '—'}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </section>
          <aside className="nls-trades-block" aria-label="Trade block">
            <h3 className="nls-trades-title">Trade block</h3>
            {block.length ? (
              <ul className="nls-block-tiles" data-testid="trade-block-tiles">
                {block.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      className="nls-block-tile"
                      data-pos={b.position.toLowerCase()}
                      aria-label={`${b.name}, ${b.position}${b.team ? ` ${b.team}` : ''}, listed by ${b.ownerName}. Propose a trade`}
                      onClick={() => openBuilder(b.playerId)}
                    >
                      <span className="nls-block-tile-top">
                        <span className="nls-block-tile-text">
                          <small><b>{b.position}</b>{b.team ? ` · ${b.team}` : ''}</small>
                          <strong>{shortPlayerName(b.name)}</strong>
                        </span>
                        <PlayerAvatar name={b.name} headshotUrl={b.headshotUrl ?? null} teamLogoUrl={b.teamLogoUrl ?? null} team={b.team} sport={league.sport} />
                      </span>
                      <span className="nls-block-owner">{b.ownerName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="nls-trades-block-empty">Nobody has listed a player yet.</p>
            )}
          </aside>
        </div></div>
      ) : null}

      <ProposeTradeModal open={builderOpen} counterTradeId={counterTradeId} initialGetPlayerId={blockPlayerId} onClose={() => setBuilderOpen(false)} leagueId={league.id} teams={teams} platform={league.platform} leagueSettings={league.settings} sport={league.sport} onSubmitted={() => { setBuilderOpen(false); void load() }} />
    </div>
    </RedraftScreen>
  )
}
