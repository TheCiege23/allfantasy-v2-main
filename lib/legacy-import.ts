// lib/legacy-import.ts
import { computeAndSaveRank } from '@/lib/ranking/computeAndSaveRank';
import { prisma } from './prisma';
import {
  getUserLeagues,
  getLeagueRosters,
  getPlayoffBracket,
  getTradedDraftPicks,
  getLeagueDrafts,
  getLeagueUsers,
  getScoringType,
  getLeagueType,
  SleeperLeague,
  SleeperDraftPick,
} from './sleeper-client';
import { jitterSleep, runWithConcurrency } from './async-utils';

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function inferLeagueType(league: SleeperLeague): string {
  const typeRaw = (league as any)?.settings?.type;
  const typeNum = safeNum(typeRaw, -1);
  if (typeNum === 2) return 'Dynasty';
  if (typeNum === 1) return 'Keeper';
  if (typeNum === 0) return 'Redraft';

  const t = getLeagueType(league) || '';
  if (t.toLowerCase().includes('dynasty')) return 'Dynasty';
  if (t.toLowerCase().includes('keeper')) return 'Keeper';
  return 'Redraft';
}

function detectSpecialtyFormat(league: SleeperLeague): string {
  const name = (league.name || '').toLowerCase();
  const settings = (league as any)?.settings || {};
  
  // Check name patterns for specialty leagues
  const guillotinePatterns = ['guillotine', 'guillo', 'survivor elimination', 'last man standing', 'elimination league'];
  const bestBallPatterns = ['best ball', 'bestball', 'bb '];
  const survivorPatterns = ['survivor', 'pick\'em', 'pickem', 'eliminator'];
  const draftOnlyPatterns = ['draft only', 'mock', 'draft-only'];
  
  for (const pattern of guillotinePatterns) {
    if (name.includes(pattern)) return 'guillotine';
  }
  
  for (const pattern of bestBallPatterns) {
    if (name.includes(pattern)) return 'bestball';
  }
  
  for (const pattern of survivorPatterns) {
    if (name.includes(pattern)) return 'survivor';
  }
  
  for (const pattern of draftOnlyPatterns) {
    if (name.includes(pattern)) return 'draft_only';
  }
  
  // Check settings for best ball indicator
  if (settings.best_ball === 1 || settings.bestball === 1) {
    return 'bestball';
  }
  
  // Check for draft-only (no rosters after draft)
  if (settings.type === 3) {
    return 'draft_only';
  }
  
  return 'standard';
}

function detectLeagueFormats(league: SleeperLeague): { isSF: boolean; isTEP: boolean; tepBonus: number | null } {
  const rosterPositions = (league as any).roster_positions || [];
  const scoringSettings = (league as any).scoring_settings || {};
  
  // Detect Superflex: Check for SUPER_FLEX position
  const isSF = rosterPositions.some((pos: string) => 
    pos === 'SUPER_FLEX' || pos === 'SF' || pos === 'OP'
  );
  
  // Detect TEP: Check if TE has bonus reception points
  // TEP means TE receptions are worth more than WR/RB receptions
  const recValue = scoringSettings.rec ?? 0;
  const tePremValue = scoringSettings.bonus_rec_te ?? scoringSettings.rec_te ?? 0;
  
  const isTEP = tePremValue > 0;
  const tepBonus = isTEP ? tePremValue : null;
  
  return { isSF, isTEP, tepBonus };
}

interface BracketMatchup {
  r: number;
  m: number;
  t1: number | null;
  t2: number | null;
  w: number | null;
  l: number | null;
}

function extractPlayoffParticipants(
  bracket: BracketMatchup[] | null
): Set<number> {
  const participants = new Set<number>();
  if (!Array.isArray(bracket)) return participants;

  for (const matchup of bracket) {
    const t1 = safeNum(matchup.t1, 0);
    const t2 = safeNum(matchup.t2, 0);
    if (t1 > 0) participants.add(t1);
    if (t2 > 0) participants.add(t2);
  }

  return participants;
}

