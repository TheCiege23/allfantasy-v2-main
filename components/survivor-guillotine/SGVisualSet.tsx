'use client'

/**
 * Survivor Guillotine visual set (design-refs/native-league-handoff/survivor-guillotine/).
 *
 * Presentation only. All numbers come from the member-safe season payload; the model in
 * lib/survivor-guillotine/visual-model.ts follows the engine's rules and labels live values as
 * projections. The functional controls (lineups, tribe choices, Chimmy power commands, commissioner
 * tools) stay in SurvivorGuillotineLeague below this set.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  SpecialtyCard,
  SpecialtyCountdown,
  SpecialtyFeed,
  SpecialtyGrid,
  SpecialtyHero,
  SpecialtyRules,
  SpecialtyShell,
  SpecialtyTag,
  specialtyAvatarColor,
  specialtyInitials,
  usePrefersReducedMotion,
  type SpecialtyAction,
  type SpecialtyFeedItem,
} from '@/components/league/specialty/SpecialtyShell'
import {
  SG_ART,
  SG_NOTIFICATION_DEFAULTS,
  buildCeremony,
  buildChopLine,
  buildIdolVault,
  buildTimeline,
  buildTorches,
  buildTribeRace,
  sgMergePeriod,
  sgPhase,
  sgTribeArt,
  shareCardsFor,
  type SGVisualInput,
} from '@/lib/survivor-guillotine/visual-model'
import {
  buildBladeMeter, buildMultiRace, buildReversals, buildTribeDraw, buildTribeSetupView, sgChopCardFromHistory,
  type SGOwnPlayer, type SGReleasedPlayer, type SGReversalRow,
} from '@/lib/survivor-guillotine/visual-boards'
import { SGChopCardView, SGLineupMeter, SGMultiRaceBoard, SGReversalCard, SGTribeDrawCard, SGTribeSetupCard, SGWaiversCard } from './SGBoards'
import s from './survguil.module.css'

export type SGVisualExtras = {
  ownPlayers?: SGOwnPlayer[]
  releasedPlayers?: SGReleasedPlayer[]
  reversals?: SGReversalRow[]
  faabRemaining?: number | null
  /** Opens the private Chimmy power panel for this power (the existing control below the set). */
  onPlayPower?: (powerId: string) => void
}

function cx(...p: Array<string | false | null | undefined>) {
  return p.filter(Boolean).join(' ')
}

function Buff({ tribeId }: { tribeId: string }) {
  const art = sgTribeArt(tribeId)
  return (
    <div className={s.tb} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={s.tbB} src={art.buffSrc} alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={s.tbS} src={art.symbolSrc} alt="" />
      <span>{art.name}</span>
    </div>
  )
}

function Avatar({ id, name }: { id: string; name: string }) {
  return <span className={s.av} style={{ background: specialtyAvatarColor(id) }} aria-hidden>{specialtyInitials(name)}</span>
}

