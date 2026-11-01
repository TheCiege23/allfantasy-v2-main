import { prisma } from '@/lib/prisma'

/**
 * League FAQ generator — creates and pins a rules FAQ document in the league chat.
 * Covers: Redraft, Dynasty, Keeper, Guillotine, Tournament, Zombie, Best Ball, and Salary Cap.
 * Survivor has its own dedicated FAQ generator in lib/survivor/faqGenerator.ts.
 */

async function upsertPinnedFaq(
  leagueId: string,
  userId: string,
  faqContent: string,
  faqTitle: string,
): Promise<void> {
  // Check if a pinned FAQ already exists
  const existing = await prisma.leagueChatMessage.findFirst({
    where: {
      leagueId,
      type: 'host_announcement',
      metadata: { path: ['contentType'], equals: 'league_faq' },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (existing) {
    await prisma.leagueChatMessage.update({
      where: { id: existing.id },
      data: {
        message: faqContent,
        metadata: {
          senderIsHost: true,
          contentType: 'league_faq',
          isPinned: true,
          pinnedAt: new Date().toISOString(),
          pinnedBy: 'system',
          faqTitle,
        },
      },
    })
    return
  }

  await prisma.leagueChatMessage.create({
    data: {
      leagueId,
      userId,
      message: faqContent,
      type: 'host_announcement',
      metadata: {
        senderIsHost: true,
        contentType: 'league_faq',
        isPinned: true,
        pinnedAt: new Date().toISOString(),
        pinnedBy: 'system',
        faqTitle,
      },
    },
  })
}

// ============================================================================
// REDRAFT FAQ
// ============================================================================

export async function generateAndPinRedraftFAQ(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      userId: true,
      name: true,
      sport: true,
      settings: true,
      _count: { select: { teams: true } },
    },
  })
  if (!league) return

  const settings = (league.settings ?? {}) as Record<string, unknown>
  const scoringFormat = String(settings.scoring_format ?? settings.scoring ?? 'PPR').toUpperCase()
  const draftType = String(settings.draft_type ?? settings.requested_draft_type ?? 'snake')
  const waiverType = String(settings.waiver_type ?? 'FAAB').toUpperCase()
  const teamCount = league._count?.teams ?? 12
  const sport = (league.sport ?? 'NFL').toUpperCase()

  const faq = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ${league.name ?? 'League'} — RULES FAQ
${sport} Redraft League · ${teamCount} Teams
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 FORMAT
This is a REDRAFT league. All rosters reset at the end of each season. No player carryover.

📌 DRAFT
Draft type: ${draftType.replace(/_/g, ' ')}
All teams draft fresh each season. Draft order is determined by the commissioner or randomized.

📌 SCORING
Format: ${scoringFormat}
Points are calculated based on player performance using the ${scoringFormat} scoring system.
Stat corrections may apply within 48 hours of game completion.

📌 WAIVERS
Type: ${waiverType}
${waiverType === 'FAAB' ? 'Each team has a budget to bid on free agents. Highest bid wins. Budget does not reset.' : 'Waiver priority resets based on standings each week.'}
Free agents become available after the waiver window closes.

📌 TRADES
Trade proposals can be sent to any team.
The commissioner reviews trades for fairness.
Trade deadline is enforced — no trades after the deadline.

📌 MATCHUPS
Weekly head-to-head matchups determine standings.
Ties are broken by total points scored.

📌 PLAYOFFS
Top teams qualify for playoffs.
Playoff matchups are single-elimination.
The champion is determined by the final round.

📌 @CHIMMY
Tag @Chimmy in chat for:
- Rules questions
- Scoring explanations
- Waiver advice (if AI features enabled)
- Trade analysis (if AI features enabled)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Questions? Ask your commissioner or @Chimmy.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

  await upsertPinnedFaq(leagueId, league.userId, faq, 'League Rules FAQ')
}

// ============================================================================
// DYNASTY FAQ
// ============================================================================

export async function generateAndPinDynastyFAQ(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, name: true, sport: true, settings: true, _count: { select: { teams: true } } },
  })
  if (!league) return

  const settings = (league.settings ?? {}) as Record<string, unknown>
  const taxiSlots = Number(settings.taxi_slots ?? settings.taxiSlots ?? 4)
  const sport = (league.sport ?? 'NFL').toUpperCase()
  const teamCount = league._count?.teams ?? 12

  const faq = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ${league.name ?? 'League'} — DYNASTY RULES FAQ
