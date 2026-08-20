# Chimmy AI Sports Intelligence Architecture

## Overview

**Canonical Route:** `/chimmy/chat`

Chimmy is the official AllFantasy AI assistant designed to answer:
1. **Real sports information** — schedules, scores, player stats, trades, signings, team news
2. **User-specific fantasy context** — league rules, roster settings, waiver rules, matchup analysis

## Current Architecture

### Request Flow

```
Client (/chimmy/chat) 
  → /api/chimmy (alias) 
  → /api/chat/chimmy (implementation)
```

### Current Capabilities

**Real Sports Data (Integration Points — NOT YET WIRED):**
- Player stats
- Team information
- Schedules and scores
- Trades and signings
- Playoff schedules
- Live/real-time scoring

**Fantasy Context (WORKING):**
- User's leagues ✅
- League rules & settings ✅
- Roster information ✅
- Scoring settings ✅
- Waiver rules ✅
- Draft settings ✅
- Matchup context ✅
- Trade context ✅

### Context Layers

#### 1. User Context (✅ Ready)
```typescript
// app/api/chat/chimmy/route.ts
const session = await getServerSession(authOptions)
const userId = session.user.id
const userTimezone = await buildUserTemporalContextForAI(userId)
```

#### 2. League Context (✅ Ready)
```typescript
// League snapshot loading
import { loadLeagueSnapshotForUser } from '@/lib/chimmy/chimmy-league-snapshot'
const league = await loadLeagueSnapshotForUser(userId, leagueId)

// Normalized context for multi-platform consistency
import { resolveNormalizedLeagueContext } from '@/lib/league-context-engine'
const normalized = await resolveNormalizedLeagueContext(league)
```

#### 3. Sports Data Digest (FUTURE — Framework exists)
```typescript
// app/api/chat/chimmy/route.ts
import { buildChimmySportDataDigest } from '@/lib/chimmy/chimmy-sport-data-digest'

// This function is called but receives incomplete data
// TODO Phase 2: Wire live sports data sources here
const sportDigest = await buildChimmySportDataDigest({
  leagueSnapshot: league,
  sport: requestContext.sport,
  userId,
  week: requestContext.week,
  // FUTURE PARAMS:
  // injuries?: InjuryReportData[]
  // schedules?: ScheduleData[]
  // scores?: ScoreData[]
  // playerStats?: PlayerStatsData[]
  // trades?: TradeData[]
  // signings?: SigningData[]
})
```

#### 4. AI Memory (✅ Ready)
```typescript
import { getFullAIContext } from '@/lib/ai-memory'
const memoryContext = await getFullAIContext(userId, conversationId)
```

#### 5. League-Specific Sub-Modes (✅ Ready)
- Tournament mode (`buildTournamentContextForChimmy`)
- Big Brother (`buildBigBrotherContextForChimmy`)
- IDP (`buildIdpContextForChimmy`)
- Survivor (`buildSurvivorContextForChimmy`)
- Zombie (`buildZombieContextForChimmy`)
- Dynasty (`buildDynastyContextForChimmy`)
- And 5+ others

### AI Provider Cascade

```typescript
// app/api/chat/chimmy/route.ts → runUnifiedOrchestration()

Providers (parallel):
  1. OpenAI (gpt-4o)
  2. Grok (X API) 
  3. DeepSeek
  4. Anthropic Claude
  
Result: Consensus + confidence score + hallucination guard
```

### Message Persistence

**Client-side:** `AIThreadPersistenceService.ts`
```typescript
// Up to 80 messages per conversation
localStorage.setItem('allfantasy:chimmy-thread:v1:' + storageKey, messagesJSON)
```

**Database-side:** Prisma persistence in `/api/chat/chimmy` handler
```typescript
await appendChatHistory(userId, conversationId, messages)
```

---

## Future: Sports API Integration Points

### Phase 2: Real Sports Data Wiring

#### 1. Player Stats Integration

**Location:** `lib/chimmy/chimmy-sport-data-digest.ts`

**Integration Point:**
```typescript
// TODO Phase 2: Replace placeholder with live API
type PlayerStatsSource = {
  playerId: string
  playerName: string
  position: string
  team: string
  lastGameStats?: {
    passingYards?: number
    receivingYards?: number
    rushingyards?: number
    touchdowns?: number
    date: Date
  }
  seasonStats?: {
    passingYards?: number
    touchdowns?: number
    interceptions?: number
    // ... sport-specific fields
  }
  projectedStats?: {
    weekNumber: number
    projectedPoints: number
    floorPoints: number
    ceilPoints: number
  }
}

// DECISION: Should come from existing API if available
// (API-Sports, Sports Data, ClearSports, or internal warehouse)
```

**Existing APIs to Check:**
- `/api/player/[playerId]/stats` — if exists
- `/api/player/[playerId]/history` — if exists
- `/api/league/[leagueId]/roster` — includes projected stats?