export function SGVisualSet({
  input,
  leagueId,
  isCommissioner,
  extras = {},
}: {
  input: SGVisualInput
  leagueId: string
  isCommissioner: boolean
  extras?: SGVisualExtras
}) {
  const { season } = input
  const reduced = usePrefersReducedMotion()
  const phase = sgPhase(season.config, season.currentPeriod, season.status)
  const race = useMemo(() => buildTribeRace(input), [input])
  const chopLine = useMemo(() => buildChopLine(input, race), [input, race])
  const vault = useMemo(() => buildIdolVault(input), [input])
  const torches = useMemo(() => buildTorches(input), [input])
  const timeline = useMemo(() => buildTimeline(input), [input])
  const shares = useMemo(() => shareCardsFor(input), [input])
  const mergeAt = sgMergePeriod(season.config)
  const meter = useMemo(() => buildBladeMeter(input, race), [input, race])
  const multi = useMemo(() => buildMultiRace(race), [race])
  const draw = useMemo(() => buildTribeDraw(input, extras.ownPlayers ?? []), [input, extras.ownPlayers])
  const setupView = useMemo(() => buildTribeSetupView(season.config), [season.config])
  const reversals = useMemo(() => buildReversals(extras.reversals ?? [], input.teams, season.periodHistory), [extras.reversals, input.teams, season.periodHistory])
  const heldImmunity = vault.mine.find((p) => p.status === 'held' && (p.kind === 'personal_immunity' || p.kind === 'ally_immunity')) ?? null
  const teamName = (id: string) => input.teams.find((t) => t.legacyRosterId === id)?.teamName ?? 'A chopped team'
  const alive = torches.filter((t) => t.lit).length

  const completed = useMemo(() => Object.entries(season.periodHistory)
    .filter(([, r]) => !r.hostedCeremony || r.hostedCeremony.stage >= 3)
    .sort((a, b) => Number(b[0]) - Number(a[0])), [season.periodHistory])
  const latest = completed[0]
  const steps = useMemo(() => (latest ? buildCeremony(latest[0], latest[1], input.teams) : []), [latest, input.teams])
  const [step, setStep] = useState(0)
  const latestPeriod = latest?.[0] ?? ''
  useEffect(() => { setStep(reduced ? Math.max(0, steps.length - 1) : 0) }, [steps.length, reduced, latestPeriod])

  const state = season.periodState
  const lockAt = state?.immunityDeadlineAt ?? state?.ceremonyAt ?? null
  const myTribe = season.tribes.find((m) => m.rosterId === input.ownRosterId)?.tribeId ?? null
  const headline = phase.phase === 'completed'
    ? 'The last torch is still burning.'
    : season.currentPeriod
      ? `Period ${season.currentPeriod} · ${phase.label}${race.projectedImmuneTribeId && myTribe ? (race.projectedImmuneTribeId === myTribe ? ' · your tribe is ahead' : ' · your tribe is behind') : ''}`
      : 'Tribes form after the draft.'

  const actions: SpecialtyAction[] = [
    { label: 'Tribe race', href: '#sg-race', primary: true },
    { label: 'Idol vault', href: '#sg-vault' },
    { label: 'Watch the chop', href: '#sg-chop' },
  ]
  if (isCommissioner) actions.push({ label: 'League rules', href: `/survivor-guillotine/setup?leagueId=${encodeURIComponent(leagueId)}` })

  const feed: SpecialtyFeedItem[] = timeline.slice().reverse().slice(0, 4).flatMap((t) => {
    const items: SpecialtyFeedItem[] = []
    if (t.chopped.length) items.push({ id: `c${t.period}`, icon: `${SG_ART}/icon-chop.svg`, title: `${t.chopped.join(', ')} ${t.chopped.length > 1 ? 'were' : 'was'} chopped`, sub: `Period ${t.period} · ${t.mode}` })
    if (t.saved.length) items.push({ id: `s${t.period}`, icon: `${SG_ART}/icon-idolsave.svg`, title: 'An idol passed the blade on', sub: `Period ${t.period} · ${t.saved.join(', ')} survived` })
    if (t.immuneTribe) items.push({ id: `i${t.period}`, icon: `${SG_ART}/icon-safe.svg`, title: `${t.immuneTribe} won immunity`, sub: `Period ${t.period}` })
    return items
  })

  const two = race.tribes.length === 2 ? race.tribes : null
  const twoTotal = two ? Math.max(1, (two[0].metric ?? two[0].totalPoints) + (two[1].metric ?? two[1].totalPoints)) : 1
  const stepNow = steps[step]

  const main = (
    <>
      {meter ? <SGLineupMeter meter={meter} heldIdolId={heldImmunity?.id ?? null} idolLabel={heldImmunity?.label ?? null}
        onPlayIdol={extras.onPlayPower} lockText={lockAt ? new Date(lockAt).toLocaleString() : null} /> : null}
      <SpecialtyCard id="sg-race" label={`Tribe race · ${season.currentPeriod ? `period ${season.currentPeriod}` : 'before period 1'}`} testId="sg-race">
        <div className={s.scene}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={s.sceneBg} src={`${SG_ART}/bg/beach-dusk.svg`} alt="" aria-hidden />
          <div className={s.sceneIn}>
            {race.tribes.length === 0 ? (
              <p style={{ margin: 0 }}>Tribes have not been formed yet. They appear here once the commissioner or the draw sets them.</p>
            ) : two ? (
              <div className={s.raceTop}>
                <Buff tribeId={two[0].tribeId} />
                <div className={s.raceMid}>
                  <div className={s.raceNames}>
                    <span className={s.cinzel} style={{ color: two[0].color }}>{two[0].name} <b className={s.mono}>{fmt(two[0].metric ?? two[0].totalPoints, two[0].metricLabel)}</b></span>
                    <span className={s.cinzel} style={{ color: two[1].color }}><b className={s.mono}>{fmt(two[1].metric ?? two[1].totalPoints, two[1].metricLabel)}</b> {two[1].name}</span>
                  </div>
                  <div className={s.split} role="img" aria-label={`${two[0].name} ${two[0].metric ?? two[0].totalPoints}, ${two[1].name} ${two[1].metric ?? two[1].totalPoints} (${two[0].metricLabel})`}>
                    <i style={{ width: `${((two[0].metric ?? two[0].totalPoints) / twoTotal) * 100}%`, background: two[0].color }} />
                    <i style={{ flex: 1, background: two[1].color }} />
                  </div>
                  <div className={s.metricNote}>Deciding metric: {two[0].metricLabel.toLowerCase()} · tribe points {two[0].totalPoints.toFixed(1)} – {two[1].totalPoints.toFixed(1)}</div>
                  <p className={s.raceSummary}>{race.summary}</p>
                </div>
                <Buff tribeId={two[1].tribeId} />
              </div>
            ) : (
              <>
                <SGMultiRaceBoard rows={multi} />
                <p className={s.raceSummary}>{race.summary}</p>
              </>
            )}
          </div>
        </div>
        {race.tribes.length > 0 ? (
          <div className={s.tribeCols}>
            {race.tribes.map((t) => (
              <div key={t.tribeId} className={s.tribeCol} style={{ borderColor: t.standing === 'trailing' ? 'rgba(224,64,46,.45)' : t.standing === 'leading' ? 'rgba(58,168,106,.45)' : undefined }}>
                <div className={s.tribeHead}>
                  <div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.buffSrc} alt="" aria-hidden />
                    <h3 style={{ color: t.color }}>{t.name}</h3>
                  </div>
                  {t.standing !== 'pending' ? <SpecialtyTag tone={t.standing === 'leading' ? 'safe' : t.standing === 'tied' ? 'gold' : 'danger'}>{t.standing}</SpecialtyTag> : null}
                </div>
                {t.members.map((m) => (
                  <div key={m.rosterId} className={cx(s.mrow, m.you && s.you)}>
                    <Avatar id={m.rosterId} name={m.name} />
                    <span className={s.mname}>{m.name}{m.you ? ' (you)' : ''}<small>{[m.captain && 'Captain', m.sittingOut && 'Sitting out'].filter(Boolean).join(' · ') || ' '}</small></span>
                    <span className={s.mono}>{m.points == null ? '—' : m.points.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </SpecialtyCard>

      <SpecialtyCard label="Chop line" icon={`${SG_ART}/icon-zone.svg`} aside={<span style={{ fontSize: 12, color: '#9aa3b8' }}>Live points</span>} testId="sg-chopline">
        {chopLine.groups.length === 0 ? <p style={{ margin: 0, color: '#b9c0d0' }}>{chopLine.note}</p> : chopLine.groups.map((g) => {
          const top = Math.max(1, ...g.rows.map((r) => r.points))
          return (
            <div key={g.label} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, letterSpacing: '.12em', color: '#9aa3b8', textTransform: 'uppercase' }}>{g.label}</div>
              {g.rows.map((r) => (
                <div key={r.rosterId} className={cx(s.mrow, r.you && s.you, r.tier === 'chop_zone' && s.zone)} data-tier={r.tier}>
                  <Avatar id={r.rosterId} name={r.name} />
                  <span className={s.mname} style={{ flex: '0 1 30%' }}>{r.name}{r.you ? ' (you)' : ''}</span>
                  <span className={s.bar} aria-hidden><i style={{ width: `${(r.points / top) * 100}%`, background: r.tier === 'chop_zone' ? '#e0402e' : r.tier === 'danger' ? '#e8b84a' : '#7b6cf0' }} /></span>
                  <span className={s.mono}>{r.points.toFixed(1)}</span>
                  <SpecialtyTag tone={r.tier === 'chop_zone' ? 'danger' : r.tier === 'danger' ? 'gold' : 'safe'}>
                    {r.tier === 'chop_zone' ? 'Under the blade' : r.tier === 'danger' ? `${r.marginAboveBlade.toFixed(1)} above it` : 'Safe'}
                  </SpecialtyTag>
                </div>
              ))}
            </div>
          )
        })}
        {chopLine.groups.length ? <p style={{ margin: '8px 0 0', fontSize: 13, color: '#9aa3b8' }}>{chopLine.note}</p> : null}
      </SpecialtyCard>

      <SpecialtyCard id="sg-chop" label={latest ? `Chop night · period ${latest[0]}` : 'Chop night'} testId="sg-chopnight">
        {!latest ? (
          <p style={{ margin: 0, color: '#b9c0d0' }}>The first ceremony plays here after the first chop.{state?.ceremonyAt ? ` Scheduled: ${new Date(state.ceremonyAt).toLocaleString()}.` : ''}</p>
        ) : (
          <div className={s.stage}>
            <div className={s.stageHead}>
              <span className={s.stageEyebrow}>Step {step + 1} of {steps.length}{latest[1].completedAt ? ` · ${new Date(latest[1].completedAt).toLocaleString()}` : ''}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={{ minHeight: 44, minWidth: 64, borderRadius: 10, background: '#141826', color: '#fff', border: '1px solid rgba(255,255,255,.12)' }} onClick={() => setStep((v) => Math.max(0, v - 1))} disabled={step === 0}>Back</button>
                <button type="button" style={{ minHeight: 44, minWidth: 64, borderRadius: 10, background: '#e2672a', color: '#1a0a04', fontWeight: 800, border: 0 }} onClick={() => setStep((v) => Math.min(steps.length - 1, v + 1))} disabled={step >= steps.length - 1}>Next</button>
              </div>
            </div>
            {stepNow ? (
              <div className={s.stageBody} aria-live="polite">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img key={`${stepNow.key}-${step}`} src={stepNow.art} alt="" aria-hidden className={cx(s.stageArt, stepNow.key === 'chop' && s.fall, stepNow.key === 'idols' && s.knock, stepNow.key === 'torch' && s.snuff)} />
                <div>
                  <h3 key={`t-${step}`} className={s.stageTitle}>{stepNow.title}</h3>
                  <p style={{ margin: 0, color: '#d7dbe6' }}>{stepNow.detail}</p>
                </div>
              </div>
            ) : null}
            <ol className={s.steps}>
              {steps.map((st, i) => (
                <li key={st.key} className={cx(i <= step && s.on)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={st.art} alt="" aria-hidden />
                  <b>STEP {i + 1}</b>
                  <span>{st.title}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </SpecialtyCard>

      {latest ? <SGChopCardView card={sgChopCardFromHistory(Number(latest[0]), latest[1], input.teams)} /> : null}
      <SGReversalCard rows={reversals} />
      <SGWaiversCard players={extras.releasedPlayers ?? []} faab={extras.faabRemaining ?? null}
        waiverHref={`/waiver-wire?leagueId=${encodeURIComponent(leagueId)}`} teamName={teamName} />

      <SpecialtyCard label={`Torches · ${alive} of ${torches.length} still lit`} icon={`${SG_ART}/torch-lit.svg`} testId="sg-torches">
        {torches.length === 0 ? <p style={{ margin: 0, color: '#b9c0d0' }}>Managers appear here once teams are claimed.</p> : (
          <div className={s.torches}>
            {torches.map((t) => (
              <div key={t.rosterId} className={cx(s.torch, !t.lit && s.out, t.you && s.you)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${SG_ART}/${t.lit ? 'torch-lit' : 'torch-out'}.svg`} alt="" aria-hidden />
                <span>{t.name}{t.you ? ' (you)' : ''}</span>
                <span style={{ color: t.lit ? (t.tribeId ? sgTribeArt(t.tribeId).color : '#9aa3b8') : '#9aa3b8' }}>{t.lit ? (t.tribeId ? sgTribeArt(t.tribeId).name : 'No tribe yet') : 'Chopped'}</span>
              </div>
            ))}
          </div>
        )}
        {mergeAt ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${SG_ART}/merge.svg`} alt="" aria-hidden style={{ width: 96, height: 'auto' }} />
            <p style={{ margin: 0, fontSize: 14, color: '#d7dbe6' }}>
              {season.currentPeriod >= mergeAt ? 'The tribes have merged. All powers have expired; the lowest score in the field is chopped.' : `The tribes merge in period ${mergeAt}. Every power expires before then.`}
            </p>
          </div>
        ) : null}
      </SpecialtyCard>

      {timeline.length ? (
        <SpecialtyCard label="Season so far" icon={`${SG_ART}/icon-chop.svg`} testId="sg-timeline">
          <ol className={s.timeline}>
            {timeline.map((t) => (
              <li key={t.period}><b>P{t.period}</b><span>{t.mode}{t.immuneTribe ? ` · ${t.immuneTribe} immune` : ''}{t.chopped.length ? ` · chopped: ${t.chopped.join(', ')}` : ''}{t.saved.length ? ` · saved: ${t.saved.join(', ')}` : ''}</span></li>
            ))}
          </ol>
        </SpecialtyCard>
      ) : null}
    </>
  )

  const rail = (
    <>
      <SGTribeDrawCard draw={draw} />
      <SpecialtyCard id="sg-vault" label="Your hidden powers" testId="sg-vault" borderColor="rgba(59,179,184,.45)">
        {vault.mine.length === 0 ? <p style={{ margin: 0, color: '#b9c0d0' }}>No powers on your team. Hidden powers are visible only to their owner.</p> : vault.mine.map((p) => (
          <div key={p.id} className={s.idol}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src} alt="" aria-hidden className={cx(p.status === 'held' && s.glow)} />
            <div>
              <SpecialtyTag tone={p.status === 'held' ? 'safe' : p.status === 'sealed' ? 'gold' : 'muted'}>{p.status === 'sealed' ? 'Sealed until the chop' : p.status}</SpecialtyTag>
              <h3>{p.label}</h3>
              <p>{p.blurb} Expires after period {p.throughPeriod}.</p>
            </div>
          </div>
        ))}
        {vault.revealed.length ? <p style={{ marginTop: 10, fontSize: 13, color: '#9aa3b8' }}>Revealed this season: {vault.revealed.map((p) => p.label).join(', ')}.</p> : null}
        <p style={{ marginTop: 10, fontSize: 13, color: '#9aa3b8' }}>Use a power privately with Chimmy from the powers panel below. Nobody else is told until the reveal.</p>
      </SpecialtyCard>

      <SGTribeSetupCard view={setupView} rulesHref={isCommissioner ? `/survivor-guillotine/setup?leagueId=${encodeURIComponent(leagueId)}` : null} />
      <SpecialtyCard label="How it works">
        <SpecialtyRules rules={[
          'Tribes race each period: Match Play counts matchup wins; Tribe Champion compares each tribe\'s champion.',
          'The winning tribe is immune. The lowest score outside it is chopped. Nobody votes.',
          'An immunity idol passes the blade to the next lowest, and can chain.',
          'Ties: weekly points, then the previous period, then the commissioner.',
          `The Gauntlet chops two a period${mergeAt ? `; at period ${mergeAt} the tribes merge` : ''}. The final three are placed by the championship score.`,
        ]} />
      </SpecialtyCard>

      <SpecialtyCard label="Latest">
        <SpecialtyFeed items={feed} empty="Chops, saves and immunity wins appear here." />
      </SpecialtyCard>

      {shares.length ? (
        <SpecialtyCard label="Your story cards" testId="sg-share">
          <div className={s.share}>
            {shares.map((c) => (
              <div key={c.key} className={s.card916}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.art} alt="" aria-hidden />
                <strong>{c.title}</strong>
                <span>{c.line}</span>
              </div>
            ))}
          </div>
        </SpecialtyCard>
      ) : null}

      <SpecialtyCard label="Notification defaults">
        <details>
          <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Show default channels</summary>
          <table className={s.channels}>
            <thead><tr><th scope="col">Moment</th><th scope="col">Push</th><th scope="col">In-app</th><th scope="col">Email</th><th scope="col">Tribe chat</th></tr></thead>
            <tbody>
              {SG_NOTIFICATION_DEFAULTS.map((n) => (
                <tr key={n.moment}><td>{n.moment}</td>{[n.push, n.inApp, n.email, n.tribeChat].map((on, i) => <td key={i}>{on ? 'On' : 'Off'}</td>)}</tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: '#9aa3b8' }}>No message names an idol holder before the chop reveals it.</p>
        </details>
      </SpecialtyCard>
    </>
  )

  return (
    <div className={s.wrap} data-testid="sg-visual-set">
      <SpecialtyShell format="survguil">
        <SpecialtyHero
          format="survguil"
          bannerSrc={`${SG_ART}/banner.svg`}
          emblemSrc={`${SG_ART}/emblem.svg`}
          emblemAlt="Survivor Guillotine emblem"
          chips={[season.config.sport, 'Survivor Guillotine', `${torches.length || season.config.teamCount} managers · ${alive || season.config.teamCount} left`]}
          title="The island"
          headline={headline}
          blurb="Survivor tribes, but nobody votes. The lowest score outside the immune tribe is chopped, unless an idol passes the blade on."
          actions={actions}
          clock={<SpecialtyCountdown label="Powers lock in" target={lockAt} caption={state?.ceremonyAt ? `Chop: ${new Date(state.ceremonyAt).toLocaleString()}` : 'No chop scheduled yet'} />}
        />
        <SpecialtyGrid main={main} rail={rail} />
      </SpecialtyShell>
    </div>
  )
}

function fmt(n: number, label: string): string {
  return label === 'Matchup wins' ? String(n) : n.toFixed(1)
}