${sport} Dynasty League · ${teamCount} Teams
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 FORMAT
This is a DYNASTY league. You keep your entire roster year-to-year. Build for the long term.

📌 ROSTERS
Rosters persist across seasons. Larger rosters than redraft.
Taxi squad: ${taxiSlots} slots (developing players with restricted movement).
IR slots available for injured players.

📌 TAXI SQUAD
Taxi is for developing players (rookies and 2nd-year players by default).
Once promoted from taxi to active roster, a player cannot return to taxi (unless commissioner overrides).
Taxi players do not count against your active roster limit.

📌 DRAFT SYSTEM
Startup draft: Full team draft in the first season.
Rookie draft: Annual draft of incoming rookies. Order based on reverse standings.
Draft picks are tradeable — you can trade future picks up to 3 years out.

📌 TRADES
Players AND draft picks can be traded.
Multi-year pick trades are supported.
Pick ownership is tracked automatically — traded picks transfer correctly.
Trade deadline is enforced during the season.

📌 OFFSEASON
After the championship, the league enters offseason phases:
1. Post-Season → 2. Offseason Open → 3. Free Agency → 4. Rookie Draft → 5. Roster Cuts → 6. Preseason → 7. Season

📌 WAIVERS
Same system as redraft (FAAB or rolling priority).
Long-term stashing is a key dynasty strategy.

📌 LEAGUE HISTORY
Championships, records, and trade history are tracked permanently.
Your dynasty legacy builds over time.

📌 @CHIMMY
Tag @Chimmy in chat for:
- Rules questions
- Player valuations (if AI features enabled)
- Trade analysis with dynasty context (if AI features enabled)
- Rebuild vs contend strategy advice (if AI features enabled)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Questions? Ask your commissioner or @Chimmy.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

  await upsertPinnedFaq(leagueId, league.userId, faq, 'Dynasty Rules FAQ')
}

// ============================================================================
// GUILLOTINE FAQ
// ============================================================================

export async function generateAndPinGuillotineFAQ(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, name: true, sport: true, settings: true, _count: { select: { teams: true } } },
  })
  if (!league) return

  const sport = (league.sport ?? 'NFL').toUpperCase()
  const teamCount = league._count?.teams ?? 17

  const faq = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ${league.name ?? 'League'} — GUILLY RULES FAQ
${sport} Guilly League · ${teamCount} Teams
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 FORMAT
This is a GUILLY league. The lowest-scoring team each week is ELIMINATED.
Their entire roster is released to waivers. Last team standing wins.

📌 HOW IT WORKS
1. All teams score each week (no head-to-head matchups).
2. The team with the LOWEST score is eliminated.
3. All players from the eliminated team go to waivers.
4. Remaining teams bid on released players.
5. Repeat until one team remains — the champion.

📌 ELIMINATION
One team is eliminated every week (or on the configured chop day).
Eliminated teams cannot make any roster moves.
Tiebreaker for lowest score: total points for the season.

📌 WAIVERS
After each elimination, a special waiver window opens.
FAAB bidding determines who gets the released players.
This is the ONLY way to add players (no regular free agency outside waiver windows).

📌 STRATEGY
Start your best lineup every week — there are no safe weeks.
Hoard FAAB for when elite players get released.
Roster construction evolves as teams shrink and talent concentrates.

📌 NO TRADES
Trades are typically disabled in Guilly leagues.
The waiver system is the primary roster-building mechanism.

📌 @CHIMMY
Tag @Chimmy in chat for:
- Rules questions
- Waiver advice
- Elimination risk analysis (if AI features enabled)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Questions? Ask your commissioner or @Chimmy.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

  await upsertPinnedFaq(leagueId, league.userId, faq, 'Guilly Rules FAQ')
}

// ============================================================================
// TOURNAMENT FAQ
// ============================================================================

export async function generateAndPinTournamentFAQ(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, name: true, sport: true, settings: true },
  })
  if (!league) return

  const sport = (league.sport ?? 'NFL').toUpperCase()

  const faq = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ${league.name ?? 'League'} — TOURNAMENT RULES FAQ
