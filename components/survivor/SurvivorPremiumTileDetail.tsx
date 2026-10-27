'use client'

import { useEffect, useState } from 'react'
import type { SurvivorPremiumTilePayload, ThreatMapTile, SocialPulseTile, ChallengeOutlookTile, JuryProjectionTile, ExileStatusTile } from '@/lib/survivor/premium/survivorPremiumTiles'

const muted = 'text-xs text-white/55'
const you = (isYou: boolean) => (isYou ? <span className="ml-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-200">you</span> : null)
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '—')

function ThreatMap({ data }: { data: ThreatMapTile }) {
  if (!data.rows.length) return <p className={muted}>Nobody is in the game yet.</p>
  const tone = { high: 'text-rose-200 border-rose-400/30 bg-rose-500/10', medium: 'text-amber-100 border-amber-400/30 bg-amber-500/10', low: 'text-white/60 border-white/10 bg-white/[0.03]' }
  return (
    <div className="space-y-3">
      <p className={muted}>{data.scope === 'tribe' ? `Your tribe${data.scopeName ? `, ${data.scopeName}` : ''}` : 'Everyone still in the game'}, strongest first. Threat is season points, then immunity wins.</p>
      <ul className="space-y-1.5">
        {data.rows.map(row => (
          <li key={row.name} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/25 px-3 py-2 text-sm">
            <span className="min-w-0 font-semibold text-white">{row.name}{you(row.isYou)}{row.onTheBlock ? <span className="ml-2 text-[11px] font-semibold text-rose-200">on the block</span> : null}</span>
            <span className="flex items-center gap-2 text-xs text-white/60">
              <span>{row.seasonPoints} pts</span>
              {row.immunityWins ? <span>{row.immunityWins} immunity</span> : null}
              <span>{row.votesAgainst} vote{row.votesAgainst === 1 ? '' : 's'} drawn</span>
              <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase ${tone[row.threat]}`}>{row.threat}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className={muted}>{data.lastRead ? `Last read, week ${data.lastRead.week}: ${data.lastRead.names.map(n => `${n.name} (${n.votes})`).join(', ') || 'no votes counted'}.` : 'No council has been read yet.'}</p>
    </div>
  )
}

function SocialPulse({ data }: { data: SocialPulseTile }) {
  if (!data.available) return <p className={muted}>{data.reason}</p>
  const health = { lively: 'Lively', steady: 'Steady', quiet: 'Quiet' }[data.health]
  return (
    <div className="space-y-3">
      <p className={muted}>{data.channelName} · last {data.windowDays} days · {data.totalMessages} message{data.totalMessages === 1 ? '' : 's'} · <span className="font-semibold text-white/80">{health}</span>. Counts only; nobody&apos;s messages are read.</p>
      <ul className="space-y-1.5">
        {data.rows.map(row => (
          <li key={row.name} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/25 px-3 py-2 text-sm">
            <span className="font-semibold text-white">{row.name}{you(row.isYou)}</span>
            <span className="text-xs text-white/60">{row.messages} msg{row.lastActiveAt ? ` · last ${when(row.lastActiveAt)}` : ' · silent'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChallengeOutlook({ data }: { data: ChallengeOutlookTile }) {
  if (!data.items.length) return <p className={muted}>{data.week > 0 ? `No challenges posted for week ${data.week} yet.` : 'Challenges start once the season does.'}</p>
  const label = { open: 'Open', locked: 'Locked', settled: 'Settled' }
  return (
    <ul className="space-y-1.5">
      {data.items.map((item, index) => (
        <li key={`${item.title}-${index}`} className="rounded-lg border border-white/[0.06] bg-black/25 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-white">{item.title}</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/60">{label[item.status]} · {item.scope === 'tribe' ? 'Tribe' : 'Individual'}</span>
          </div>
          <p className="mt-1 text-xs text-white/60">
            {item.status === 'open' ? `Locks ${when(item.locksAt)}` : item.status === 'locked' ? 'Waiting on results' : 'Results are in'}
            {item.reward ? ` · Reward: ${item.reward}` : ''}
            {item.status !== 'settled' ? (item.youSubmitted ? ' · You are in' : ' · You have not entered') : ''}
          </p>
        </li>
      ))}
    </ul>
  )
}

function JuryProjection({ data }: { data: JuryProjectionTile }) {
  return (
    <div className="space-y-3">
      <p className={muted}>{data.remaining} still in · final {data.finalistCount} face the jury.</p>
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wide text-white/50">Jury so far</h4>
        <p className="mt-1 text-sm text-white/80">{data.jurors.length ? data.jurors.join(', ') : 'Nobody yet. The jury starts later in the season.'}</p>
      </div>
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wide text-white/50">Best placed to reach the end</h4>
        <ol className="mt-1 space-y-1.5">
          {data.contenders.map((c, index) => (
            <li key={c.name} className="rounded-lg border border-white/[0.06] bg-black/25 px-3 py-2 text-sm">
              <span className="font-semibold text-white">{index + 1}. {c.name}{you(c.isYou)}</span>
              <p className="mt-0.5 text-xs text-white/60">{c.reason}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function ExileStatus({ data }: { data: ExileStatusTile }) {
  if (!data.enabled) return <p className={muted}>Exile Island is off in this league: a voted-out manager is out of the game.</p>
  return (
    <ul className="space-y-1.5 text-sm text-white/80">
      <li>Return: <strong>end of week {data.returnWeek}</strong>{data.weeksUntilReturn != null ? ` (${data.weeksUntilReturn === 0 ? 'this week' : `in ${data.weeksUntilReturn} week${data.weeksUntilReturn === 1 ? '' : 's'}`})` : ''}</li>
      <li>Tokens needed to come back: <strong>{data.tokensNeeded}</strong>, and the most of anyone on Exile</li>
      <li>On Exile now: <strong>{data.onExile}</strong></li>
      <li>{data.you.onExile ? <>Your tokens: <strong>{data.you.tokens}</strong> of {data.tokensNeeded}</> : 'You are not on Exile. Other managers’ token counts stay private.'}</li>
    </ul>
  )
}

function render(payload: SurvivorPremiumTilePayload) {
  switch (payload.tileId) {
    case 'threat_map': return <ThreatMap data={payload.data} />
    case 'social_pulse': return <SocialPulse data={payload.data} />
    case 'challenge_outlook': return <ChallengeOutlook data={payload.data} />
    case 'jury_projection': return <JuryProjection data={payload.data} />
    case 'exile_status': return <ExileStatus data={payload.data} />
  }
}

/** Loads one tile from the server, which re-checks the plan before it returns anything. */
export function SurvivorPremiumTileDetail({ leagueId, tileId, title }: { leagueId: string; tileId: string; title: string }) {
  const [state, setState] = useState<{ loading: boolean; payload: SurvivorPremiumTilePayload | null; error: string | null }>({ loading: true, payload: null, error: null })
  useEffect(() => {
    let cancelled = false
    setState({ loading: true, payload: null, error: null })
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/premium?tile=${encodeURIComponent(tileId)}`, { cache: 'no-store', credentials: 'include' })
      .then(async res => {
        const body = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) setState({ loading: false, payload: null, error: body.error ?? 'Could not load this tile.' })
        else setState({ loading: false, payload: body as SurvivorPremiumTilePayload, error: null })
      })
      .catch(() => { if (!cancelled) setState({ loading: false, payload: null, error: 'Could not load this tile.' }) })
    return () => { cancelled = true }
  }, [leagueId, tileId])
  return (
    <section aria-label={title} data-testid={`survivor-premium-detail-${tileId}`} className="rounded-2xl border border-emerald-400/20 bg-black/30 p-4">
      <h3 className="text-sm font-bold text-white">{title}</h3>
      <div className="mt-3">
        {state.loading ? <p className={muted} role="status">Loading…</p> : state.error ? <p className="text-sm text-amber-200" role="alert">{state.error}</p> : state.payload ? render(state.payload) : null}
      </div>
    </section>
  )
}
