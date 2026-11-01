'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useMessages } from '@/components/i18n/useMessages'
import { survivorFinaleMessages } from '@/lib/survivor/survivorFinaleMessages'
import { SURVIVOR_VOTES_DUE_MAX_HOURS, type SurvivorFinaleSettings, type SurvivorFinaleWindows } from '@/lib/survivor/survivorFinaleSettings'

type FinalePayload = {
  settings: SurvivorFinaleSettings
  windows: SurvivorFinaleWindows
  juryVoteDeadline: string | null
  councilOpen: boolean
}

type WindowKey = keyof SurvivorFinaleWindows | 'juryVoteDeadline'

/** ISO → the value a datetime-local input takes, in the viewer's own time zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A datetime-local value (viewer's time zone) → ISO, or null when empty. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function Toggle({ checked, onChange, disabled, label, testId }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; testId: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} data-testid={testId} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full border transition ${checked ? 'border-emerald-300/60 bg-emerald-400/40' : 'border-white/20 bg-white/10'} disabled:opacity-40`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? 'left-6' : 'left-0.5'}`} />
    </button>
  )
}

/**
 * Commissioner controls for the jury, finale and reunion rules and this season's finale windows.
 * Mounted in the Commissioner Hub's Jury tab and in league settings (Merge & jury panel).
 */