#### 2. Schedule Integration

**Location:** `lib/chimmy/chimmy-sport-data-digest.ts`

**Integration Point:**
```typescript
// TODO Phase 2: Wire schedule data
type ScheduleData = {
  week: number
  date: Date
  homeTeam: string
  awayTeam: string
  status: 'scheduled' | 'live' | 'final'
  finalScore?: { home: number; away: number }
  liveScore?: { home: number; away: number }
}

// Questions this enables:
// "When is the next Knicks playoff game?"
// "Who do the Eagles play next?"
// "What was the final score of the Yankees game?"
```

**Existing APIs to Check:**
- `/api/schedule` or `/api/schedules`
- `/api/sport/[sport]/schedule`
- `/api/sport/[sport]/scores`

#### 3. Injuries Integration

**Location:** `lib/chimmy/chimmy-sport-data-digest.ts`

**Integration Point:**
```typescript
// TODO Phase 2: Wire injury report
type InjuryReport = {
  playerId: string
  playerName: string
  team: string
  status: 'out' | 'questionable' | 'probable' | 'day_to_day'
  injuryType: string
  estimatedReturnWeek?: number
  reportedDate: Date
}

// Questions this enables:
// "What are the latest injury updates?"
// "Is [Player] out for the week?"
// "When will [Player] be back?"
```

**Existing APIs to Check:**
- `/api/injuries`
- `/api/sport/[sport]/injuries`
- `/api/news` (injury news)

#### 4. Trades & Signings

**Location:** `lib/chimmy/chimmy-sport-data-digest.ts`

**Integration Point:**
```typescript
// TODO Phase 2: Wire transaction data
type TransactionData = {
  playerId: string
  playerName: string
  fromTeam?: string
  toTeam?: string
  type: 'trade' | 'signing' | 'release' | 'waiver'
  date: Date
}

// Questions this enables:
// "Did the Lakers sign anyone recently?"
// "What was the [Team] trade?"
// "Who did [Team] release?"
```

**Existing APIs to Check:**
- `/api/transactions`
- `/api/sport/[sport]/trades`
- `/api/sport/[sport]/news`

#### 5. Live Scoring

**Location:** `lib/chimmy/chimmy-sport-data-digest.ts`

**Integration Point:**
```typescript
// TODO Phase 2: Wire live game updates
type LiveGame = {
  gameId: string
  homeTeam: string
  awayTeam: string
  status: 'live' | 'final' | 'scheduled'
  quarter?: number
  time?: string
  homeScore: number
  awayScore: number
  livePlays?: Array<{
    timestamp: string
    player: string
    team: string
    action: string
    points: number
  }>
}

// Questions this enables:
// "What's the current score of the Lakers game?"
// "How is [Player] doing in tonight's game?"
// Real-time lineup impact analysis
```

**Existing APIs to Check:**
- `/api/games` or `/api/sport/[sport]/games`
- WebSocket or polling for live updates?

---

## Integration Strategy

### Low-Risk Wiring Path

1. **Identify data source** for each integration (player stats, schedule, injuries, etc.)
   - Check if API already exists in codebase
   - Check if data exists in existing Postgres tables
   - Check if third-party API already available

2. **Add data building function** in `lib/chimmy/chimmy-sport-data-digest.ts`
   ```typescript
   async function enrichSportDigestWithLiveData(
     digest: ChimmySportDataDigest,
     sport: SupportedSport,
     week?: number
   ): Promise<ChimmySportDataDigest> {
     // Load from API/DB
     // Merge into digest
     // Return enhanced digest
   }
   ```

3. **Pass to AI prompt** in `/api/chat/chimmy/route.ts`
   ```typescript
   const sportDigest = await buildChimmySportDataDigest(...)
   const enrichedDigest = await enrichSportDigestWithLiveData(sportDigest, sport, week)
   
   // Include in system prompt:
   // "You have access to the following real-time sports data: [digest]"
   ```

4. **Test with sample data** before going live
   - Verify AI can understand data structure
   - Check hallucination guard still works
   - Validate accuracy of sources

5. **Add staleness warning** if data is older than expected
   ```typescript
   if (digest.lastUpdated < Date.now() - 3600000) { // 1 hour old
     // Add warning to response
   }
   ```

---

## Hallucination Prevention

### Current Guard (✅ Ready)
```typescript
// app/api/chat/chimmy/route.ts
import { checkChimmyHallucination } from '@/lib/chimmy-chat/hallucination-guard'

const guard = await checkChimmyHallucination(response)
if (guard.likelyHallucination) {
  // Return error instead of fake response
  return "I don't have current data on that. Please check the official source."
}
```

