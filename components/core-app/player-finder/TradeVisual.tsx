import Link from 'next/link'
import type { SectionState } from '@/lib/core-app/leagueHome'
import type { PlayerTradeVisual, TradeVisualAsset, TradeVisualPackage } from '@/lib/core-app/playerTradeVisual'
import { platformLabel, tradeLink } from '@/lib/core-app/platformLinks'

/**
 * The trade visual — what it takes to get him, and what we recommend.
 *
 * Give on the left, get on the right, the value totals under each, the
 * fairness band between them, then the engine's verdict. The hand-off to the
 * platform sits inside the card (Guap, 2026-09-02): AllFantasy never sends a
 * trade, so the last thing the card does is point at the screen that can.
 */

function fmtValue(n: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US')
}

function fairnessTone(f: TradeVisualPackage['fairness']): 'good' | 'warn' | 'bad' | 'none' {
  if (f === 'balanced' || f === 'slight edge you') return 'good'
  if (f === 'slight edge partner') return 'warn'
  if (f === 'lopsided') return 'bad'
  return 'none'
}

function verdictTone(v: 'accept' | 'reject' | 'counter'): 'good' | 'warn' | 'bad' {
  return v === 'accept' ? 'good' : v === 'counter' ? 'warn' : 'bad'
}

function AssetList({ assets, empty }: { assets: TradeVisualAsset[]; empty: string }) {
  if (assets.length === 0) return <p className="af-pf-tv-empty">{empty}</p>
  return (
    <ul className="af-pf-tv-assets">
      {assets.map((a, i) => (
        <li key={`${a.playerId ?? a.name}-${i}`} className="af-pf-tv-asset">
          <span className="af-pf-tv-asset-name">{a.name}</span>
          <span className="af-pf-tv-asset-meta af-num">{a.position ?? ''}</span>
          <span className="af-pf-tv-asset-value af-num" title="AllFantasy market value">
            {fmtValue(a.value)}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function TradeVisual({ state, playerName }: { state: SectionState<PlayerTradeVisual>; playerName: string }) {
  const last = playerName.trim().split(/\s+/).slice(-1)[0] ?? playerName

  if (!state.available) {
    return (
      <section className="af-card af-pf-tv af-pf-tv--empty" aria-labelledby="af-pf-tv-h">
        <header className="af-pf-tv-head">
          <span className="af-label">Trade for {last}</span>
        </header>
        <p className="af-pf-unavailable">{state.reason}.</p>
      </section>
    )
  }

  const v = state.data
  const rec = v.recommended
  const links = tradeLink({
    id: v.leagueId,
    platform: v.platform,
    platformLeagueId: v.platformLeagueId,
    season: v.season,
    name: v.leagueName,
  })
  const others = v.packages.filter((p) => p.id !== rec?.id)

  return (
    <section className="af-card af-pf-tv" aria-labelledby="af-pf-tv-h" data-fairness={rec?.fairness ?? 'none'}>
      <header className="af-pf-tv-head">
        <span className="af-label">Trade for {last}</span>
        <h3 className="af-pf-h3" id="af-pf-tv-h">
          {rec
            ? `What it takes to get ${last} from ${v.partner.teamName}`
            : `No balanced package for ${last} from ${v.partner.teamName} right now`}
        </h3>
        <p className="af-pf-block-sub">
          {v.partner.teamName}
          {v.partner.ownerName ? ` · @${v.partner.ownerName}` : ''} · {v.partner.stance}
          {v.partner.needs.length > 0 ? ` · needs ${v.partner.needs.join(', ')}` : ''}
          {v.partner.surpluses.length > 0 ? ` · deep at ${v.partner.surpluses.join(', ')}` : ''}
        </p>
      </header>

      {rec ? (
        <>
          <div className="af-pf-tv-sides">
            <div className="af-pf-tv-side" data-side="give">
              <span className="af-label">You give</span>
              <AssetList assets={rec.give} empty="Nothing" />
              <span className="af-pf-tv-total af-num">{fmtValue(rec.giveTotal)}</span>
            </div>
            <div className="af-pf-tv-arrow" aria-hidden>
              ⇄
            </div>
            <div className="af-pf-tv-side" data-side="get">
              <span className="af-label">You get</span>
              <AssetList assets={rec.receive} empty="Nothing" />
              <span className="af-pf-tv-total af-num">{fmtValue(rec.receiveTotal)}</span>
            </div>
          </div>

          <div className="af-pf-tv-verdict">
            <span className="af-chip af-num af-pf-tv-fairness" data-tone={fairnessTone(rec.fairness)}>
              {rec.fairness}
            </span>
            <span className="af-pf-tv-delta af-num" data-tone={rec.delta >= 0 ? 'good' : 'warn'}>
              {rec.delta >= 0 ? '+' : ''}
              {fmtValue(rec.delta)} value to you
            </span>
            {v.grade.available ? (
              <>
                <span className="af-chip af-num af-pf-tv-engine" data-tone={verdictTone(v.grade.data.verdict)}>
                  Engine: {v.grade.data.verdict} · {v.grade.data.verdictConfidence}
                </span>
                <span className="af-pf-tv-lineup af-num" data-tone={v.grade.data.starterDeltaPts >= 0 ? 'good' : 'bad'}>
                  {v.grade.data.starterDeltaPts >= 0 ? '+' : ''}
                  {v.grade.data.starterDeltaPts.toFixed(1)} starter pts
                </span>
                {v.grade.data.acceptance != null ? (
                  <span className="af-pf-tv-accept af-num">{Math.round(v.grade.data.acceptance * 100)}% likely to accept</span>
                ) : null}
              </>
            ) : (
              <span className="af-pf-nothing">Engine grade: {v.grade.reason}</span>
            )}
          </div>

          {rec.reasons.length > 0 || (v.grade.available && v.grade.data.explanations.length > 0) ? (
            <ul className="af-pf-tv-reasons">
              {rec.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
              {v.grade.available ? v.grade.data.explanations.map((r) => <li key={r}>{r}</li>) : null}
              {v.grade.available && v.grade.data.lineupNote ? <li>{v.grade.data.lineupNote}</li> : null}
            </ul>
          ) : null}

          {others.length > 0 ? (
            <div className="af-pf-tv-others">
              <span className="af-label">Other packages</span>
              <ul className="af-pf-tv-other-list">
                {others.map((p) => (
                  <li key={p.id} className="af-pf-tv-other">
                    <span className="af-pf-tv-other-text">
                      {p.give.map((a) => a.name).join(' + ')} for {p.receive.map((a) => a.name).join(' + ')}
                    </span>
                    <span className="af-chip af-num af-pf-tv-fairness" data-tone={fairnessTone(p.fairness)}>
                      {p.fairness}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p className="af-pf-unavailable">
          The package finder found nothing balanced from your surplus positions. Try the Trade Center to build one by hand.
        </p>
      )}

      <div className="af-pf-tv-actions">
        {links.there ? (
          <a className="af-btn af-pf-tv-btn" href={links.there.href} target="_blank" rel="noopener noreferrer">
            Send it on {links.there.platformLabel}
          </a>
        ) : null}
        <Link className={`af-btn af-pf-tv-btn${links.there ? ' af-btn--ghost' : ''}`} href={links.here.href}>
          Open Trade Center
        </Link>
      </div>

      <p className="af-pf-readonly-note">
        Values are AllFantasy market values ({v.values.mode}, {v.values.ppr} PPR, {v.values.numQbs === 2 ? 'superflex' : '1QB'}).
        AllFantasy never sends a trade — you send it on {platformLabel(v.platform)}.
      </p>
    </section>
  )
}

export default TradeVisual
