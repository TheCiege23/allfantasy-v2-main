'use client'

/**
 * Guilly hub (design-refs/native-league-handoff/guilly/ GuillyHome + GuillyGraveyard + MobileGuillyChop).
 * Reads the existing guillotine summary; every tier and chop is the engine's.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  SpecialtyCard, SpecialtyGrid, SpecialtyHero, SpecialtyReplayButton, SpecialtyRules, SpecialtyShell, SpecialtyTag,
  usePrefersReducedMotion,
} from '@/components/league/specialty/SpecialtyShell'
import { GUILLY_ART, bladeStatus, buildGuillyHub, describeTiebreak, headSrc, type GuillySummaryPayload } from '@/lib/guilly/hub'
import { GUILLY_NOTIFICATION_DEFAULTS } from '@/lib/guilly/setup'
import g from './guilly.module.css'

function cx(...p: Array<string | false | null | undefined>) {
  return p.filter(Boolean).join(' ')
}

export function GuillyHome({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<GuillySummaryPayload | null>(null)
  const [error, setError] = useState('')
  const [replay, setReplay] = useState(0)
  const reduced = usePrefersReducedMotion()
  useEffect(() => {
    let live = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary`, { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error ?? 'This Guilly league is not available.')
        if (live) setData(body as GuillySummaryPayload)
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'This Guilly league is not available.'))
    return () => { live = false }
  }, [leagueId])
  const hub = useMemo(() => (data ? buildGuillyHub(data) : null), [data])

  if (!hub || !data) return <SpecialtyShell format="guillotine"><p role="status">{error || 'Loading Guilly…'}</p></SpecialtyShell>

  const lineIdx = hub.blade.findIndex((r) => r.tier === 'chop_zone')
  const me = hub.me
  const maxOver = Math.max(1, ...hub.blade.map((r) => r.overBlade))
  const neckPct = me ? Math.min(100, Math.max(0, (me.overBlade / maxOver) * 100)) : 0
  const latestChop = hub.graveyard[0]

  const main = (
    <>
      <SpecialtyCard label={`The blade line · week ${hub.week} · projected`} icon={headSrc('nervous')} testId="guilly-blade">
        {hub.blade.length === 0 ? <p style={{ margin: 0, color: '#9aa3b8' }}>Projections appear once the week has a schedule and rosters.</p> : (
          <ol className={g.bl}>
            {hub.blade.map((r, i) => (
              <li key={r.rosterId} className={cx(r.you && g.you, r.tier === 'chop_zone' && g.zone)} data-tier={r.tier}
                style={i === lineIdx && i > 0 ? { marginTop: 30, position: 'relative' } : undefined}>
                {i === lineIdx && i > 0 ? <div className={g.line} style={{ position: 'absolute', left: 0, right: 0, top: -18, margin: 0 }}><span>BLADE LINE</span></div> : null}
                <span className={g.mono} style={{ color: '#9aa3b8' }}>{i + 1}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={headSrc(r.head)} alt="" aria-hidden />
                <span className={g.nm}>{r.you ? `You · ${r.name}` : r.name}<small>{r.seasonPoints != null ? `${r.seasonPoints.toFixed(1)} season pts` : ' '}</small></span>
                <span className={g.mono}>+{r.overBlade.toFixed(1)}</span>
                <span className={g.st}><SpecialtyTag tone={r.tier === 'chop_zone' ? 'danger' : r.tier === 'danger' ? 'gold' : 'safe'}>{bladeStatus(r.tier)}</SpecialtyTag></span>
              </li>
            ))}
          </ol>
        )}
        <p style={{ margin: '12px 0 0', fontSize: 13, color: '#9aa3b8' }}>Points over the projected lowest score. {describeTiebreak(data.config?.tiebreakerOrder)}</p>
      </SpecialtyCard>

      {latestChop ? (
        <SpecialtyCard label={`Chop night · week ${latestChop.week}`} aside={<SpecialtyReplayButton onReplay={() => setReplay((n) => n + 1)} />} testId="guilly-chop">
          <div key={replay} className={cx(g.chop, !reduced && g.shake)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={cx(g.scene, !reduced && g.blade)} src={`${GUILLY_ART}/chop.svg`} alt="" aria-hidden />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={g.head} src={`${GUILLY_ART}/off-with-your-head.svg`} alt="Off with your head" />
            <p style={{ fontSize: 18, fontWeight: 800, margin: '8px 0 0' }}>{hub.iWasChopped ? 'Your head rolled.' : `${latestChop.name} was chopped.`}</p>
            <p style={{ margin: '4px 0 0', color: '#9aa3b8', fontSize: 14 }}>Their roster goes into the basket: {data.config?.rosterReleaseTiming === 'immediate' ? 'free agency now' : 'blind FAAB at the next waiver run'}.</p>
          </div>
        </SpecialtyCard>
      ) : null}

      <SpecialtyCard label={`The graveyard · ${hub.graveyard.length} heads`} icon={`${GUILLY_ART}/icon-tomb.svg`} testId="guilly-graveyard">
        {hub.graveyard.length === 0 ? <p style={{ margin: 0, color: '#9aa3b8' }}>Nobody has lost their head yet.</p> : (
          <div className={g.grave}>
            {hub.graveyard.map((t) => (
              <div key={`${t.rosterId}-${t.week}`} className={g.stone}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${GUILLY_ART}/tombstone.svg`} alt="" aria-hidden />
                <span>{t.name}</span>
                <small>Week {t.week}</small>
              </div>
            ))}
          </div>
        )}
      </SpecialtyCard>
    </>
  )

  const rail = (
    <>
      <SpecialtyCard borderColor="rgba(242,201,76,.5)" testId="guilly-neck">
        {me ? (
          <>
            <div className={g.neck}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={headSrc(me.head)} alt="" aria-hidden />
              <div><span style={{ fontSize: 12, letterSpacing: '.12em', color: '#f2c94c' }}>YOUR NECK THIS WEEK</span><strong>+{me.overBlade.toFixed(1)}</strong><span style={{ fontSize: 13, color: '#9aa3b8' }}>projected over the blade</span></div>
            </div>
            <div className={g.meter} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(neckPct)} aria-label="Margin over the blade"><i style={{ left: `${neckPct}%` }} /></div>
            <div className={g.meterLbl}><span>CHOPPED</span><span>SWEATING</span><span>SAFE</span></div>
          </>
        ) : hub.iWasChopped ? (
          <div className={g.neck}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={headSrc('ko')} alt="" aria-hidden /><p style={{ margin: 0 }}>You were chopped. You can still watch every chop night.</p>
          </div>
        ) : hub.champion ? (
          <div className={g.neck}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={headSrc('crown')} alt="" aria-hidden /><p style={{ margin: 0 }}>{hub.champion.name} is the last team standing.</p>
          </div>
        ) : <p style={{ margin: 0, color: '#9aa3b8' }}>Claim a team to see your margin over the blade.</p>}
      </SpecialtyCard>
      <SpecialtyCard label="How Guilly works">
        <SpecialtyRules rules={[
          'Everyone plays everyone: one weekly points race across the whole league.',
          `The lowest weekly score is chopped${data.config && data.config.teamsPerChop > 1 ? ` (${data.config.teamsPerChop} per week)` : ''}, starting week ${data.config?.eliminationStartWeek ?? 1}.`,
          'Their whole roster drops into blind FAAB at the next waiver run.',
          'Last team standing wins. Your FAAB has to last all season.',
        ]} />
      </SpecialtyCard>
      <SpecialtyCard label="Notification defaults">
        <details>
          <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Show default channels</summary>
          <table className={g.channels}>
            <thead><tr><th scope="col">Moment</th><th scope="col">Push</th><th scope="col">In-app</th><th scope="col">Email</th><th scope="col">Chat</th></tr></thead>
            <tbody>{GUILLY_NOTIFICATION_DEFAULTS.map((n) => <tr key={n.moment}><td>{n.moment}</td>{[n.push, n.inApp, n.email, n.chat].map((on, i) => <td key={i}>{on ? 'On' : 'Off'}</td>)}</tr>)}</tbody>
          </table>
        </details>
      </SpecialtyCard>
    </>
  )

  return (
    <SpecialtyShell format="guillotine" testId="guilly-home">
      <SpecialtyHero
        format="guillotine"
        bannerSrc={`${GUILLY_ART}/banner.svg`}
        emblemSrc={`${GUILLY_ART}/emblem.svg`}
        emblemAlt="Guilly emblem"
        chips={['NBA', 'Guilly', `${hub.alive} alive`]}
        title="Guilly"
        headline={me ? `Week ${hub.week} · projected ${me.overBlade.toFixed(1)} over the blade` : `Week ${hub.week}`}
        blurb="One league-wide points race. Every week the lowest score gets chopped, off with their head, and their whole roster goes to waivers. Last team standing wins."
        actions={[
          { label: 'Open league', href: `/league/${encodeURIComponent(leagueId)}`, primary: true },
        ]}
      />
      <SpecialtyGrid main={main} rail={rail} />
    </SpecialtyShell>
  )
}
