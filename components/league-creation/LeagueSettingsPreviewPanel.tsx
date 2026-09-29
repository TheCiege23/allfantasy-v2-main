'use client';

/**
 * Shows a summary of roster, scoring, player pool, and league defaults for the selected preset.
 * Updates when sport or preset (variant) changes; helps users confirm settings before creation.
 */
import { useMemo, useState } from 'react';
import type { LeagueCreationPresetPayload } from '@/hooks/useSportPreset';
import { supportsIdpLeagueSport } from '@/lib/sport-scope';

export interface LeagueSettingsPreviewPanelProps {
  preset: LeagueCreationPresetPayload | null;
  sport: string;
  presetLabel?: string;
  teamCountOverride?: number | null;
  playoffTeamCountOverride?: number | null;
  regularSeasonLengthOverride?: number | null;
  matchupUnitOverride?: string | null;
  tradeReviewModeOverride?: 'none' | 'commissioner' | 'league_vote' | 'instant' | null;
  className?: string;
}

export function LeagueSettingsPreviewPanel({
  preset,
  sport,
  presetLabel,
  teamCountOverride,
  playoffTeamCountOverride,
  regularSeasonLengthOverride,
  matchupUnitOverride,
  tradeReviewModeOverride,
  className = '',
}: LeagueSettingsPreviewPanelProps) {
  const [showDisabledScoringRules, setShowDisabledScoringRules] = useState(false);
  const scoringRules = useMemo(
    () =>
      (preset?.scoringTemplate?.rules ?? []).filter((rule) =>
        showDisabledScoringRules ? true : rule.enabled !== false
      ),
    [preset?.scoringTemplate?.rules, showDisabledScoringRules]
  );
  if (!preset) return null;

  const sportUpper = String(sport || '').toUpperCase();
  const variantText = [presetLabel, preset.scoring?.scoring_format, preset.scoringTemplate?.formatType]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  const isSoccer = sportUpper === 'SOCCER';
  const isFootballIdp = supportsIdpLeagueSport(sportUpper) && variantText.includes('IDP');

  const rosterSlots = preset.roster?.starter_slots
    ? Object.entries(preset.roster.starter_slots)
        .filter(([, count]) => count > 0)
        .map(([slot, count]) => `${slot}: ${count}`)
        .join(', ')
    : preset.rosterTemplate?.slots
        ?.filter((s) => s.starterCount > 0)
        .map((s) => `${s.slotName}: ${s.starterCount}`)
        .join(', ') ?? '—';
  const irSlots =
    typeof preset.roster?.IR_slots === 'number'
      ? preset.roster.IR_slots
      : null;

  const scoringFormat = preset.scoring?.scoring_format ?? preset.scoringTemplate?.formatType ?? '—';
  const scoringName = preset.scoringTemplate?.name ?? scoringFormat;

  const playerPoolType =
    isSoccer
      ? 'Soccer players (GKP/GK, DEF, MID, FWD)'
      : isFootballIdp
        ? `${sportUpper} offensive + IDP defenders (DL, LB, DB, IDP FLEX)`
        : sportUpper === 'NFL'
          ? 'NFL offensive + DST'
          : `${sportUpper || 'Sport'} players`;

  const teamMetadata = preset.teamMetadata?.teams ?? [];
  const teamMetadataSamples = teamMetadata.slice(0, 6);

  const defaultLeagueSettings =
    preset.defaultLeagueSettings && typeof preset.defaultLeagueSettings === 'object'
      ? (preset.defaultLeagueSettings as Record<string, unknown>)
      : null;
  const effectiveTeamCount = teamCountOverride ?? preset.league?.default_team_count ?? null;
  const effectivePlayoffCount =
    playoffTeamCountOverride ??
    (typeof defaultLeagueSettings?.playoff_team_count === 'number'
      ? defaultLeagueSettings.playoff_team_count
      : preset.league?.default_playoff_team_count ?? null);
  const effectiveSeasonLength =
    regularSeasonLengthOverride ??
    (typeof defaultLeagueSettings?.regular_season_length === 'number'
      ? defaultLeagueSettings.regular_season_length
      : preset.league?.default_regular_season_length ?? null);
  const effectiveMatchupUnit =
    matchupUnitOverride ??
    (typeof defaultLeagueSettings?.schedule_unit === 'string'
      ? defaultLeagueSettings.schedule_unit
      : preset.league?.default_matchup_unit ?? null);

  const leagueDefaults = [
    `Teams: ${effectiveTeamCount ?? '—'}`,
    `Playoffs: ${effectivePlayoffCount ?? '—'} teams`,
    `Season: ${effectiveSeasonLength ?? '—'} ${effectiveMatchupUnit ?? 'weeks'}`,
  ].join(' · ');
  const defaultModes = [
    `Scoring mode: ${
      typeof defaultLeagueSettings?.scoring_mode === 'string'
        ? defaultLeagueSettings.scoring_mode
        : 'points'
    }`,
    `Roster mode: ${
      typeof defaultLeagueSettings?.roster_mode === 'string'
        ? defaultLeagueSettings.roster_mode
        : 'redraft'
    }`,
    `Waiver mode: ${
      typeof defaultLeagueSettings?.waiver_mode === 'string'
        ? defaultLeagueSettings.waiver_mode
        : preset.waiver?.waiver_type ?? '—'
    }`,
    `Trade review: ${
      tradeReviewModeOverride ??
      (typeof defaultLeagueSettings?.trade_review_mode === 'string'
        ? defaultLeagueSettings.trade_review_mode
        : 'commissioner')
    }`,
  ].join(' · ');

  const contextMessage =
    isSoccer
      ? 'Soccer is a separate sport selection, so this preview uses soccer-specific roster slots, scoring, and player pools.'
      : isFootballIdp
        ? `IDP keeps ${sportUpper} as the sport, but expands the preset to include defensive starters, defenders in the player pool, and IDP scoring.`
        : null;

  return (
    <div
      className={`rounded-lg border border-purple-600/30 bg-black/30 p-4 text-sm ${className}`}
      role="region"
      aria-label="Preset summary"
    >
      <p className="font-medium text-purple-300 mb-2">Preset summary</p>
      {contextMessage && (
        <p className="text-white/70 text-xs mb-2 italic">{contextMessage}</p>
      )}
      <ul className="space-y-1.5 text-white/80">
        <li>
          <span className="text-white/60">Roster:</span> {rosterSlots || '—'}
          {preset.roster?.bench_slots != null && (
            <span className="text-white/60"> · Bench: {preset.roster.bench_slots}</span>
          )}
          {irSlots != null && (
            <span className="text-white/60"> · IR: {irSlots}</span>
          )}
        </li>
        <li>
          <span className="text-white/60">Scoring:</span> {scoringName}
        </li>
        <li>
          <span className="text-white/60">Player pool:</span> {playerPoolType}
        </li>
        <li>
          <span className="text-white/60">League defaults:</span> {leagueDefaults}
        </li>
        <li>
          <span className="text-white/60">League settings:</span> {defaultModes}
        </li>
        {teamMetadata.length > 0 && (
          <li>
            <span className="text-white/60">Team metadata:</span> {teamMetadata.length} teams with logos
            <div className="mt-2 flex flex-wrap gap-2">
              {teamMetadataSamples.map((team) => (
                <span
                  key={`${team.team_id}-${team.abbreviation}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2 py-1 text-xs text-white/75"
                  title={team.team_name}
                >
                  {team.primary_logo ? (
                    <img
                      src={team.primary_logo}
                      alt={`${team.abbreviation} logo`}
                      className="h-3.5 w-3.5 rounded-full object-contain"
                      loading="lazy"
                    />
                  ) : null}
                  <span>{team.abbreviation}</span>
                </span>
              ))}
            </div>
          </li>
        )}
      </ul>
      <div className="mt-3 rounded-lg border border-white/10 bg-black/25 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-white/85">Scoring categories preview</p>
          <label className="inline-flex items-center gap-2 text-[11px] text-white/65">
            <input
              type="checkbox"
              checked={showDisabledScoringRules}
              onChange={(event) => setShowDisabledScoringRules(event.target.checked)}
              data-testid="league-settings-preview-show-disabled-scoring-rules"
              className="h-3.5 w-3.5 accent-cyan-500"
            />
            Show disabled
          </label>
        </div>
        {scoringRules.length === 0 ? (
          <p className="text-[11px] text-white/55">
            No scoring categories in this preset preview.
          </p>
        ) : (
          <div className="max-h-48 overflow-auto rounded border border-white/10">
            <table className="min-w-full text-[11px]">
              <thead className="bg-black/50 text-white/55">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Category</th>
                  <th className="px-2 py-1.5 text-right font-medium">Points</th>
                  <th className="px-2 py-1.5 text-right font-medium">Multiplier</th>
                  <th className="px-2 py-1.5 text-right font-medium">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {scoringRules.map((rule) => (
                  <tr
                    key={rule.statKey}
                    className="border-t border-white/10 text-white/80"
                    data-testid={`league-settings-preview-rule-${rule.statKey}`}
                  >
                    <td className="px-2 py-1.5">
                      <div className="font-medium">
                        {rule.statKey.replace(/_/g, ' ')}
                      </div>
                      <div className="text-[11px] text-white/45">{rule.statKey}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right">{rule.pointsValue}</td>
                    <td className="px-2 py-1.5 text-right">{rule.multiplier}</td>
                    <td className="px-2 py-1.5 text-right">
                      {rule.enabled === false ? 'Off' : 'On'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-white/50">
        Roster and scoring above update when you change sport or preset. You can change league size and other options before creating.
      </p>
    </div>
  );
}
