import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, Crown, CheckCircle } from 'lucide-react';
import { formatInTimezone } from '@/lib/preferences/TimezoneFormattingResolver';
import { resolveServerRenderPreferences } from '@/lib/preferences/ServerRenderPreferenceResolver';
import { DynastyLeagueGrade } from '@/components/dynasty-trade/DynastyLeagueGrade';
import { readSharedTrade } from '@/components/dynasty-trade/sharedTrade';

interface TradeAsset {
  id: string;
  name: string;
  type: 'player' | 'pick';
}

export default async function TradeSharePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { timezone, language } = await resolveServerRenderPreferences();
  const share = await (prisma as any).tradeShare.findUnique({
    where: { id: params.id },
  });

  if (!share) notFound();

  if (share.expiresAt && new Date(share.expiresAt) < new Date()) notFound();

  /*
   * 🛑 THE ONE GRADE, OR NO VERDICT (2026-09-29). The page printed the stored `winner`, `valueDelta`,
   * `confidence`, `dynastyVerdict` and `vetoRisk` — the dual-brain engine's own scale. It now prints the
   * stored league grade and a winner read off its letter; an old share without one shows neither.
   */
  const analysis = readSharedTrade(share.analysis);
  const sideA = (share.sideA || []) as TradeAsset[];
  const sideB = (share.sideB || []) as TradeAsset[];
  const { teamAName, teamBName } = analysis;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0a0f] to-[#0f0f1a] py-16">
      <div className="container mx-auto px-4 max-w-3xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent mb-2">
            AllFantasy Trade Analysis
          </h1>
          <p className="text-gray-400 text-sm">
            {analysis.leagueContext || 'Dynasty Trade'} &middot; {formatInTimezone(share.createdAt, timezone, { dateStyle: 'short' }, language)}
          </p>
        </div>

        <div id="trade-result" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="border-cyan-900/30 bg-black/40 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <div className="h-3 w-3 rounded-full bg-cyan-400" />
                  {teamAName} gives
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {sideA.map((asset: TradeAsset) => (
                    <Badge
                      key={asset.id}
                      variant="outline"
                      className={`py-1.5 px-3 ${
                        asset.type === 'player'
                          ? 'border-cyan-500/40 text-cyan-300 bg-cyan-950/20'
                          : 'border-amber-500/40 text-amber-300 bg-amber-950/20'
                      }`}
                    >
                      {asset.type === 'pick' && '📋 '}{asset.name}
                    </Badge>
                  ))}
                  {sideA.length === 0 && <span className="text-sm text-gray-500 italic">No assets</span>}
                </div>
              </CardContent>
            </Card>

            <Card className="border-purple-900/30 bg-black/40 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <div className="h-3 w-3 rounded-full bg-purple-400" />
                  {teamBName} gives
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {sideB.map((asset: TradeAsset) => (
                    <Badge
                      key={asset.id}
                      variant="outline"
                      className={`py-1.5 px-3 ${
                        asset.type === 'player'
                          ? 'border-cyan-500/40 text-cyan-300 bg-cyan-950/20'
                          : 'border-amber-500/40 text-amber-300 bg-amber-950/20'
                      }`}
                    >
                      {asset.type === 'pick' && '📋 '}{asset.name}
                    </Badge>
                  ))}
                  {sideB.length === 0 && <span className="text-sm text-gray-500 italic">No assets</span>}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-gray-700/50 bg-black/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-yellow-400" />
                Analysis Result
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {analysis.leagueGrade ? (
                <>
                  <DynastyLeagueGrade
                    tradeGrade={analysis.leagueGrade}
                    teamAName={teamAName}
                    teamBName={teamBName}
                    leagueChosen
                    leagueOptionCount={0}
                  />
                  {analysis.winner && (
                    <div data-testid="shared-trade-winner">
                      <span className="text-sm text-gray-400">Winner:</span>
                      <span className="ml-2 font-semibold text-white">{analysis.winner}</span>
                    </div>
                  )}
                </>
              ) : (
                <p data-testid="shared-trade-no-grade" className="text-sm text-gray-400">
                  This trade was shared before AllFantasy graded shared trades, so it carries no grade.
                </p>
              )}

              {analysis.factors.length > 0 && (
                <div>
                  <span className="text-sm font-medium text-gray-300 mb-2 block">Key Factors:</span>
                  <ul className="space-y-1">
                    {analysis.factors.map((f: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
                        <TrendingUp className="h-3.5 w-3.5 text-cyan-400 mt-0.5 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.agingConcerns && analysis.agingConcerns.length > 0 && (
                <div>
                  <span className="text-sm font-medium text-amber-300 mb-2 block">Aging Concerns:</span>
                  <ul className="space-y-1">
                    {analysis.agingConcerns.map((c: string, i: number) => (
                      <li key={i} className="text-sm text-gray-400">⏳ {c}</li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.recommendations && analysis.recommendations.length > 0 && (
                <div>
                  <span className="text-sm font-medium text-green-300 mb-2 block">Recommendations:</span>
                  <ul className="space-y-1">
                    {analysis.recommendations.map((r: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
                        <CheckCircle className="h-3.5 w-3.5 text-green-400 mt-0.5 shrink-0" />
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="text-center pt-4">
            <a
              href="/dynasty-trade-analyzer"
              className="text-sm text-cyan-400 hover:text-cyan-300 underline"
            >
              Analyze your own trade on AllFantasy &rarr;
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
