/**
 * AI Draft Intelligence — source invariants (Commit 19)
 *
 * The AI Draft Intelligence panel is already wired into DraftRoomPageClient.
 * This file locks the 8 behavioral contracts required by the canonical
 * /drafts/[draftId] route:
 *
 *   1. AI receives current session/draft context (session, currentPick, picks, teamCount)
 *   2. AI calls the live-brain endpoint (/api/draft/live-brain)
 *   3. AI calls the recommend endpoint (/api/draft/recommend)
 *   4. AI loading state does not block the draft board
 *   5. AI error state does not clear draft session
 *   6. AI re-requests when currentPick changes
 *   7. AI does not call the pick endpoint
 *   8. AI does not call the queue mutation endpoint
 *
 * Also verifies viewer-privacy (off-clock clears result), war room wiring,
 * assistant-context endpoint, and that floating intelligence window is mounted.
 *
 * All tests are source-level — zero DB, zero render, zero network.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')

const src = readFileSync(
  resolve(root, 'components/app/draft-room/DraftRoomPageClient.tsx'),
  'utf8',
)

const commissionerSrc = readFileSync(
  resolve(root, 'hooks/useCommissionerActions.ts'),
  'utf8',
)

// Extract fetchRecommendation callback body
const fetchRecMatch = src.match(
  /const fetchRecommendation = useCallback\(\s*async[\s\S]*?\},\s*\[[\s\S]*?\],?\s*\)/,
)
const fetchRecSrc = fetchRecMatch?.[0] ?? ''

// Extract fetchWarRoom callback body
const fetchWarMatch = src.match(
  /const fetchWarRoom = useCallback\(\s*async[\s\S]*?\},\s*\[[\s\S]*?\],?\s*\)/,
)
const fetchWarSrc = fetchWarMatch?.[0] ?? ''

// Extract fetchDraftAssistantContext callback body
const fetchAssistantMatch = src.match(
  /const fetchDraftAssistantContext = useCallback\(\s*async[\s\S]*?\},\s*\[[\s\S]*?\],?\s*\)/,
)
const fetchAssistantSrc = fetchAssistantMatch?.[0] ?? ''

// Extract the recommendation trigger effect (fires fetchRecommendation on pick change)
const recTriggerMatch = src.match(
  /recommendationRequestKeyRef\.current = recommendationKey[\s\S]*?fetchRecommendation\(\)[\s\S]*?\},\s*\[[\s\S]*?currentPick\?\.overall[\s\S]*?\]\s*\)/,
)
const recTriggerSrc = recTriggerMatch?.[0] ?? ''

// Extract the off-the-clock effect that clears recommendation for viewer privacy
const offClockMatch = src.match(
  /Off-the-clock[\s\S]*?setRecommendationResult\(\{[\s\S]*?recommendation: null[\s\S]*?\}\)/,
)
const offClockSrc = offClockMatch?.[0] ?? ''

// Extract the war room trigger effect
const warTriggerMatch = src.match(
  /scheduleWarRoomFetch\(false\)[\s\S]*?\}\s*,\s*\[[\s\S]*?currentPick\?\.overall[\s\S]*?\]\s*\)/,
)
const warTriggerSrc = warTriggerMatch?.[0] ?? ''

// ---------------------------------------------------------------------------
// 1. AI receives current session/draft context
// ---------------------------------------------------------------------------

describe('fetchRecommendation — reads session state for AI context', () => {
  it('fetchRecommendation is present in DraftRoomPageClient', () => {
    expect(fetchRecSrc).not.toBe('')
  })

  it('reads currentPick from session-derived state', () => {
    expect(fetchRecSrc).toMatch(/currentPick/)
  })

  it('reads session.teamCount for roster-slot context', () => {
    expect(fetchRecSrc).toMatch(/session\.teamCount/)
  })

  it('reads session.picks to build myRoster (current user roster)', () => {
    expect(fetchRecSrc).toMatch(/session\.picks/)
  })

  it('reads currentUserRosterId to filter picks to viewer roster', () => {
    expect(fetchRecSrc).toMatch(/currentUserRosterId/)
  })

  it('reads players pool to build available player list', () => {
    expect(fetchRecSrc).toMatch(/players/)
  })

  it('reads draftedNames and draftedPlayerIds to filter already-drafted', () => {
    expect(fetchRecSrc).toMatch(/draftedNames/)
    expect(fetchRecSrc).toMatch(/draftedPlayerIds/)
  })

  it('sends round and pick (slot) from currentPick', () => {
    expect(fetchRecSrc).toMatch(/round: currentPick\.round/)
    expect(fetchRecSrc).toMatch(/pick: currentPick\.slot/)
  })
})

// ---------------------------------------------------------------------------
// 2. AI calls the live-brain endpoint
// ---------------------------------------------------------------------------

describe('fetchRecommendation — calls /api/draft/live-brain', () => {
  it('POSTs to /api/draft/live-brain', () => {
    expect(fetchRecSrc).toMatch(/\/api\/draft\/live-brain/)
    expect(fetchRecSrc).toMatch(/method: 'POST'/)
  })

  it('uses buildLiveDraftBrainPayload to construct the payload', () => {
    expect(fetchRecSrc).toMatch(/buildLiveDraftBrainPayload\(/)
  })

  it('stores the live-brain envelope in liveBrainEnvelope state', () => {
    expect(fetchRecSrc).toMatch(/setLiveBrainEnvelope\(/)
  })
})

// ---------------------------------------------------------------------------
// 3. AI calls the recommend endpoint
// ---------------------------------------------------------------------------

describe('fetchRecommendation — calls /api/draft/recommend', () => {
  it('POSTs to /api/draft/recommend', () => {
    expect(fetchRecSrc).toMatch(/\/api\/draft\/recommend/)
  })

  it('sends leagueId in the recommend request body', () => {
    expect(fetchRecSrc).toMatch(/leagueId/)
  })

  it('sends sport and draftType context', () => {
    expect(fetchRecSrc).toMatch(/sport:/)
    expect(fetchRecSrc).toMatch(/isDynasty/)
  })

  it('sets recommendationResult with returned recommendation data', () => {
    expect(fetchRecSrc).toMatch(/setRecommendationResult\(\{/)
  })
})

// ---------------------------------------------------------------------------
// War room also calls existing AI endpoint
// ---------------------------------------------------------------------------

describe('fetchWarRoom — calls /api/ai/draft/recommend', () => {
  it('fetchWarRoom is present in DraftRoomPageClient', () => {
    expect(fetchWarSrc).not.toBe('')
  })

  it('POSTs to /api/ai/draft/recommend', () => {
    expect(fetchWarSrc).toMatch(/\/api\/ai\/draft\/recommend/)
    expect(fetchWarSrc).toMatch(/method: 'POST'/)
  })

  it('sends leagueId, availablePlayers, userRoster in request body', () => {
    expect(fetchWarSrc).toMatch(/leagueId/)
    expect(fetchWarSrc).toMatch(/availablePlayers/)
    expect(fetchWarSrc).toMatch(/userRoster/)
  })

  it('includes round, pick, totalTeams from currentPick and session', () => {
    expect(fetchWarSrc).toMatch(/round: currentPick\.round/)
    expect(fetchWarSrc).toMatch(/totalTeams: session\.teamCount/)
  })

  it('caches war room result by pick+roster key', () => {
    expect(fetchWarSrc).toMatch(/warRoomCacheRef\.current\.set\(cacheKey/)
  })
})

// ---------------------------------------------------------------------------
// Assistant context uses canonical league endpoint
// ---------------------------------------------------------------------------

describe('fetchDraftAssistantContext — uses canonical /api/leagues endpoint', () => {
  it('fetchDraftAssistantContext is present', () => {
    expect(fetchAssistantSrc).not.toBe('')
  })

  it('GETs /api/leagues/[leagueId]/draft/assistant-context', () => {
    expect(fetchAssistantSrc).toMatch(/\/api\/leagues\/.*\/draft\/assistant-context/)
  })

  it('uses encodeURIComponent on leagueId', () => {
    expect(fetchAssistantSrc).toMatch(/encodeURIComponent\(leagueId\)/)
  })

  it('sets draftAssistantContext on success', () => {
    expect(fetchAssistantSrc).toMatch(/setDraftAssistantContext\(\{/)
  })

  it('sets draftAssistantContext to null on catch (non-blocking)', () => {
    expect(fetchAssistantSrc).toMatch(/setDraftAssistantContext\(null\)/)
  })
})

// ---------------------------------------------------------------------------
// 4. AI loading state does not block the draft board
// ---------------------------------------------------------------------------

describe('AI loading — separate from board loading state', () => {
  it('recommendationLoading is a distinct useState from loading', () => {
    // Board loading state
    expect(src).toMatch(/const \[loading, setLoading\] = useState\(initialSnapshot \? false : true\)/)
    // AI loading state — separate
    expect(src).toMatch(/const \[recommendationLoading, setRecommendationLoading\] = useState\(false\)/)
  })

  it('warRoomLoading is also separate from board loading', () => {
    expect(src).toMatch(/const \[warRoomLoading, setWarRoomLoading\] = useState\(false\)/)
  })

  it('setRecommendationLoading(true) does not call setLoading', () => {
    // The fetchRecommendation callback should not touch the board loading flag
    expect(fetchRecSrc).not.toMatch(/\bsetLoading\b/)
  })

  it('fetchWarRoom does not touch board loading state', () => {
    expect(fetchWarSrc).not.toMatch(/\bsetLoading\b/)
  })
})

// ---------------------------------------------------------------------------
// 5. AI error state does not clear draft session
// ---------------------------------------------------------------------------

describe('AI error — does not clear draft session', () => {
  it('fetchRecommendation catch sets setRecommendationError, not setSession(null)', () => {
    const catchMatch = fetchRecSrc.match(/} catch \(e[^)]*\) \{[\s\S]*?setRecommendationError\(/)
    expect(catchMatch).not.toBeNull()
  })

  it('fetchRecommendation catch never calls setSession(null)', () => {
    const catchSection = fetchRecSrc.slice(fetchRecSrc.lastIndexOf('} catch'))
    expect(catchSection).not.toMatch(/setSession\(null\)/)
  })

  it('fetchWarRoom catch sets setWarRoomError, not setSession', () => {
    const catchMatch = fetchWarSrc.match(/} catch \(e[^)]*\) \{[\s\S]*?setWarRoomError\(/)
    expect(catchMatch).not.toBeNull()
  })

  it('fetchWarRoom catch never calls setSession', () => {
    const catchSection = fetchWarSrc.slice(fetchWarSrc.lastIndexOf('} catch'))
    expect(catchSection).not.toMatch(/setSession\(/)
  })

  it('fetchDraftAssistantContext catch only sets draftAssistantContext to null', () => {
    const catchSection = fetchAssistantSrc.slice(fetchAssistantSrc.lastIndexOf('} catch'))
    expect(catchSection).not.toMatch(/setSession\(/)
  })

  it('non-ok recommend response sets setRecommendationError', () => {
    expect(fetchRecSrc).toMatch(/setRecommendationError\(/)
  })

  it('non-ok war room response sets setWarRoomError', () => {
    expect(fetchWarSrc).toMatch(/setWarRoomError\(/)
  })
})

// ---------------------------------------------------------------------------
// 6. AI re-requests when currentPick changes
// ---------------------------------------------------------------------------

describe('recommendation trigger effect — fires on currentPick change', () => {
  it('trigger effect is present', () => {
    expect(recTriggerSrc).not.toBe('')
  })

  it('currentPick?.overall is in the effect dependency array', () => {
    expect(recTriggerSrc).toMatch(/currentPick\?\.overall/)
  })

  it('currentPick?.rosterId is in the effect dependency array', () => {
    expect(recTriggerSrc).toMatch(/currentPick\?\.rosterId/)
  })

  it('session?.picks?.length is in the effect dependency array', () => {
    expect(recTriggerSrc).toMatch(/session\?\.picks\?\.length/)
  })

  it('uses a recommendation key to deduplicate requests for the same pick', () => {
    expect(recTriggerSrc).toMatch(/recommendationRequestKeyRef\.current/)
  })
})

describe('war room trigger effect — fires on currentPick change', () => {
  it('war room trigger is present', () => {
    expect(warTriggerSrc).not.toBe('')
  })

  it('currentPick?.overall is in the war room effect dep array', () => {
    expect(warTriggerSrc).toMatch(/currentPick\?\.overall/)
  })

  it('session?.picks?.length is in the war room effect dep array', () => {
    expect(warTriggerSrc).toMatch(/session\?\.picks\?\.length/)
  })

  it('session?.status is in the war room effect dep array', () => {
    expect(warTriggerSrc).toMatch(/session\?\.status/)
  })
})

// ---------------------------------------------------------------------------
// 7. AI does not call the pick endpoint
// ---------------------------------------------------------------------------

describe('fetchRecommendation — does not call pick endpoint', () => {
  it('fetchRecommendation does not POST to /draft/pick', () => {
    expect(fetchRecSrc).not.toMatch(/\/draft\/pick/)
  })

  it('fetchRecommendation does not call handleMakePick', () => {
    expect(fetchRecSrc).not.toMatch(/handleMakePick/)
  })
})

describe('fetchWarRoom — does not call pick endpoint', () => {
  it('fetchWarRoom does not POST to /draft/pick', () => {
    expect(fetchWarSrc).not.toMatch(/\/draft\/pick/)
  })

  it('fetchWarRoom does not call handleMakePick', () => {
    expect(fetchWarSrc).not.toMatch(/handleMakePick/)
  })
})

// ---------------------------------------------------------------------------
// 8. AI does not call the queue mutation endpoint
// ---------------------------------------------------------------------------

describe('fetchRecommendation — does not mutate queue', () => {
  it('fetchRecommendation does not PUT to /draft/queue', () => {
    expect(fetchRecSrc).not.toMatch(/PUT.*draft\/queue|draft\/queue.*PUT/)
    expect(fetchRecSrc).not.toMatch(/method: 'PUT'/)
  })

  it('fetchRecommendation does not call handleQueueSave', () => {
    expect(fetchRecSrc).not.toMatch(/handleQueueSave/)
  })

  it('fetchRecommendation does not call setQueue', () => {
    expect(fetchRecSrc).not.toMatch(/setQueue\(/)
  })
})

describe('fetchWarRoom — does not mutate queue', () => {
  it('fetchWarRoom does not PUT to /draft/queue', () => {
    expect(fetchWarSrc).not.toMatch(/method: 'PUT'/)
  })

  it('fetchWarRoom does not call handleQueueSave', () => {
    expect(fetchWarSrc).not.toMatch(/handleQueueSave/)
  })

  it('fetchWarRoom does not call setQueue', () => {
    expect(fetchWarSrc).not.toMatch(/setQueue\(/)
  })
})

// ---------------------------------------------------------------------------
// Viewer privacy — off-the-clock clears recommendation
// ---------------------------------------------------------------------------

describe('AI viewer privacy — recommendation cleared when not on clock', () => {
  it('off-the-clock effect is present', () => {
    expect(offClockSrc).not.toBe('')
  })

  it('clears recommendation when currentPick.rosterId !== currentUserRosterId', () => {
    expect(offClockSrc).toMatch(/currentPick\.rosterId === currentUserRosterId/)
    expect(offClockSrc).toMatch(/recommendation: null/)
  })

  it('recommendation request key is reset when off-clock in trigger effect', () => {
    // The guard lives just before the key-join in the trigger effect body.
    // Search the full source rather than the extracted suffix.
    expect(src).toMatch(/currentPick\.rosterId !== currentUserRosterId[\s\S]*?recommendationRequestKeyRef\.current = ''/)
  })
})

// ---------------------------------------------------------------------------
// AI floating intelligence window is mounted (rendering contract)
// ---------------------------------------------------------------------------

describe('DraftRoomPageClient — AI floating window is rendered', () => {
  it('DraftHelperFloatingWindow is mounted in JSX', () => {
    expect(src).toMatch(/<DraftHelperFloatingWindow/)
  })

  it('floating window receives copilotProps with recommendation data', () => {
    expect(src).toMatch(/copilotProps=\{/)
    expect(src).toMatch(/recommendation: recommendationResult\?\.recommendation/)
  })

  it('floating window receives intelligenceProps with aiFeatureStatus', () => {
    expect(src).toMatch(/intelligenceProps=\{/)
    expect(src).toMatch(/aiFeatureStatus:/)
  })

  it('floating window receives sportsFeed from draftAssistantContext', () => {
    expect(src).toMatch(/headlines: draftAssistantContext\.headlines/)
    expect(src).toMatch(/injuries: draftAssistantContext\.injuries/)
  })

  it('floating bubble is shown when hasDraftHelperData is true', () => {
    expect(src).toMatch(/hasDraftHelperData && \([\s\S]*?<DraftHelperFloatingBubble/)
  })

  it('DraftHelperFloatingBubble receives badgeCount from draftHelperBadgeCount', () => {
    expect(src).toMatch(/badgeCount=\{draftHelperBadgeCount\}/)
  })
})

// ---------------------------------------------------------------------------
// AI state does not feed into pick or queue handler calls
// ---------------------------------------------------------------------------

describe('AI state isolation — warRoomData and recommendationResult not wired to pick/queue', () => {
  it('handleMakePick does not reference warRoomData', () => {
    const makePickMatch = src.match(
      /const handleMakePick = useCallback\(\s*async[\s\S]*?\},\s*\[[\s\S]*?\],?\s*\)/,
    )
    const makePickSrc = makePickMatch?.[0] ?? ''
    expect(makePickSrc).not.toMatch(/warRoomData/)
  })

  it('handleMakePick does not reference recommendationResult', () => {
    const makePickMatch = src.match(
      /const handleMakePick = useCallback\(\s*async[\s\S]*?\},\s*\[[\s\S]*?\],?\s*\)/,
    )
    const makePickSrc = makePickMatch?.[0] ?? ''
    expect(makePickSrc).not.toMatch(/recommendationResult/)
  })

  it('handleQueueSave does not reference warRoomData', () => {
    const queueSaveMatch = src.match(
      /const handleQueueSave = useCallback\(\s*async[\s\S]*?\},\s*\[[\s\S]*?\],?\s*\)/,
    )
    const queueSaveSrc = queueSaveMatch?.[0] ?? ''
    expect(queueSaveSrc).not.toMatch(/warRoomData/)
  })

  it('handleQueueSave does not reference recommendationResult', () => {
    const queueSaveMatch = src.match(
      /const handleQueueSave = useCallback\(\s*async[\s\S]*?\},\s*\[[\s\S]*?\],?\s*\)/,
    )
    const queueSaveSrc = queueSaveMatch?.[0] ?? ''
    expect(queueSaveSrc).not.toMatch(/recommendationResult/)
  })
})

// ---------------------------------------------------------------------------
// fetchDraftAssistantContext is called after undo_pick (AI updates on pick change)
// Lives in useCommissionerActions.ts (the hook receives it as a prop).
// ---------------------------------------------------------------------------

describe('AI context refreshed after undo_pick', () => {
  it('useCommissionerActions accepts fetchDraftAssistantContext as a prop', () => {
    expect(commissionerSrc).toMatch(/fetchDraftAssistantContext/)
  })

  it('fetchDraftAssistantContext is called inside the undo_pick success branch', () => {
    const undoMatch = commissionerSrc.match(
      /if \(action === 'undo_pick'\) \{[\s\S]*?fetchDraftAssistantContext\(\)/,
    )
    expect(undoMatch).not.toBeNull()
  })

  it('DraftRoomPageClient passes fetchDraftAssistantContext to useCommissionerActions', () => {
    const match = src.match(/useCommissionerActions\(\{[\s\S]*?fetchDraftAssistantContext/)
    expect(match).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// No new legacy AI endpoints introduced
// ---------------------------------------------------------------------------

describe('AI endpoints — no legacy routes used', () => {
  it('fetchRecommendation does not use legacy /api/draft-ai route', () => {
    expect(fetchRecSrc).not.toMatch(/\/api\/draft-ai\//)
  })

  it('fetchWarRoom does not use legacy /api/draft-ai route', () => {
    expect(fetchWarSrc).not.toMatch(/\/api\/draft-ai\//)
  })

  it('fetchDraftAssistantContext does not use legacy /api/draft/assistant-context', () => {
    // Must use the canonical /api/leagues/ prefix
    expect(fetchAssistantSrc).not.toMatch(/['"`]\/api\/draft\/assistant-context['"`]/)
  })
})
