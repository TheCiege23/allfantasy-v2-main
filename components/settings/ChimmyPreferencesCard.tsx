'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  CHIMMY_PERSONALIZATION_DEFAULTS,
  type ChimmyPersonalizationProfile,
} from '@/lib/chimmy-personalization/types'

/**
 * HOW CHIMMY ANSWERS, AND WHAT IT REMEMBERS — with the user in control of both.
 *
 * Chimmy brief item 6. Two stores feed Chimmy's prompt and, until this card, a user could see and
 * change neither:
 *   - explicit settings (`/api/user/chimmy-personalization` PATCH) — the endpoint existed and
 *     nothing in the product called it;
 *   - what Chimmy learned from conversation (the per-league `coaching_profile`) — including the
 *     rebuilding/contending direction the brief names — written silently whenever a user DECLARED
 *     something in chat.
 *
 * ⚠ EVERY SETTING SAYS WHERE ITS VALUE CAME FROM. "Set by you", "Learned" and "Default" are three
 * different claims; a control that showed only the value would let an inferred guess pass for a
 * choice the user made.
 */

type Remembered = {
  leagueId: string | null
  leagueName: string | null
  teamDirection: 'contender' | 'rebuilder' | null
  learned: Record<string, string>
  updatedAt: string | null
}

type LeagueOption = { leagueId: string; name: string; season: number | null }

type Snapshot = {
  profile: ChimmyPersonalizationProfile | null
  remembered: Remembered[]
  leagues: LeagueOption[]
}

type SettingKey = 'explanationStyle' | 'riskPreference' | 'leagueStylePreference' | 'actionPreference'

const SETTINGS: { key: SettingKey; label: string; hint: string; options: [string, string][] }[] = [
  {
    key: 'explanationStyle',
    label: 'Explanation depth',
    hint: 'How much Chimmy explains.',
    options: [
      ['concise', 'Short and direct'],
      ['balanced', 'Balanced'],
      ['detailed', 'Detailed'],
      ['data-heavy', 'Show the numbers'],
      ['beginner-friendly', 'Explain the basics'],
      ['commissioner-focused', 'Commissioner lens'],
    ],
  },
  {
    key: 'riskPreference',
    label: 'Risk tolerance',
    hint: 'Safer floors or bigger ceilings when it is close.',
    options: [
      ['floor', 'Play it safe (floor)'],
      ['balanced', 'Balanced'],
      ['upside', 'Chase upside (ceiling)'],
    ],
  },
  {
    key: 'leagueStylePreference',
    label: 'Favorite formats',
    hint: 'The kind of league Chimmy should assume you think in.',
    options: [
      ['redraft-first', 'Redraft'],
      ['dynasty-first', 'Dynasty'],
      ['specialty-league-first', 'Specialty formats'],
      ['c2c-devy-heavy', 'Devy / College-to-Canton'],
    ],
  },
  {
    key: 'actionPreference',
    label: 'Answer shape',
    hint: 'One move, a short list, or the whole picture.',
    options: [
      ['quick-one-move', 'One clear move'],
      ['top-3-options', 'Top 3 options'],
      ['full-breakdown', 'Full breakdown'],
    ],
  },
]

const SOURCE_LABEL: Record<string, string> = {
  explicit: 'Set by you',
  inferred: 'Learned',
  default: 'Default',
}

const LEARNED_LABEL: Record<string, (v: string) => string> = {
  riskStyle: (v) => `Risk: ${v}`,
  detailLevel: (v) => `Detail: ${v}`,
  toneStyle: (v) => `Tone: ${v}`,
  scoringPreference: (v) =>
    `Scoring: ${v === 'ppr' ? 'PPR' : v === 'half_ppr' ? 'Half PPR' : v === 'non_ppr' ? 'Standard' : v}`,
  favoriteLeagueType: (v) => `Format: ${v}`,
}

