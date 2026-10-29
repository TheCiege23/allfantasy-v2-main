'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Users, CheckCircle2, AlertCircle, Settings, Trophy, Calendar, History, ArrowLeft } from 'lucide-react';
import type { ImportPreviewResponse } from '@/lib/league-import/ImportedLeaguePreviewBuilder';
import { getImportProviderLabel } from '@/lib/league-import/provider-ui-config';
import type { ImportProvider } from '@/lib/league-import/types';

export interface ImportedLeaguePreviewPanelProps {
  /** Current import provider (e.g. sleeper). */
  provider: ImportProvider | null;
  preview: ImportPreviewResponse | null;
  loading: boolean;
  onCreateFromImport: () => void;
  createLoading: boolean;
  /** Optional: clear preview so user can enter a different league ID. */
  onBack?: () => void;
}

export function ImportedLeaguePreviewPanel({
  provider,
  preview,
  loading,
  onCreateFromImport,
  createLoading,
  onBack,
}: ImportedLeaguePreviewPanelProps) {
  if (loading) {
    return (
      <Card className="border-cyan-400/25 bg-[#07122d]/80 backdrop-blur-md">
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-300" />
          <span className="ml-2 text-white">Fetching league…</span>
        </CardContent>
      </Card>
    );
  }

  if (!preview) return null;

  const { league, managers, dataQuality } = preview;
  const formatSummary = preview.formatSummary ?? {
    detectedFormat: league.type,
    modifiers: [],
    mappedScoringSettingsCount: 0,
    mappedRosterSlotCount: preview.rosterPositions?.length ?? 0,
    unsupportedPositions: [],
    introVideo: 'Not resolved',
    formatCardLabel: league.type,
  };
  const coverageItems = dataQuality.coverageSummary.slice(0, 6);
  const tierColor =
    dataQuality.tier === 'FULL'
      ? 'text-green-400'
      : dataQuality.tier === 'PARTIAL'
        ? 'text-amber-400'
        : 'text-amber-500';
  const sourceLabel = provider ? getImportProviderLabel(provider) : preview.source?.source_provider ?? 'Import';
  const managersWithTeamLogos = managers.filter((m) => Boolean(m.teamLogo)).length;

  return (
    <Card className="border-cyan-400/25 bg-[#07122d]/80 backdrop-blur-md" data-testid="import-preview-panel">
      <CardHeader>
        <div className="flex items-center gap-2">
          {league.avatar && (
            <img
              src={league.avatar}
              alt=""
              className="h-10 w-10 rounded-full object-cover border border-cyan-300/35"
            />
          )}
          <div>
            <CardTitle className="text-lg text-white">Import preview: {league.name}</CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-sm text-white/70 mt-0.5">
              <span>{league.sport}</span>
              {league.seasonPhase && (
                <span className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-amber-200" data-testid="fantrax-season-phase">
                  {league.seasonPhase === 'pre_draft' ? 'Pre-draft' : 'Offseason'}
                </span>
              )}
              <span>·</span>
              <span>{league.type}</span>
              <span>·</span>
              <span>{league.teamCount} teams</span>
              {league.season != null && (
                <>
                  <span>·</span>
                  <span>Season {league.season}</span>
                </>
              )}
              <span>·</span>
              <span className="text-cyan-200">Source: {sourceLabel}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Data quality */}
        <div className="flex items-center gap-2">
          {dataQuality.tier === 'FULL' ? (
            <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
          ) : (
            <AlertCircle className={`h-5 w-5 shrink-0 ${tierColor}`} />
          )}
          <span className={tierColor}>
            Data quality: {dataQuality.tier} ({dataQuality.completenessScore}%)
          </span>
        </div>
        {dataQuality.signals.length > 0 && (
          <ul className="list-inside list-disc text-xs text-white/60">
            {dataQuality.signals.slice(0, 5).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
        {coverageItems.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {coverageItems.map((item) => {
              const pillClass =
                item.state === 'full'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : item.state === 'partial'
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                    : 'border-rose-500/40 bg-rose-500/10 text-rose-200';
              return (
                <span
                  key={item.key}
                  className={`rounded-full border px-2 py-1 text-[11px] ${pillClass}`}
                  title={item.note ?? undefined}
                >
                  {item.label}: {item.state}
                </span>
              );
            })}
          </div>
        )}

        {/* Settings summary: roster, scoring, playoff, draft */}
        <div className="rounded border border-cyan-400/25 bg-[#030a20]/80 p-3 space-y-2">
          <p className="text-xs font-medium text-white/70 flex items-center gap-1.5">
            <Settings className="h-3.5 w-3.5" />
            Settings
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-white/90">
            <span className="text-white/60">Roster</span>
            <span>{preview.rosterPositions?.length ? preview.rosterPositions.join(', ') : '—'}</span>
            <span className="text-white/60">Scoring</span>
            <span>
              {[
                league.settings?.ppr && 'PPR',
                league.settings?.superflex && 'Superflex',
                league.settings?.tep && 'TEP',
              ]
                .filter(Boolean)
                .join(', ') || 'Standard'}
            </span>
            <span className="text-white/60">Playoff teams</span>
            <span>{league.playoffTeams ?? '—'}</span>
            <span className="text-white/60">Draft</span>
            <span>{preview.draftPickCount} picks imported</span>
          </div>
        </div>

        <div className="rounded border border-cyan-400/25 bg-[#030a20]/80 p-3 space-y-2">
          <p className="text-xs font-medium text-white/70">Detected AllFantasy format</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-white/90">
            <span className="text-white/60">Format</span>
            <span>{formatSummary.detectedFormat}</span>
            <span className="text-white/60">Modifiers</span>
            <span>{formatSummary.modifiers.join(', ') || 'None'}</span>
            <span className="text-white/60">Mapped scoring rules</span>
            <span>{formatSummary.mappedScoringSettingsCount}</span>
            <span className="text-white/60">Mapped roster slots</span>
            <span>{formatSummary.mappedRosterSlotCount}</span>
            <span className="text-white/60">Intro video</span>
            <span>{formatSummary.introVideo}</span>
          </div>
          {formatSummary.unsupportedPositions.length > 0 ? (
            <p className="text-[11px] text-amber-200">
              Unsupported positions: {formatSummary.unsupportedPositions.join(', ')}
            </p>
          ) : null}
        </div>

        {/* Historical data */}
        <div className="flex items-center gap-2 text-xs text-white/70">
          <History className="h-4 w-4 shrink-0" />
          <span>
            Historical data: {dataQuality.sources.history ? 'Some history available' : 'No previous seasons or historical rosters'}
          </span>
        </div>

        {/* Managers / teams with logos */}
        <div>
          <p className="text-xs font-medium text-white/70 flex items-center gap-1.5 mb-2">
            <Users className="h-3.5 w-3.5" />
            Managers & teams ({managers.length})
          </p>
          <p className="mb-2 text-[11px] text-white/50" data-testid="import-preview-team-logo-count">
            Team logos available: {managersWithTeamLogos}/{managers.length}
          </p>
          <div className="max-h-44 overflow-y-auto rounded border border-cyan-400/25 bg-[#030a20]/80 p-2 space-y-1.5">
            {managers.slice(0, 24).map((m) => (
              <div
                key={m.rosterId}
                className="flex items-center gap-2 text-xs text-white/90"
                data-testid={`import-preview-manager-row-${m.rosterId}`}
              >
                {m.teamLogo ? (
                  <img
                    src={m.teamLogo}
                    alt=""
                    className="h-6 w-6 rounded-full object-cover shrink-0"
                    title={m.teamAbbreviation ?? m.teamName}
                    data-testid={`import-preview-team-logo-${m.rosterId}`}
                  />
                ) : (
                  <div className="h-6 w-6 rounded-full bg-white/10 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {m.teamName}
                    {m.teamAbbreviation ? (
                      <span className="ml-1 text-white/55">({m.teamAbbreviation})</span>
                    ) : null}
                  </span>
                  <span className="block truncate text-[11px] text-white/55">
                    Manager: {m.displayName}
                  </span>
                </div>
                {m.managerAvatar && m.managerAvatar !== m.teamLogo ? (
                  <img
                    src={m.managerAvatar}
                    alt=""
                    className="h-5 w-5 rounded-full object-cover shrink-0 border border-white/20"
                    title={m.displayName}
                    data-testid={`import-preview-manager-avatar-${m.rosterId}`}
                  />
                ) : null}
                <span className="text-white/50 shrink-0">
                  {m.wins}-{m.losses}
                  {m.ties ? `-${m.ties}` : ''} · {m.pointsFor} pts
                </span>
              </div>
            ))}
            {managers.length > 24 && (
              <p className="text-white/50 text-xs">+{managers.length - 24} more</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-white/80">
          <Trophy className="h-4 w-4" />
          <span>{preview.draftPickCount} draft picks</span>
          <span>·</span>
          <span>{preview.transactionCount} transactions</span>
          <span>·</span>
          <Calendar className="h-4 w-4" />
          <span>{preview.matchupWeeks} matchup weeks</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            onClick={onCreateFromImport}
            disabled={createLoading}
            className="flex-1 bg-[#00ffd4] text-[#00131a] hover:bg-[#2bffe0]"
            size="lg"
            data-testid="import-preview-create-button"
          >
            {createLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating League…
              </>
            ) : (
              'Create League from Import'
            )}
          </Button>
          {onBack && (
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              disabled={createLoading}
              className="shrink-0 border-cyan-400/35 text-cyan-200 hover:bg-cyan-300/10"
              data-testid="import-preview-back-button"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Try different league ID
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
