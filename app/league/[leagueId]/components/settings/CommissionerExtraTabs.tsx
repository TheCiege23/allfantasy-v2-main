'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { LeagueDuesTrackerPanel } from '@/components/league-settings/LeagueDuesTrackerPanel'
import { PickTermsPanel } from '@/components/league-settings/PickTermsPanel'
import { SettingsLockPanel } from '@/components/league-settings/home/SettingsLockPanel'
import { OffseasonCalendar } from '@/components/core-app/commissioner/OffseasonCalendar'
import { importedPlatformLabel, isNativePlatform } from '@/lib/dashboard/platform-label'
import { NATIVE_PICK_YEARS, NATIVE_PICK_YEARS_MAX, NATIVE_PICK_YEARS_MIN, resolveNativePickYears } from '@/lib/league-trade-engine/nativePickYears'
import { tabsCopy, tabsLang, type TabsCopyKey, type TabsLang } from '@/lib/i18n/commish-settings-tabs-copy'
import { DiscordLeagueSyncPanel } from '../DiscordLeagueSyncPanel'

/**
 * The commissioner settings tabs that used to render PlaceholderPanel. Each one mounts the surface
 * that already does the job elsewhere in the app, so there is one place a rule is changed:
 *
 *   Payments        LeagueDuesTrackerPanel   (/api/commissioner/leagues/[id]/dues)
 *   Import / Sync   where the league came from and when it was last read; re-sync is /core/sync
 *   Advanced Rules  OffseasonCalendar        (/api/leagues/[id]/offseason-calendar)
 *   Appearance      the league logo          (/api/commissioner/leagues/[id]/logo)
 *   Permissions     SettingsLockPanel        (/api/commissioner/leagues/[id]/settings-lock)
 *   Draft Picks     future pick seasons      (/api/leagues/[id]/dynasty-settings) + PickTermsPanel
 *   Integrations    DiscordLeagueSyncPanel   (/api/discord/league)
 *
 * Strings: lib/i18n/commish-settings-tabs-copy.ts (EN/ES).
 */

function useTabsLang(): TabsLang {
  const { language } = useLanguage()
  return tabsLang(language)
}

function TabShell({ title, sub, children }: { title: TabsCopyKey; sub: TabsCopyKey; children: React.ReactNode }) {
  const lang = useTabsLang()
  return (
    <div className="min-h-0 flex-1 px-6 py-6">
      <header className="mb-5 border-b border-white/[0.08] pb-4">
        <h3 className="text-lg font-semibold text-white">{tabsCopy(title, lang)}</h3>
        <p className="mt-1 text-[13px] text-white/50">{tabsCopy(sub, lang)}</p>
      </header>
      {children}
    </div>
  )
}

export function DuesTab({ leagueId }: { leagueId: string }) {
  return (
    <TabShell title="duesTitle" sub="duesSub">
      <LeagueDuesTrackerPanel leagueId={leagueId} />
    </TabShell>
  )
}

export function PermissionsTab({ leagueId }: { leagueId: string }) {
  return (
    <TabShell title="securityTitle" sub="securitySub">
      <SettingsLockPanel leagueId={leagueId} />
    </TabShell>
  )
}

export function AdvancedRulesTab({ leagueId }: { leagueId: string }) {
  return (
    <TabShell title="advancedTitle" sub="advancedSub">
      <OffseasonCalendar leagueId={leagueId} />
    </TabShell>
  )
}

export function IntegrationsTab({ leagueId, leagueOwnerUserId }: { leagueId: string; leagueOwnerUserId: string }) {
  const { data: session } = useSession()
  const viewerId = session?.user?.id ?? ''
  return (
    <TabShell title="integrationsTitle" sub="integrationsSub">
      <DiscordLeagueSyncPanel leagueId={leagueId} isLeagueOwner={Boolean(viewerId) && viewerId === leagueOwnerUserId} />
    </TabShell>
  )
}

