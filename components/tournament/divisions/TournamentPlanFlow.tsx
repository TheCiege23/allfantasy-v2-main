'use client'
/**
 * "Plan a tournament": step 1 picks the format. Points race hands off to the
 * existing `SeasonTournamentPlanner` (unchanged apart from its starting sport and
 * field size). Divisions & conferences continues to the identity step, then the
 * scoring and roster step, and saves a plan through `/api/tournament/divisions`.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SeasonTournamentPlanner } from '@/components/tournament/SeasonTournamentPlanner'
import { defaultFormatSettings, type FormatSettings } from '@/lib/tournament/divisions/engine'
import { presetIdentity, resizeConferences, type DivisionIdentityInput } from '@/lib/tournament/divisions/identity'
import { TournamentFormatPicker, type PointsRaceChoice, type TournamentFormatId } from './TournamentFormatPicker'
import { TournamentIdentityStep } from './TournamentIdentityStep'
import { TournamentRulesStep } from './TournamentRulesStep'

type Step = 'format' | 'identity' | 'rules' | 'points'

function StepHeader({ title, sub, onBack, right }: { title: string; sub: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-4 border-b border-white/10 pb-5">
      {onBack ? (
        <button type="button" onClick={onBack} aria-label="Back" className="grid h-12 w-12 place-items-center rounded-xl border border-white/15 bg-[#0e1018] text-xl text-white">‹</button>
      ) : (
        <Link href="/tournament-hub" aria-label="Back to tournaments" className="grid h-12 w-12 place-items-center rounded-xl border border-white/15 bg-[#0e1018] text-xl text-white">‹</Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold text-white sm:text-4xl">{title}</h1>
        <p className="text-slate-300">{sub}</p>
      </div>
      {right}
    </header>
  )
}

export function TournamentPlanFlow() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('format')
  const [format, setFormat] = useState<TournamentFormatId>('divisions')
  const [settings, setSettings] = useState<FormatSettings>(defaultFormatSettings('NFL'))
  const [points, setPoints] = useState<PointsRaceChoice>({ sport: 'NFL', participants: 64 })
  const [identity, setIdentity] = useState<DivisionIdentityInput>(presetIdentity('rookie-vet', 10))
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (step === 'points') return <SeasonTournamentPlanner initial={points} />

  const tournamentName = name.trim() || `${identity.divisions[0]?.name || 'Division A'} vs ${identity.divisions[1]?.name || 'Division B'}`
  const changeSettings = (s: FormatSettings) => {
    setSettings(s)
    if (s.conferencesPerDivision !== identity.conferences.length) setIdentity(i => resizeConferences(i, s.conferencesPerDivision))
  }
  const changeIdentity = (next: DivisionIdentityInput) => {
    setIdentity(next)
    if (next.conferences.length !== settings.conferencesPerDivision) setSettings(s => ({ ...s, conferencesPerDivision: next.conferences.length }))
  }

  async function save() {
    if (saving) return
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/tournament/divisions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', plan: { name: tournamentName, settings, identity } }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not save the tournament plan.')
      router.push('/tournament-hub/' + body.tournamentId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the tournament plan.')
      setSaving(false)
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-[1440px] space-y-6 bg-[#07080d] px-4 py-6 text-white sm:px-8">
      {step === 'format' ? (
        <>
          <StepHeader title="Choose a tournament format" sub="Plan a tournament · step 1 of 4 · you can switch formats until registration opens" />
          <TournamentFormatPicker format={format} onFormat={setFormat} settings={settings} onSettings={changeSettings} points={points} onPoints={setPoints}
            onContinue={() => {
              if (format === 'points_race') { setStep('points'); return }
              setIdentity(i => resizeConferences(i, settings.conferencesPerDivision))
              setStep('identity')
            }} />
        </>
      ) : step === 'rules' ? (
        <>
          <StepHeader title="Scoring and roster" sub="Plan a tournament · step 3 of 4 · the same rules in every league and every stage" onBack={() => setStep('identity')}
            right={<span className="rounded-lg border border-white/15 px-3 py-1 text-sm text-slate-200">Rules lock when registration opens</span>} />
          <TournamentRulesStep sport={settings.sport} onBack={() => setStep('identity')} onSave={save} saving={saving} error={error} />
        </>
      ) : (
        <>
          <StepHeader title="Name your divisions and conferences" sub="Plan a tournament · step 2 of 4 · start from a preset or type your own" onBack={() => setStep('format')}
            right={<span className="rounded-lg border border-white/15 px-3 py-1 text-sm text-slate-200">Names lock when registration opens</span>} />
          <label className="block max-w-xl">
            <span className="text-sm text-slate-400">Tournament name</span>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder={tournamentName}
              className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-[#07080d] px-3 font-bold text-white" />
          </label>
          <TournamentIdentityStep identity={identity} onChange={changeIdentity} minConferences={4} onBack={() => setStep('format')} onSave={() => setStep('rules')} saveLabel="Continue" />
        </>
      )}
    </main>
  )
}
