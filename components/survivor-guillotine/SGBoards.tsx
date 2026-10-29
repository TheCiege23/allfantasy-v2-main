'use client'

/**
 * Survivor Guillotine follow-up boards (handoff2). Each is a panel the visual set mounts; all data is
 * the member-safe season payload, shaped by lib/survivor-guillotine/visual-boards.ts.
 */

import { useState } from 'react'
import { SpecialtyCard, SpecialtyTag, usePrefersReducedMotion } from '@/components/league/specialty/SpecialtyShell'
import { SG_ART } from '@/lib/survivor-guillotine/visual-model'
import type {
  SGBladeMeter, SGChopCard, SGMultiRow, SGReleasedPlayer, buildReversals, buildTribeDraw, buildTribeSetupView,
} from '@/lib/survivor-guillotine/visual-boards'
import s from './survguil.module.css'

function cx(...p: Array<string | false | null | undefined>) {
  return p.filter(Boolean).join(' ')
}

/* SGLineup: blade meter + play-idol shortcut */
export function SGLineupMeter({ meter, heldIdolId, idolLabel, onPlayIdol, lockText }: {
  meter: SGBladeMeter; heldIdolId: string | null; idolLabel: string | null; onPlayIdol?: (id: string) => void; lockText: string | null
}) {
  const tone = meter.tier === 'chop_zone' ? 'danger' : meter.tier === 'danger' ? 'gold' : 'safe'
  return (
    <SpecialtyCard label="My lineup · blade meter" icon={`${SG_ART}/guillotine.svg`} testId="sg-lineup" borderColor={meter.tier === 'chop_zone' ? 'rgba(224,64,46,.5)' : meter.tier === 'danger' ? 'rgba(232,184,74,.5)' : undefined}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div>
          <SpecialtyTag tone={tone}>{meter.tier === 'chop_zone' ? 'Chop zone' : meter.tier === 'danger' ? 'Danger' : meter.tier === 'immune' ? 'Tribe ahead' : 'Safe'}</SpecialtyTag>
          <h3 style={{ margin: '6px 0 2px', fontSize: 20 }}>{meter.headline}</h3>
          <p style={{ margin: 0, color: '#b9c0d0', fontSize: 14 }}>{meter.sub}</p>
        </div>
        <div style={{ textAlign: 'right' }}><b className={s.mono} style={{ fontSize: 30 }}>{meter.you.toFixed(1)}</b><div style={{ fontSize: 12, color: '#9aa3b8' }}>your live points</div></div>
      </div>
      {meter.tier !== 'immune' ? (
        <div className={s.meterWrap}>
          <div className={s.meter} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(meter.youPct)} aria-label={`Your score against the blade: ${meter.margin.toFixed(1)} points`}>
            <i className={s.mark} style={{ left: `${meter.bladePct}%` }}><span>{meter.bladeName ? `${meter.bladeName} · ${meter.blade.toFixed(1)}` : `Blade · ${meter.blade.toFixed(1)}`}</span></i>
            <i className={cx(s.mark, s.markYou)} style={{ left: `${meter.youPct}%` }}><span>You · {meter.you.toFixed(1)}</span></i>
          </div>
          <div className={s.meterLbl}><span>Chop zone</span><span>Danger · within 10</span><span>Safe</span></div>
        </div>
      ) : null}
      {heldIdolId && onPlayIdol ? (
        <div className={s.idol} style={{ marginTop: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${SG_ART}/idol-block.svg`} alt="" aria-hidden className={s.glow} />
          <div>
            <h3>{idolLabel} in your vault</h3>
            <p>{lockText ? `Play it before ${lockText}.` : 'Play it before the deadline.'} It stays sealed until the chop.</p>
            <button type="button" className={s.primaryBtn} onClick={() => onPlayIdol(heldIdolId)}>Play idol</button>
          </div>
        </div>
      ) : null}
      <p style={{ margin: '10px 0 0', fontSize: 12, color: '#9aa3b8' }}>Set starters in your league roster (or the daily lineup below for capped-games NBA). The meter uses live points against the engine&apos;s chop field.</p>
    </SpecialtyCard>
  )
}

/* SGMultiRace: 3–4 tribes, engine rule */
export function SGMultiRaceBoard({ rows }: { rows: SGMultiRow[] }) {
  return (
    <div data-testid="sg-multirace">
      <ol className={s.multi}>
        {rows.map((r) => (
          <li key={r.tribeId} className={cx(r.status === 'immune' && s.multiSafe, r.status === 'chop_field' && s.multiField)}>
            <b className={s.mono}>#{r.rank}</b>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.buffSrc} alt="" aria-hidden />
            <span className={s.cinzel} style={{ color: r.color }}>{r.name}</span>
            <span className={s.mono}>{r.value == null ? '—' : r.label === 'Matchup wins' ? r.value : r.value.toFixed(1)}</span>
            <SpecialtyTag tone={r.status === 'immune' ? 'safe' : r.status === 'chop_field' ? 'danger' : 'muted'}>
              {r.status === 'immune' ? 'Immune' : r.status === 'chop_field' ? 'In the chop field' : r.status === 'tied' ? 'Tied for first' : 'Waiting'}
            </SpecialtyTag>
          </li>
        ))}
      </ol>
      <p className={s.metricNote}>One tribe earns immunity. Every other tribe is in the chop field, and the lowest score across them is chopped.</p>
    </div>
  )
}

/* SGTribeDraw + MobileSGTribeDraw: your tribe and your sealed idol */
export function SGTribeDrawCard({ draw }: { draw: ReturnType<typeof buildTribeDraw> }) {
  const reduced = usePrefersReducedMotion()
  const [open, setOpen] = useState(false)
  return (
    <SpecialtyCard label="Your tribe" testId="sg-tribedraw">
      {draw.tribe ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={draw.tribe.buffSrc} alt="" aria-hidden style={{ width: 64, height: 'auto' }} className={reduced ? undefined : s.pop} />
          <div>
            <h3 className={s.cinzel} style={{ margin: 0, color: draw.tribe.color }}>{draw.tribe.name}{draw.captain ? ' · captain' : ''}</h3>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#b9c0d0' }}>{draw.tribemates.length ? `With ${draw.tribemates.join(', ')}` : 'Tribemates appear here.'}</p>
          </div>
        </div>
      ) : <p style={{ margin: 0, color: '#b9c0d0' }}>Tribes are not set yet. {draw.formation}.</p>}
      {draw.idols.length ? (
        <div style={{ marginTop: 12 }}>
          {!open ? (
            <button type="button" className={s.sealed} onClick={() => setOpen(true)} aria-expanded={false}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${SG_ART}/idol-block.svg`} alt="" aria-hidden />
              <span><b>You were dealt {draw.idols.length === 1 ? 'a hidden power' : `${draw.idols.length} hidden powers`}</b><small>Only you can see this. Tap to open.</small></span>
            </button>
          ) : draw.idols.map((p) => (
            <div key={p.id} className={s.idol}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.src} alt="" aria-hidden className={reduced ? undefined : s.pop} />
              <div>
                <h3>{p.label}</h3>
                <p>{p.attachedTo ? `Attached to ${p.attachedTo}. It moves with that player if they change rosters.` : 'Tied to you, not a player.'} Expires after period {p.throughPeriod}.</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </SpecialtyCard>
  )
}

/* SGTribeSetup + MobileSGTribeSetup: engine tribe settings */
export function SGTribeSetupCard({ view, rulesHref }: { view: ReturnType<typeof buildTribeSetupView>; rulesHref: string | null }) {
  return (
    <SpecialtyCard label="Tribe setup" testId="sg-tribesetup">
      <div className={s.countRow} role="list" aria-label="Tribe counts">
        {view.counts.map((c) => (
          <span key={c.count} role="listitem" className={cx(s.countChip, c.count === view.tribeCount && s.countOn, !c.allowed && s.countOff)} title={c.reason ?? `${c.sizes}`}>
            {c.count}
          </span>
        ))}
      </div>
      <p style={{ margin: '8px 0', fontSize: 13, color: '#b9c0d0' }}>{view.tribeCount} tribes · {view.counts.find((c) => c.count === view.tribeCount)?.sizes}. {view.formation}.{view.shuffles.length ? ` Shuffles in period${view.shuffles.length > 1 ? 's' : ''} ${view.shuffles.join(', ')}.` : ''}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {view.tribes.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={t.tribeId} src={t.buffSrc} alt={t.name} title={t.name} style={{ width: 52, height: 'auto' }} />
        ))}
        <span style={{ color: '#9aa3b8', fontSize: 13 }}>→</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={view.merged.buffSrc} alt={`Merged: ${view.merged.name}`} style={{ width: 52, height: 'auto' }} />
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 12, color: '#9aa3b8' }}>Display names use the Island words pack. Custom names, rival pairs and theme packs are not saved by the league yet.</p>
      {rulesHref ? <a className={s.textLink} href={rulesHref}>Change tribe count or formation</a> : null}
    </SpecialtyCard>
  )
}