${sport} Tournament Mode
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 FORMAT
This is a TOURNAMENT league. Multiple leagues compete across conferences.
Top performers advance through rounds. One champion crowned.

📌 HOW IT WORKS
1. Players are assigned to conferences and leagues.
2. Each round runs for several weeks with standard fantasy matchups.
3. Top finishers in each league advance to the next round.
4. Rosters are re-drafted each round.
5. Final round determines the tournament champion.

📌 CONFERENCES
The tournament is divided into conferences, each containing multiple leagues.
Standings within your league determine advancement.

📌 ADVANCEMENT
Top performers advance based on record and points.
A "bubble" zone exists for borderline qualifiers.
Cutline is clearly displayed in standings.

📌 REDRAFT BETWEEN ROUNDS
Each new round features a fresh draft among the advancing participants.
New leagues are formed from the surviving pool.

📌 CHAMPIONSHIP
The final round crowns the tournament champion.
Championship bracket results are permanent league history.

📌 @CHIMMY
Tag @Chimmy in chat for:
- Tournament rules
- Standings questions
- Advancement odds (if AI features enabled)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Questions? Ask your commissioner or @Chimmy.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

  await upsertPinnedFaq(leagueId, league.userId, faq, 'Tournament Rules FAQ')
}

// ============================================================================
// KEEPER FAQ
// ============================================================================

export async function generateAndPinKeeperFAQ(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, name: true, sport: true, settings: true, _count: { select: { teams: true } } },
  })
  if (!league) return

  const settings = (league.settings ?? {}) as Record<string, unknown>
  const ks = (settings.keeper_settings ?? {}) as Record<string, unknown>
  const maxKeepers = Number(ks.maxKeepers ?? settings.keeper_max_keepers ?? 3)
  const costMode = String(ks.roundCostMode ?? 'round_penalty')
  const sport = (league.sport ?? 'NFL').toUpperCase()
  const teamCount = league._count?.teams ?? 12

  const faq = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ${league.name ?? 'League'} — KEEPER RULES FAQ
${sport} Keeper League · ${teamCount} Teams
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 FORMAT
This is a KEEPER league. Each team retains up to ${maxKeepers} player${maxKeepers > 1 ? 's' : ''} each offseason.
All non-kept players return to the draft pool. A hybrid of redraft and dynasty.

📌 KEEPER RULES
Max keepers per team: ${maxKeepers}
Cost mode: ${costMode.replace(/_/g, ' ')}
${costMode === 'round_penalty' ? 'Keeping a player costs the draft pick from the round they were originally drafted in (or one round earlier each year).' : ''}
${costMode === 'auction_carryover' ? 'Keeper cost equals the player\'s previous auction value (may inflate each year).' : ''}
${costMode === 'no_cost' ? 'Keepers are free — no draft pick penalty.' : ''}

📌 KEEPER ELIGIBILITY
Players drafted in the startup/annual draft are eligible to be kept.
Waiver pickups may or may not be keeper-eligible (commissioner setting).
Players can be kept for a maximum number of years (if configured).

📌 KEEPER SELECTION
Before each season's draft, a keeper selection window opens.
Lock your keepers by the deadline — no changes after.
The system validates eligibility and cost automatically.

📌 DRAFT
After keepers are locked, remaining players enter the draft pool.
Draft picks forfeited for keepers are automatically removed.
Draft board reflects keeper selections in real time.

📌 TRADES
Trades can include keeper-eligible players.
Keeper eligibility transfers with the player.
Future draft picks may be affected by keeper selections.

📌 STRATEGY
Balance win-now production vs future keeper value.
Waiver pickups with keeper potential are gold.
Consider keeper cost inflation when deciding multi-year holds.

📌 @CHIMMY
Tag @Chimmy in chat for:
- Keeper value analysis (if AI features enabled)
- Draft strategy adjusted for your keepers (if AI features enabled)
- Rules questions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Questions? Ask your commissioner or @Chimmy.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

  await upsertPinnedFaq(leagueId, league.userId, faq, 'Keeper Rules FAQ')
}

// ============================================================================
// BEST BALL FAQ
// ============================================================================

