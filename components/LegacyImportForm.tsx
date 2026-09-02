'use client';

import { useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Crown, Loader2, CheckCircle2, History, HelpCircle } from 'lucide-react';
import { StepHelp } from '@/components/league-creation-wizard/StepHelp';


/** One league inside a season that did not import, and why. */
type LeagueImportFailure = { name: string; reason: string };

type SeasonImportResult = {
  season: number;
  status: string;
  leagueName?: string;
  /** Present when the season completed but individual leagues inside it did not. */
  failures?: LeagueImportFailure[];
};

export default function LegacyImportForm({ userId }: { userId: string }) {
  const [platform, setPlatform] = useState<'sleeper' | 'espn'>('sleeper');
  const [sleeperUsername, setSleeperUsername] = useState('');
  const [espnLeagueId, setEspnLeagueId] = useState('');
  const [espnS2, setEspnS2] = useState('');
  const [swid, setSwid] = useState('');
  const [startSeason, setStartSeason] = useState(2020);
  const [endSeason, setEndSeason] = useState(2025);
  const [loading, setLoading] = useState(false);
  /**
   * ⚠ `failures` IS THE POINT OF THIS SHAPE. A season used to report only "success"
   * and a league count, so a run where one of eleven leagues failed rendered as an
   * unqualified green tick. `/api/import-sleeper` now returns a per-league reason and
   * this is where it lands — a season can succeed AND still owe the user an
   * explanation about part of it.
   */
  const [results, setResults] = useState<SeasonImportResult[]>([]);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [formError, setFormError] = useState<string | null>(null);

  const seasonRange = Array.from(
    { length: endSeason - startSeason + 1 },
    (_, i) => startSeason + i
  );

  const validate = () => {
    const newErrors: typeof errors = {};

    if (platform === 'sleeper' && !sleeperUsername.trim()) {
      newErrors.sleeperUsername = 'Sleeper Username is required';
    }
    if (platform === 'espn') {
      if (!espnLeagueId.trim()) newErrors.espnLeagueId = 'ESPN League ID is required';
    }
    if (startSeason > endSeason) {
      newErrors.seasonRange = 'Start season must be before end season';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleImport = async () => {
    setFormError(null);
    if (!validate()) return;

    setLoading(true);
    setResults([]);
    const importResults: SeasonImportResult[] = [];

    try {
      if (platform === 'sleeper') {
        const userRes = await fetch('/api/legacy/user/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: sleeperUsername.trim() }),
        });
        if (!userRes.ok) {
          setFormError('Sleeper username not found. Please check and try again.');
          toast.error('Sleeper username not found.');
          setLoading(false);
          return;
        }
        const userData = await userRes.json();

        for (const season of seasonRange) {
          try {
            const res = await fetch('/api/import-sleeper', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sleeperUserId: userData.user_id,
                sport: 'nfl',
                season,
                isLegacy: true,
              }),
            });
            const data = await res.json();
            if (res.ok) {
              /* The route returns `results: [{ sourceLeagueId, name, status, reason }]`.
                 Older deploys did not, so an absent array is treated as "no per-league
                 detail available", never as "nothing failed". */
              const perLeague = Array.isArray(data.results)
                ? (data.results as { name?: string; status?: string; reason?: string }[])
                : [];
              const failures: LeagueImportFailure[] = perLeague
                .filter((row) => row?.status === 'failed')
                .map((row) => ({
                  name: row.name?.trim() || 'A league',
                  reason: row.reason?.trim() || 'No reason was given.',
                }));
              importResults.push({
                season,
                status: 'success',
                leagueName: `${data.imported} league${data.imported !== 1 ? 's' : ''}`,
                ...(failures.length > 0 ? { failures } : {}),
              });
            } else {
              if (res.status === 429) {
                setFormError('Rate limit reached - please wait a minute and try again');
                break;
              }
              if (res.status === 401) {
                setFormError('Session expired - please log in again');
                break;
              }
              importResults.push({ season, status: data.error || 'Failed' });
            }
          } catch {
            importResults.push({ season, status: 'Network error' });
          }
          setResults([...importResults]);
        }
      } else {
        for (const season of seasonRange) {
          try {
            const res = await fetch('/api/import-espn', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                leagueId: espnLeagueId.trim(),
                season,
                isLegacy: true,
                ...(espnS2 ? { espnS2 } : {}),
                ...(swid ? { swid } : {}),
              }),
            });
            const data = await res.json();
            if (res.ok) {
              importResults.push({
                season,
                status: 'success',
                leagueName: data.leagueName || 'Imported',
              });
            } else {
              if (res.status === 429) {
                setFormError('Rate limit reached - please wait a minute and try again');
                break;
              }
              if (res.status === 401) {
                setFormError('Session expired - please log in again');
                break;
              }
              importResults.push({ season, status: data.error || 'Failed' });
            }
          } catch {
            importResults.push({ season, status: 'Network error' });
          }
          setResults([...importResults]);
        }
      }

      const successCount = importResults.filter(r => r.status === 'success').length;
      if (successCount > 0) {
        toast.success(`Imported ${successCount} season${successCount !== 1 ? 's' : ''} of legacy data! Redirecting to hub...`);
        setTimeout(() => window.location.href = '/af-legacy', 2000);
      } else {
        toast.error('No seasons imported. Check your credentials and try again.');
      }
    } catch {
      toast.error('Something went wrong during import.');
    } finally {
      setLoading(false);
    }
  };

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: currentYear - 2015 + 1 }, (_, i) => 2015 + i);

  return (
    <div className="space-y-6">
      <div className="flex gap-4 justify-center">
        <Button
          variant={platform === 'sleeper' ? 'default' : 'outline'}
          onClick={() => { setPlatform('sleeper'); setErrors({}); setFormError(null); }}
          className={platform === 'sleeper'
            ? 'flex-1 max-w-[200px] bg-cyan-600 hover:bg-cyan-700'
            : 'flex-1 max-w-[200px] border-cyan-600/40 text-cyan-400 hover:bg-cyan-950/40'
          }
        >
          Sleeper
        </Button>
        <Button
          variant={platform === 'espn' ? 'default' : 'outline'}
          onClick={() => { setPlatform('espn'); setErrors({}); setFormError(null); }}
          className={platform === 'espn'
            ? 'flex-1 max-w-[200px] bg-red-600 hover:bg-red-700'
            : 'flex-1 max-w-[200px] border-red-600/40 text-red-400 hover:bg-red-950/40'
          }
        >
          ESPN
        </Button>
      </div>

      <Card className="border-purple-500/30 bg-black/40 backdrop-blur-md">
        <CardHeader>
          <div className="flex items-center gap-2 justify-between">
            <div className="flex items-center gap-3 text-xl">
              <History className="h-5 w-5 text-purple-400" />
              Multi-Season Legacy Import
            </div>
            <StepHelp title="How does legacy import work?">
              <div className="text-xs text-white/90 space-y-2">
                <div className="flex items-center gap-1 mb-1">
                  <HelpCircle className="h-4 w-4 text-cyan-300" />
                  <span className="font-semibold text-cyan-200">How Legacy Import Works</span>
                </div>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Enter your Sleeper username and click Import.</li>
                  <li>All leagues and seasons (where you are a participant or commissioner) are imported from Sleeper, not just leagues you own.</li>
                  <li>The most recent season and a general ranking are shown immediately; the rest import in the background.</li>
                  <li>You will be redirected to the Rankings page, but import progress and results will also appear on your dashboard as they complete.</li>
                  <li>When the import is fully complete, you will receive a notification in the notifications tab.</li>
                  <li>You do <b>not</b> need to be a commissioner for your leagues to be imported.</li>
                  <li>If you have a lot of history, the process may take a few minutes. You can continue using the site while it runs.</li>
                </ul>
                <div className="mt-2 text-cyan-200">The Sleeper API is the source of truth for your import.</div>
              </div>
            </StepHelp>
          </div>
          <CardDescription>
            Import multiple seasons at once to build your complete dynasty history
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {platform === 'sleeper' ? (
            <div>
              <Label htmlFor="sleeper-username">Sleeper Username</Label>
              <Input
                id="sleeper-username"
                placeholder="e.g. cjabar"
                value={sleeperUsername}
                onChange={(e) => { setSleeperUsername(e.target.value); setErrors(prev => { const n = { ...prev }; delete n.sleeperUsername; return n; }); }}
                disabled={loading}
                className={`bg-gray-900 focus:border-cyan-500 ${errors.sleeperUsername ? 'border-red-500' : 'border-cyan-600/40'}`}
              />
              {errors.sleeperUsername && <p className="text-red-400 text-sm mt-1">{errors.sleeperUsername}</p>}
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="espn-league-id">ESPN League ID</Label>
                <Input
                  id="espn-league-id"
                  placeholder="e.g. 12345678 (from your league URL)"
                  value={espnLeagueId}
                  onChange={(e) => { setEspnLeagueId(e.target.value); setErrors(prev => { const n = { ...prev }; delete n.espnLeagueId; return n; }); }}
                  disabled={loading}
                  className={`bg-gray-900 focus:border-red-500 ${errors.espnLeagueId ? 'border-red-500' : 'border-red-600/40'}`}
                />
                {errors.espnLeagueId && <p className="text-red-400 text-sm mt-1">{errors.espnLeagueId}</p>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="espn-s2">
                    espn_s2 Cookie <Badge variant="outline" className="ml-1 text-[10px] border-gray-600">Optional</Badge>
                  </Label>
                  <Input
                    id="espn-s2"
                    placeholder="For private leagues"
                    value={espnS2}
                    onChange={(e) => setEspnS2(e.target.value)}
                    disabled={loading}
                    className="border-gray-700 bg-gray-900 focus:border-red-500"
                  />
                </div>
                <div>
                  <Label htmlFor="swid">
                    SWID Cookie <Badge variant="outline" className="ml-1 text-[10px] border-gray-600">Optional</Badge>
                  </Label>
                  <Input
                    id="swid"
                    placeholder="For private leagues"
                    value={swid}
                    onChange={(e) => setSwid(e.target.value)}
                    disabled={loading}
                    className="border-gray-700 bg-gray-900 focus:border-red-500"
                  />
                </div>
              </div>
            </>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Start Season</Label>
              <select
                value={startSeason}
                onChange={(e) => setStartSeason(Number(e.target.value))}
                className="w-full rounded-md border border-purple-600/40 bg-gray-900 px-4 py-2 text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                disabled={loading}
              >
                {yearOptions.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>End Season</Label>
              <select
                value={endSeason}
                onChange={(e) => setEndSeason(Number(e.target.value))}
                className="w-full rounded-md border border-purple-600/40 bg-gray-900 px-4 py-2 text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                disabled={loading}
              >
                {yearOptions.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-sm text-gray-500">
            Importing {seasonRange.length} season{seasonRange.length !== 1 ? 's' : ''}: {startSeason} — {endSeason}
          </p>

          {errors.seasonRange && (
            <p className="text-red-400 text-sm">{errors.seasonRange}</p>
          )}

          {formError && (
            <div className="bg-red-950/50 border border-red-500/50 text-red-300 p-4 rounded-lg">
              {formError}
            </div>
          )}

          <Button
            onClick={handleImport}
            disabled={loading}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
            size="lg"
          >
            {loading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing Legacy Data...</>
            ) : (
              <><Crown className="mr-2 h-4 w-4" /> Import {seasonRange.length} Season{seasonRange.length !== 1 ? 's' : ''}</>
            )}
          </Button>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card className="border-purple-900/30 bg-black/40 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-lg">Import Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {results.map((r) => (
                <div
                  key={r.season}
                  className="rounded-lg border border-white/5 bg-gray-900/60 px-4 py-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm text-white">{r.season}</span>
                      {r.leagueName && (
                        <span className="text-sm text-gray-400">{r.leagueName}</span>
                      )}
                    </div>
                    {r.status === 'success' ? (
                      <CheckCircle2 className="h-5 w-5 text-green-400" />
                    ) : (
                      <span className="text-xs text-red-400">{r.status}</span>
                    )}
                  </div>
                  {/*
                    ⚠ A SEASON CAN SUCCEED AND STILL HAVE LEFT A LEAGUE BEHIND, and the
                    green tick above says nothing about that. Each one is named with its
                    own reason, because "1 of 11 didn't import" without saying which or
                    why is the exact report a user cannot act on.
                  */}
                  {r.failures && r.failures.length > 0 && (
                    <ul className="mt-3 space-y-1.5 border-t border-white/5 pt-3">
                      {r.failures.map((f, i) => (
                        <li key={`${r.season}-${i}`} className="text-xs leading-relaxed">
                          <span className="text-amber-300">{f.name}</span>
                          <span className="text-gray-500"> — </span>
                          <span className="text-gray-400">{f.reason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
