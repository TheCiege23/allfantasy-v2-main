'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
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

/* Every `label`, `hint` and option label below is a translation key. */

const SETTINGS: { key: SettingKey; label: string; hint: string; options: [string, string][] }[] = [
  {
    key: 'explanationStyle',
    label: 'settings.chimmyPrefs.explanationStyle.label',
    hint: 'settings.chimmyPrefs.explanationStyle.hint',
    options: [
      ['concise', 'settings.chimmyPrefs.explanationStyle.concise'],
      ['balanced', 'settings.chimmyPrefs.optionBalanced'],
      ['detailed', 'settings.chimmyPrefs.explanationStyle.detailed'],
      ['data-heavy', 'settings.chimmyPrefs.explanationStyle.dataHeavy'],
      ['beginner-friendly', 'settings.chimmyPrefs.explanationStyle.beginnerFriendly'],
      ['commissioner-focused', 'settings.chimmyPrefs.explanationStyle.commissionerFocused'],
    ],
  },
  {
    key: 'riskPreference',
    label: 'settings.chimmyPrefs.riskPreference.label',
    hint: 'settings.chimmyPrefs.riskPreference.hint',
    options: [
      ['floor', 'settings.chimmyPrefs.riskPreference.floor'],
      ['balanced', 'settings.chimmyPrefs.optionBalanced'],
      ['upside', 'settings.chimmyPrefs.riskPreference.upside'],
    ],
  },
  {
    key: 'leagueStylePreference',
    label: 'settings.chimmyPrefs.leagueStylePreference.label',
    hint: 'settings.chimmyPrefs.leagueStylePreference.hint',
    options: [
      ['redraft-first', 'settings.chimmyPrefs.leagueStylePreference.redraft'],
      ['dynasty-first', 'settings.chimmyPrefs.leagueStylePreference.dynasty'],
      ['specialty-league-first', 'settings.chimmyPrefs.leagueStylePreference.specialty'],
      ['c2c-devy-heavy', 'settings.chimmyPrefs.leagueStylePreference.devy'],
    ],
  },
  {
    key: 'actionPreference',
    label: 'settings.chimmyPrefs.actionPreference.label',
    hint: 'settings.chimmyPrefs.actionPreference.hint',
    options: [
      ['quick-one-move', 'settings.chimmyPrefs.actionPreference.quickOneMove'],
      ['top-3-options', 'settings.chimmyPrefs.actionPreference.top3'],
      ['full-breakdown', 'settings.chimmyPrefs.actionPreference.fullBreakdown'],
    ],
  },
]

const SOURCE_LABEL: Record<string, string> = {
  explicit: 'settings.chimmyPrefs.source.explicit',
  inferred: 'settings.chimmyPrefs.source.inferred',
  default: 'settings.chimmyPrefs.source.default',
}

type Translate = (key: string) => string
type Interpolate = (key: string, vars?: Record<string, string | number | undefined>) => string

const LEARNED_LABEL: Record<string, (v: string, t: Translate, ti: Interpolate) => string> = {
  riskStyle: (v, _t, ti) => ti('settings.chimmyPrefs.learned.risk', { value: v }),
  detailLevel: (v, _t, ti) => ti('settings.chimmyPrefs.learned.detail', { value: v }),
  toneStyle: (v, _t, ti) => ti('settings.chimmyPrefs.learned.tone', { value: v }),
  scoringPreference: (v, t, ti) =>
    ti('settings.chimmyPrefs.learned.scoring', {
      value:
        v === 'ppr'
          ? 'PPR'
          : v === 'half_ppr'
            ? t('settings.chimmyPrefs.scoringHalfPpr')
            : v === 'non_ppr'
              ? t('settings.chimmyPrefs.scoringStandard')
              : v,
    }),
  favoriteLeagueType: (v, _t, ti) => ti('settings.chimmyPrefs.learned.format', { value: v }),
}

const DIRECTION_OPTIONS: [string, string][] = [
  ['', 'settings.chimmyPrefs.direction.notSet'],
  ['contender', 'settings.chimmyPrefs.direction.contender'],
  ['rebuilder', 'settings.chimmyPrefs.direction.rebuilder'],
]

const selectStyle = { borderColor: 'var(--border)', background: 'var(--panel)', color: 'var(--text)' } as const
const ghostButton = { borderColor: 'var(--border)', color: 'var(--text)' } as const

function optionLabel(key: SettingKey, value: string, t: Translate): string {
  const found = SETTINGS.find((s) => s.key === key)?.options.find(([v]) => v === value)
  return found ? t(found[1]) : value
}