export async function generateAndPinBestBallFAQ(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, name: true, sport: true, _count: { select: { teams: true } } },
  })
  if (!league) return

  const sport = (league.sport ?? 'NFL').toUpperCase()

  const faq = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ${league.name ?? 'League'} — BEST BALL RULES FAQ
${sport} Best Ball League · ${league._count?.teams ?? 12} Teams
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 FORMAT
This is a BEST BALL league. No lineup setting required.
The system automatically selects your best-scoring lineup each week.

📌 HOW IT WORKS
1. Draft your roster (larger than standard leagues).
2. Each week, the system picks your highest-scoring combination.
3. No waiver moves, no trades, no lineup decisions.
4. Pure draft strategy — your draft IS your season.

📌 SCORING
Your best possible lineup is calculated automatically each week.
Optimal starters are selected from your full roster.
Bench players who outscore starters are swapped in retroactively.

📌 STRATEGY
Draft depth over stars — every roster spot matters.
Target high-upside players who could boom any week.
Stack positions to maximize ceiling weeks.
Handcuff RBs to capture backfield value.

📌 NO MOVES
No waivers. No trades. No lineup changes.
Set it and forget it after the draft.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Questions? Ask your commissioner or @Chimmy.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

  await upsertPinnedFaq(leagueId, league.userId, faq, 'Best Ball Rules FAQ')
}

// ============================================================================
// SALARY CAP FAQ
// ============================================================================

export async function generateAndPinSalaryCapFAQ(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, name: true, sport: true, settings: true, _count: { select: { teams: true } } },
  })
  if (!league) return

  const settings = (league.settings ?? {}) as Record<string, unknown>
  const sc = (settings.salary_cap_settings ?? {}) as Record<string, unknown>
  const totalCap = Number(sc.totalCap ?? sc.total_cap ?? 250)
  const draftMode = String(sc.draftMode ?? settings.draft_type ?? 'auction')
  const sport = (league.sport ?? 'NFL').toUpperCase()
  const teamCount = league._count?.teams ?? 12

  const faq = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ${league.name ?? 'League'} — SALARY CAP RULES FAQ
${sport} Salary Cap League · ${teamCount} Teams
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 FORMAT
This is a SALARY CAP league. Every player has a salary and optional contract.
Teams must stay under the hard cap ($${totalCap}) at all times.
Think of yourself as a GM — long-term planning and cap management are everything.

📌 SALARY CAP
Total cap: $${totalCap}
Hard cap is enforced — you cannot exceed it.
Dead money applies when cutting players with remaining contract years.

📌 DRAFT MODE: ${draftMode.toUpperCase().replace(/_/g, ' ')}
${draftMode.includes('auction') ? `Auction draft: You bid on players. Winning bid = player salary.
Nomination order rotates. Timer enforced. Budget = cap space.` : ''}
${draftMode.includes('snake') ? `Snake draft with salary scale: Each pick has a pre-assigned salary.
Pick 1 = highest salary, declining per pick. Later rounds = minimum salary.
Contract length is auto-assigned by round.` : ''}
${draftMode.includes('hybrid') ? `Hybrid mode: Auction for veterans, snake draft for rookies.
Veteran salaries from auction bids. Rookie salaries from pick position.` : ''}

📌 CONTRACTS
Players have 1-5 year contracts.
Contracts count against your cap for the duration.
Extensions increase salary but lock in the player longer.
Franchise tag: one player per year at premium salary.

📌 DEAD MONEY
Cutting a player with years remaining creates dead money.
Current year: 100% of remaining salary hits your cap.
Future years: reduced dead money (typically 25% per year remaining).

📌 TRADES
Players + contracts trade together.
Cap impact is shown in real-time before confirming.
Both teams must remain cap-compliant after the trade.
Future draft picks are tradeable.

📌 WAIVERS
FAAB bids → winning bid becomes player salary.
Cap must have space for the new salary.
Waiver claims are validated against cap before processing.

📌 OFFSEASON
Contracts expire at season end.
Free agency period opens for new signings.
Rookie draft replenishes talent.
Cap rollover (if enabled) carries unused space forward.

📌 @CHIMMY
Tag @Chimmy in chat for:
- @chimmy cap — view cap summary
- @chimmy contracts — list your contracts
- @chimmy extend [player] — extension analysis (AI required)
- @chimmy cut [player] — cut penalty preview
- @chimmy help — all available commands

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Questions? Ask your commissioner or @Chimmy.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

  await upsertPinnedFaq(leagueId, league.userId, faq, 'Salary Cap Rules FAQ')
}

