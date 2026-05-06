'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  refreshLegacyImportStatus,
  LEGACY_PROVIDER_IDS,
  getLegacyProviderName,
  getImportStatusLabel,
  getProviderStatus,
  LegacyProviderImportHelp,
  type LegacyImportStatusResponse,
  type LegacyProviderId,
} from '@/lib/legacy-import-settings'
import { StepHelp } from '@/components/league-creation-wizard/StepHelp'
import { SLEEPER_IMPORT_SPORTS } from '@/lib/league-import/sleeper/import-sports'

export type LegacyRankingsImportPanelProps = {
  onImportSuccess: () => void
  /** Optional compact layout for dashboard (single column on mobile, tighter grid). */
  variant?: 'default' | 'dashboard'
}

/**
 * "Build Your Legacy Profile" — import Sleeper + links to /import for other providers.
 * Used on My Rankings and the main dashboard so users can track import without leaving home.
 */
export function LegacyRankingsImportPanel({ onImportSuccess, variant = 'default' }: LegacyRankingsImportPanelProps) {
  const [legacyStatus, setLegacyStatus] = useState<LegacyImportStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [importInputs, setImportInputs] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState<Record<string, boolean>>({})
  const [importError, setImportError] = useState<Record<string, string | null>>({})

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setLegacyStatus(await refreshLegacyImportStatus())
      setLoading(false)
    })()
  }, [])

  const handleLegacyProviderImport = async (providerId: LegacyProviderId) => {
    setImporting((prev) => ({ ...prev, [providerId]: true }))
    setImportError((prev) => ({ ...prev, [providerId]: null }))
    try {
      if (providerId === 'sleeper') {
        const username = importInputs[providerId]?.trim()
        if (!username) throw new Error('Sleeper username required')
        const userRes = await fetch('/api/legacy/user/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username }),
        })
        if (!userRes.ok) throw new Error('Sleeper username not found')
        const userData = await userRes.json()
        const sportResults = await Promise.allSettled(
          SLEEPER_IMPORT_SPORTS.map((sport) =>
            fetch('/api/import-sleeper', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sleeperUserId: userData.user_id, sport, isLegacy: true }),
            }).then(async (res) => {
              if (res.ok) return { ok: true as const }
              if (res.status === 404) return { ok: false as const, notFound: true }
              const data = (await res.json().catch(() => ({}))) as { error?: string }
              return { ok: false as const, notFound: false, error: data.error?.trim() || 'Import failed' }
            })
          )
        )
        let importedAnySport = false
        let sawNoLeagues = false
        for (const r of sportResults) {
          if (r.status === 'rejected') continue
          if (r.value.ok) {
            importedAnySport = true
            continue
          }
          if (r.value.notFound) {
            sawNoLeagues = true
            continue
          }
          throw new Error(r.value.error)
        }
        if (!importedAnySport) {
          throw new Error(sawNoLeagues ? 'No Sleeper leagues found for this account' : 'Import failed')
        }
      } else {
        throw new Error('Use the Import page for this provider — link below.')
      }
      setLegacyStatus(await refreshLegacyImportStatus())
      onImportSuccess()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Import failed'
      setImportError((prev) => ({ ...prev, [providerId]: msg }))
    } finally {
      setImporting((prev) => ({ ...prev, [providerId]: false }))
    }
  }

  const gridClass =
    variant === 'dashboard'
      ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3'
      : 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4'

  return (
    <div
      className="rounded-2xl border border-white/8 bg-gradient-to-br from-[#12082a] to-[#0a0a1e] p-5 shadow-2xl sm:p-6"
      data-testid="legacy-rankings-import-panel"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-white">Build Your Legacy Profile</h3>
          <p className="mt-0.5 text-sm text-white/50">
            Import your fantasy history to calculate your AllFantasy rank, XP progress, and AI grade.
          </p>
        </div>
        {variant === 'dashboard' ? (
          <Link
            href="/af-rankings"
            className="shrink-0 text-xs font-semibold text-cyan-300/90 hover:text-cyan-200"
          >
            Full rankings page →
          </Link>
        ) : null}
      </div>
      {loading ? (
        <p className="text-sm text-white/40">Loading import status…</p>
      ) : (
        <div className={gridClass}>
          {LEGACY_PROVIDER_IDS.map((providerId) => {
            const status = legacyStatus ? getProviderStatus(legacyStatus, providerId) : null
            const name = getLegacyProviderName(providerId)
            const importStatusLabel = status?.importStatus ? getImportStatusLabel(status.importStatus) : '—'
            const imported = status?.importStatus === 'completed'
            const isDisabled = imported || importing[providerId]
            return (
              <div key={providerId} className="relative flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-base font-bold text-white">{name}</span>
                  <StepHelp title={`How to import from ${name}`}>
                    <LegacyProviderImportHelp providerId={providerId} />
                  </StepHelp>
                </div>
                <div className="mb-1 text-xs text-white/50">Status: {importStatusLabel}</div>
                {imported ? (
                  <div className="text-xs font-semibold text-green-400">Imported</div>
                ) : providerId === 'sleeper' ? (
                  <>
                    <input
                      type="text"
                      value={importInputs[providerId] || ''}
                      onChange={(e) =>
                        setImportInputs((inputs) => ({ ...inputs, [providerId]: e.target.value }))
                      }
                      placeholder="Sleeper username"
                      className="w-full rounded border border-white/10 bg-white/10 px-2 py-1 text-sm text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
                      disabled={isDisabled}
                    />
                    {importError[providerId] && (
                      <div className="mt-1 text-xs text-red-400">{importError[providerId]}</div>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleLegacyProviderImport(providerId)}
                      disabled={isDisabled || !importInputs[providerId]?.trim()}
                      className="mt-2 w-full rounded bg-gradient-to-r from-cyan-600 to-purple-600 py-2 text-xs font-bold text-white disabled:opacity-40"
                    >
                      {importing[providerId] ? 'Importing…' : `Import from ${name}`}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] leading-snug text-white/45">
                      ESPN, Yahoo, MFL, Fantrax, and Fleaflicker use the same secure import flow as the main Import page
                      (league id / key and account access).
                    </p>
                    {importError[providerId] ? (
                      <div className="mt-1 text-xs text-red-400">{importError[providerId]}</div>
                    ) : null}
                    <Link
                      href="/import?returnTo=/dashboard"
                      className="mt-2 flex w-full items-center justify-center rounded bg-gradient-to-r from-cyan-600 to-purple-600 py-2 text-xs font-bold text-white hover:opacity-95"
                    >
                      Open import tool →
                    </Link>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
      <p className="mt-3 text-center text-[11px] text-white/25">
        Career rank cache, AI report, and overview cards all refresh from this import.
      </p>
    </div>
  )
}
