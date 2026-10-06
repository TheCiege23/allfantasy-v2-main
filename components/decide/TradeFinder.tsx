'use client'

/**
 * TradeFinder — "offers likely to get accepted" panel on the Decide tab, from
 * /api/league/trade-finder.
 *
 * Honesty contract: every proposal shows its full rationale (checkable facts:
 * which slot it fills, the ADP gap, the partner's counted trade activity), the
 * method line renders verbatim, and the panel is explicit that market ADP is a
 * conversation starter — not an AF valuation verdict. Honest empty states for
 * unlinked accounts and no-match rosters.
 */

import { useEffect, useState } from 'react'
import type { TradeFinderPayload } from '@/lib/trade-intel/tradeFinderService'
import { sleeperAvatarThumb, sleeperPlayerHeadshot } from '@/lib/sports-data/headshots'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import './broadcast-deck.css'

type ApiResponse =
  | { supported: false; platform: string }
  | { supported: true; linked: false; finder: null }
  | { supported: true; linked: true; finder: TradeFinderPayload | null; error?: string }

function PlayerChip({
  playerId,
  name,
  position,
  team,
  adp,
  marketValue = null,
}: {
  playerId: string
  name: string
  position: string | null
  team: string | null
  adp: number
  marketValue?: number | null
}) {
  const { t } = useOptionalLanguage()
  const src = sleeperPlayerHeadshot(playerId)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', background: '#1c2153' }}
          onError={(e) => e.currentTarget.style.setProperty('display', 'none')}
        />
      ) : null}
      <b>{name}</b>
      <span style={{ color: 'var(--bdx-ink-ghost)', fontSize: 11 }}>
        {position ?? ''}
        {team ? ` · ${team}` : ''}
        {marketValue != null ? t('decide.finder.val').replace('{{value}}', marketValue.toLocaleString()) : ''} · ADP {adp.toFixed(1)}
      </span>
    </span>
  )
}

export function TradeFinder({
  leagueId,
  onOpenTab,
}: {
  leagueId: string
  onOpenTab: (tabId: string) => void
}) {
  const { t } = useOptionalLanguage()
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetch(`/api/league/trade-finder?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => res.json() as Promise<ApiResponse>)
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch(() => {
        if (!cancelled) setData({ supported: true, linked: true, finder: null, error: 'Request failed' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  // Non-sleeper leagues: render nothing rather than a dead panel.
  if (data && !data.supported) return null

  const finder = data && data.supported && 'finder' in data ? data.finder : null

  return (
    <div data-testid="trade-finder" style={{ marginTop: 18 }}>
      <div className="bdx-kick">
        <h2 className="bdx-disp">{t('decide.finder.title')}</h2>
        <span className="bdx-sub">
          {finder
            ? t(finder.proposals.length === 1 ? 'decide.finder.countOne' : 'decide.finder.countMany').replace('{{count}}', String(finder.proposals.length))
            : t('decide.finder.tagline')}
        </span>
      </div>

      {loading ? (
        <div className="bdx-skel" />
      ) : data && data.supported && 'linked' in data && data.linked === false ? (
        <div className="bdx-empty">
          <div className="t">{t('decide.finder.linkTitle')}</div>
          <div className="m">{t('decide.finder.linkMsg')}</div>
        </div>
      ) : !finder ? (
        <div className="bdx-empty">
          <div className="t">{t('decide.finder.unavailableTitle')}</div>
          <div className="m">{t('decide.finder.unavailableMsg')}</div>
        </div>
      ) : !finder.viewer.inLeague ? (
        <div className="bdx-empty">
          <div className="t">{t('decide.finder.notInLeagueTitle')}</div>
          <div className="m">{t('decide.finder.notInLeagueMsg')}</div>
        </div>
      ) : finder.proposals.length === 0 ? (
        <div className="bdx-empty">
          <div className="t">{t('decide.finder.noneTitle')}</div>
          <div className="m">
            {finder.viewer.openSlots.length > 0 || finder.viewer.weakSlots.length > 0
              ? t('decide.finder.needsMsg').replace('{{needs}}', [...finder.viewer.openSlots, ...finder.viewer.weakSlots.map((w) => w.slot)].join(', '))
              : t('decide.finder.coveredMsg')}
          </div>
        </div>
      ) : (
        <>
          {finder.proposals.map((p, i) => {
            const partnerAvatar = sleeperAvatarThumb(p.partner.avatar)
            return (
              <div className="bdx-card c-info" style={{ marginBottom: 10 }} key={`${p.partner.ownerId}-${p.get.playerId}-${i}`}>
                <div className="bdx-head">
                  <span className="bdx-kind">
                    {t('decide.finder.offerTo')}{' '}
                    {partnerAvatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={partnerAvatar}
                        alt=""
                        style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover', verticalAlign: '-3px' }}
                      />
                    ) : null}{' '}
                    {p.partner.name}
                  </span>
                  {p.partner.completedTrades > 0 ? (
                    <span className="bdx-sev ok">{t('decide.finder.careerTrades').replace('{{count}}', String(p.partner.completedTrades))}</span>
                  ) : null}
                  <span className="bdx-when">
                    {p.valueGapPct != null
                      ? t('decide.finder.valueGap').replace('{{pct}}', p.valueGapPct.toFixed(1))
                      : t('decide.finder.adpGap').replace('{{gap}}', p.adpGap.toFixed(1))}
                  </span>
                </div>
                <div className="bdx-line" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--bdx-ink-faint)' }}>{t('decide.youSend')}</span>
                  <PlayerChip {...p.give} />
                  <span style={{ color: 'var(--bdx-ink-faint)' }}>{t('decide.finder.youGet')}</span>
                  <PlayerChip {...p.get} />
                </div>
                <ul className="bdx-why" style={{ marginTop: 8 }}>
                  {p.rationale.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <div className="bdx-acts">
                  <button type="button" className="bdx-btn pri" onClick={() => onOpenTab('trades')}>
                    {t('decide.finder.build')}
                  </button>
                </div>
              </div>
            )
          })}
          <div className="bdx-empty" style={{ marginTop: 4 }}>
            <div className="m">
              <b>{t('decide.finder.method')}</b> {finder.method}
              {finder.contextNotes.map((n) => (
                <span key={n}>
                  <br />
                  {n}
                </span>
              ))}
              {finder.missing.length > 0 ? (
                <>
                  <br />{t('decide.finder.couldntSync').replace('{{list}}', finder.missing.join(', '))}
                </>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default TradeFinder