const DIRECTION_OPTIONS: [string, string][] = [
  ['', 'Not set'],
  ['contender', 'Contending'],
  ['rebuilder', 'Rebuilding'],
]

const selectStyle = { borderColor: 'var(--border)', background: 'var(--panel)', color: 'var(--text)' } as const
const ghostButton = { borderColor: 'var(--border)', color: 'var(--text)' } as const

function optionLabel(key: SettingKey, value: string): string {
  const found = SETTINGS.find((s) => s.key === key)?.options.find(([v]) => v === value)
  return found ? found[1] : value
}

export default function ChimmyPreferencesCard() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmForget, setConfirmForget] = useState<string | null>(null)
  const [newLeagueId, setNewLeagueId] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/user/chimmy-personalization', { cache: 'no-store', credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Could not load your Chimmy preferences.')
        return (await res.json()) as Snapshot
      })
      .then((data) => {
        if (!cancelled) setSnap({ profile: data.profile ?? null, remembered: data.remembered ?? [], leagues: data.leagues ?? [] })
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load your Chimmy preferences.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const patch = async (body: Record<string, unknown>, success: string) => {
    setSaving(true)
    try {
      const res = await fetch('/api/user/chimmy-personalization', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(res.status === 403 ? 'That league is not available to you.' : 'Could not save.')
      const data = (await res.json()) as Snapshot
      setSnap({ profile: data.profile ?? null, remembered: data.remembered ?? [], leagues: data.leagues ?? [] })
      toast.success(success)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
      setConfirmForget(null)
    }
  }

  const profile = snap?.profile ?? null
  const remembered = snap?.remembered ?? []
  const listedLeagues = new Set(remembered.map((r) => r.leagueId))
  const otherLeagues = (snap?.leagues ?? []).filter((l) => !listedLeagues.has(l.leagueId))

  return (
    <div
      className="rounded-xl border p-4 space-y-4"
      style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}
      data-testid="chimmy-preferences-card"
    >
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Chimmy preferences</h3>
        <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
          How Chimmy answers you, and what it has learned from your chats. Change anything here — your choice always
          wins over what Chimmy learned.
        </p>
      </div>

      {loadError ? (
        <p className="text-xs" role="alert" style={{ color: 'var(--muted)' }}>{loadError}</p>
      ) : !snap ? (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {SETTINGS.map((setting) => {
              const explicit = profile?.explicit?.[setting.key] as string | undefined
              const source = profile?.sources?.[setting.key] ?? 'default'
              /*
               * What "let Chimmy decide" would mean RIGHT NOW: the effective value when nothing is
               * set, otherwise what clearing would fall back to — the learned value, else the default.
               */
              const undecided = explicit
                ? ((profile?.inferred?.[setting.key] as string | undefined) ?? CHIMMY_PERSONALIZATION_DEFAULTS[setting.key])
                : ((profile?.effective?.[setting.key] as string | undefined) ?? CHIMMY_PERSONALIZATION_DEFAULTS[setting.key])
              return (
                <label key={setting.key} className="block" data-testid={`chimmy-pref-${setting.key}`}>
                  <span className="mb-1 flex items-center justify-between gap-2 text-xs font-medium" style={{ color: 'var(--muted2)' }}>
                    {setting.label}
                    <span
                      className="rounded-full border px-2 py-0.5 text-[10px]"
                      style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                      data-testid={`chimmy-pref-source-${setting.key}`}
                      data-source={source}
                    >
                      {SOURCE_LABEL[source] ?? source}
                    </span>
                  </span>
                  <select
                    value={explicit ?? ''}
                    disabled={saving}
                    onChange={(e) =>
                      void patch(
                        { [setting.key]: e.target.value === '' ? null : e.target.value },
                        e.target.value === '' ? `${setting.label}: Chimmy will decide` : `${setting.label} saved`,
                      )
                    }
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={selectStyle}
                  >
                    {/* The "let Chimmy decide" option names what that currently means, so clearing is not a leap. */}
                    <option value="">Let Chimmy decide ({optionLabel(setting.key, undecided)})</option>
                    {setting.options.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px]" style={{ color: 'var(--muted)' }}>{setting.hint}</span>
                </label>
              )
            })}
          </div>

          <div className="space-y-2" data-testid="chimmy-remembered">
            <h4 className="text-xs font-semibold" style={{ color: 'var(--text)' }}>What Chimmy remembers from your chats</h4>
            {remembered.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--muted)' }} data-testid="chimmy-remembered-empty">
                Nothing yet. When you tell Chimmy something like &ldquo;I&rsquo;m rebuilding&rdquo; or &ldquo;keep it short&rdquo;, it
                shows up here, and you can change it or make Chimmy forget it.
              </p>
            ) : (
              remembered.map((entry) => {
                const id = entry.leagueId ?? 'all'
                const chips = Object.entries(entry.learned)
                  .map(([k, v]) => (LEARNED_LABEL[k] ? LEARNED_LABEL[k](v) : `${k}: ${v}`))
                return (
                  <div
                    key={id}
                    className="rounded-lg border px-3 py-2"
                    style={{ borderColor: 'var(--border)' }}
                    data-testid={`chimmy-remembered-${id}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                        {entry.leagueName ?? 'All leagues'}
                      </span>
                      <div className="flex items-center gap-2">
                        <select
                          aria-label={`Team direction for ${entry.leagueName ?? 'all leagues'}`}
                          value={entry.teamDirection ?? ''}
                          disabled={saving}
                          onChange={(e) =>
                            void patch(
                              { teamDirection: { leagueId: entry.leagueId, value: e.target.value || null } },
                              'Team direction saved',
                            )
                          }
                          className="rounded-lg border px-2 py-1 text-xs"
                          style={selectStyle}
                        >
                          {DIRECTION_OPTIONS.map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                        {confirmForget === id ? (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void patch({ forget: { leagueId: entry.leagueId } }, 'Chimmy forgot it')}
                            className="rounded-lg border px-2 py-1 text-xs font-semibold"
                            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                          >
                            Confirm forget
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => setConfirmForget(id)}
                            className="rounded-lg border px-2 py-1 text-xs"
                            style={ghostButton}
                          >
                            Forget
                          </button>
                        )}
                      </div>
                    </div>
                    {chips.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {chips.map((c) => (
                          <span
                            key={c}
                            className="rounded-full border px-2 py-0.5 text-[11px]"
                            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )
              })
            )}

            {otherLeagues.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <select
                  aria-label="League to set a team direction for"
                  value={newLeagueId}
                  onChange={(e) => setNewLeagueId(e.target.value)}
                  className="rounded-lg border px-2 py-1 text-xs"
                  style={selectStyle}
                >
                  <option value="">Set team direction for a league…</option>
                  {otherLeagues.map((l) => (
                    <option key={l.leagueId} value={l.leagueId}>
                      {l.name}{l.season ? ` (${l.season})` : ''}
                    </option>
                  ))}
                </select>
                {newLeagueId ? (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        void patch({ teamDirection: { leagueId: newLeagueId, value: 'contender' } }, 'Team direction saved')
                        setNewLeagueId('')
                      }}
                      className="rounded-lg border px-2 py-1 text-xs"
                      style={ghostButton}
                    >
                      Contending
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        void patch({ teamDirection: { leagueId: newLeagueId, value: 'rebuilder' } }, 'Team direction saved')
                        setNewLeagueId('')
                      }}
                      className="rounded-lg border px-2 py-1 text-xs"
                      style={ghostButton}
                    >
                      Rebuilding
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          {profile?.transparency?.note ? (
            <p className="text-[11px]" style={{ color: 'var(--muted)' }}>{profile.transparency.note}</p>
          ) : null}
        </>
      )}
    </div>
  )
}