function computePlayoffSeedFromBracket(
  rosterId: number,
  bracket: BracketMatchup[] | null
): number | null {
  if (!Array.isArray(bracket) || bracket.length === 0) return null;

  // Find the first round matchup containing this roster
  const round1Matchups = bracket
    .filter((m) => safeNum(m.r, 0) === 1)
    .sort((a, b) => safeNum(a.m, 0) - safeNum(b.m, 0));

  for (let i = 0; i < round1Matchups.length; i++) {
    const matchup = round1Matchups[i];
    const t1 = safeNum(matchup.t1, 0);
    const t2 = safeNum(matchup.t2, 0);

    // Higher seeds typically face lower seeds (1 vs 8, 2 vs 7, etc.)
    // In Sleeper, t1 is typically the higher seed
    if (t1 === rosterId) {
      return i + 1; // Seeds 1, 2, 3, 4...
    }
    if (t2 === rosterId) {
      return round1Matchups.length * 2 - i; // Seeds 8, 7, 6, 5...
    }
  }

  // If not in round 1, they may have a bye - check round 2
  const round2Matchups = bracket.filter((m) => safeNum(m.r, 0) === 2);
  for (const matchup of round2Matchups) {
    const t1 = safeNum(matchup.t1, 0);
    const t2 = safeNum(matchup.t2, 0);
    if (t1 === rosterId || t2 === rosterId) {
      // They had a bye, so they're a top seed (1 or 2 typically)
      return t1 === rosterId ? 1 : 2;
    }
  }

  return null;
}

function findChampionFromLeagueOrBracket(
  league: SleeperLeague,
  bracket: BracketMatchup[] | null
): number | null {
  const directRaw = (league as any)?.winner_roster_id;
  const direct = Number(directRaw);
  if (Number.isFinite(direct)) return direct;

  if (!Array.isArray(bracket) || bracket.length === 0) return null;

  const maxRound = Math.max(...bracket.map((g) => safeNum((g as any)?.r, 0)));
  if (!Number.isFinite(maxRound) || maxRound <= 0) return null;

  const finals = bracket.filter((g) => safeNum((g as any)?.r, 0) === maxRound);
  const finalGame =
    finals.find((g) => {
      const w = Number((g as any)?.w);
      return Number.isFinite(w) && w > 0;
    }) || finals[0];

  const winner = Number((finalGame as any)?.w);
  return Number.isFinite(winner) && winner > 0 ? winner : null;
}

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = CURRENT_YEAR - 20;
const MAX_EMPTY_YEARS = 3;

async function refreshAfRankAfterLegacyImportComplete(legacyUserId: string): Promise<void> {
  const appUser = await prisma.appUser.findFirst({
    where: { legacyUserId },
    select: { id: true },
  })
  if (!appUser) return
  await computeAndSaveRank(appUser.id).catch((err) => {
    console.error('[legacy-import] computeAndSaveRank after job complete:', err)
  })
}