export default function ChimmyPreferencesCard() {
  // Optional: the card is rendered on its own in tests, outside any LanguageProviderClient.
  const { t, tInterpolate } = useOptionalLanguage()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmForget, setConfirmForget] = useState<string | null>(null)
  const [newLeagueId, setNewLeagueId] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/user/chimmy-personalization', { cache: 'no-store', credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('settings.chimmyPrefs.loadError'))
        return (await res.json()) as Snapshot
      })
      .then((data) => {
        if (!cancelled) setSnap({ profile: data.profile ?? null, remembered: data.remembered ?? [], leagues: data.leagues ?? [] })
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : t('settings.chimmyPrefs.loadError'))
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
      if (!res.ok) {
        throw new Error(
          res.status === 403 ? t('settings.chimmyPrefs.leagueUnavailable') : t('settings.chimmyPrefs.saveFailed'),
        )
      }
      const data = (await res.json()) as Snapshot
      setSnap({ profile: data.profile ?? null, remembered: data.remembered ?? [], leagues: data.leagues ?? [] })
      toast.success(success)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.chimmyPrefs.saveFailed'))
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
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{t('settings.chimmyPrefs.title')}</h3>
        <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
          {t('settings.chimmyPrefs.intro')}
        </p>
      </div>

      {loadError ? (
        <p className="text-xs" role="alert" style={{ color: 'var(--muted)' }}>{loadError}</p>
      ) : !snap ? (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>{t('settings.chimmyPrefs.loading')}</p>
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
                    {t(setting.label)}
                    <span
                      className="rounded-full border px-2 py-0.5 text-[11px]"
                      style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                      data-testid={`chimmy-pref-source-${setting.key}`}
                      data-source={source}
                    >
                      {SOURCE_LABEL[source] ? t(SOURCE_LABEL[source]) : source}
                    </span>
                  </span>
                  <select
                    value={explicit ?? ''}
                    disabled={saving}
                    onChange={(e) =>
                      void patch(
                        { [setting.key]: e.target.value === '' ? null : e.target.value },
                        tInterpolate(
                          e.target.value === ''
                            ? 'settings.chimmyPrefs.chimmyWillDecide'
                            : 'settings.chimmyPrefs.settingSaved',
                          { label: t(setting.label) },
                        ),
                      )
                    }
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={selectStyle}
                  >
                    {/* The "let Chimmy decide" option names what that currently means, so clearing is not a leap. */}
                    <option value="">
                      {tInterpolate('settings.chimmyPrefs.letChimmyDecide', {
                        current: optionLabel(setting.key, undecided, t),
                      })}
                    </option>
                    {setting.options.map(([value, label]) => (
                      <option key={value} value={value}>{t(label)}</option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px]" style={{ color: 'var(--muted)' }}>{t(setting.hint)}</span>
                </label>
              )
            })}
          </div>

          <div className="space-y-2" data-testid="chimmy-remembered">
            <h4 className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
              {t('settings.chimmyPrefs.rememberedTitle')}
            </h4>
            {remembered.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--muted)' }} data-testid="chimmy-remembered-empty">
                {t('settings.chimmyPrefs.rememberedEmpty')}
              </p>
            ) : (
              remembered.map((entry) => {
                const id = entry.leagueId ?? 'all'
                const chips = Object.entries(entry.learned)
                  .map(([k, v]) => (LEARNED_LABEL[k] ? LEARNED_LABEL[k](v, t, tInterpolate) : `${k}: ${v}`))
                return (
                  <div
                    key={id}
                    className="rounded-lg border px-3 py-2"
                    style={{ borderColor: 'var(--border)' }}
                    data-testid={`chimmy-remembered-${id}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                        {entry.leagueName ?? t('settings.chimmyPrefs.allLeagues')}
                      </span>
                      <div className="flex items-center gap-2">
                        <select
                          aria-label={tInterpolate('settings.chimmyPrefs.directionAria', {
                            league: entry.leagueName ?? t('settings.chimmyPrefs.directionAriaAllLeagues'),
                          })}
                          value={entry.teamDirection ?? ''}
                          disabled={saving}
                          onChange={(e) =>
                            void patch(
                              { teamDirection: { leagueId: entry.leagueId, value: e.target.value || null } },
                              t('settings.chimmyPrefs.directionSaved'),
                            )
                          }
                          className="rounded-lg border px-2 py-1 text-xs"
                          style={selectStyle}
                        >
                          {DIRECTION_OPTIONS.map(([v, l]) => (
                            <option key={v} value={v}>{t(l)}</option>
                          ))}
                        </select>
                        {confirmForget === id ? (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              void patch({ forget: { leagueId: entry.leagueId } }, t('settings.chimmyPrefs.forgotten'))
                            }
                            className="rounded-lg border px-2 py-1 text-xs font-semibold"
                            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                          >
                            {t('settings.chimmyPrefs.confirmForget')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => setConfirmForget(id)}
                            className="rounded-lg border px-2 py-1 text-xs"
                            style={ghostButton}
                          >
                            {t('settings.chimmyPrefs.forget')}
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
                  aria-label={t('settings.chimmyPrefs.newLeagueAria')}
                  value={newLeagueId}
                  onChange={(e) => setNewLeagueId(e.target.value)}
                  className="rounded-lg border px-2 py-1 text-xs"
                  style={selectStyle}
                >
                  <option value="">{t('settings.chimmyPrefs.newLeaguePlaceholder')}</option>
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
                        void patch(
                          { teamDirection: { leagueId: newLeagueId, value: 'contender' } },
                          t('settings.chimmyPrefs.directionSaved'),
                        )
                        setNewLeagueId('')
                      }}
                      className="rounded-lg border px-2 py-1 text-xs"
                      style={ghostButton}
                    >
                      {t('settings.chimmyPrefs.direction.contender')}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        void patch(
                          { teamDirection: { leagueId: newLeagueId, value: 'rebuilder' } },
                          t('settings.chimmyPrefs.directionSaved'),
                        )
                        setNewLeagueId('')
                      }}
                      className="rounded-lg border px-2 py-1 text-xs"
                      style={ghostButton}
                    >
                      {t('settings.chimmyPrefs.direction.rebuilder')}
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
