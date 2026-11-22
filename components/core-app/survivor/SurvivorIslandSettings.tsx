'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import { survivorIslandSettingsMessages } from '@/lib/core-app/messages/survivorIslandSettings'
import {
  ISLAND_SCENE_CHOICES,
  applyInlineEdits,
  exileTokenChoices,
  idolCountChoices,
  inlineRuleFields,
  sceneArt,
  withIslandScene,
  type InlineRuleEdits,
  type InlineRuleKey,
  type IslandSettingsState,
} from '@/lib/core-app/survivorIslandSettings'
import { SURVIVOR_VOTE_DAYS, SURVIVOR_VOTE_TIMES, type SurvivorIslandScenePreference, type SurvivorSettingsForm } from '@/lib/survivor/survivorSettingsScreen'

/**
 * The Survivor settings screen's state, for Island control. Reads and writes the same
 * `/survivor/settings-screen` endpoint the full settings page uses: it answers 403 to anyone without
 * settings rights, so for them `state` stays null and neither editor renders. Every save posts the
 * WHOLE form, so the server's own lock and range checks decide, exactly as on the settings page.
 */
export function useIslandSettings(leagueId: string, onSaved?: () => void) {
  const [state, setState] = useState<IslandSettingsState | null>(null)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/survivor/settings-screen`

  useEffect(() => {
    let live = true
    fetch(url, { cache: 'no-store', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d && d.form && d.locks) setState(d) })
      .catch(() => {})
    return () => { live = false }
  }, [url])

  const save = useCallback(async (form: SurvivorSettingsForm): Promise<{ ok: true } | { ok: false; error: string | null }> => {
    try {
      const res = await fetch(url, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ form }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) return { ok: false, error: typeof data?.error === 'string' ? data.error : null }
      if (data?.state?.form) setState(data.state)
      onSaved?.()
      return { ok: true }
    } catch {
      return { ok: false, error: null }
    }
  }, [url, onSaved])

  return { state, save }
}

type Save = ReturnType<typeof useIslandSettings>['save']
type Status = { tone: 'busy' | 'ok' | 'error'; text: string } | null

/** A gallery of the banner scenes plus "Follow the season"; a pick saves at once. */
export function SurvivorScenePicker({ state, save }: { state: IslandSettingsState; save: Save }) {
  const m = useMessages(survivorIslandSettingsMessages)
  const current: SurvivorIslandScenePreference = state.form.islandScene ?? 'auto'
  const [status, setStatus] = useState<Status>(null)

  const pick = async (choice: SurvivorIslandScenePreference) => {
    if (choice === current || status?.tone === 'busy') return
    setStatus({ tone: 'busy', text: m.saving })
    const r = await save(withIslandScene(state.form, choice))
    setStatus(r.ok ? { tone: 'ok', text: m.saved } : { tone: 'error', text: r.error ?? m.failed })
  }

  return (
    <section className="sv-panel" aria-label={m.sceneTitle} data-testid="survivor-scene-picker">
      <div className="sv-panel-h">
        <span className="sv-eyebrow">{m.sceneTitle}</span>
        {status ? <span className="sv-note" role="status" data-tone={status.tone}>{status.text}</span> : null}
      </div>
      <p className="sv-note sv-scene-hint">{m.sceneHint}</p>
      <div className="sv-scenes" role="radiogroup" aria-label={m.sceneTitle}>
        {ISLAND_SCENE_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={choice === current}
            className="sv-scene"
            data-scene={choice}
            disabled={status?.tone === 'busy'}
            onClick={() => { void pick(choice) }}
          >
            <span className="sv-scene-art" style={{ backgroundImage: `url('${sceneArt(choice)}')` }} aria-hidden="true" />
            <span className="sv-scene-name">{m[`scene_${choice}`]}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

/** A UTC-free label for a stored "HH:MM" (the settings screen stores the league's own clock time). */
function timeLabel(time: string, locale: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) return time
  return new Date(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2]))).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
}

/** The weekday's name in the reader's language (index 0 = Sunday, matching SURVIVOR_VOTE_DAYS). */
function dayLabel(index: number, locale: string): string {
  // Sunday 2026-11-01 UTC, so the weekday never depends on today.
  return new Date(Date.UTC(2026, 10, 1 + index)).toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' })
}

/**
 * The rulebook's safe fields, edited in place. Locked fields (isSettingLocked: everything but the
 * vote deadline once the draft starts) are shown disabled; the server refuses them regardless.
 */
export function SurvivorRulesEditor({ state, save, settingsHref }: { state: IslandSettingsState; save: Save; settingsHref: string }) {
  const m = useMessages(survivorIslandSettingsMessages)
  const [open, setOpen] = useState(false)
  const [edits, setEdits] = useState<InlineRuleEdits>({})
  const [status, setStatus] = useState<Status>(null)
  const fields = inlineRuleFields(state)
  const anyLocked = fields.some((f) => f.locked)
  const form = applyInlineEdits(state.form, edits)
  const locale = getAppIntlLocale()
  const set = <K extends InlineRuleKey>(key: K, value: SurvivorSettingsForm[K]) => setEdits((e) => ({ ...e, [key]: value }))
  const dirty = Object.keys(edits).some((k) => JSON.stringify(edits[k as InlineRuleKey]) !== JSON.stringify(state.form[k as InlineRuleKey]))

  const submit = async () => {
    setStatus({ tone: 'busy', text: m.saving })
    const r = await save(form)
    if (r.ok) { setEdits({}); setOpen(false); setStatus({ tone: 'ok', text: m.saved }) } else setStatus({ tone: 'error', text: r.error ?? m.failed })
  }

  const control = (key: InlineRuleKey, locked: boolean) => {
    const id = `sv-rule-${key}`
    switch (key) {
      case 'voteDay':
        return (
          <select id={id} value={form.voteDay} disabled={locked} onChange={(e) => set('voteDay', e.target.value)}>
            {SURVIVOR_VOTE_DAYS.map((d, i) => <option key={d} value={d}>{dayLabel(i, locale)}</option>)}
          </select>
        )
      case 'voteTime': {
        const times: string[] = (SURVIVOR_VOTE_TIMES as readonly string[]).includes(form.voteTime) ? [...SURVIVOR_VOTE_TIMES] : [form.voteTime, ...SURVIVOR_VOTE_TIMES]
        return (
          <select id={id} value={form.voteTime} disabled={locked} onChange={(e) => set('voteTime', e.target.value)}>
            {times.map((t) => <option key={t} value={t}>{timeLabel(t, locale)}</option>)}
          </select>
        )
      }
      case 'selfVotesAllowed':
        return <input id={id} type="checkbox" checked={form.selfVotesAllowed} disabled={locked} onChange={(e) => set('selfVotesAllowed', e.target.checked)} />
      case 'idolCount': {
        const choices = idolCountChoices()
        const list = choices.includes(form.idolCount) ? choices : [form.idolCount, ...choices]
        return (
          <select id={id} value={form.idolCount} disabled={locked} onChange={(e) => set('idolCount', Number(e.target.value))}>
            {list.map((n) => <option key={n} value={n}>{n.toLocaleString(locale)}</option>)}
          </select>
        )
      }
      case 'exileReturnTokens':
        return (
          <select id={id} value={form.exileReturnTokens} disabled={locked} onChange={(e) => set('exileReturnTokens', Number(e.target.value))}>
            {exileTokenChoices(state.form.exileReturnTokens).map((n) => <option key={n} value={n}>{n.toLocaleString(locale)}</option>)}
          </select>
        )
      case 'mergeWeek':
        return (
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={state.context.firstWeek + 1}
            max={state.context.lastWeek - 1}
            value={form.mergeWeek}
            disabled={locked}
            onChange={(e) => set('mergeWeek', Number(e.target.value))}
          />
        )
    }
  }

  return (
    <section className="sv-panel" aria-label={m.rulesTitle} data-testid="survivor-rules-editor">
      <div className="sv-panel-h">
        <span className="sv-eyebrow">{m.rulesTitle}</span>
        {status ? <span className="sv-note" role="status" data-tone={status.tone}>{status.text}</span> : null}
      </div>
      {!open ? (
        <button type="button" className="sv-btn" onClick={() => { setOpen(true); setStatus(null) }}>{m.rulesOpen}</button>
      ) : (
        <>
          {anyLocked ? <p className="sv-note">{m.lockedNote}</p> : null}
          <div className="sv-rule-edit">
            {fields.map(({ key, locked }) => (
              <div key={key} className="sv-rule-field" data-rule={key} data-locked={locked ? 'true' : undefined}>
                <label htmlFor={`sv-rule-${key}`}>{m[key]}{locked ? <small> · {m.locked}</small> : null}</label>
                {control(key, locked)}
              </div>
            ))}
          </div>
          <div className="sv-actions">
            <button type="button" className="sv-btn sv-btn-primary" disabled={!dirty || status?.tone === 'busy'} onClick={() => { void submit() }}>{m.rulesSave}</button>
            <button type="button" className="sv-btn" onClick={() => { setOpen(false); setEdits({}); setStatus(null) }}>{m.rulesCancel}</button>
          </div>
        </>
      )}
      <p className="sv-note"><Link className="sv-link" href={settingsHref}>{m.rulesMore} →</Link></p>
    </section>
  )
}