export async function runLegacyImportStep(
  jobId: string,
  userId: string,
  sleeperUserId: string
): Promise<{ done: boolean; progress: number }> {
  const job = await prisma.legacyImportJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    throw new Error('Job not found');
  }

  if (job.status === 'completed' || job.status === 'failed') {
    return { done: true, progress: job.progress };
  }

  // Initialize if first run
  let currentSeason = job.currentSeason;
  let emptyYears = job.emptyYears;

  if (currentSeason === null) {
    currentSeason = CURRENT_YEAR;
    await prisma.legacyImportJob.update({
      where: { id: jobId },
      data: {
        status: 'running',
        startedAt: new Date(),
        currentSeason,
        emptyYears: 0,
        progress: 5,
      },
    });
  }

  // Check if we're done scanning
  if (currentSeason < MIN_YEAR || emptyYears >= MAX_EMPTY_YEARS) {
    await prisma.legacyImportJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        progress: 100,
        completedAt: new Date(),
      },
    });
    await refreshAfRankAfterLegacyImportComplete(userId);
    return { done: true, progress: 100 };
  }

  // Process ONE season
  const sport = 'nfl';
  let leagues: SleeperLeague[] = [];

  try {
    leagues = await getUserLeagues(sleeperUserId, sport, String(currentSeason));
  } catch (e: any) {
    console.error(`Error fetching leagues for season ${currentSeason}:`, e.message);
    // Move to next season on error — but RECORD the failed season instead of silently dropping
    // it. totalSeasons grows while seasonsCompleted doesn't, which is exactly what lets the
    // status route derive an honest "partial" instead of reporting a clean "completed".
    const nextSeason = currentSeason - 1;
    const progress = calculateProgress(nextSeason);
    const summary = Array.isArray(job.seasonsSummary) ? (job.seasonsSummary as unknown[]) : [];
    await prisma.legacyImportJob.update({
      where: { id: jobId },
      data: {
        currentSeason: nextSeason,
        progress,
        totalSeasons: { increment: 1 },
        seasonsSummary: [
          ...summary,
          { season: currentSeason, ok: false, reason: 'SEASON_FETCH_FAILED' },
        ] as object[],
      },
    });
    return { done: false, progress };
  }

  // Empty season
  if (!leagues || leagues.length === 0) {
    const newEmptyYears = emptyYears + 1;
    const nextSeason = currentSeason - 1;
    const progress = calculateProgress(nextSeason);

    if (newEmptyYears >= MAX_EMPTY_YEARS) {
      await prisma.legacyImportJob.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          progress: 100,
          completedAt: new Date(),
          currentSeason: nextSeason,
          emptyYears: newEmptyYears,
        },
      });
      await refreshAfRankAfterLegacyImportComplete(userId);
      return { done: true, progress: 100 };
    }

    await prisma.legacyImportJob.update({
      where: { id: jobId },
      data: { currentSeason: nextSeason, emptyYears: newEmptyYears, progress },
    });
    return { done: false, progress };
  }

  // Reset empty years counter and import leagues. Per-league failures are COUNTED, not
  // swallowed — a season where some leagues failed must be distinguishable from a full one.
  let leaguesSaved = 0;
  let leagueFailures = 0;
  await runWithConcurrency(leagues, 3, async (league) => {
    try {
      await importLeague(userId, sleeperUserId, league, currentSeason!);
      leaguesSaved += 1;
    } catch (e: any) {
      leagueFailures += 1;
      console.error(`Error importing league ${league.league_id} (season ${currentSeason}):`, e?.message);
    }
    return true;
  });

  const priorSummary = Array.isArray(job.seasonsSummary) ? (job.seasonsSummary as unknown[]) : [];
  const seasonCompleteness = {
    totalSeasons: { increment: 1 },
    seasonsCompleted: { increment: leagueFailures === 0 ? 1 : 0 },
    totalLeaguesSaved: { increment: leaguesSaved },
    currentSeasonLeagues: leagues.length,
    seasonsSummary: [
      ...priorSummary,
      {
        season: currentSeason,
        ok: leagueFailures === 0,
        leagues: leagues.length,
        saved: leaguesSaved,
        ...(leagueFailures > 0 ? { failed: leagueFailures, reason: 'LEAGUE_IMPORT_FAILED' } : {}),
      },
    ] as object[],
  };

  // Move to next season
  const nextSeason = currentSeason - 1;
  const progress = calculateProgress(nextSeason);

  if (nextSeason < MIN_YEAR) {
    await prisma.legacyImportJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        progress: 100,
        completedAt: new Date(),
        currentSeason: nextSeason,
        emptyYears: 0,
        ...seasonCompleteness,
      },
    });
    await refreshAfRankAfterLegacyImportComplete(userId);
    return { done: true, progress: 100 };
  }

  await prisma.legacyImportJob.update({
    where: { id: jobId },
    data: { currentSeason: nextSeason, emptyYears: 0, progress, ...seasonCompleteness },
  });

  return { done: false, progress };
}

function calculateProgress(currentSeason: number): number {
  const totalSeasons = CURRENT_YEAR - MIN_YEAR + 1;
  const seasonsProcessed = CURRENT_YEAR - currentSeason;
  return Math.min(95, Math.round(5 + (seasonsProcessed / totalSeasons) * 90));
}