### Behavior Rules (✅ Ready)
```typescript
import { checkBehaviorRules } from '@/lib/ai/behavior-rules'
import { buildBehaviorRulesPrompt } from '@/lib/ai/behavior-rules'

const rules = await loadCustomRules('chimmy')
const ruled = await checkBehaviorRules(response, rules)
```

### System Prompt Direction (For Future Sports APIs)
```
SPORTS DATA REALITY CHECKS:
- If you don't have data for a question, say so honestly.
- Never make up schedules, scores, or player stats.
- If data is stale (> 1 hour old), mention the timestamp.
- For live games, say "I don't have live updates" rather than guessing.
- For recent trades/signings, verify against actual news sources.
```

---

## Response Behavior Direction

### Case 1: Live/Current Sports Information

**Question:** "What was Jalen Brunson's last stat line?"

**Current Behavior:**
```
"I don't have live game data wired yet, but you can check ESPN or NBA.com 
for the latest stat lines. If you share a screenshot, I can analyze it!"
```

**Phase 2 Behavior:**
```
"Jalen Brunson's last game (vs [Team], [Date]):
- 25 points, 8 assists, 4 rebounds
- 9-16 FG, 3-6 3PT, 4-4 FT
- Played 32 minutes

Want me to analyze how that impacts your league?"
```

### Case 2: League-Specific Questions

**Question:** "Who should I start in my league?"

**Current Behavior:** ✅ Works
```
"Based on your league's scoring rules ([rules]), I'd start [Player] 
over [Player] because [reason]."
```

**Phase 2 Enhancement:**
```
"Based on your league's scoring rules and current projections:
- Start [Player] (projected 18.5 pts vs [team])
- Bench [Player] (projected 12.3 pts vs [team])
- [Player] is questionable — monitor status before Sunday"
```

### Case 3: Mixed Questions

**Question:** "Does this trade help my roster given the playoff matchups?"

**Current Behavior:** ✅ Partial
```
"Yes, [Player] upgrades your WR depth and fits your league's PPR scoring.
But I don't have current playoff schedules to factor in."
```

**Phase 2 Enhancement:**
```
"Yes, [Player] upgrades your WR depth. Here's why with playoff context:
- Your playoff teams:  [Teams you face weeks 15-17]
- [Player] schedule: [Opponent analysis for playoff weeks]
- Verdict: Strong upgrade with favorable matchups"
```

---

## Remaining Gaps (Documented in SETTINGS_PAGE_AUDIT.md equivalents)

### Now (Phase 1 - Current)
✅ User leagues & settings
✅ League-specific context
✅ Multi-AI provider consensus
✅ Message persistence
✅ Voice & image support
✅ Conversation memory
❌ Live player stats
❌ Real schedules & scores
❌ Injury reports
❌ Trades & signings
❌ Two-way league integration (suggesting trades back to league)

### Phase 2 Recommended
- Wire player stats API
- Wire schedule/score API
- Wire injury report API
- Wire trade/signing news API
- Live game updates (optional WebSocket)
- Hallucination guard testing on real data

### Phase 3+ (Future)
- Agent-based trade suggestions
- Auto-coaching with live stats
- Real-time lineup optimization
- Waiver wire recommendations with live availability
- Season strategy adjustments based on current standings

---

## Development Checklist

### For Adding New Sports Data Source:

- [ ] Identify data location (API endpoint or DB table)
- [ ] Check if already available in codebase
- [ ] Create builder function in `lib/chimmy/chimmy-sport-data-digest.ts`
- [ ] Add type definitions
- [ ] Wire into `/api/chat/chimmy/route.ts` before AI prompt
- [ ] Add staleness warning if > 1 hour old
- [ ] Test with sample questions
- [ ] Run hallucination guard validation
- [ ] Document in system prompt
- [ ] Add to behavior rules if needed
- [ ] Test on mobile and web
- [ ] Monitor for false positives in early rollout

---

## Related Files

**Core Route:** `app/chimmy/chat/` (page.tsx, ChimmyChatPageClient.tsx)
**UI Component:** `components/chimmy/ChimmyChatShell.tsx` (main chat interface)
**API Handler:** `app/api/chat/chimmy/route.ts` (request → response)
**Entry Point:** `lib/ai-product-layer/UnifiedChimmyEntryResolver.ts`
**Sport Digest:** `lib/chimmy/chimmy-sport-data-digest.ts` (data aggregation)
**League Context:** `lib/chimmy/chimmy-league-snapshot.ts` + `lib/league-context-engine/`
**Hallucination Guard:** `lib/chimmy-chat/hallucination-guard.ts`
**Behavior Rules:** `lib/ai/behavior-rules.ts`
**Memory System:** `lib/ai-memory/`

---

## Next Steps

1. Review existing sports APIs already in codebase
2. Identify highest-impact data source (player stats vs schedules)
3. Create Phase 2 implementation plan with data source selection
4. Wire first data source with comprehensive testing
5. Iterate on response quality and hallucination prevention