/* SGTribeChat: the AF chop card as the engine posts it to league chat */
export function SGChopCardView({ card }: { card: SGChopCard }) {
  return (
    <SpecialtyCard label="League chat · AF chop card" testId="sg-chopcard">
      <div className={s.chatCard}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={card.art} alt="" aria-hidden />
        <div>
          <b>{card.title}</b>
          {card.lines.map((l) => <span key={l}>{l}</span>)}
        </div>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 12, color: '#9aa3b8' }}>Posted to the league channel by the chop. Private tribe channels are not part of this league format yet.</p>
    </SpecialtyCard>
  )
}

/* SGWaivers */
export function SGWaiversCard({ players, faab, waiverHref, teamName }: { players: SGReleasedPlayer[]; faab: number | null; waiverHref: string; teamName: (id: string) => string }) {
  if (!players.length) return null
  const period = players[0].period
  const from = [...new Set(players.map((p) => teamName(p.fromRosterId)))].join(', ')
  return (
    <SpecialtyCard label={`Waivers · ${from}'s roster`} icon={`${SG_ART}/icon-chop.svg`} testId="sg-waivers" aside={faab != null ? <span className={s.mono} style={{ fontSize: 13 }}>${faab} FAAB left</span> : undefined}>
      <ul className={s.waivers}>
        {players.map((p) => (
          <li key={p.id}>
            <span className={s.pos}>{p.position}</span>
            <span className={s.mname}>{p.name}<small>{p.team ?? 'FA'}</small></span>
            <SpecialtyTag tone={p.available ? 'safe' : 'muted'}>{p.available ? 'On waivers' : 'Claimed'}</SpecialtyTag>
          </li>
        ))}
      </ul>
      <p style={{ margin: '8px 0', fontSize: 13, color: '#b9c0d0' }}>Released by the period {period} chop. Bids are blind FAAB; the league waiver run decides them. Chopped managers cannot bid.</p>
      <a className={s.primaryBtn} href={waiverHref}>Place FAAB bids</a>
    </SpecialtyCard>
  )
}