// ============================================================================
// IDP FAQ
// ============================================================================

export async function generateAndPinIdpFAQ(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, name: true, sport: true, settings: true, _count: { select: { teams: true } } },
  })
  if (!league) return

  const settings = (league.settings ?? {}) as Record<string, unknown>
  const posMode = String(settings.idp_position_mode ?? 'standard')
  const rosterPreset = String(settings.idp_roster_preset ?? 'standard')
  const scoringPreset = String(settings.idp_scoring_preset ?? 'balanced')
  const teamCount = league._count?.teams ?? 12

  const posDescription = posMode === 'advanced'
    ? 'Advanced (DE, DT, LB, CB, S — split positions)'
    : posMode === 'hybrid'
      ? 'Hybrid (grouped + split positions)'
      : 'Standard (DL, LB, DB — grouped positions)'

  const faq = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ${league.name ?? 'League'} — IDP RULES FAQ
NFL IDP League · ${teamCount} Teams
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 FORMAT
This is an IDP (Individual Defensive Player) league. You draft and start BOTH offensive AND defensive players.
Defensive scoring can rival or exceed offensive scoring depending on settings.

📌 POSITION MODE
${posDescription}
Roster preset: ${rosterPreset}

📌 DEFENSIVE ROSTER SLOTS
${posMode === 'advanced' ? `DE: 2 · DT: 1 · LB: 3 · CB: 2 · S: 2 · IDP FLEX: 1` : `DL: 2 · LB: 2-3 · DB: 2-3 · IDP FLEX: 1-2`}
Plus standard offensive slots (QB, RB, WR, TE, FLEX, K)

📌 DEFENSIVE SCORING (${scoringPreset.toUpperCase()})
Core stats:
- Solo Tackle: 1.0 pt
- Assisted Tackle: 0.5 pt
- Sack: 4.0 pts
- Interception: 5.0 pts
- Forced Fumble: 4.0 pts
- Fumble Recovery: 2.0 pts
- Pass Defended: 1.5 pts
- Defensive TD: 6.0 pts
- Safety: 2.0 pts

Advanced stats (if enabled):
- Tackle for Loss: 1.5 pts
- QB Hit: 1.0 pt
- Blocked Kick: 3.0 pts

📌 DRAFT STRATEGY
The draft combines offensive and defensive players in one pool.
Key decisions: when to draft elite defenders vs offensive depth.
LB tends to be the most valuable IDP position (high tackle volume).
Elite edge rushers (DE) provide sack upside.
DBs with interception history offer big-play potential.

📌 WAIVERS
Offensive and defensive players share the waiver pool.
Filter by OFFENSE or DEFENSE tabs.
Breakout defenders after Week 1-2 are prime waiver targets.

📌 MATCHUPS
Your matchup score combines:
- Offensive Points
- Defensive Points
- Total determines the winner

📌 @CHIMMY
Tag @Chimmy in chat for:
- @chimmy idp rankings — defensive player rankings
- @chimmy start/sit defense — IDP start/sit advice (AI required)
- @chimmy waiver targets defense — defensive waiver suggestions (AI required)
- @chimmy matchup analysis — full matchup breakdown (AI required)
- @chimmy help — all commands

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Questions? Ask your commissioner or @Chimmy.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

  await upsertPinnedFaq(leagueId, league.userId, faq, 'IDP Rules FAQ')
}

// ============================================================================
// DEVY FAQ
// ============================================================================

export async function generateAndPinDevyFAQ(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, name: true, sport: true, settings: true, _count: { select: { teams: true } } },
  })
  if (!league) return

  const settings = (league.settings ?? {}) as Record<string, unknown>
  const devyCfg = (settings.devyConfig ?? {}) as Record<string, unknown>
  const devySlots = Number(devyCfg.devySlotCount ?? 6)
  const taxiSlots = Number(settings.taxi_slots ?? settings.taxiSlots ?? 4)
  const devyRounds = Array.isArray(devyCfg.devyRounds) ? devyCfg.devyRounds.length : 4
  const sport = (league.sport ?? 'NFL').toUpperCase()
  const teamCount = league._count?.teams ?? 12

  const faq = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ${league.name ?? 'League'} — DEVY DYNASTY RULES FAQ
