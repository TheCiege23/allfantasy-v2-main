'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SpecialtyCard, SpecialtyGrid, SpecialtyShell } from '@/components/league/specialty/SpecialtyShell'
import {
  GUILLY_AUCTION_BUDGETS, GUILLY_DEFAULTS, GUILLY_FAAB_BUDGETS, GUILLY_FIRST_CHOP_WEEKS, GUILLY_LEAGUE_SIZES,
  GUILLY_UNSUPPORTED, buildGuillyCreateBody, buildGuillyFollowUps, isGuillyOptionSupported, summarizeGuilly,
  validateGuillySetup, type GuillySetupState,
} from '@/lib/guilly/setup'
import { GUILLY_ART } from '@/lib/guilly/hub'
import g from './guilly.module.css'

type Choice<T> = { value: T; label: string; disabledReason?: string }

function Seg<T extends string | number | boolean>({ label, value, choices, onChange }: {
  label: string; value: T; choices: Choice<T>[]; onChange: (v: T) => void
}) {
  return (
    <div className={g.seg} role="group" aria-label={label}>
      {choices.map((c) => (
        <button key={String(c.value)} type="button" aria-pressed={value === c.value} disabled={Boolean(c.disabledReason)}
          title={c.disabledReason} onClick={() => onChange(c.value)}>
          {c.label}
          {c.disabledReason ? <span className={g.soon}>Coming soon</span> : null}
        </button>
      ))}
    </div>
  )
}

