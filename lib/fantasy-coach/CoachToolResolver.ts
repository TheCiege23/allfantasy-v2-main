/**
 * Canonical hrefs for coach action cards.
 */

type CoachHrefParams = Record<string, string | number | undefined | null>;

const TRADE_ANALYZER = '/trade-evaluator';
const WAIVER_AI = '/waiver-ai';
const RANKINGS = '/core/rankings';
const PLAYER_PAGE = '/player-comparison';
const PLAYER_DECISION_TOOL = '/tools/player-decision';

function withQuery(basePath: string, params: CoachHrefParams = {}): string {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value == null) return;
    const normalized = String(value).trim();
    if (!normalized) return;
    query.set(key, normalized);
  });

  const search = query.toString();
  return search ? `${basePath}?${search}` : basePath;
}

export function getTradeAnalyzerHref(
  leagueId?: string,
  params: CoachHrefParams = {}
): string {
  return withQuery(TRADE_ANALYZER, {
    source: 'coach-mode',
    leagueId,
    ...params,
  });
}

export function getWaiverToolHref(
  leagueId?: string,
  params: CoachHrefParams = {}
): string {
  return withQuery(WAIVER_AI, {
    source: 'coach-mode',
    leagueId,
    ...params,
  });
}

export function getRankingsToolHref(
  leagueId?: string,
  params: CoachHrefParams = {}
): string {
  // /core/rankings reads `scope` and `league` (not `leagueId`); the old /rankings page took neither.
  return withQuery(RANKINGS, {
    scope: 'league',
    league: leagueId,
    source: 'coach-mode',
    ...params,
  });
}

export function getPlayerPageHref(
  playerName: string,
  params: CoachHrefParams = {}
): string {
  return withQuery(PLAYER_PAGE, {
    player: playerName,
    ...params,
  });
}

/** Start A vs B decision tool — deterministic-first comparison with scenario modes */
export function getPlayerDecisionToolHref(params: CoachHrefParams = {}): string {
  return withQuery(PLAYER_DECISION_TOOL, {
    source: 'coach-mode',
    ...params,
  });
}