${sport} Devy League · ${teamCount} Teams
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 FORMAT
This is a DEVY DYNASTY league. You roster NFL veterans, rookies, AND college/developmental players.
Devy players are rights-based assets — they do NOT score fantasy points until they enter the NFL.

📌 ROSTER BUCKETS
ACTIVE (Starters + Bench + IR): NFL players who score points
TAXI (${taxiSlots} slots): Stash area for young players. Points may display but do NOT count toward matchup score.
DEVY (${devySlots} slots): College/developmental players. No scoring contribution. Rights ownership only.

📌 SCORING RULES
Only STARTERS on your active roster count toward your official weekly score.
Bench players: points may display visually but do NOT count.
Taxi players: points may display visually but do NOT count.
Devy players: NO scoring at all while in college.

📌 DEVY PLAYER LIFECYCLE
1. DEVY PROSPECT — College player on your devy roster. Rights only, no scoring.
2. NFL ENTRY — Player declares/enters NFL. System detects transition.
3. ROOKIE — Player becomes rookie-eligible. Moves to taxi or active based on league rules.
4. NFL ASSET — Full dynasty player. Scores when started on active roster.

📌 DRAFT SYSTEM
Startup draft: Veterans + Rookies + Devy (format chosen by commissioner)
Annual drafts: Rookie + Devy combined OR separate (commissioner setting)
Devy draft rounds: ${devyRounds}
Draft picks are tradeable — including future devy picks.

📌 TAXI SQUAD
Taxi is for developing young players (rookies / 2nd-year by default).
Once promoted to active, a player cannot return to taxi (default setting).
Taxi deadline may be enforced (commissioner setting).

📌 TRADES
Players, draft picks (rookie + devy), and devy rights are all tradeable.
Devy-for-veteran trades are a core strategy element.

📌 IMPORTS
This league may import rosters from multiple sources.
NFL rosters and devy rosters can come from different platforms.
All data is merged into one unified team page.

📌 @CHIMMY
Tag @Chimmy in chat for:
- @chimmy devy rules — explain devy mechanics
- @chimmy taxi rules — taxi eligibility and rules
- @chimmy devy rankings — prospect rankings (AI required)
- @chimmy evaluate prospect — player analysis (AI required)
- @chimmy help — all commands

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Questions? Ask your commissioner or @Chimmy.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

  await upsertPinnedFaq(leagueId, league.userId, faq, 'Devy Dynasty Rules FAQ')
}

// ============================================================================
// C2C (CAMPUS 2 CANTON) FAQ
// ============================================================================

export async function generateAndPinC2CFAQ(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, name: true, sport: true, settings: true, _count: { select: { teams: true } } },
  })
  if (!league) return

  const settings = (league.settings ?? {}) as Record<string, unknown>
  const c2c = (settings.c2cConfig ?? {}) as Record<string, unknown>
  const sport = (league.sport ?? 'NFL').toUpperCase()
  const teamCount = league._count?.teams ?? 12
  const isFootball = sport === 'NFL' || sport === 'NCAAF'
  const collegeSport = isFootball ? 'College Football' : 'College Basketball'
  const proSport = isFootball ? 'NFL' : 'NBA'

  const faq = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ${league.name ?? 'League'} — C2C RULES FAQ
Campus 2 Canton · ${proSport} + ${collegeSport} · ${teamCount} Teams
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 FORMAT
This is a CAMPUS 2 CANTON (C2C) dynasty league. You manage BOTH college AND pro players in one franchise.
College players score real fantasy points when placed in campus starter slots.
Pro players score real fantasy points when placed in pro starter slots.
This is deeper than Devy — college production matters NOW, not just future projection.

📌 ROSTER STRUCTURE
CAMPUS STARTERS: College players who score points toward your matchup total
PRO STARTERS: ${proSport} players who score points toward your matchup total
BENCH: Visible points only — do NOT count toward official score
TAXI: Stash area — visible points only, do NOT count
DEVY: Developmental stash (scoring behavior set by commissioner)