function Opt({ icon, title, sub, children }: { icon: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className={g.opt}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${GUILLY_ART}/${icon}`} alt="" aria-hidden />
      <div><h3>{title}</h3><p>{sub}</p></div>
      {children}
    </div>
  )
}

export function GuillySetup() {
  const router = useRouter()
  const [s, setS] = useState<GuillySetupState>(GUILLY_DEFAULTS)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const set = <K extends keyof GuillySetupState>(k: K, v: GuillySetupState[K]) => setS((cur) => ({ ...cur, [k]: v }))
  const summary = useMemo(() => summarizeGuilly(s), [s])
  const errors = useMemo(() => validateGuillySetup(s), [s])

  async function create() {
    if (errors.length) return
    setBusy(true)
    setStatus('Creating your league…')
    try {
      const res = await fetch('/api/league/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildGuillyCreateBody(s)) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not create the league.')
      const leagueId: string | undefined = data.leagueId ?? data.id ?? data.league?.id
      if (!leagueId) throw new Error('The league was created but no id came back. Open it from your leagues list.')
      const failed: string[] = []
      for (const step of buildGuillyFollowUps(leagueId, s)) {
        const r = await fetch(step.url, { method: step.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(step.body) }).catch(() => null)
        if (!r || !r.ok) failed.push(step.label)
      }
      if (failed.length) {
        setStatus(`League created. Could not save: ${failed.join(', ')} — set ${failed.length > 1 ? 'them' : 'it'} in league settings.`)
        setBusy(false)
        return
      }
      router.push(`/guilly/${encodeURIComponent(leagueId)}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not create the league.')
      setBusy(false)
    }
  }

  const main = (
    <SpecialtyCard>
      <div className={g.opt}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${GUILLY_ART}/icon-crown.svg`} alt="" aria-hidden />
        <label style={{ gridColumn: '2 / -1' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>League name</h3>
          <input className={g.nameInput} value={s.name} maxLength={100} onChange={(e) => set('name', e.target.value)} placeholder="Chop Night" />
        </label>
      </div>
      <Opt icon="icon-chop.svg" title="League size" sub="One chop per team, minus the winner.">
        <Seg label="League size" value={s.leagueSize} onChange={(v) => set('leagueSize', v)} choices={GUILLY_LEAGUE_SIZES.map((n) => ({ value: n, label: String(n) }))} />
      </Opt>
      <Opt icon="icon-gavel.svg" title="Draft type" sub={s.draft === 'auction' ? '$ budget per team, everyone can bid on everyone.' : 'Snake order, one pick at a time.'}>
        <Seg label="Draft type" value={s.draft} onChange={(v) => set('draft', v)} choices={[{ value: 'auction', label: 'Auction' }, { value: 'snake', label: 'Snake' }]} />
      </Opt>
      {s.draft === 'auction' ? (
        <Opt icon="icon-faab.svg" title="Auction budget" sub="Only used for auction drafts.">
          <Seg label="Auction budget" value={s.auctionBudget} onChange={(v) => set('auctionBudget', v)}
            choices={GUILLY_AUCTION_BUDGETS.map((n) => ({ value: n, label: `$${n}`, disabledReason: isGuillyOptionSupported({ auctionBudget: n }) ? undefined : GUILLY_UNSUPPORTED.auctionBudget }))} />
        </Opt>
      ) : null}
      <Opt icon="icon-bestball.svg" title="Lineups" sub="Managers set daily lineups.">
        <Seg label="Lineups" value={s.lineups} onChange={(v) => set('lineups', v)} choices={[{ value: 'managed', label: 'Managed' }, { value: 'bestball', label: 'Bestball', disabledReason: GUILLY_UNSUPPORTED.bestball }]} />
      </Opt>
      <Opt icon="icon-danger.svg" title="First chop" sub="Week the blade starts falling.">
        <Seg label="First chop week" value={s.firstChopWeek} onChange={(v) => set('firstChopWeek', v)} choices={GUILLY_FIRST_CHOP_WEEKS.map((n) => ({ value: n, label: String(n) }))} />
      </Opt>
      <Opt icon="icon-tomb.svg" title="Double-chop weeks" sub="Two heads a week until the field fits the calendar.">
        <Seg label="Double-chop weeks" value={s.doubleChop} onChange={(v) => set('doubleChop', v)} choices={[{ value: false, label: 'Off' }, { value: true, label: 'On', disabledReason: GUILLY_UNSUPPORTED.doubleChop }]} />
      </Opt>
      <Opt icon="icon-faab.svg" title="Season FAAB" sub="Has to last through every frenzy.">
        <Seg label="Season FAAB" value={s.faabBudget} onChange={(v) => set('faabBudget', v)} choices={GUILLY_FAAB_BUDGETS.map((n) => ({ value: n, label: `$${n.toLocaleString('en-US')}` }))} />
      </Opt>
      <Opt icon="icon-basket.svg" title="Chopped rosters go to" sub="Blind FAAB at the next waiver run.">
        <Seg label="Chopped rosters go to" value={s.release} onChange={(v) => set('release', v)} choices={[{ value: 'blind_faab', label: 'Blind FAAB' }, { value: 'free_agency', label: 'Free agency', disabledReason: GUILLY_UNSUPPORTED.freeAgency }]} />
      </Opt>
      <div className={g.opt}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${GUILLY_ART}/icon-streak.svg`} alt="" aria-hidden />
        <div><h3>Scoring and roster</h3><p>The league&apos;s NBA scoring and roster defaults. Change them in league settings after creation.</p></div>
      </div>
    </SpecialtyCard>
  )

  const rail = (
    <SpecialtyCard borderColor="rgba(255,59,47,.45)" testId="guilly-summary">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={g.wordmark} src={`${GUILLY_ART}/wordmark.svg`} alt="Guilly — last team standing" />
      <div className={g.chips}>
        <span>{s.draft === 'auction' ? 'Auction' : 'Snake'}</span>
        <span>{s.lineups === 'managed' ? 'Managed' : 'Bestball'}</span>
        <span>{s.leagueSize} teams</span>
        <span>${s.faabBudget.toLocaleString('en-US')} FAAB</span>
      </div>
      <dl className={g.kv}>
        <dt>Chops</dt><dd>{summary.chops}</dd>
        <dt>First chop</dt><dd>Week {summary.firstChopWeek}</dd>
        <dt>Last chop</dt><dd>Week {summary.lastChopWeek}</dd>
        <dt>Winner</dt><dd>Last team standing</dd>
        <dt>NBA season</dt><dd>~{summary.seasonWeeks} weeks</dd>
      </dl>
      <span className={g.warn}>{summary.fitsSeason ? 'Ends before the NBA playoffs' : summary.warning}</span>
      <button type="button" className={g.create} disabled={busy || errors.length > 0} onClick={create}>Create league and invite</button>
      {errors.length ? <ul className={g.errs}>{errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
      {status ? <p role="status" style={{ fontSize: 13, color: '#c3c8d6' }}>{status}</p> : null}
    </SpecialtyCard>
  )

  return (
    <SpecialtyShell format="guillotine" testId="guilly-setup">
      <div className={g.top}>
        <div>
          <h1>Create a Guilly league</h1>
          <p>NBA · commissioner setup · rules lock when the draft starts</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${GUILLY_ART}/emblem.svg`} alt="" aria-hidden />
      </div>
      <SpecialtyGrid main={main} rail={rail} />
    </SpecialtyShell>
  )
}