export function SurvivorFinaleControls({ leagueId, canEdit = true }: { leagueId: string; canEdit?: boolean }) {
  const m = useMessages(survivorFinaleMessages)
  const [data, setData] = useState<FinalePayload | null>(null)
  const [rules, setRules] = useState<SurvivorFinaleSettings | null>(null)
  const [windows, setWindows] = useState<Record<WindowKey, string>>({ questionsOpenAt: '', questionsDeadline: '', answersDeadline: '', speechesDeadline: '', juryVoteDeadline: '' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/survivor/commissioner?leagueId=${encodeURIComponent(leagueId)}&type=finale`, { credentials: 'include' }).catch(() => null)
    const payload = res ? ((await res.json().catch(() => null)) as FinalePayload | null) : null
    if (!res?.ok || !payload?.settings) return setMessage(m.errors_generic)
    setData(payload)
    setRules(payload.settings)
    setWindows({
      questionsOpenAt: toLocalInput(payload.windows.questionsOpenAt),
      questionsDeadline: toLocalInput(payload.windows.questionsDeadline),
      answersDeadline: toLocalInput(payload.windows.answersDeadline),
      speechesDeadline: toLocalInput(payload.windows.speechesDeadline),
      juryVoteDeadline: toLocalInput(payload.juryVoteDeadline),
    })
  }, [leagueId, m.errors_generic])

  useEffect(() => { void load() }, [load])

  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/survivor/commissioner', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId, ...body }) })
      const out = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      if (!res.ok) setMessage(out.code === 'council_open' ? m.councilOpenNote : out.error ?? m.errors_generic)
      else { setMessage(m.saved); await load() }
    } catch {
      setMessage(m.errors_generic)
    } finally {
      setBusy(false)
    }
  }

  if (!data || !rules) return <p className="text-[13px] text-white/50">{message ?? m.loadingControls}</p>
  const disabled = !canEdit || busy
  const lockedNow = data.councilOpen
  const ruleRow = (key: 'juryQuestionsEnabled' | 'closingSpeechesEnabled' | 'sealedImmunity' | 'endOfSeasonBallotReveal' | 'reunionChatEnabled', label: string, help: string, locked = false) => (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-3">
      <div className="min-w-0"><p className="text-[13px] font-semibold text-white">{label}</p><p className="text-[12px] text-white/50">{help}</p></div>
      <Toggle testId={`finale-rule-${key}`} label={label} checked={rules[key]} disabled={disabled || locked} onChange={(v) => setRules({ ...rules, [key]: v })} />
    </div>
  )
  const windowRow = (key: WindowKey, label: string, help?: string) => (
    <label key={key} className="flex flex-col gap-1 py-2 text-[12px] text-white/70">
      <span className="font-semibold text-white">{label}</span>
      {help ? <span className="text-white/45">{help}</span> : null}
      <span className="flex gap-2">
        <input type="datetime-local" data-testid={`finale-window-${key}`} value={windows[key]} disabled={disabled} onChange={(e) => setWindows({ ...windows, [key]: e.target.value })}
          className="min-h-[44px] flex-1 rounded-xl border border-white/15 bg-black/30 px-3 text-[13px] text-white" />
        <button type="button" disabled={disabled || !windows[key]} onClick={() => setWindows({ ...windows, [key]: '' })} className="min-h-[44px] rounded-xl border border-white/15 px-3 text-[12px] text-white/70">{m.clear}</button>
      </span>
    </label>
  )

  return (
    <div className="flex flex-col gap-6 text-white/85" data-testid="survivor-finale-controls">
      <section>
        <h3 className="text-[15px] font-bold text-white">{m.controlsTitle}</h3>
        <p className="mt-1 text-[12px] text-white/50">{m.controlsIntro}</p>
        {lockedNow ? <p className="mt-2 text-[12px] text-amber-200/80">{m.councilOpenNote}</p> : null}
        {ruleRow('juryQuestionsEnabled', m.ruleQuestions, m.ruleQuestionsHelp)}
        {ruleRow('closingSpeechesEnabled', m.ruleSpeeches, m.ruleSpeechesHelp)}
        {ruleRow('sealedImmunity', m.ruleSealed, m.ruleSealedHelp, lockedNow)}
        <label className="flex items-start justify-between gap-4 border-b border-white/5 py-3">
          <span className="min-w-0"><span className="block text-[13px] font-semibold text-white">{m.ruleVotesDue}</span><span className="block text-[12px] text-white/50">{m.ruleVotesDueHelp}</span></span>
          <input type="number" min={0} max={SURVIVOR_VOTES_DUE_MAX_HOURS} step={1} data-testid="finale-rule-votesDue" value={rules.votesDueHoursBeforeCeremony} disabled={disabled || lockedNow}
            onChange={(e) => setRules({ ...rules, votesDueHoursBeforeCeremony: Math.max(0, Math.min(SURVIVOR_VOTES_DUE_MAX_HOURS, Math.floor(Number(e.target.value) || 0))) })}
            className="min-h-[44px] w-20 rounded-xl border border-white/15 bg-black/30 px-2 text-center text-[13px] text-white" />
        </label>
        {ruleRow('endOfSeasonBallotReveal', m.ruleBallotReveal, m.ruleBallotRevealHelp)}
        {ruleRow('reunionChatEnabled', m.ruleReunion, m.ruleReunionHelp)}
        <div className="mt-3 flex justify-end">
          <button type="button" data-testid="finale-save-rules" disabled={disabled} onClick={() => {
            const patch: Partial<SurvivorFinaleSettings> = {}
            for (const key of Object.keys(rules) as Array<keyof SurvivorFinaleSettings>) if (rules[key] !== data.settings[key]) (patch as Record<string, unknown>)[key] = rules[key]
            if (Object.keys(patch).length) void post({ action: 'finale_settings', settings: patch })
          }} className="min-h-[44px] rounded-xl border border-amber-300/40 bg-amber-300/10 px-4 text-[13px] font-semibold text-amber-100 disabled:opacity-40">{busy ? m.saving : m.saveRules}</button>
        </div>
      </section>

      <section>
        <h3 className="text-[15px] font-bold text-white">{m.windowsTitle}</h3>
        <p className="mt-1 text-[12px] text-white/50">{m.windowsIntro}</p>
        {windowRow('questionsOpenAt', m.wQuestionsOpen)}
        {windowRow('questionsDeadline', m.wQuestionsClose)}
        {windowRow('answersDeadline', m.wAnswersClose)}
        {windowRow('speechesDeadline', m.wSpeechesClose)}
        {windowRow('juryVoteDeadline', m.wJuryVote, m.wJuryVoteHelp)}
        <div className="mt-3 flex justify-end">
          <button type="button" data-testid="finale-save-windows" disabled={disabled} onClick={() => {
            const next: Record<string, string | null> = {}
            for (const key of ['questionsOpenAt', 'questionsDeadline', 'answersDeadline', 'speechesDeadline'] as const) {
              const value = fromLocalInput(windows[key])
              if (value !== data.windows[key]) next[key] = value
            }
            const vote = fromLocalInput(windows.juryVoteDeadline)
            if (vote && vote !== data.juryVoteDeadline) next.juryVoteDeadline = vote
            if (Object.keys(next).length) void post({ action: 'finale_windows', windows: next })
          }} className="min-h-[44px] rounded-xl border border-amber-300/40 bg-amber-300/10 px-4 text-[13px] font-semibold text-amber-100 disabled:opacity-40">{busy ? m.saving : m.saveWindows}</button>
        </div>
      </section>

      {message ? <p role="status" className="text-[12px] text-amber-200">{message}</p> : null}
      <Link href={`/survivor/${encodeURIComponent(leagueId)}/jury`} className="text-[13px] text-cyan-300">{m.openJury} →</Link>
    </div>
  )
}