/* SGReversal */
export function SGReversalCard({ rows }: { rows: ReturnType<typeof buildReversals> }) {
  const r = rows[0]
  if (!r) return null
  return (
    <SpecialtyCard label={`Chop reversed · period ${r.period}`} testId="sg-reversal" borderColor="rgba(58,168,106,.45)">
      <div className={s.stageBody}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${SG_ART}/torch-lit.svg`} alt="" aria-hidden className={s.stageArt} style={{ width: 80, height: 160 }} />
        <div>
          <span className={s.stageEyebrow}>Stat correction{r.when ? ` · ${new Date(r.when).toLocaleString()}` : ''}</span>
          <h3 className={s.stageTitle} style={{ fontSize: 24 }}>{r.restored} is back.{r.newlyChopped.length ? ` ${r.newlyChopped.join(', ')} ${r.newlyChopped.length > 1 ? 'are' : 'is'} chopped.` : ''}</h3>
          <p style={{ margin: 0, color: '#d7dbe6', fontSize: 14 }}>Corrected final scores changed period {r.period}. Their roster came back, except any player another manager had already won on waivers.</p>
        </div>
      </div>
      <ol className={s.steps}>
        {r.steps.map((st, i) => (
          <li key={st.title} className={s.on}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={st.art} alt="" aria-hidden />
            <b>STEP {i + 1}</b>
            <span>{st.title}</span>
            <span style={{ fontSize: 12, color: '#9aa3b8' }}>{st.detail}</span>
          </li>
        ))}
      </ol>
    </SpecialtyCard>
  )
}