function formatDate(iso: string | null, lang: TabsLang): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(lang === 'es' ? 'es' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ImportSyncTab({
  platform,
  importedAt,
  lastSyncedAt,
  syncStatus,
}: {
  platform: string | null
  importedAt: string | null
  lastSyncedAt: string | null
  syncStatus: string | null
}) {
  const lang = useTabsLang()
  const label = importedPlatformLabel(platform)
  if (isNativePlatform(platform) || !label) {
    return (
      <TabShell title="importTitle" sub="importSub">
        <p data-testid="import-sync-native" className="max-w-lg text-[13px] leading-relaxed text-white/65">
          {tabsCopy('nativeLeague', lang)}
        </p>
      </TabShell>
    )
  }
  const imported = formatDate(importedAt, lang)
  const synced = formatDate(lastSyncedAt, lang)
  return (
    <TabShell title="importTitle" sub="importSub">
      <div data-testid="import-sync-imported" className="max-w-lg space-y-2 text-[13px] text-white/70">
        <p className="font-semibold text-white/90">{tabsCopy('importedFrom', lang, { platform: label })}</p>
        {imported ? <p>{tabsCopy('importedOn', lang, { date: imported })}</p> : null}
        <p>{synced ? tabsCopy('lastSynced', lang, { date: synced }) : tabsCopy('neverSynced', lang)}</p>
        {syncStatus === 'error' ? <p className="text-amber-200/90">{tabsCopy('statusError', lang)}</p> : null}
        <p className="text-white/50">{tabsCopy('importNote', lang, { platform: label })}</p>
        <Link
          href="/core/sync"
          className="mt-2 inline-flex rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-[12px] font-semibold text-cyan-100 hover:bg-cyan-500/20"
        >
          {tabsCopy('openSync', lang)}
        </Link>
      </div>
    </TabShell>
  )
}

export function AppearanceTab({ leagueId, logoUrl, canEdit }: { leagueId: string; logoUrl: string | null; canEdit: boolean }) {
  const lang = useTabsLang()
  const [current, setCurrent] = useState<string | null>(logoUrl)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const url = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/logo`

  useEffect(() => setCurrent(logoUrl), [logoUrl])

  const send = async (init: RequestInit, ok: TabsCopyKey) => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(url, init)
      const data = (await res.json().catch(() => ({}))) as { logoUrl?: string | null; error?: string }
      if (!res.ok) {
        setMessage({ tone: 'error', text: data.error || tabsCopy('logoFailed', lang) })
        return
      }
      setCurrent(data.logoUrl ?? null)
      setMessage({ tone: 'ok', text: tabsCopy(ok, lang) })
    } catch {
      setMessage({ tone: 'error', text: tabsCopy('logoFailed', lang) })
    } finally {
      setBusy(false)
    }
  }

  const onFile = (file: File | undefined) => {
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    void send({ method: 'POST', body: form }, 'logoSaved')
  }

  return (
    <TabShell title="appearanceTitle" sub="appearanceSub">
      <div className="flex items-start gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
          {current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current} alt={tabsCopy('logoCurrent', lang)} className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div className="space-y-2 text-[13px] text-white/65">
          {!current ? <p data-testid="league-logo-none">{tabsCopy('logoNone', lang)}</p> : null}
          {canEdit ? (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                  className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-[12px] font-semibold text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50"
                >
                  {tabsCopy(current ? 'logoReplace' : 'logoUpload', lang)}
                </button>
                {current ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void send({ method: 'DELETE' }, 'logoRemoved')}
                    className="rounded-lg border border-white/15 px-3 py-2 text-[12px] font-semibold text-white/75 hover:bg-white/[0.06] disabled:opacity-50"
                  >
                    {tabsCopy('logoRemove', lang)}
                  </button>
                ) : null}
              </div>
              <p className="text-[11px] text-white/45">{tabsCopy('logoHint', lang)}</p>
              <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                data-testid="league-logo-input"
                onChange={(e) => {
                  onFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </>
          ) : (
            <p className="text-[12px] text-white/45">{tabsCopy('readOnly', lang)}</p>
          )}
          {message ? (
            <p role="status" className={message.tone === 'ok' ? 'text-emerald-300' : 'text-red-300'}>
              {message.text}
            </p>
          ) : null}
        </div>
      </div>
    </TabShell>
  )
}

/** The seasons a commissioner may pick for the tradeable-pick horizon (the trade engine's 1-5 clamp). */
export const PICK_YEAR_OPTIONS = Array.from({ length: NATIVE_PICK_YEARS_MAX - NATIVE_PICK_YEARS_MIN + 1 }, (_, i) => NATIVE_PICK_YEARS_MIN + i)

export function DraftPicksTab({ leagueId, nativeDynasty, canEdit }: { leagueId: string; nativeDynasty: boolean; canEdit: boolean }) {
  const lang = useTabsLang()
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/dynasty-settings`
  const [saved, setSaved] = useState<number | null>(null)
  const [years, setYears] = useState<number>(NATIVE_PICK_YEARS)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { effective?: { futurePicksYearsOut?: number | null } }
      const n = resolveNativePickYears(data.effective?.futurePicksYearsOut)
      setSaved(n)
      setYears(n)
    } catch {
      // The tab still shows the pick terms card.
    }
  }, [url])

  useEffect(() => {
    if (nativeDynasty) void load()
  }, [nativeDynasty, load])

  const save = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ futurePicksYearsOut: years }) })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setMessage({ tone: 'error', text: data.error || tabsCopy('pickYearsFailed', lang) })
        return
      }
      setSaved(years)
      setMessage({ tone: 'ok', text: tabsCopy('pickYearsSaved', lang) })
    } catch {
      setMessage({ tone: 'error', text: tabsCopy('pickYearsFailed', lang) })
    } finally {
      setBusy(false)
    }
  }

  if (!nativeDynasty) {
    return (
      <TabShell title="picksTitle" sub="picksSub">
        <p data-testid="draft-picks-not-dynasty" className="max-w-lg text-[13px] leading-relaxed text-white/65">
          {tabsCopy('picksNotDynasty', lang)}
        </p>
      </TabShell>
    )
  }

  return (
    <TabShell title="picksTitle" sub="picksSub">
      <div className="max-w-lg space-y-6">
        <section className="space-y-2">
          <label className="block">
            <span className="text-[12px] font-semibold text-white/80">{tabsCopy('pickYearsLabel', lang)}</span>
            <select
              data-testid="pick-years-select"
              value={years}
              disabled={!canEdit || busy || saved == null}
              onChange={(e) => setYears(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-[13px] text-white disabled:opacity-50"
            >
              {PICK_YEAR_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {tabsCopy(n === 1 ? 'pickYearsOne' : 'pickYearsOther', lang, { n })}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] leading-relaxed text-white/45">{tabsCopy('pickYearsHelp', lang)}</p>
          {canEdit ? (
            <button
              type="button"
              data-testid="pick-years-save"
              disabled={busy || saved == null || years === saved}
              onClick={() => void save()}
              className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-[12px] font-semibold text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              {tabsCopy('pickYearsSave', lang)}
            </button>
          ) : (
            <p className="text-[12px] text-white/45">{tabsCopy('readOnly', lang)}</p>
          )}
          {message ? (
            <p role="status" className={message.tone === 'ok' ? 'text-[12px] text-emerald-300' : 'text-[12px] text-red-300'}>
              {message.text}
            </p>
          ) : null}
        </section>
        <PickTermsPanel leagueId={leagueId} />
        <p className="text-[11px] text-white/45">{tabsCopy('picksTradingNote', lang)}</p>
      </div>
    </TabShell>
  )
}