📌 SCORING
Your weekly matchup score combines:
  Campus Starter Points + Pro Starter Points = Final Team Score
Only players in STARTER slots count. Bench and taxi display points but never count.
${isFootball ? 'Campus and pro scoring use matched fantasy settings (PPR/half-PPR/standard).' : 'Campus and pro scoring use matched points-league settings.'}

📌 PLAYER LIFECYCLE
1. COLLEGE PLAYER — Scores on campus side when started
2. DRAFT ELIGIBLE — Enters pro draft pool
3. ROOKIE — Transitions to pro side (taxi or active)
4. PRO ASSET — Full ${proSport} dynasty player

📌 DRAFTS
Startup: College + Pro players drafted together (or split by commissioner choice)
Annual: Incoming rookie + college replenishment drafts
All draft picks are tradeable — campus picks and pro picks.

📌 TRADES
Players, draft picks (campus + pro), and devy rights are all tradeable.
Campus-for-pro trades are a core strategy element.

📌 @CHIMMY
Tag @Chimmy in chat for:
- @chimmy c2c rules — explain C2C mechanics
- @chimmy campus rankings — college player rankings (AI required)
- @chimmy pro rankings — ${proSport} rankings (AI required)
- @chimmy transition watch — upcoming college-to-pro transitions (AI required)
- @chimmy help — all commands

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Questions? Ask your commissioner or @Chimmy.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

  await upsertPinnedFaq(leagueId, league.userId, faq, 'C2C Rules FAQ')
}

// ============================================================================
// BIG BROTHER FAQ
// ============================================================================

export async function generateAndPinBigBrotherFAQ(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, name: true, sport: true, settings: true, _count: { select: { teams: true } } },
  })
  if (!league) return

  const sport = (league.sport ?? 'NFL').toUpperCase()
  const teamCount = league._count?.teams ?? 12

  const faq = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ${league.name ?? 'League'} — BIG BROTHER RULES FAQ
${sport} Big Brother League · ${teamCount} Houseguests
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 FORMAT
This is a BIG BROTHER fantasy league. Each week features competitions, nominations, vetoes, and evictions — just like the show, powered by fantasy sports scoring.

📌 WEEKLY GAME LOOP
1. HOH COMPETITION — Automated mini-game based on fantasy scoring. Winner becomes Head of Household.
2. NOMINATIONS — HOH nominates 2 houseguests for eviction via @Chimmy.
3. POV COMPETITION — Power of Veto competition. Winner can save a nominee.
4. VETO CEREMONY — POV holder decides whether to use the veto. If used, HOH names a replacement.
5. LIVE VOTING — All houseguests (except HOH and nominees) vote privately to evict.
6. EVICTION — Lowest vote-getter is evicted. Their roster is released to waivers.

📌 HOH (HEAD OF HOUSEHOLD)
The HOH wins power for the week. HOH:
- Nominates 2 houseguests for eviction
- Names a replacement nominee if veto is used
- Does NOT vote (unless tiebreaker)
- Cannot be HOH two weeks in a row

📌 POV (POWER OF VETO)
The POV winner can:
- Save themselves (if nominated)
- Save another nominee
- Choose not to use it
If used, HOH must name a replacement (cannot re-nominate POV winner or saved player).

📌 VOTING
All houseguests except HOH and nominees vote privately.
Use: @chimmy vote [manager name]
Votes are secret until the eviction reveal.

📌 EVICTION
The nominee with the most votes is evicted.
Tie: HOH casts the tiebreaker vote.
Evicted houseguest's roster is released to waivers.

📌 JURY
After a commissioner-set week, evicted houseguests join the Jury.
Jury members vote for the winner at the finale.
Final 2 face the Jury — the Jury decides the champion.

📌 @CHIMMY COMMANDS
- @chimmy nominate [player1] [player2] — HOH nominates (HOH only)
- @chimmy veto use [player] — use POV to save someone (POV winner only)
- @chimmy veto pass — decline to use POV (POV winner only)
- @chimmy vote [player] — cast eviction vote (private)
- @chimmy status — check current week phase
- @chimmy rules — explain the rules
- @chimmy help — all commands

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Questions? Ask your commissioner or @Chimmy.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

  await upsertPinnedFaq(leagueId, league.userId, faq, 'Big Brother Rules FAQ')
}
