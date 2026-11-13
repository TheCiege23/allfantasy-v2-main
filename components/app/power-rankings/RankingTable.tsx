'use client';

import Link from 'next/link';
import { useLanguage } from '@/components/i18n/LanguageProviderClient';
import type { PowerRankingTeam } from '@/lib/league-power-rankings/types';
import { MovementIndicators } from './MovementIndicators';
import { getLeagueRosterTabHref } from '@/lib/league-power-rankings/rosterLinkResolver';

interface RankingTableProps {
  leagueId: string;
  teams: PowerRankingTeam[];
}

export function RankingTable({ leagueId, teams }: RankingTableProps) {
  const { t, tInterpolate } = useLanguage();
  return (
    <div
      className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03]"
      data-audit="ranking-table"
      data-testid="power-rankings-table"
    >
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/10">
            <th className="p-3 font-medium text-white/80">{t('powerRankingsPage.col.rank')}</th>
            <th className="p-3 font-medium text-white/80">{t('powerRankingsPage.col.team')}</th>
            <th className="p-3 font-medium text-white/80">{t('powerRankingsPage.col.record')}</th>
            <th className="p-3 font-medium text-white/80">{t('leaguePowerRankings.table.pf')}</th>
            <th className="p-3 font-medium text-white/80">{t('leaguePowerRankings.table.pa')}</th>
            <th className="p-3 font-medium text-white/80">{t('leaguePowerRankings.table.sos')}</th>
            <th className="p-3 font-medium text-white/80">{t('leaguePowerRankings.table.recent')}</th>
            <th className="p-3 font-medium text-white/80">{t('leaguePowerRankings.table.rosterCol')}</th>
            <th className="p-3 font-medium text-white/80">{t('leaguePowerRankings.table.projection')}</th>
            <th className="p-3 font-medium text-white/80">{t('leaguePowerRankings.table.power')}</th>
            <th className="p-3 font-medium text-white/80">{t('leaguePowerRankings.table.movement')}</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((team) => {
            const name =
              team.displayName ||
              team.username ||
              tInterpolate('leaguePowerRankings.teamFallback', { id: team.rosterId });
            const r = team.record;
            const rosterHref = getLeagueRosterTabHref(leagueId, team.rosterId);
            return (
              <tr
                key={team.rosterId}
                className="border-b border-white/5 hover:bg-white/5 transition"
                data-audit="team-card"
                data-testid={`power-ranking-team-card-${team.rosterId}`}
              >
                <td className="p-3">
                  <span className="font-medium text-amber-400">#{team.rank}</span>
                </td>
                <td className="p-3">
                  <Link
                    href={rosterHref}
                    className="font-medium text-white hover:text-cyan-400 transition"
                    data-audit="team-card-click"
                    data-testid={`power-ranking-team-link-${team.rosterId}`}
                  >
                    {name}
                  </Link>
                </td>
                <td className="p-3 text-white/80">
                  {r.wins}-{r.losses}
                  {r.ties > 0 ? `-${r.ties}` : ''}
                </td>
                <td className="p-3 text-white/80">{team.pointsFor.toFixed(1)}</td>
                <td className="p-3 text-white/80">{team.pointsAgainst.toFixed(1)}</td>
                <td className="p-3 text-white/80">{(team.strengthOfSchedule * 100).toFixed(0)}</td>
                <td className="p-3 text-white/80">{team.recentPerformanceScore.toFixed(0)}</td>
                <td className="p-3 text-white/80">{team.rosterStrengthScore.toFixed(0)}</td>
                <td className="p-3 text-white/80">{team.projectionStrengthScore.toFixed(0)}</td>
                <td className="p-3 text-cyan-300">{team.powerScore.toFixed(0)}</td>
                <td className="p-3">
                  <MovementIndicators team={team} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