async function importLeague(
  userId: string,
  sleeperUserId: string,
  league: SleeperLeague,
  season: number
) {
  const leagueId = league.league_id;
  const leagueName = league.name || 'Unnamed League';

  let bracket: BracketMatchup[] | null = null;
  try {
    const rawBracket = await getPlayoffBracket(leagueId);
    bracket = rawBracket as BracketMatchup[];
  } catch {}

  let rosters: any[] | null = null;
  try {
    rosters = await getLeagueRosters(leagueId);
  } catch {}

  let tradedPicks: SleeperDraftPick[] = [];
  try {
    tradedPicks = await getTradedDraftPicks(leagueId);
  } catch {}

  // Sleeper's league-users endpoint marks the commissioner (league creator) with
  // `is_owner: true` — not part of the typed SleeperUser shape, so read it off the raw response.
  let isCommissioner = false;
  try {
    const leagueUsers = await getLeagueUsers(leagueId);
    isCommissioner = leagueUsers.some(
      (u) => String(u.user_id) === sleeperUserId && (u as unknown as { is_owner?: boolean }).is_owner === true
    );
  } catch {}

  let rosterToSlot: Record<number, number> = {};
  try {
    const drafts = await getLeagueDrafts(leagueId);
    if (drafts && drafts.length > 0) {
      // Sort by season descending to get the most recent draft with order data
      const sortedDrafts = [...drafts].sort((a: any, b: any) => 
        parseInt(b.season || '0') - parseInt(a.season || '0')
      );
      
      // Build user_id -> roster_id map for draft_order resolution
      const userToRosterId: Record<string, number> = {};
      if (rosters) {
        for (const r of rosters) {
          if (r.owner_id) userToRosterId[String(r.owner_id)] = r.roster_id;
        }
      }
      
      for (const draft of sortedDrafts) {
        const slotToRoster: Record<string, number> = draft.slot_to_roster_id || {};
        if (Object.keys(slotToRoster).length > 0) {
          for (const [slot, rosterId] of Object.entries(slotToRoster)) {
            rosterToSlot[rosterId] = parseInt(slot);
          }
          break;
        }
        // Fallback to draft_order (maps user_id -> slot)
        const draftOrder: Record<string, number> = draft.draft_order || {};
        if (Object.keys(draftOrder).length > 0) {
          for (const [userId, slot] of Object.entries(draftOrder)) {
            const rosterId = userToRosterId[userId];
            if (rosterId) {
              rosterToSlot[rosterId] = slot;
            }
          }
          break;
        }
      }
    }
  } catch {}

  await jitterSleep(100, 200);

  const leagueType = inferLeagueType(league);
  const specialtyFormat = detectSpecialtyFormat(league);
  const { isSF, isTEP, tepBonus } = detectLeagueFormats(league);
  const championRosterId = findChampionFromLeagueOrBracket(league, bracket);

  const savedLeague = await prisma.legacyLeague.upsert({
    where: {
      userId_sleeperLeagueId: { userId, sleeperLeagueId: leagueId },
    },
    update: {
      name: leagueName,
      season,
      leagueType,
      specialtyFormat,
      isSF,
      isTEP,
      tepBonus,
      isCommissioner,
      winnerRosterId: championRosterId,
      status: league.status,
      sport: league.sport || 'nfl',
      scoringType: getScoringType(league.scoring_settings),
      teamCount: league.total_rosters,
      draftId: (league as any).draft_id,
      playoffTeams: safeNum((league as any)?.settings?.playoff_teams, 0) || null,
      avatar: (league as any).avatar ? `https://sleepercdn.com/avatars/thumbs/${(league as any).avatar}` : null,
    },
    create: {
      userId,
      sleeperLeagueId: leagueId,
      name: leagueName,
      season,
      sport: league.sport || 'nfl',
      leagueType,
      specialtyFormat,
      isSF,
      isTEP,
      tepBonus,
      isCommissioner,
      scoringType: getScoringType(league.scoring_settings),
      teamCount: league.total_rosters,
      status: league.status,
      draftId: (league as any).draft_id,
      winnerRosterId: championRosterId,
      playoffTeams: safeNum((league as any)?.settings?.playoff_teams, 0) || null,
      avatar: (league as any).avatar ? `https://sleepercdn.com/avatars/thumbs/${(league as any).avatar}` : null,
    },
  });

  // Get playoff_teams setting from league for fallback calculation
  const playoffTeams = safeNum((league as any)?.settings?.playoff_teams, 0);
  
  // Extract all roster IDs that appear in the playoff bracket
  const playoffParticipants = extractPlayoffParticipants(bracket);

  const normalizedRosters = (rosters || []).map((r: any) => {
    const settings =
      r.settings || { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, final_rank: null, rank: null };
    
    const rosterId = safeNum(r.roster_id, 0);
    
    // Use Sleeper's playoff_seed directly if available (with seed fallback)
    const playoffSeedRaw = settings.playoff_seed ?? settings.seed ?? null;
    let playoffSeed: number | null = playoffSeedRaw != null ? safeNum(playoffSeedRaw, 0) || null : null;
    
    // Use Sleeper's rank directly if available
    const rank = settings.rank != null ? safeNum(settings.rank, 0) : null;
    
    // NEW: If no playoff_seed but roster is in playoff bracket, compute seed from bracket position
    if (playoffSeed == null && playoffParticipants.has(rosterId)) {
      const bracketSeed = computePlayoffSeedFromBracket(rosterId, bracket);
      if (bracketSeed != null) {
        playoffSeed = bracketSeed;
      } else {
        // Fallback: set to 1 to indicate they made playoffs (seed unknown)
        playoffSeed = 1;
      }
    }
    
    // Computed fallback: if no playoff_seed but rank <= playoff_teams, use rank
    if (playoffSeed == null && playoffTeams > 0 && rank != null && rank > 0 && rank <= playoffTeams) {
      playoffSeed = rank;
    }
    
    return {
      rosterId,
      ownerId: String(r.owner_id || ''),
      coOwners: Array.isArray(r.co_owners) ? r.co_owners.map(String) : [],
      wins: safeNum(settings.wins, 0),
      losses: safeNum(settings.losses, 0),
      ties: safeNum(settings.ties, 0),
      pointsFor: safeNum(settings.fpts, 0) + safeNum(settings.fpts_decimal, 0) / 100,
      pointsAgainst: safeNum(settings.fpts_against, 0) + safeNum(settings.fpts_against_decimal, 0) / 100,
      rank,
      playoffSeed,
      players: {
        starters: Array.isArray(r.starters) ? r.starters : [],
        bench: Array.isArray(r.players) 
          ? r.players.filter((p: string) => 
              !r.starters?.includes(p) && 
              !r.reserve?.includes(p) && 
              !r.taxi?.includes(p)
            ) 
          : [],
        ir: Array.isArray(r.reserve) ? r.reserve : [],
        taxi: Array.isArray(r.taxi) ? r.taxi : [],
        draftPicks: tradedPicks
          .filter((pick) => pick.owner_id === rosterId)
          .map((pick) => ({
            season: pick.season,
            round: pick.round,
            originalOwner: pick.roster_id,
            draftSlot: rosterToSlot[pick.roster_id] || null,
          })),
      },
    };
  });

  const userRoster = normalizedRosters.find(
    (r) => r.ownerId === sleeperUserId || r.coOwners.includes(sleeperUserId)
  );

  if (userRoster) {
    const isChampion = championRosterId !== null && championRosterId === userRoster.rosterId;
    
    // Compute finalStanding: champion = 1, else fallback to rank
    const finalStanding = isChampion ? 1 : userRoster.rank;
    
    // Check if user owns roster (either as owner or co-owner)
    const isUsersRoster = userRoster.ownerId === sleeperUserId || userRoster.coOwners.includes(sleeperUserId);

    await prisma.legacyRoster.upsert({
      where: {
        leagueId_rosterId: { leagueId: savedLeague.id, rosterId: userRoster.rosterId },
      },
      update: {
        wins: userRoster.wins,
        losses: userRoster.losses,
        ties: userRoster.ties,
        pointsFor: userRoster.pointsFor,
        pointsAgainst: userRoster.pointsAgainst,
        rank: userRoster.rank,
        playoffSeed: userRoster.playoffSeed,
        finalStanding,
        isOwner: isUsersRoster,
        isChampion,
        players: userRoster.players,
      },
      create: {
        leagueId: savedLeague.id,
        rosterId: userRoster.rosterId,
        ownerId: userRoster.ownerId,
        wins: userRoster.wins,
        losses: userRoster.losses,
        ties: userRoster.ties,
        pointsFor: userRoster.pointsFor,
        pointsAgainst: userRoster.pointsAgainst,
        rank: userRoster.rank,
        playoffSeed: userRoster.playoffSeed,
        finalStanding,
        isOwner: isUsersRoster,
        isChampion,
        players: userRoster.players,
      },
    });

    await prisma.legacySeasonSummary.upsert({
      where: { leagueId: savedLeague.id },
      update: {
        champion: isChampion,
        wins: userRoster.wins,
        losses: userRoster.losses,
        pointsFor: userRoster.pointsFor,
        finalRank: userRoster.rank,
      },
      create: {
        leagueId: savedLeague.id,
        season,
        champion: isChampion,
        wins: userRoster.wins,
        losses: userRoster.losses,
        pointsFor: userRoster.pointsFor,
        finalRank: userRoster.rank,
      },
    });
  }
}

/**
 * Sync one Sleeper league into legacy tables (`LegacyLeague` + `LegacyRoster`).
 * Used by `/api/leagues/import` so career rank uses the same data as the legacy import worker.
 */
export async function syncLegacyLeagueFromSleeper(
  legacyUserId: string,
  sleeperUserId: string,
  league: SleeperLeague,
  season: number,
): Promise<void> {
  await importLeague(legacyUserId, sleeperUserId, league, season)
}

// Legacy function for backward compatibility
export async function runLegacyImport(
  jobId: string,
  userId: string,
  sleeperUserId: string,
  options: { concurrency?: number; seasonBackoffMinMs?: number; seasonBackoffMaxMs?: number } = {}
) {
  let done = false;
  while (!done) {
    const result = await runLegacyImportStep(jobId, userId, sleeperUserId);
    done = result.done;
    if (!done) {
      await jitterSleep(options.seasonBackoffMinMs ?? 100, options.seasonBackoffMaxMs ?? 200);
    }
  }
}
