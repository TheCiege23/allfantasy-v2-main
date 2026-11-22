'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import {
  GAMES_COUNT_BEST_N_KEY,
  GAMES_COUNT_MODE_KEY,
  isGamesCountSport,
  readGamesCountSetting,
  type GamesCountMode,
} from '@/lib/redraft/gamesCount'
import { SettingsSection } from './ui'

/**
 * The commissioner's "which games count" control (lib/redraft/gamesCount.ts), for NBA/NHL/MLB only.
 *
 * Rendered inside `SportConfigSettingsPanel` and written through ITS `patch`, so the two keys land in
 * the same `sportConfig` blob that panel autosaves. A separate save would race the panel's own copy of
 * the blob and one of the two would silently undo the other. The server refuses any invalid value
 * (`gamesCountSportConfigError` in the settings PATCH); this control offers only valid ones.
 */
export function GamesCountSettingControl({
  sport,
  sportConfig,
  onPatch,
  disabled,
}: {
  sport: string
  sportConfig: Record<string, unknown>
  onPatch: (partial: Record<string, unknown>) => void
  disabled: boolean
}) {
  const { t, tInterpolate } = useOptionalLanguage()
  if (!isGamesCountSport(sport)) return null
  const setting = readGamesCountSetting({ sportConfig }, sport)
  const n = setting.mode === 'best_n' ? setting.n : 2
  const modes: GamesCountMode[] = ['all', 'best_n', 'lock_in']

  const choose = (mode: GamesCountMode) => {
    if (mode === 'best_n') onPatch({ [GAMES_COUNT_MODE_KEY]: 'best_n', [GAMES_COUNT_BEST_N_KEY]: n })
    else onPatch({ [GAMES_COUNT_MODE_KEY]: mode, [GAMES_COUNT_BEST_N_KEY]: null })
  }

  return (
    <SettingsSection title={t('gamesCount.title')} description={t('gamesCount.help')}>
      <div role="radiogroup" aria-label={t('gamesCount.title')} className="space-y-3" data-testid="games-count-setting">
        {modes.map((mode) => (
          <label key={mode} className="flex cursor-pointer items-start gap-2 text-[13px] text-white/80">
            <input
              type="radio"
              name="games-count-mode"
              className="mt-0.5"
              value={mode}
              checked={setting.mode === mode}
              disabled={disabled}
              onChange={() => choose(mode)}
              data-testid={`games-count-mode-${mode}`}
            />
            <span>
              <span className="block font-medium text-white">{t(`gamesCount.mode.${mode}`)}</span>
              <span className="block text-[11px] text-white/45">{tInterpolate(`gamesCount.mode.${mode}.desc`, { n })}</span>
            </span>
          </label>
        ))}
        {setting.mode === 'best_n' ? (
          <div className="flex flex-col gap-1 pl-6 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[13px] text-white/70">{t('gamesCount.bestN')}</span>
            <select
              className="w-28 rounded-lg border border-white/[0.12] bg-[#0a1220] px-2 py-1 text-[13px] text-white"
              disabled={disabled}
              value={String(n)}
              onChange={(e) => onPatch({ [GAMES_COUNT_MODE_KEY]: 'best_n', [GAMES_COUNT_BEST_N_KEY]: Number(e.target.value) })}
              data-testid="games-count-best-n"
            >
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </div>
        ) : null}
      </div>
    </SettingsSection>
  )
}
