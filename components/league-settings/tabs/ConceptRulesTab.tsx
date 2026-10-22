'use client'

import { useMemo } from 'react'
import { DevyLeagueSettingsHub } from '@/components/devy/settings/DevyLeagueSettingsHub'
import { BestBallSettingsCommissionerPanel } from '@/components/league-settings/BestBallSettingsCommissionerPanel'
import LeagueTypeConfirm from '@/components/league/LeagueTypeConfirm'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'

/** "big_brother" → "Big Brother": a format id is never shown to a commissioner as-is. */
function formatName(variant: string | null): string {
  if (!variant) return '—'
  // Customer-facing name since the 2026-10-22 rename; the stored id stays 'guillotine'.
  if (variant.toLowerCase() === 'guillotine') return 'Guilly'
  return variant
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * League format: what kind of league this is, and the format's own panels (Devy, Best Ball).
 *
 * This page used to end in a "Commissioner concept notes (JSON merge)" textarea that wrote raw
 * JSON into `settings.concept_rules_overlay`. Nothing reads that key (it only round-trips into
 * league templates), so it was a developer field shown to commissioners; it is gone. Any value
 * already saved is left in place.
 */
export function ConceptRulesTab({ ctx, canEdit }: LeagueSettingsTabProps) {
  const { t } = useLanguage()
  const leagueId = ctx.league.id

  const isDevy = useMemo(() => {
    const raw =
      ctx.league.settings && typeof ctx.league.settings === 'object' && !Array.isArray(ctx.league.settings)
        ? (ctx.league.settings as Record<string, unknown>).devy_league_config
        : undefined
    return ctx.league.leagueType === 'devy' || Boolean(raw)
  }, [ctx.league.leagueType, ctx.league.settings])

  const flags = useMemo(
    () => ({
      guillotine: ctx.league.guillotineMode === true,
      survivor: ctx.league.survivorMode === true,
      bestBall: ctx.league.bestBallMode === true,
      variant: ctx.league.leagueVariant ?? null,
    }),
    [ctx.league.guillotineMode, ctx.league.survivorMode, ctx.league.bestBallMode, ctx.league.leagueVariant],
  )

  return (
    <div className="space-y-8">
      <LeagueTypeConfirm leagueId={leagueId} alwaysShow />

      <div className="rounded-2xl border border-white/[0.08] bg-[#0a1228]/80 p-4">
        <h4 className="text-[12px] font-bold uppercase tracking-wide text-cyan-200/80">{t('lsHub.cr.snapshot')}</h4>
        <ul className="mt-3 space-y-1.5 text-[12px] text-white/70">
          <li>{t('lsHub.cr.guillotine').replace('{{state}}', flags.guillotine ? t('lsHub.on') : t('lsHub.off'))}</li>
          <li>{t('lsHub.cr.survivor').replace('{{state}}', flags.survivor ? t('lsHub.on') : t('lsHub.off'))}</li>
          <li>{t('lsHub.cr.bestBall').replace('{{state}}', flags.bestBall ? t('lsHub.on') : t('lsHub.off'))}</li>
          <li>{t('lsHub.cr.variant').replace('{{variant}}', formatName(flags.variant))}</li>
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-white/45">
          {t('lsHub.cr.note')}
        </p>
      </div>

      {isDevy ? (
        <div className="space-y-3">
          <h4 className="text-[12px] font-bold uppercase tracking-wide text-white/55">Devy HQ</h4>
          <DevyLeagueSettingsHub ctx={ctx} />
        </div>
      ) : null}

      {flags.bestBall ? (
        <div className="space-y-3">
          <h4 className="text-[12px] font-bold uppercase tracking-wide text-white/55">{t('lsHub.cr.bestBallSettings')}</h4>
          <BestBallSettingsCommissionerPanel
            leagueId={ctx.league.id}
            sport={String(ctx.league.sport ?? 'NFL')}
            canEdit={canEdit}
          />
        </div>
      ) : null}

    </div>
  )
}
