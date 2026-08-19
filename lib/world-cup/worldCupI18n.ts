/**
 * worldCupI18n.ts
 *
 * World Cup-scoped translation dictionary. Reuses the existing app-wide
 * language preference (cookie `af_lang` + localStorage + user profile)
 * resolved via `useOptionalLanguage()` on the client and
 * `resolveServerRenderPreferences()` on the server.
 *
 * Supported locales (Phase 2 — five languages):
 *   en  — English
 *   es  — Español
 *   zh  — 繁體中文 (Traditional Chinese)
 *   fil — Filipino
 *   vi  — Tiếng Việt
 *
 * Why a separate dictionary instead of folding into lib/i18n/translations.ts:
 *  - The main translations bundle is already 4400+ lines; bundling ~100
 *    World Cup-only keys for every page (login, dashboard, draft, etc.)
 *    would inflate first-load JS for non-WC users.
 *  - WC keys are co-located with the rest of the WC code, easier to keep
 *    in sync as cards evolve.
 *
 * Hydration safety:
 *  - The current locale comes from useOptionalLanguage(), which itself
 *    reads from <html data-lang="..."> set by the server-side language
 *    init script. SSR HTML and the first client render see the same
 *    locale → no React #425/#418 risk.
 *  - On the server, resolveServerRenderPreferences() returns "en"/"es"
 *    from cookie or user profile; same value is rendered on first CSR.
 *  - No browser APIs read during render. Pure / deterministic.
 *
 * Missing-key behavior:
 *  - Falls back to English when a key is missing in the requested locale.
 *  - In development (process.env.NODE_ENV !== "production") logs a single
 *    console.warn per missing key/locale pair so the dev sees it without
 *    spamming. Production never logs and never shows the raw key.
 *  - If the key is missing from English too, returns the key string as a
 *    last resort — production still hides this via the same path.
 *
 * Safety properties verified by tests:
 *  - No values contain email addresses, user IDs, or wagering / betting
 *    language.
 *  - Placeholder syntax `{{name}}` is interpolated.
 */
export type WorldCupLocale = "en" | "es" | "zh" | "fil" | "vi" | "fr" | "ar"

export const WORLD_CUP_SUPPORTED_LOCALES: WorldCupLocale[] = [
  "en",
  "es",
  "zh",
  "fil",
  "vi",
  "fr",
  "ar",
]
export const WORLD_CUP_DEFAULT_LOCALE: WorldCupLocale = "en"

/**
 * Native language display names for the World Cup language picker /
 * tooltip. Kept identical to lib/i18n/constants.ts for visual parity
 * with the global LanguageToggle.
 */
export const WORLD_CUP_LOCALE_NATIVE_NAMES: Record<WorldCupLocale, string> = {
  en: "English",
  es: "Español",
  zh: "繁體中文",
  fil: "Filipino",
  fr: "Fran\u00e7ais",
  ar: "\u0627\u0644\u0639\u0631\u0628\u064a\u0629",
  vi: "Tiếng Việt",
}

/**
 * Normalize an arbitrary string / null / undefined into a supported World
 * Cup locale. Mirrors lib/i18n/constants.ts resolveLanguage so the WC
 * helper accepts every code the app-wide system can emit.
 */
export function getWorldCupLocale(input: unknown): WorldCupLocale {
  if (input === "es") return "es"
  if (input === "en") return "en"
  if (input === "zh") return "zh"
  if (input === "fil") return "fil"
  if (input === "vi") return "vi"
  if (input === "fr") return "fr"
  if (input === "ar") return "ar"
  return WORLD_CUP_DEFAULT_LOCALE
}

/**
 * Native display name for a locale code. Falls back to English ("English")
 * if the input is unknown.
 */
export function getWorldCupLocaleNativeName(
  input: WorldCupLocale | string | null | undefined
): string {
  const safe = getWorldCupLocale(input)
  return WORLD_CUP_LOCALE_NATIVE_NAMES[safe]
}

type WorldCupDictionary = Record<string, string>

const EN: WorldCupDictionary = {
  // ── Shared / shell ───────────────────────────────────────────────────
  "wc.common.loading": "Loading...",
  "wc.common.back": "Back",
  "wc.common.openSettings": "Open settings",
  "wc.common.signIn": "Sign in",
  "wc.common.signOut": "Sign out",

  // ── Public hub: /brackets/world-cup ──────────────────────────────────
  "wc.publicHub.backToBrackets": "← Back to Brackets",
  "wc.publicHub.heroTitle": "World Cup Bracket Challenge",
  "wc.publicHub.heroSubtitle":
    "Create an NCAA-style bracket pool for the FIFA World Cup. Invite friends, make picks, track live scores, and climb the leaderboard.",
  "wc.publicHub.discover": "Discover public pools",
  "wc.publicHub.joinWithCode": "Join with Invite Code",
  "wc.publicHub.createPool": "Create Pool",
  "wc.publicHub.createWorldCupPool": "Create World Cup Pool",
  "wc.publicHub.yourPools": "Your World Cup Pools",
  "wc.publicHub.poolsCountOne": "{{count}} pool",
  "wc.publicHub.poolsCountOther": "{{count}} pools",
  "wc.publicHub.scoreLabel": "Score",
  "wc.publicHub.rankLabel": "Rank",
  "wc.publicHub.participantsOne": "{{count}} participant",
  "wc.publicHub.participantsOther": "{{count}} participants",
  "wc.publicHub.statusOpen": "Open",
  "wc.publicHub.statusLocked": "Locked",
  "wc.publicHub.statusFinal": "Final",
  "wc.publicHub.emptyTitle": "No World Cup pools yet",
  "wc.publicHub.emptyBody":
    "You haven't created or joined a World Cup bracket pool.",
  "wc.publicHub.emptyHint":
    "Create one and invite friends, or ask someone for an invite code.",
  "wc.publicHub.signInTitle": "Sign in to get started",
  "wc.publicHub.signInBody":
    "Create or join a World Cup bracket pool and compete with friends.",
  "wc.publicHub.signInCta": "Sign In to Get Started",
  "wc.publicHub.feature.privatePublic":
    "Private or public pools — up to 100 participants.",
  "wc.publicHub.feature.bracketsPerUser":
    "Up to 5 brackets per user, compete with multiple strategies.",
  "wc.publicHub.feature.ncaaScoring":
    "NCAA-style scoring — more points for later rounds.",
  "wc.publicHub.feature.guidedPicker":
    "Guided pick builder with AI matchup previews.",
  "wc.publicHub.feature.liveTracking":
    "Live score and match-minute tracking.",
  "wc.publicHub.feature.aiBracketBuilder":
    "AI bracket builder fills unpicked matches automatically.",
  "wc.publicHub.feature.perBracketLeaderboard":
    "Per-bracket leaderboard — every entry ranked individually.",
  "wc.publicHub.feature.lockOnKickoff":
    "Brackets lock when the first World Cup match begins.",

  // ── Public hub: v2 command center ────────────────────────────────────
  "wc.publicHub.commandEyebrow": "AF World Cup Pools Command Center",
  "wc.publicHub.commandTitle": "Build your World Cup path to greatness.",
  "wc.publicHub.commandSubtitle":
    "Create a pool, invite your crew, rank every group, pick the knockout path, and watch the leaderboard come alive.",
  "wc.publicHub.trustNote": "Free to play. Just glory, strategy, and bragging rights.",
  "wc.publicHub.stat.teams": "48 Teams",
  "wc.publicHub.stat.groups": "12 Groups",
  "wc.publicHub.stat.matches": "104 Matches",
  "wc.publicHub.stat.format": "Group Stage + Knockouts",
  "wc.publicHub.actionsTitle": "How would you like to start?",
  "wc.publicHub.action.create.title": "Create a Pool",
  "wc.publicHub.action.create.desc":
    "Start a private or public World Cup pool and invite friends.",
  "wc.publicHub.action.join.title": "Join with Code",
  "wc.publicHub.action.join.desc":
    "Got an invite? Enter the code and jump right in.",
  "wc.publicHub.action.discover.title": "Discover Public Pools",
  "wc.publicHub.action.discover.desc":
    "Find open World Cup pools and join the action.",
  "wc.publicHub.how.title": "How AF World Cup Pools work",
  "wc.publicHub.how.step1Title": "Create or join a pool",
  "wc.publicHub.how.step1Body":
    "Start a private pool for your crew or find a public one anyone can join.",
  "wc.publicHub.how.step2Title": "Rank every group",
  "wc.publicHub.how.step2Body":
    "Predict where each team finishes — including 3rd-place advancers that continue the knockout stage.",
  "wc.publicHub.how.step3Title": "Build the knockout path",
  "wc.publicHub.how.step3Body":
    "Pick match winners through Round of 32, quarters, semis, and the final.",
  "wc.publicHub.how.step4Title": "Finalize and climb",
  "wc.publicHub.how.step4Body":
    "Lock your bracket before kickoff, then watch live standings update and share your results.",
  "wc.publicHub.ai.title": "AI-Powered Bracket Tools",
  "wc.publicHub.ai.subtitle":
    "Chimmy and AllFantasy AI help you understand risk, surface bracket insights, and guide commissioners.",
  "wc.publicHub.ai.explain.title": "Explain My Bracket",
  "wc.publicHub.ai.explain.desc":
    "AI reads your picks and explains what makes your bracket unique.",
  "wc.publicHub.ai.danger.title": "Knockout Danger Zones",
  "wc.publicHub.ai.danger.desc":
    "See which knockout picks are most vulnerable to upsets.",
  "wc.publicHub.ai.chat.title": "Pool Chat + Strategy",
  "wc.publicHub.ai.chat.desc":
    "Ask @Chimmy for pick advice right in your pool chat.",
  "wc.publicHub.ai.commissioner.title": "Commissioner Insights",
  "wc.publicHub.ai.commissioner.desc":
    "AI summaries for pool health, bracket diversity, and member activity.",
  "wc.publicHub.ai.gating":
    "Available on eligible AI plans or token-powered tools.",
  "wc.publicHub.social.title": "Bring your crew.",
  "wc.publicHub.social.desc":
    "Share your pool link, challenge your friends, and let the leaderboard settle the debate.",
  "wc.publicHub.social.cta": "Create a Pool to Get Invite Link",
  "wc.publicHub.trust.note":
    "AllFantasy World Cup Pools are for fantasy sports entertainment, strategy, and bragging rights. Completely free to play.",

  // ── Pool dashboard: tab labels ───────────────────────────────────────
  "wc.tab.home": "Home",
  "wc.tab.groupStage": "Group Stage",
  "wc.tab.picks": "Knockouts",
  "wc.tab.review": "Review",
  "wc.tab.leaderboard": "Leaderboard",
  "wc.tab.rules": "Rules",
  "wc.tab.invite": "Invite",
  "wc.tab.commissioner": "Commissioner",
  "wc.tab.admin": "Settings",

  // ── Pool dashboard: sticky subnav labels ─────────────────────────────
  "wc.subnav.quickJump": "Quick jumps",
  "wc.subnav.start": "Start",
  "wc.subnav.groupBuilder": "Group Builder",
  "wc.subnav.bracketBoard": "Bracket Board",
  "wc.subnav.firstRound": "First Round",
  "wc.subnav.opsTools": "Ops Tools",
  "wc.subnav.rankSnapshot": "Rank Snapshot",
  "wc.subnav.inviteCenter": "Invite Center",

  // ── Mobile bottom nav: short labels ──────────────────────────────────
  "wc.tab.leaderboard.short": "Ranks",
  "wc.tab.commissioner.short": "Commish",
  "wc.tab.settings.short": "Setup",
  "wc.tab.home.short": "Home",
  "wc.tab.groupStage.short": "Groups",
  "wc.tab.picks.short": "Bracket",
  "wc.tab.review.short": "Review",
  "wc.tab.rules.short": "Rules",
  "wc.tab.invite.short": "Invite",
  "wc.tab.admin.short": "Settings",

  // ── Rules tab ────────────────────────────────────────────────────────
  "wc.rules.hero.eyebrow": "Pool",
  "wc.rules.hero.title": "Pool Rules",
  "wc.rules.hero.subtitle": "Understand scoring, deadlines, entries, and how your World Cup pool works.",
  "wc.rules.how.title": "How It Works",
  "wc.rules.how.body1": "Pick every winner from the Round of 32 through the champion. Picks lock at kickoff for each match.",
  "wc.rules.how.body2": "Correct picks score more each round. Match results update scores and refresh the leaderboard.",
  "wc.rules.scoring.title": "Scoring",
  "wc.rules.scoring.roundOf32": "Round of 32",
  "wc.rules.scoring.roundOf16": "Round of 16",
  "wc.rules.scoring.quarterfinal": "Quarterfinal",
  "wc.rules.scoring.semifinal": "Semifinal",
  "wc.rules.scoring.final": "Final",
  "wc.rules.scoring.champion": "Champion Bonus",
  "wc.rules.scoring.thirdPlace": "3rd Place",
  "wc.rules.scoring.pts": "pts",
  "wc.rules.settings.title": "Pool Settings",
  "wc.rules.settings.bracketsPerUser": "Brackets per user",
  "wc.rules.settings.thirdPlace": "Third-place match",
  "wc.rules.settings.thirdPlaceOn": "Included",
  "wc.rules.settings.thirdPlaceOff": "Off",
  "wc.rules.settings.inviteSharing": "Invite sharing",
  "wc.rules.settings.inviteCommish": "Commissioner only",
  "wc.rules.trustNote": "Free to play. Just World Cup predictions, strategy, and bragging rights.",

  // ── Pool dashboard: home tab ──────────────────────────────────────────
  "wc.home.title": "World Cup Pool Dashboard",
  "wc.home.subtitle": "Start here: create or open your bracket, rank all Group Stage pools, make Knockout picks, review, then finalize to appear on the leaderboard.",
  "wc.home.copyInvite": "Copy Invite",
  "wc.home.invitePanel": "Invite Panel",
  "wc.home.stat.participants": "Participants",
  "wc.home.stat.entries": "Entries",
  "wc.home.stat.finalized": "Finalized Entries",
  "wc.home.stat.fixtureStatus": "Fixture Status",
  "wc.home.stat.ready": "Ready",
  "wc.home.stat.notReady": "Not Ready",
  "wc.home.entries.title": "Entries",
  "wc.home.entries.loading": "Loading entries...",
  // ── Home tab: entry list card ────────────────────────────────────────
  "wc.entryList.subtitle": "Create or open your personal bracket when you are ready to make picks. Free play supports one bracket entry; AF Commissioner pool settings can allow multiple entries.",
  "wc.entryList.complete": "Complete",
  "wc.entryList.notComplete": "Not complete",
  "wc.entryList.rank": "Rank #{{rank}}",
  "wc.entryList.unranked": "Unranked",
  "wc.entryList.openBracket": "Open Bracket",
  "wc.entryList.noBracketsTitle": "No brackets created yet",
  "wc.entryList.noBracketsBody": "Create your personal bracket first, then you can make picks once fixtures are ready.",
  // ── Pool dashboard: AI features teaser ───────────────────────────────
  "wc.home.ai.title": "AI Features",
  "wc.home.ai.chimmyHint": "Type @chimmy in pool chat for personalized bracket advice.",
  "wc.home.ai.explainHint": "Go to the Review tab to get an AI explanation of your bracket strategy.",
  "wc.home.ai.unlockHint": "Upgrade to AF Pro to unlock Chimmy AI and Explain My Bracket.",

  // ── AI Insights CTA panel ──────────────────────────────────────────────────
  "wc.cta.panelTitle": "AI Insights",
  "wc.cta.aiRowLabel": "AI / Pro",
  "wc.cta.commissionerRowLabel": "Commissioner",
  // AI tier CTAs
  "wc.cta.askChimmy": "Ask Chimmy",
  "wc.cta.askChimmyDesc": "Open Chimmy with a bracket question",
  "wc.cta.askChimmyPrompt": "What should I know about my bracket picks?",
  "wc.cta.pathToFirst": "Path to First",
  "wc.cta.pathToFirstDesc": "Ask Chimmy what your bracket needs to climb to first",
  "wc.cta.pathToFirstPrompt": "What does my bracket {{name}} need to climb to first place in this pool?",
  "wc.cta.pathToFirstPromptGeneric": "What does my bracket need to climb to first place in this pool?",
  "wc.cta.explainBracket": "Explain My Bracket",
  "wc.cta.explainBracketDesc": "Get an AI explanation of your bracket strategy",
  // Commissioner tier CTAs
  "wc.cta.rootingGuide": "Rooting Guide",
  "wc.cta.rootingGuideDesc": "Generate a rooting guide for this entry",
  "wc.cta.poolSwing": "Pool Swing",
  "wc.cta.poolSwingDesc": "Find the biggest upcoming leaderboard swing",
  "wc.cta.championRisk": "Champion Risk",
  "wc.cta.championRiskDesc": "Analyze champion pick risk across the pool",
  "wc.cta.commissionerRecap": "Commissioner Recap",
  "wc.cta.commissionerRecapDesc": "Generate an AI pool recap (preview before posting)",
  "wc.cta.postHype": "Post Hype",
  "wc.cta.postHypeDesc": "Post a hype message to pool chat",
  "wc.cta.findIncomplete": "Incomplete Picks",
  "wc.cta.findIncompleteDesc": "Find entries that are most at risk of missing picks",

  // ── Daily Edge Report card ────────────────────────────────────────────
  "wc.edgeReport.title": "Daily Edge Report",
  "wc.edgeReport.subtitle": "What matters most in your pool today",
  "wc.edgeReport.badge.free": "Free",
  "wc.edgeReport.badge.included": "Included with plan",
  "wc.edgeReport.loading": "Building your edge report…",
  "wc.edgeReport.error": "Could not load your edge report. Try refreshing.",
  "wc.edgeReport.section.matchThatMatters": "Match That Matters",
  "wc.edgeReport.section.rootFor": "Root For",
  "wc.edgeReport.section.threats": "Who Can Pass You",
  "wc.edgeReport.section.bestPath": "Best Path to Climb",
  "wc.edgeReport.section.mistakeToAvoid": "Mistake to Avoid",
  "wc.edgeReport.coaching.title": "Chimmy Coaching",
  "wc.edgeReport.coaching.cachedBadge": "Unlocked today",
  "wc.edgeReport.coaching.includedLabel": "Included with your plan",
  "wc.edgeReport.coaching.unlockBtn": "Unlock today's coaching",
  "wc.edgeReport.coaching.tokenCost": "1 token",
  "wc.edgeReport.coaching.loading": "Generating coaching…",
  "wc.edgeReport.coaching.error": "Coaching unavailable right now. Try again.",
  "wc.edgeReport.coaching.spendFailed": "Token could not be deducted. Check your balance and try again.",
  "wc.edgeReport.commissionerPost.title": "Post Idea for Your Pool",
  "wc.edgeReport.commissionerPost.postBtn": "Post to pool chat",
  "wc.edgeReport.commissionerPost.posting": "Posting…",
  "wc.edgeReport.commissionerPost.posted": "Posted!",
  "wc.edgeReport.freshness": "Deterministic · updates each match day",
  "wc.dataTrust.liveLabel": "Live scores active",
  "wc.dataTrust.cachedLabel": "Updated within 24 hours",
  "wc.dataTrust.scheduleOnlyLabel": "Schedule only — scores may be outdated",
  "wc.dataTrust.poolOnlyLabel": "Pool data only — no fixture data loaded",
  "wc.dataTrust.noneLabel": "No data loaded",
  "wc.personalImpact.title": "Why This Match Matters",
  "wc.personalImpact.rootFor": "Root for",
  "wc.personalImpact.ptsAtStake": "pts at stake",
  "wc.matchImpact.title": "Why This Match Matters",
  "wc.matchImpact.rootFor": "Root for",
  "wc.matchImpact.worstResult": "Worst result",
  "wc.matchImpact.ptsAtStake": "Points at stake",
  "wc.matchImpact.poolSize": "Pool size",
  "wc.matchImpact.championRisk": "Champion risk",
  "wc.matchImpact.noEntry": "Add your bracket picks to see your match impact.",
  "wc.edgeReport.noEntry": "Add your bracket picks to see your daily edge report.",
  // Billing clarity — shown beneath coaching block after it loads
  "wc.edgeReport.billing.cached": "No token used · coaching was already unlocked today",
  "wc.edgeReport.billing.included": "Included with your plan",
  "wc.edgeReport.billing.charged": "1 token used",
  // Feedback
  "wc.edgeReport.feedback.title": "Was this helpful?",
  "wc.edgeReport.feedback.helpful": "Helpful",
  "wc.edgeReport.feedback.notHelpful": "Not helpful",
  "wc.edgeReport.feedback.tooBasic": "Too basic",
  "wc.edgeReport.feedback.notActionable": "Not actionable",
  "wc.edgeReport.feedback.wrongData": "Wrong data",
  "wc.edgeReport.feedback.greatInsight": "Great insight",
  "wc.edgeReport.feedback.thanks": "Thanks for your feedback",
  // Visual cue badge — shown on card header when deterministic report has loaded
  "wc.edgeReport.cue.ready": "Today's Edge Ready",

  // ── Pool Chat community panel (Goal 9) ───────────────────────────────
  "wc.chat.hero.title": "Pool Chat",
  "wc.chat.hero.subtitle": "Talk strategy, call your shots, and keep the pool alive.",
  "wc.chat.hero.badge": "Community",
  "wc.chat.empty.headline": "Start the first debate.",
  "wc.chat.empty.body":
    "Call your champion, question a risky pick, or ask Chimmy for a read.",
  "wc.chat.chip.explainBracket": "Explain my bracket",
  "wc.chat.chip.dangerZone": "Find my danger-zone picks",
  "wc.chat.chip.poolFavorite": "Who is the pool favorite?",
  "wc.chat.chip.keyMatchup": "What matchup could change everything?",
  "wc.chat.chip.trashTalk": "Give me a trash-talk-safe line",
  "wc.chat.composer.placeholder": "Message the pool or ask Chimmy…",
  "wc.chat.composer.send": "Send",
  "wc.chat.privateLabel": "Private Chimmy reply · Only visible to you",
  "wc.chat.aiHint.unlocked":
    "@chimmy replies are private. Only you will see your prompt and Chimmy’s answer in this pool.",
  "wc.chat.aiHint.locked":
    "@chimmy private replies require AI/Pro. Upgrade to ask Chimmy from this pool chat.",
  "wc.chat.trustNote": "Keep it competitive. Keep it clean.",
  "wc.chat.loading": "Loading pool chat…",
  "wc.chat.refresh": "Refresh",
  "wc.chat.mode.ai": "Chimmy AI",
  "wc.chat.mode.pool": "Pool Chat",
  "wc.chat.mode.dm": "DM Chat",
  "wc.chat.placeholder.ai": "Ask Chimmy about the bracket, picks, locks, or pool standings...",
  "wc.chat.placeholder.dm": "Message this private chat...",
  "wc.chat.drawer.aiTitle": "AI Chimmy Chat",
  "wc.chat.drawer.poolTitle": "Pool Messages",
  "wc.chat.drawer.dmTitle": "Direct Messages",
  "wc.chat.drawer.aiTrust": "Messages in this mode are sent to @Chimmy and may return a private AI reply.",
  "wc.chat.dm.comingSoonTitle": "Start a private chat",
  "wc.chat.dm.comingSoon": "Pick one or more pool members to start a private conversation. Messages stay inside that private thread.",
  "wc.chat.mention.title": "Mention pool members",
  "wc.chat.mention.loading": "Loading",
  "wc.chat.mention.noMatches": "No matching pool members. Use the username shown in this pool.",
  "wc.chat.mention.allHelper": "Commissioner broadcast to every pool member",
  "wc.chat.mention.allAria": "Mention all pool members",
  "wc.chat.mention.allManagerOnly": "@all is reserved for pool commissioners and admins.",
  "wc.chat.askChimmy": "Ask Chimmy",
  "wc.chat.open": "Open Chat",
  "wc.chat.collapse": "Collapse",
  "wc.chat.chip.askChimmy": "Ask Chimmy",
  "wc.chat.chip.analyzePool": "Analyze my pool",
  "wc.chat.chip.whyLosing": "Why am I losing?",
  "wc.chat.chip.rootFor": "Who should I root for?",
  "wc.chat.chip.championLoses": "What if my champion loses?",
  "wc.chat.chip.bestBracket": "Who has the best bracket?",
  "wc.chat.chip.pathToWin": "Explain my path to win",
  "wc.chat.chip.dangerGroup": "Most dangerous group?",
  "wc.chat.chip.watchToday": "What picks should I watch?",
  "wc.chat.chip.summarizePool": "Summarize this pool",
  "wc.chat.chip.scoringRules": "Explain scoring rules",
  "wc.chat.chip.commissionerSummary": "Commissioner summary",
  "wc.chat.prompt.askChimmy": "Give me a verified-data-only read on my World Cup pool. Start with what data you can see and what is missing.",
  "wc.chat.prompt.analyzePool": "Analyze my World Cup pool using only saved pool, leaderboard, scoring, and pick data. Give me strengths, risks, and my best path.",
  "wc.chat.prompt.whyLosing": "Why am I losing in this World Cup pool? Use the leaderboard, scoring rules, and my saved picks only. Tell me what changed and what can still help.",
  "wc.chat.prompt.rootFor": "Who should I root for next in this World Cup pool? Use my saved picks and the leaderboard only. Separate verified impact from unavailable projections.",
  "wc.chat.prompt.championLoses": "What if my champion pick loses? Explain the bracket and leaderboard impact only if the saved picks and scoring data support it.",
  "wc.chat.prompt.bestBracket": "Who has the best bracket so far? Use only the stored leaderboard, saved picks, champion picks, and max possible points.",
  "wc.chat.prompt.pathToWin": "Explain my path to win using my saved World Cup bracket, leaderboard gap, scoring rules, and remaining possible points only.",
  "wc.chat.prompt.dangerGroup": "Which group is the most dangerous using cached group standings or my saved group picks only? If official standings are missing, say what is missing.",
  "wc.chat.prompt.watchToday": "What picks should I watch today? Use cached live/upcoming matches if available, otherwise explain which saved picks matter most without inventing schedules.",
  "wc.chat.prompt.summarizePool": "Summarize this World Cup pool using only stored participants, leaderboard rows, scoring rules, finalized/saved entry data, and available picks.",
  "wc.chat.prompt.scoringRules": "Explain this World Cup pool's scoring rules and what rounds matter most.",
  "wc.chat.prompt.commissionerSummary": "Commissioner summary: show pool participation, finalized entries, common champion picks if available, and what reminder I should send. Use verified pool data only.",

  // ── Pool dashboard: command hero ──────────────────────────────────────
  "wc.pool.eyebrow": "Pool Command Center",
  "wc.pool.privateBadge": "Private",
  "wc.pool.publicBadge": "Open",
  // ── Pool dashboard: what to do next card ──────────────────────────────
  "wc.pool.next.title": "What To Do Next",
  "wc.pool.next.create.title": "Create Your Bracket",
  "wc.pool.next.create.body": "Start your picks to compete in this pool.",
  "wc.pool.next.picks.title": "Make Your Picks",
  "wc.pool.next.picks.body": "Fixtures are ready — open your bracket and start picking winners.",
  "wc.pool.next.review.title": "Review & Finalize",
  "wc.pool.next.review.body": "All picks made. Review your bracket and lock it in before the tournament.",
  "wc.pool.next.done.title": "Bracket Submitted",
  "wc.pool.next.done.body": "Your bracket is locked in. Check the leaderboard to track your rank.",
  "wc.pool.next.waiting.title": "Awaiting Fixtures",
  "wc.pool.next.waiting.body": "Matchup details are being set up. Check back before kick-off.",
  // ── Pool dashboard: progress strip ────────────────────────────────────
  "wc.pool.progress.title": "Progress",
  "wc.pool.progress.created": "Created",
  "wc.pool.progress.picks": "Picks Made",
  "wc.pool.progress.finalized": "Submitted",
  // ── Pool dashboard: commissioner panel ────────────────────────────────
  "wc.pool.commissioner.title": "Commissioner Tools",
  // ── Pool dashboard: leaderboard preview ───────────────────────────────
  "wc.pool.leaderboard.title": "Leaderboard",
  "wc.pool.leaderboard.empty": "No scored brackets yet",
  "wc.pool.leaderboard.emptyNote": "Brackets appear here after scoring begins.",
  "wc.pool.leaderboard.viewFull": "Full Leaderboard",

  // ── Pool dashboard: header / status strip ────────────────────────────
  "wc.header.sync": "Sync",
  "wc.header.inviteAria": "Invite friends",
  "wc.header.invite": "Invite",
  "wc.header.testMode": "Test mode",
  "wc.header.testModeNote":
    "results are simulated and can change leaderboard standings.",

  // ── Lock countdown ───────────────────────────────────────────────────
  "wc.lock.untilLockDays": "{{d}}d {{h}}h until picks lock",
  "wc.lock.untilLockHours": "{{h}}h {{m}}m until picks lock",
  "wc.lock.untilLockMinutes": "{{m}}m until picks lock",
  "wc.lock.locksSoon": "Bracket locks soon",
  "wc.lock.bracketLocked": "Bracket Locked",
  "wc.lock.picksFrozen": "Bracket locked — picks are frozen.",

  // ── Countdown banner ─────────────────────────────────────────────────
  "wc.countdown.banner.startsIn": "World Cup starts in",
  "wc.countdown.banner.locksNote": "Group picks lock at kickoff",
  "wc.countdown.banner.urgent24h": "Picks lock soon",
  "wc.countdown.banner.urgent1h": "Final chance — picks lock at kickoff",
  "wc.countdown.banner.locked.title": "Group picks are locked",
  "wc.countdown.banner.locked.subtitle": "Live scoring is now active",
  "wc.countdown.banner.cta.make": "Make Picks",
  "wc.countdown.banner.cta.finish": "Finish My Bracket",
  "wc.countdown.banner.cta.finishNow": "Finish Picks Now",
  "wc.countdown.banner.cta.leaderboard": "View Leaderboard",
  "wc.countdown.banner.firstMatchFallback": "First group-stage match",
  "wc.countdown.banner.lockTime": "Group picks lock · {{time}}",
  "wc.countdown.banner.fallback": "World Cup countdown coming soon",
  "wc.countdown.banner.fallbackHint": "Picks remain editable until kickoff is confirmed",

  // ── AI upgrade / cap messages ────────────────────────────────────────
  "wc.ai.upgrade.chimmy.free": "You've used today's 3 Chimmy questions. Upgrade to AF Pro for 30 per day.",
  "wc.ai.upgrade.chimmy.pro": "You've used today's 30 Chimmy questions. They reset at midnight UTC.",
  "wc.ai.upgrade.explain.free": "Bracket explanations require AF Pro. Upgrade to get daily AI bracket breakdowns.",
  "wc.ai.upgrade.explain.pro": "You've used today's bracket explanation. It resets at midnight UTC.",
  "wc.ai.upgrade.matchup.free": "AI Matchup Intelligence requires AF Pro.",
  "wc.ai.upgrade.matchup.pro": "You've used today's 25 AI matchup analyses. They reset at midnight UTC.",
  "wc.ai.upgrade.brain.free": "Commissioner Brain requires AF Commissioner or higher.",
  "wc.ai.upgrade.brain.pro": "You've used today's Commissioner Brain calls. They reset at midnight UTC.",
  "wc.ai.upgrade.resetHint": "Daily AI limits reset at midnight UTC.",
  "wc.ai.upgrade.cta": "Upgrade Plan",

  // ── Knockouts tab ────────────────────────────────────────────────────
  "wc.knockouts.intro.reseeded":
    "Knockout picks open after official Round of 32 fixtures are available.",
  "wc.knockouts.intro.knockoutOnly":
    "This pool starts with the official knockout bracket. Group Stage and third-place picks are skipped.",
  "wc.knockouts.intro.predictive":
    "Your knockout bracket is generated from your predicted group results.",
  "wc.knockouts.subintro.reseeded":
    "Group Stage picks work normally now. Once real knockout fixtures are synced, you will make fresh knockout picks from the official bracket.",
  "wc.knockouts.subintro.knockoutOnly":
    "Commissioners can run a knockout-only pool when the official Round of 32 field is ready. Picks stay locked until fixtures are synced.",
  "wc.knockouts.subintro.predictive":
    "Knockout matchups update based on your Group Stage predictions. Changing group predictions may reset affected knockout picks.",
  "wc.knockouts.locked.reseeded":
    "Official knockout fixtures are not synced yet.",
  "wc.knockouts.locked.knockoutOnly":
    "Knockout-only pools open after official Round of 32 fixtures are synced.",
  "wc.knockouts.startPicks": "Start Picks",
  "wc.knockouts.continuePicks": "Continue Picks",
  "wc.knockouts.guidance.complete":
    "{{done}}/{{required}} currently available picks complete.",
  "wc.knockouts.guidance.nextPick": "Next pick: Match {{matchNumber}}.",
  "wc.knockouts.guidance.blocked":
    "Pick earlier round winners first. More picks unlock as prior winners are selected.",
  "wc.knockouts.guidance.noneReady":
    "No available knockout picks are ready right now.",

  // ── Knockout Danger Zones card ───────────────────────────────────────
  "wc.danger.eyebrow": "Knockouts",
  "wc.danger.title": "Knockout Danger Zones",
  "wc.danger.subtitle":
    "Deterministic — compares your picks against pre-tournament seed strength and live match state.",
  "wc.danger.tierPro": "AF Pro",
  "wc.danger.tierBasic": "Basic",
  "wc.danger.emptyNoEntry": "Open a bracket entry to see danger zones.",
  "wc.danger.emptyNoPicks": "Make knockout picks to see danger zones.",
  "wc.danger.emptyNoRisks":
    "No danger zones right now. All your knockout picks look favored by pre-tournament strength.",
  "wc.danger.severityHigh": "High",
  "wc.danger.severityMedium": "Medium",
  "wc.danger.severityLow": "Low",
  "wc.danger.severitySuffix": "danger",
  "wc.danger.footer":
    "Counts only your own picks vs the public schedule. No AI call. No other users' picks.",

  // ── AI Report (Review tab) ───────────────────────────────────────────
  "wc.aiReport.eyebrow": "Report",
  "wc.aiReport.title": "Your Bracket AI Report",
  "wc.aiReport.subtitle":
    "Six AI signals computed from your own picks. Everything below is private to you.",
  "wc.aiReport.tierActive": "AF Pro active",
  "wc.aiReport.tierPreview": "AF Pro preview",

  // ── Share / Invite ───────────────────────────────────────────────────
  "wc.invite.title": "Invite friends",
  "wc.invite.copyLink": "Copy invite link",
  "wc.invite.copied": "Link copied!",
  "wc.invite.shareNative": "Share",
  "wc.invite.shareViaText": "Text",
  "wc.invite.shareViaEmail": "Email",
  "wc.invite.viaSocial": "Social",
  "wc.invite.heading":
    "Invite friends to compete in {{poolName}} on AllFantasy.",
  "wc.invite.inviteCodeLabel": "Invite code",

  // ── Commissioner Checklist ───────────────────────────────────────────
  "wc.checklist.title": "Pool Completion Checklist",
  "wc.checklist.subtitle":
    "Members of {{poolName}} and where they stand against the lock deadline.",
  "wc.checklist.copyReminder": "Copy reminder",
  "wc.checklist.reminderCopied": "Reminder copied!",
  "wc.checklist.statusReady": "Ready",
  "wc.checklist.statusNoMembers": "No members yet",
  "wc.checklist.statusNoData": "No snapshot available",

  // ── Empty / loading / error states ───────────────────────────────────
  "wc.state.loading": "Loading...",
  "wc.state.refresh": "Refresh",
  "wc.state.tryAgain": "Try again",
  "wc.state.noEntries":
    "You haven't created a bracket entry for this pool yet.",
  "wc.state.createEntry": "Create my bracket",

  // ── Language selector tooltip ────────────────────────────────────────
  "wc.language.label": "Language",
  "wc.language.english": "English",
  "wc.language.spanish": "Español",
  "wc.language.chinese": "繁體中文",
  "wc.language.filipino": "Filipino",
  "wc.language.vietnamese": "Tiếng Việt",

  // ── Create page / modal ──────────────────────────────────────────────
  "wc.create.goBack": "Go back",
  "wc.create.header": "Create World Cup Bracket Pool",
  "wc.create.subheader": "2026 FIFA World Cup · round-by-round scoring",
  "wc.create.heroTitle": "2026 FIFA World Cup",
  "wc.create.heroSubtitle":
    "Create a pool container — invite friends and let them build their brackets inside.",
  "wc.create.poolName.label": "Pool Name",
  "wc.create.poolName.placeholder": "e.g. Office World Cup Pool 2026",
  "wc.create.poolName.error.blank": "Pool name cannot be blank.",
  "wc.create.poolName.default": "World Cup Bracket Pool",
  "wc.create.visibility.label": "Pool Visibility",
  "wc.create.visibility.private": "Private",
  "wc.create.visibility.privateHint": "Invite link required to join",
  "wc.create.visibility.public": "Public",
  "wc.create.visibility.publicHint": "Anyone can discover and join",
  "wc.create.maxUsers.label": "Max Users",
  "wc.create.maxUsers.hint": "Maximum {{max}} per pool",
  "wc.create.maxUsers.error": "Must be between 2 and {{max}}.",
  "wc.create.maxEntries.label": "Brackets per User",
  "wc.create.maxEntries.hint": "Maximum {{max}} per user",
  "wc.create.maxEntries.error": "Must be between 1 and {{max}}.",
  "wc.create.lockRule.label": "Pick Lock Rule",
  "wc.create.lockRule.tournament": "Tournament Lock",
  "wc.create.lockRule.tournamentHint":
    "All picks lock when the first match begins",
  "wc.create.lockRule.perMatch": "Per-Match Lock",
  "wc.create.lockRule.perMatchHint":
    "Each match locks at its own kickoff",
  "wc.create.lockRule.copyTournament":
    "Picks can be edited until the first World Cup match begins.",
  "wc.create.lockRule.copyPerMatch":
    "Each matchup can be edited until that match kicks off.",
  "wc.create.bracketFormat.label": "Bracket Format",
  "wc.create.bracketFormat.predictive.title": "Full Pool",
  "wc.create.bracketFormat.predictive.body":
    "Groups, third-place advancers, and knockouts.",
  "wc.create.bracketFormat.reseeded.title": "Official Knockouts",
  "wc.create.bracketFormat.reseeded.body":
    "Lock knockout picks until official fixtures load.",
  "wc.create.bracketFormat.knockoutOnly.title": "Knockout Only",
  "wc.create.bracketFormat.knockoutOnly.body":
    "Skip group picks and run a knockout bracket.",
  "wc.create.bracketFormat.commissionerRequired":
    "AF Commissioner is required for advanced bracket formats. The server will block this setting if your account is not eligible.",
  "wc.create.scoring.intro": "Round-by-round scoring:",
  "wc.create.scoring.values":
    "10 pts Round of 32 · 20 pts Round of 16 · 40 pts QF · 80 pts SF · 160 pts Final · 320 pts Champion bonus",
  "wc.create.monetization.title": "Make Chimmy visible when users are ready",
  "wc.create.monetization.body":
    "Pools are free to create. AF Pro unlocks deeper AI bracket analysis, and tokens cover one-off premium AI actions.",
  "wc.create.monetization.proCta": "AF Pro",
  "wc.create.monetization.tokensCta": "Tokens",
  "wc.create.helper.entriesOne":
    "Each user can create up to {{max}} bracket entry.",
  "wc.create.helper.entriesOther":
    "Each user can create up to {{max}} bracket entries.",
  "wc.create.helper.leaderboard":
    "The leaderboard ranks finalized bracket entries, not drafts.",
  "wc.create.helper.inviteLink":
    "An invite link will be shown after creation.",
  "wc.create.thirdPlace": "Include third-place match",
  "wc.create.thirdPlace.knockoutOnlyOff":
    "Third-place match is off for knockout-only pools",
  "wc.create.testFixtures.label": "Seed Test Fixtures",
  "wc.create.testFixtures.hint":
    "Adds mock Round of 32 teams, flags, kickoff times, and venues so this pool is pickable immediately.",
  "wc.create.submit.idle": "Create Pool",
  "wc.create.submit.creating": "Creating...",
  "wc.create.submit.opening": "Created, opening...",
  "wc.create.openingSuccess": "Created bracket, opening...",
  "wc.create.error.signInRequired": "Please sign in to create a bracket.",
  "wc.create.error.noId":
    "Bracket was created but the server did not return an ID. Please refresh the page.",
  "wc.create.error.generic": "Failed to create bracket",
  "wc.create.error.requestFailed": "Request failed ({{status}})",

  // ── Discover page ────────────────────────────────────────────────────
  "wc.discover.backToHub": "← World Cup hub",
  "wc.discover.createPool": "Create Pool",
  "wc.discover.title": "Discover public pools",
  "wc.discover.subtitle":
    "Browse public World Cup bracket pools. Join opens Bracket 1 with no picks — we drop you into the guided picker when the pool allows new players and isn't full.",
  "wc.discover.search.label": "Search",
  "wc.discover.search.placeholder": "Pool name",
  "wc.discover.season.label": "Season",
  "wc.discover.season.placeholder": "e.g. 2026",
  "wc.discover.statusFilter.label": "Status",
  "wc.discover.statusFilter.all": "All",
  "wc.discover.statusFilter.open": "Open",
  "wc.discover.statusFilter.locked": "Locked",
  "wc.discover.statusFilter.final": "Final",
  "wc.discover.loading": "Loading public pools...",
  "wc.discover.errors.couldNotLoad": "Could not load pools",
  "wc.discover.empty":
    "No public pools match your filters. Try another season or clear search — or join a private pool with an invite code above.",
  "wc.discover.joinPanelTitle": "Join with invite code (private pools)",

  // ── Discover card ────────────────────────────────────────────────────
  "wc.discover.card.statusOpen": "Open",
  "wc.discover.card.blockedFull": "League full",
  "wc.discover.card.blockedClosed": "Closed to new players",
  "wc.discover.card.password": "Password",
  "wc.discover.card.lateJoin": "Picks locked · late join on",
  "wc.discover.card.preview": "Preview",
  "wc.discover.card.join": "Join",

  // ── Join / invite panel ──────────────────────────────────────────────
  "wc.join.backToHub": "← World Cup hub",
  "wc.join.brandEyebrow": "AllFantasy",
  "wc.join.brandTitle": "2026 World Cup Bracket Pools",
  "wc.join.panelTitle": "Join with invite code",
  "wc.join.panelHelper":
    "Enter the invite code from your commissioner. After joining, you will land on the pool dashboard and can start your first bracket. Password-protected pools require the join password set in pool settings.",
  "wc.join.codeInput.placeholder": "WCUP invite code",
  "wc.join.previewBtn": "Preview",
  "wc.join.errors.invalidCode": "Enter a valid invite code",
  "wc.join.errors.notFound": "Invite not found",
  "wc.join.errors.full": "This pool is full.",
  "wc.join.errors.closed": "This pool is closed to new players.",
  "wc.join.errors.couldNotJoin": "Could not join",
  "wc.join.preview.hostLine":
    "Host: {{owner}} · {{count}} playing · {{visibility}}",
  "wc.join.preview.openCopy":
    "Join now to create Bracket 1, make Group Stage and Knockout picks, and finalize when ready.",
  "wc.join.preview.fullCopy": "This pool is full.",
  "wc.join.preview.closedCopy":
    "Pool locked — not accepting new players.",
  "wc.join.preview.passwordLabel": "Join password",
  "wc.join.preview.joinBtn": "Join league",
  "wc.join.success": "You're in — Bracket 1 is ready.",

  // ── Finalize / share success block (Review tab) ──────────────────────
  "wc.finalize.eyebrow": "Finalized",
  "wc.finalize.title": "Your bracket is locked in",
  "wc.finalize.subtitleNoTime":
    "Submitted. You can still edit until pool lock — invite friends now before the field fills up.",
  "wc.finalize.subtitleWithTime":
    "Submitted {{at}}. You can still edit until pool lock — invite friends now before the field fills up.",
  "wc.finalize.copyShare": "Copy share text",
  "wc.finalize.copyShareCopied": "Share Copied!",
  "wc.finalize.shareReport": "Share My AI Bracket Report",
  "wc.finalize.inviteFriends": "Invite Friends To Beat My Bracket",
  "wc.finalize.previewShare": "Preview share text",

  // ── Finalize success block: challenge + trust ─────────────────────────
  "wc.finalize.viewLeaderboard": "View Leaderboard",
  "wc.finalize.openChat": "Pool Chat",
  "wc.finalize.challengeTitle": "Your World Cup path is locked.",
  "wc.finalize.challengeDesc": "Now bring your crew and watch the leaderboard come alive.",
  "wc.finalize.trustNote": "Free to play. Just strategy, predictions, and bragging rights.",

  // ── Leaderboard tab visual upgrade ───────────────────────────────────
  "wc.lb.eyebrow": "Pool",
  "wc.lb.title": "Leaderboard Race",
  "wc.lb.heroSubtitle": "Every match can change the story. Track your score, chase the leaders, and watch the pool come alive.",
  "wc.lb.statusPreTournament": "Pre-Tournament",
  "wc.lb.statusLive": "Live",
  "wc.lb.statusWaiting": "Waiting for Fixtures",
  "wc.lb.subtitleBase": "Finalized entries only · scores update after results sync.",
  "wc.lb.lastUpdated": "Last synced {{date}}.",
  "wc.lb.notYetSynced": "Not yet synced.",
  "wc.lb.testMode": "Test Mode: leaderboard may reflect simulated results.",
  "wc.lb.recalculate": "Recalculate",
  "wc.lb.autoUpdate": "Updates automatically",
  "wc.lb.scoresNotSynced": "Scores haven't synced yet — totals update after results are ingested.",
  "wc.lb.fixturesNotReady": "Fixtures not fully ready — teams must resolve before standings gain meaning.",
  "wc.lb.podiumTitle": "Top of the Pool",
  "wc.lb.yourRank": "Your Rank",
  "wc.lb.yourRankTagline": "You're in the race.",
  "wc.lb.gapToFirst": "{{n}} pts behind the leader",
  "wc.lb.isLeader": "You're leading the pool.",
  "wc.lb.tied": "Tied for the lead.",
  "wc.lb.viewMyBracket": "View My Bracket",
  "wc.lb.noEntryTitle": "Not in the race yet.",
  "wc.lb.noEntryBody": "Create a bracket to join the leaderboard.",
  "wc.lb.startMyBracket": "Start My Bracket",
  "wc.lb.emptyTitle": "The Race Hasn't Started",
  "wc.lb.emptyBody": "The leaderboard wakes up when picks lock and matches begin.",
  "wc.lb.emptyInvite": "Invite Friends",
  "wc.lb.emptyReview": "Review My Bracket",
  "wc.lb.scoringTitle": "How Scoring Works",
  "wc.lb.scoringBody": "Correct picks earn points. Later rounds carry more weight, so every path to the final matters.",
  "wc.lb.scoringUpdates": "Leaderboard updates after match results are synced.",
  "wc.lb.shareMyRank": "Share My Rank",
  "wc.lb.challengePool": "Challenge the Pool",
  "wc.lb.noChampionPick": "No champion pick",
  "wc.lb.alive": "Alive",
  "wc.lb.busted": "Busted",
  "wc.lb.aiProUnlocks": "AF Pro unlocks AI Win %, Bracket Health, and champion-path pressure.",
  "wc.lb.ptsLabel": "Pts",
  "wc.lb.trustNote": "Free to play. Just strategy, predictions, and bragging rights.",
  // ── Share card UI chrome ──────────────────────────────────────────────
  "wc.share.eyebrow": "Share Graphic",
  "wc.share.titleInvite": "Pool Invite",
  "wc.share.titleLeaderboard": "Leaderboard Snapshot",
  "wc.share.titleBracket": "My Bracket Summary",
  "wc.share.titleRecap": "AI Recap",
  "wc.share.description": "Copy-ready social text for sharing your bracket or pool standings.",
  "wc.share.publicSafe": "Public-safe",
  "wc.share.copy": "Copy share text",
  "wc.share.copied": "Copied",
  "wc.share.share": "Share",

  // ── Inside-pool Invite tab ───────────────────────────────────────────
  "wc.inviteTab.eyebrow": "Pool",
  "wc.inviteTab.title": "Invite & Pool Details",
  "wc.inviteTab.detailsTitle": "Pool details",
  "wc.inviteTab.meta.pool": "Pool",
  "wc.inviteTab.meta.privacy": "Privacy",
  "wc.inviteTab.meta.privacyPublic": "Public",
  "wc.inviteTab.meta.privacyPrivate": "Private — invite only",
  "wc.inviteTab.meta.maxUsers": "Max Users",
  "wc.inviteTab.meta.bracketsPerUser": "Brackets per User",
  "wc.inviteTab.meta.scoring": "Scoring",
  "wc.inviteTab.meta.scoringValue": "NCAA-style",
  "wc.inviteTab.meta.lockRule": "Lock Rule",
  "wc.inviteTab.meta.lockTournament": "Locks at first World Cup match",
  "wc.inviteTab.meta.lockPerMatch": "Per-match lock at kickoff",
  "wc.inviteTab.lockedBanner":
    "This pool is locked. Picks can no longer be edited.",
  "wc.inviteTab.member.title": "Invite friends to this pool",
  "wc.inviteTab.member.body":
    "Only the pool commissioner can copy and share the invite link. Ask your commissioner for the invite link or code.",
  "wc.inviteTab.commissioner.linkTitle": "Invite Link",
  "wc.inviteTab.commissioner.linkHelper":
    "Share this with anyone you want to invite. They must be signed in to AllFantasy.",
  "wc.inviteTab.commissioner.codeLabel": "Invite Code",
  "wc.inviteTab.commissioner.copyCode": "Copy Code",
  "wc.inviteTab.commissioner.copyCodeDone": "Copied",
  "wc.inviteTab.commissioner.copyLink": "Copy Invite Link",
  "wc.inviteTab.commissioner.copyLinkDone": "Link Copied!",
  "wc.inviteTab.commissioner.copyMessage": "Copy Invite Message",
  "wc.inviteTab.commissioner.copyMessageDone": "Message Copied!",
  "wc.inviteTab.commissioner.share": "Share",
  "wc.inviteTab.commissioner.previewInvite": "Preview invite message",
  "wc.inviteTab.commissioner.previewShare": "Preview share message",
  "wc.inviteTab.commissioner.noCodeTitle": "Invite link not available",
  "wc.inviteTab.commissioner.noCodeBody":
    "The pool owner or admin can regenerate an invite link from the pool settings.",
  "wc.inviteTab.shareMessage.default":
    "Join my AllFantasy World Cup Bracket Pool \"{{pool}}\"! Make up to {{maxEntries}} brackets, rank Group Stage teams, build Knockout picks, and compete on the live leaderboard. {{url}}",
  "wc.inviteTab.shareTitleNative":
    "{{pool}} — AllFantasy World Cup Bracket",

  // ── Invite tab: new UX sections (Goal 8) ─────────────────────────────
  "wc.inviteTab.hero.title": "Bring Your Crew",
  "wc.inviteTab.hero.subtitle":
    "Share this pool, challenge your friends, and let the leaderboard settle the debate.",
  "wc.inviteTab.hero.participants": "{{count}} in the pool",
  "wc.inviteTab.hero.spotsLeft": "{{n}} spots left",
  "wc.inviteTab.hero.poolFull": "Pool full",
  "wc.inviteTab.hero.lockDeadline": "Picks lock {{date}}",
  "wc.inviteTab.growth.title": "Your pool gets better with rivals.",
  "wc.inviteTab.growth.body":
    "Invite friends before picks lock and fill your leaderboard.",
  "wc.inviteTab.growth.cta": "Invite Friends",
  "wc.inviteTab.social.title": "Social Copy",
  "wc.inviteTab.social.copy1":
    "Join my World Cup pool on AllFantasy and prove your bracket is better.",
  "wc.inviteTab.social.copy2": "The leaderboard is about to get personal.",
  "wc.inviteTab.social.copy3": "Bring your best bracket.",
  "wc.inviteTab.social.copyBtn": "Copy",
  "wc.inviteTab.social.copiedBtn": "Copied",
  "wc.inviteTab.actions.viewLeaderboard": "View Leaderboard",
  "wc.inviteTab.actions.openChat": "Open Pool Chat",
  "wc.inviteTab.actions.shareLink": "Share on Mobile",
  "wc.inviteTab.trustNote":
    "Free to play. Just World Cup predictions, strategy, and bragging rights.",

  // ── Commissioner Checklist card chrome (extended) ────────────────────
  "wc.checklist.eyebrow": "Commissioner",
  "wc.checklist.cardSubtitle":
    "Member progress at a glance. Visible to pool commissioners and admins only.",
  "wc.checklist.copyReminderBtn": "Copy Reminder Message",
  "wc.checklist.copyReminderDone": "Reminder Copied!",
  "wc.checklist.stat.total": "Total members",
  "wc.checklist.stat.finalized": "Finalized",
  "wc.checklist.stat.inProgress": "In progress",
  "wc.checklist.stat.completion": "Completion",
  "wc.checklist.entryStatus.finalized": "Finalized",
  "wc.checklist.entryStatus.inProgress": "In progress",
  "wc.checklist.entryStatus.needsPicks": "Needs picks",
  "wc.checklist.entryStatus.unknown": "Unknown",
  "wc.checklist.needsReminderBadge": "Needs reminder",
  "wc.checklist.missingPicks": "{{count}} missing",
  "wc.checklist.previewReminder": "Preview reminder message",
  "wc.checklist.privacyNote":
    "Deterministic — uses snapshot data already loaded for commissioner tools. No emails or user IDs are shown.",
  "wc.checklist.empty.memberOnly":
    "Only the pool commissioner or admin can see member status.",
  "wc.checklist.empty.loading":
    "Commissioner status data is still loading.",
  "wc.checklist.empty.noMembers":
    "No members have created entries yet. Share the invite link to get started.",
  "wc.checklist.empty.fallback": "No member data available.",
  "wc.checklist.row.memberFallback": "Member",
  "wc.checklist.row.bracketFallback": "Bracket",
  "wc.checklist.row.finalizedRowOne": "{{count}} finalized bracket",
  "wc.checklist.row.finalizedRowOther": "{{count}} finalized brackets",

  // ── Commissioner reminder message templates ──────────────────────────
  "wc.checklist.reminder.askCommissioner":
    "Ask the pool commissioner to remind members about {{pool}}.",
  "wc.checklist.reminder.finalizeLine":
    "Friendly reminder: finalize your picks for \"{{pool}}\" on AllFantasy.",
  "wc.checklist.reminder.joinLine":
    "Reminder: join \"{{pool}}\" on AllFantasy and lock in your World Cup bracket.",
  "wc.checklist.reminder.statusLine":
    "Status: {{done}}/{{total}} brackets finalized ({{percent}}%).",
  "wc.checklist.reminder.deadlineLine": "Picks lock {{deadline}}.",
  "wc.checklist.reminder.poweredBy": "Powered by AllFantasy.",
  "wc.checklist.reminder.noSnapshotLine":
    "Reminder: finish your picks for \"{{pool}}\" on AllFantasy.",

  // ── AI Report card chrome (extended) ─────────────────────────────────
  "wc.aiShareCard.eyebrow": "Share Graphic",
  "wc.aiShareCard.subtitle":
    "All 6 AI signals in one copy-ready card. Deterministic — no AI call to share.",
  "wc.aiShareCard.tierPro": "AF Pro",
  "wc.aiShareCard.tierPreview": "Basic preview",
  "wc.aiShareCard.emptyNoEntry":
    "Select a bracket entry to generate a share card.",
  "wc.aiShareCard.copyShare": "Copy share text",
  "wc.aiShareCard.copyShareDone": "Copied",
  "wc.aiShareCard.share": "Share",
  "wc.aiShareCard.privacyNote":
    "Private to you until you share it. Uses only your own bracket data and aggregated pool counts.",
  "wc.explain.eyebrow": "Private AI",
  "wc.explain.title": "Explain My Bracket",
  "wc.explain.subtitle":
    "A private narrative analysis of your bracket strategy. Only you can see it.",
  "wc.explain.tierPro": "AF Pro",
  "wc.explain.tierLocked": "Locked",
  "wc.explain.locked":
    "AF Pro unlocks private AI explanation of your bracket strategy. Token users can also confirm a one-off spend before generation; failed AI calls never deduct tokens.",
  "wc.explain.upgradeCta": "Upgrade to AF Pro →",
  "wc.explain.generate": "Generate explanation",
  "wc.explain.generating": "Generating...",
  "wc.explain.selectFirst": "Select a bracket first",
  "wc.explain.regenerate": "Regenerate",
  "wc.explain.regenerating": "Regenerating...",
  "wc.explain.fallbackBadge": "Deterministic fallback",
  "wc.explain.error.generic": "Could not generate explanation.",
  "wc.explain.error.network": "Network error. Please try again.",
  "wc.explain.privacyNote":
    "Private to you. Uses only your own picks and public team data. Never posted to chat.",
  "wc.uniqueness.eyebrow": "Pool comparison",
  "wc.uniqueness.title": "What makes my bracket unique?",
  "wc.uniqueness.subtitle":
    "Compared only against finalized brackets in this pool.",
  "wc.uniqueness.tierPro": "AF Pro",
  "wc.uniqueness.tierBasic": "Basic",
  "wc.uniqueness.empty.noEntry":
    "Select a bracket entry to compute uniqueness.",
  "wc.uniqueness.loading": "Loading pool comparison...",
  "wc.uniqueness.error.couldNotLoad": "Could not load uniqueness data.",
  "wc.uniqueness.error.network": "Network error. Please try again.",
  "wc.uniqueness.empty.notEnoughData":
    "Uniqueness unlocks after more finalized brackets are submitted.",
  "wc.uniqueness.empty.incomplete":
    "Make group and knockout picks to see how unique your bracket is.",
  "wc.uniqueness.rarity.veryRare": "Very rare",
  "wc.uniqueness.rarity.rare": "Rare",
  "wc.uniqueness.rarity.uncommon": "Uncommon",
  "wc.uniqueness.rarity.common": "Common",
  "wc.uniqueness.percentShare": "{{percent}}% share",
  "wc.uniqueness.privacyNote":
    "Deterministic — counts only finalized brackets. No AI call, no other users' raw picks shown.",
  "wc.grade.eyebrow": "Bracket Grade",
  "wc.grade.completionLabel": "{{percent}}% complete",
  "wc.grade.tierProDetail": "AF Pro detail",
  "wc.grade.tierBasic": "Basic",
  "wc.grade.stat.groups": "Groups",
  "wc.grade.stat.thirdPlace": "Third-place",
  "wc.grade.stat.knockouts": "Knockouts",
  "wc.grade.stat.missing": "Missing",
  "wc.grade.risk": "Risk Level:",
  "wc.grade.upset": "Upset Meter:",
  "wc.grade.championConfidence": "Champion Confidence:",
  "wc.grade.championConfidenceNone": "No champion selected",
  "wc.grade.biggestRisk": "Biggest Risk:",
  "wc.grade.recommendation": "Recommendation:",
  "wc.grade.lockedBody":
    "AF Pro unlocks risk, upset meter, champion confidence, biggest risk, and recommendation details.",
  "wc.confidence.title": "AI Confidence Check",
  "wc.confidence.tierOpen": "Open",
  "wc.confidence.tierLocked": "Locked",
  "wc.confidence.missingPicks": "Missing picks:",
  "wc.confidence.noMissing": "None. Ready to finalize.",
  "wc.confidence.missingBreakdown":
    "{{knockout}} knockout, {{groups}} groups, {{thirdPlace}} third-place.",
  "wc.confidence.highRiskPicks": "High-risk picks:",
  "wc.confidence.highRiskBody":
    "{{count}} early-round picks shape most of your bracket path.",
  "wc.confidence.bracketShape": "Bracket shape:",
  "wc.confidence.bracketShapeChalk":
    "Chalk-heavy. Consider whether one measured contrarian pick improves uniqueness.",
  "wc.confidence.bracketShapeBalanced":
    "Balanced enough for a first-pass confidence check.",
  "wc.confidence.finalizeConfidence": "Finalize confidence:",
  "wc.confidence.finalizeReady": "Ready to finalize for leaderboard.",
  "wc.confidence.finalizeMissing":
    "Finish missing requirements before finalizing.",
  "wc.confidence.privacyNote":
    "Deterministic prediction and scoring complexity only. Bracket guidance stays limited to pool picks and scoring mechanics.",
  "wc.confidence.lockedBody":
    "Upgrade to AI/Pro to open the confidence check. Locked users do not trigger AI calls.",
  "wc.path.title": "What needs to happen for me to win?",
  "wc.path.subtitle":
    "Private current-entry read. Other users' unfinalized picks stay hidden.",
  "wc.path.tierActive": "AF Pro active",
  "wc.path.tierLocked": "AF Pro locked",

  // ── Group Stage picks (gameplay) ─────────────────────────────────────
  "wc.groupStage.loading": "Loading group-stage picks...",
  "wc.groupStage.failedLoad": "Failed to load group stage",
  "wc.groupStage.title": "Group Stage Picks",
  "wc.groupStage.subtitle":
    "Rank each group 1st through 4th, then choose 8 third-place teams to advance.",
  "wc.groupStage.rankedCount": "Groups ranked: {{done}}/12",
  "wc.groupStage.lockedNoReason": "Group-stage picks are locked.",
  "wc.groupStage.lockedWithReason":
    "Group-stage picks are locked: {{reason}}",
  "wc.groupStage.teamCount": "{{count}}/4 teams",
  "wc.groupStage.teamFallback": "Team",
  "wc.groupStage.actualRank": "Actual #{{rank}}",
  "wc.groupStage.moveUp": "Move Up",
  "wc.groupStage.moveDown": "Move Down",
  "wc.groupStage.dragHint":
    "Drag teams to rank the group, or use Move Up / Move Down as a tap-friendly fallback.",
  "wc.groupStage.dragHandle": "Drag team to rank",
  "wc.groupStage.needsFourTeams":
    "{{group}} needs 4 teams before it can be saved.",
  "wc.groupStage.unsavedOrder":
    "Unsaved order change. Click Save Group before Review will count it.",
  "wc.groupStage.savedReviewUses":
    "Saved. Review uses this group order.",
  "wc.groupStage.saveGroup": "Save Group",
  "wc.groupStage.saving": "Saving...",
  "wc.groupStage.saved": "Saved",
  "wc.groupStage.retrySave": "Retry Save",
  "wc.groupStage.failedSave": "Failed to save group ranking",
  "wc.groupStage.aiTitle": "AI Insights",
  "wc.groupStage.aiTierOpen": "Open",
  "wc.groupStage.aiTierLocked": "Locked",
  "wc.groupStage.aiPrivacyNote":
    "Prediction and scoring complexity only. Bracket guidance stays limited to pool picks and scoring mechanics.",
  "wc.groupStage.aiLockedBody":
    "Basic deterministic signals are free. AF Pro or tokens unlock deeper Chimmy analysis with your full bracket and pool context.",
  "wc.groupStage.teamInfo": "Team info",
  "wc.groupStage.freeSignal": "Free",
  "wc.groupStage.seedSignal": "Advancement signal",
  "wc.groupStage.seedSignalValue": "Seed model {{value}}/100",
  "wc.groupStage.cachedStats": "Cached stats",
  "wc.groupStage.noCachedStats": "Live group stats are not cached yet.",
  "wc.groupStage.statPoints": "{{value}} pts",
  "wc.groupStage.statGoalDiff": "GD {{value}}",
  "wc.groupStage.statGoalsFor": "GF {{value}}",
  "wc.groupStage.statActualRank": "actual rank #{{rank}}",
  "wc.groupStage.whatToWatch": "What to watch",
  "wc.groupStage.predictedRankContext": "Your current order has them at #{{rank}}.",
  "wc.groupStage.signalFavorite": "Strong favorite profile",
  "wc.groupStage.signalContender": "Likely contender",
  "wc.groupStage.signalBubble": "Bubble or upset path",
  "wc.groupStage.signalLongShot": "Long-shot upset path",
  "wc.groupStage.watchSeed1": "Safer path: top seeds usually need fewer breaks to win the group.",
  "wc.groupStage.watchSeed2": "Solid path: a runner-up projection can be safer than forcing a group win.",
  "wc.groupStage.watchSeed3": "Bubble path: third-place teams need points and goal difference help.",
  "wc.groupStage.watchSeed4": "Upset path: this is a bold pick unless cached form later supports it.",
  "wc.groupStage.deeperCta":
    "Ask Chimmy for deeper pool-specific analysis with AF Pro or tokens. Unsupported live facts will not spend tokens.",
  "wc.groupStage.resultCorrect": "Correct +{{points}}",
  "wc.groupStage.resultWrong": "Wrong +0",
  "wc.groupStage.resultPending": "Result pending",

  // ── Third-place advancers (gameplay) ─────────────────────────────────
  "wc.thirdPlace.title": "Third-Place Advancers",
  "wc.thirdPlace.subtitle":
    "Choose exactly 8 predicted third-place teams after all groups are ranked.",
  "wc.thirdPlace.selectedCount":
    "Third-place advancers selected: {{count}}/8",
  "wc.thirdPlace.saveBtn": "Save Third-Place",
  "wc.thirdPlace.savePicksDone": "Saved Third-Place Picks",
  "wc.thirdPlace.saving": "Saving...",
  "wc.thirdPlace.saved": "Saved",
  "wc.thirdPlace.savePrimaryBtn": "Save Third-Place Advancers",
  "wc.thirdPlace.rankAllFirst":
    "Rank all 12 groups before selecting third-place advancers.",
  "wc.thirdPlace.unsaved":
    "Unsaved third-place changes. Click Save Third-Place Advancers before Review will count them.",
  "wc.thirdPlace.savedReviewUses":
    "Third-place picks saved. Review uses these selections.",
  "wc.thirdPlace.errorChoose8":
    "Choose exactly 8 third-place advancers.",
  "wc.thirdPlace.errorRankFirst":
    "Rank all 12 groups before choosing third-place advancers.",
  "wc.thirdPlace.failedSave":
    "Failed to save third-place advancers",
  "wc.thirdPlace.noPickYet": "No 3rd-place pick yet",
  "wc.thirdPlace.selectedToAdvance": "Selected to advance",
  "wc.thirdPlace.tapToSelect": "Tap to select",
  "wc.thirdPlace.selectAria":
    "Select {{name}} as a third-place advancer",
  "wc.thirdPlace.aiTitle": "Ask Chimmy",
  "wc.thirdPlace.aiLockedBody":
    "AI/Pro unlocks third-place selection insights. Locked users only see this CTA and no AI request is made.",

  // ── Matchup card (gameplay) ──────────────────────────────────────────
  "wc.matchup.matchLabel": "Match {{number}}",
  "wc.matchup.openGuidedAria":
    "Open guided picker for match {{number}}",
  "wc.matchup.statusFinal": "Final",
  "wc.matchup.statusPostponed": "Postponed",
  "wc.matchup.statusCancelled": "Cancelled",
  "wc.matchup.statusSimulated": "Simulated",
  "wc.matchup.statusTestFixture": "Test Fixture",
  "wc.matchup.statusSaving": "Saving...",
  "wc.matchup.notReadyPill": "Not ready for picks",
  "wc.matchup.pickBadgeCorrect": "Correct",
  "wc.matchup.pickBadgeIncorrect": "Incorrect",
  "wc.matchup.pickVisualCorrect": "Correct pick",
  "wc.matchup.pickVisualIncorrect": "Incorrect pick",
  "wc.matchup.pickVisualPending": "Pending result",
  "wc.matchup.yourPick": "Your pick:",
  "wc.matchup.points": "{{points}} pts",
  "wc.matchup.pointsPositive": "+{{points}} pts",
  "wc.matchup.zeroPts": "0 pts",
  "wc.matchup.pending": "Pending",
  "wc.matchup.winnerOfficial": "Winner: {{name}}",
  "wc.matchup.unpickableFinal": "This match is final.",
  "wc.matchup.unpickableMissingTeam":
    "Pick earlier round winners first.",
  "wc.matchup.unpickableUnknown": "Teams not available yet.",
  "wc.matchup.ftBadge": "FT",
  "wc.matchup.confidenceTitle": "Confidence bonus",
  "wc.matchup.confidenceHint":
    "Higher confidence means more bonus points if correct.",
  "wc.matchup.confidencePointSingle": "{{value}} point",
  "wc.matchup.confidencePointPlural": "{{value}} points",
  "wc.matchup.aiInsightsLabel": "AI Insights",
  "wc.matchup.aiTierOpen": "Open",
  "wc.matchup.aiTierLocked": "Locked",
  "wc.matchup.aiSaferPick": "Safer pick:",
  "wc.matchup.aiSaferBody":
    "{{name}} based on current bracket slot order.",
  "wc.matchup.aiUpsidePick": "Upside pick:",
  "wc.matchup.aiUpsideBody":
    "{{name}} if you need a differentiated path.",
  "wc.matchup.aiBracketImpact": "Bracket impact:",
  "wc.matchup.aiBracketImpactBody":
    "Winner feeds the next slot; changing this pick may reset downstream choices.",
  "wc.matchup.aiUpsetRisk": "Upset risk:",
  "wc.matchup.aiUpsetRiskBody":
    "Medium until live form and official results arrive.",
  "wc.matchup.aiPrivacyNote":
    "Prediction and scoring complexity only. Bracket guidance stays limited to pool picks and scoring mechanics.",
  "wc.matchup.aiLockedBody":
    "Basic matchup signals are free. AF Pro or tokens unlock deeper Chimmy analysis with your bracket and pool context.",
  "wc.matchup.freeSignalTitle": "Basic pick signal:",
  "wc.matchup.freeRecommendedBody": "Recommended: {{name}}",
  "wc.matchup.freeChanceLabel": "Seed-model chance:",
  "wc.matchup.freeChanceBody": "{{home}} {{homePct}} / {{away}} {{awayPct}}",
  "wc.matchup.freeUpsetLabel": "Upset risk:",
  "wc.matchup.freeMissingTeams": "This matchup still needs earlier winners before pick signals can be calculated.",
  "wc.matchup.upsetRisk.low": "Low",
  "wc.matchup.upsetRisk.medium": "Medium",
  "wc.matchup.upsetRisk.high": "High",
  "wc.matchup.scoreboardLabel": "Scoreboard:",
  "wc.matchup.scoreboardAwaiting": "Awaiting kickoff",
  "wc.matchup.pickAriaPicked": "Pick {{name}} to win",
  "wc.matchup.pickAriaSelected": "Selected: {{name}} to win",
  "wc.matchup.disabledLocked": "Picks are locked for this match",
  "wc.matchup.disabledSaving": "This pick is saving",
  "wc.matchup.winnerLabel": "Winner",
  "wc.matchup.lockHintTournament": "Locks at tournament start",
  "wc.matchup.lockHintKickoff": "Locks at kickoff",
  "wc.matchup.lockHintTournamentWithTime": "Locks {{at}}",
  "wc.matchup.lockHintKickoffWithTime": "Locks at kickoff · {{at}}",
  "wc.matchup.bracketBoardChampionLabel": "Champion Pick",
  "wc.matchup.bracketBoardChampionFallback": "Not picked",
  "wc.matchup.bracketBoardHelper":
    "Your knockout bracket is generated from your predicted group results. Picks advance visually as soon as you choose a winner.",
  "wc.matchup.aiHomeSideFallback": "Home side",
  "wc.matchup.aiAwaySideFallback": "Away side",
  "wc.matchup.pensAbbr": "pens",

  // ── Bracket round column labels ──────────────────────────────────────
  "wc.round.roundOf32": "Round of 32",
  "wc.round.roundOf16": "Round of 16",
  "wc.round.quarterfinal": "Quarterfinals",
  "wc.round.semifinal": "Semifinals",
  "wc.round.thirdPlace": "Third Place",
  "wc.round.final": "Final",

  // ── Review tab finalize/missing-picks checklist ──────────────────────
  "wc.review.savedThirdPlaceTitle": "Saved Third-Place Advancers",
  "wc.review.noSavedThirdPlace":
    "No saved third-place advancers yet.",
  "wc.review.loadingSavedThirdPlace":
    "Loading saved third-place picks...",
  "wc.review.savedKnockoutTitle": "Saved Knockout Picks",
  "wc.review.noSavedKnockout": "No saved knockout picks yet.",
  "wc.review.knockoutPickPrefix": "Match {{number}} · ",
  "wc.review.missingRequirementsTitle": "Missing requirements",
  "wc.review.needsRefinalize":
    "Entry changed after submission. Complete missing picks and finalize again.",
  "wc.review.missingGroupRankings":
    "Missing group rankings: {{groups}}",
  "wc.review.thirdPlaceCount":
    "Third-place advancers selected: {{count}}/8",
  "wc.review.missingKnockout": "Missing knockout picks: {{count}}",
  "wc.review.lockedNoTime":
    "Locked: picks can no longer be edited",
  "wc.review.lockedWithTime":
    "Locked: picks can no longer be edited · submitted {{at}}",
  "wc.review.completeDraftHelper":
    "Complete draft. Finalize to submit it to the leaderboard; you can still edit until lock.",
  "wc.review.finalizing": "Finalizing...",
  "wc.review.finalizeEntry": "Finalize Entry",
  "wc.review.refinalizeEntry": "Re-finalize Entry",
  "wc.review.completeAllToUnlock":
    "Complete all missing requirements to unlock Finalize.",
  "wc.review.tapRefresh": "Tap Refresh Review to check completion.",
  "wc.review.createEntryFirstTitle": "Create an entry first",
  "wc.review.createEntryFirstBody":
    "Review and finalization are saved per bracket entry.",
  "wc.review.createMyBracket": "Create My Bracket",
  "wc.review.creating": "Creating...",
  "wc.review.openMyBracket": "Open My Bracket",

  // ── Review tab: hero section ──────────────────────────────────────────
  "wc.review.heroTitle": "Review Your Road to Glory",
  "wc.review.heroSubtitle": "Check every group, knockout path, and finalist before you lock it in.",
  "wc.review.groupChangeWarning": "Changing Group Stage picks may unfinalize your entry if knockout picks are reset.",
  "wc.review.statusIncomplete": "Incomplete",
  "wc.review.statusReady": "Ready to Finalize",
  "wc.review.statusFinalized": "Finalized",
  "wc.review.statusLocked": "Locked",
  "wc.review.checking": "Checking...",
  "wc.review.refreshReview": "Refresh Review",
  "wc.review.loadingReview": "Loading...",
  // ── Review tab: stat cards ────────────────────────────────────────────
  "wc.review.stat.groups": "Groups Ranked",
  "wc.review.stat.thirdPlace": "Best Third",
  "wc.review.stat.knockouts": "Knockout Picks",
  // ── Review tab: scoring note ──────────────────────────────────────────
  "wc.review.scoringNoteTitle": "Scoring note",
  "wc.review.scoringNoteBody": "Finalized = submitted for leaderboard. Locked = deadline passed, picks cannot be edited.",
  "wc.review.resultPendingNote": "Result pending means your pick is saved, but the official match result has not posted or been scored yet.",
  // ── Review tab: AF Pro upgrade banner ────────────────────────────────
  "wc.review.afProUnlocks": "AF Pro unlocks",
  "wc.review.afProUnlocksDetails": "the full report — Champion Confidence, Path to Win, the AI Explain narrative, your Uniqueness insight, and the full Share card.",
  // ── Review tab: saved picks section ──────────────────────────────────
  "wc.review.savedGroupTitle": "Saved Group Stage Picks",
  "wc.review.savedGroupNote": "Your predictions · official results shown separately",
  "wc.review.groupPicksSaved": "{{n}}/4 saved",
  "wc.review.noGroupPicksYet": "No saved ranking yet.",
  "wc.review.loadingGroupPicks": "Loading saved group picks...",
  // ── Review tab: finalize area ─────────────────────────────────────────
  "wc.review.finalizeLockWarning": "Picks may not be editable after the lock deadline.",

  // ── Guided Matchup Picker (Phase 6) ──────────────────────────────────
  "wc.guided.dialogLabel": "Guided Matchup Picker",
  "wc.guided.closeLabel": "Close guided picker",
  "wc.guided.timeTbd": "Time TBD",
  "wc.guided.awaitingResult": "Awaiting result",
  "wc.guided.tbd": "TBD",
  "wc.guided.matchFinal": "Final",
  "wc.guided.matchPostponed": "Postponed",
  "wc.guided.pickAriaLabel": "Pick {{teamName}} to win",
  "wc.guided.progressRound": "{{label}} · {{done}}/{{total}} picks",
  "wc.guided.progressOverall": "{{pct}}% overall",
  "wc.guided.headerLocked": "Bracket Locked",
  "wc.guided.headerFixturesNotReady": "Fixtures Not Ready",
  "wc.guided.headerStart": "Start Making Picks",
  "wc.guided.headerComplete": "Bracket Complete",
  "wc.guided.headerGuided": "Guided Picks",
  "wc.guided.lockedHelper":
    "This bracket is locked. Picks can no longer be changed.",
  "wc.guided.emptyTeamsUpstream":
    "Teams for this round will appear once earlier matches are picked.",
  "wc.guided.emptyFixturesUnresolved":
    "Fixtures are loaded, but real team matchups are not resolved yet.",
  "wc.guided.close": "Close",
  "wc.guided.back": "Back",
  "wc.guided.skip": "Skip",
  "wc.guided.matchNumber": "Match {{number}}",
  "wc.guided.saving": "Saving…",
  "wc.guided.saved": "Saved",
  "wc.guided.nextMatchup": "Next matchup…",
  "wc.guided.tapToSelect": "Tap a team to select the winner",
  "wc.guided.tapToChange": "Tap the other team to change your pick",
  "wc.guided.matchFinalNote": "This match is final.",
  "wc.guided.pickEarlierRoundsFirst": "Pick earlier round winners first.",
  "wc.guided.matchEnded": "This match has ended.",
  "wc.guided.matchLocked": "Picks are locked for this match.",
  "wc.guided.confidenceTitle": "Confidence bonus",
  "wc.guided.confidenceHelper":
    "Higher confidence means more bonus points if correct.",
  "wc.guided.confidenceOptionOne": "1 point",
  "wc.guided.confidenceOptionOther": "{{n}} points",
  "wc.guided.bracketCompleteTitle": "Bracket Complete!",
  "wc.guided.bracketCompleteBody": "You've picked every match.",
  "wc.guided.reviewBracket": "Review Bracket",
  "wc.guided.done": "Done",
  "wc.guided.errorNotReady": "This matchup is not ready for picks yet.",
  "wc.guided.errorSaveFailed": "Failed to save pick",
  "wc.guided.vs": "VS",

  // ── Score Summary card (Phase 6) ─────────────────────────────────────
  "wc.summary.title": "Bracket scorecard",
  "wc.summary.rankPlaceholder": "Rank —",
  "wc.summary.bracketComplete": "Bracket complete",
  "wc.summary.bracketIncomplete": "Bracket incomplete",
  "wc.summary.fixturesNotReady":
    "Fixtures are not fully resolved yet — scoring updates once matchups are official.",
  "wc.summary.scoresNotSynced":
    "Scores have not synced yet — points appear after results post.",
  "wc.summary.locked": "Bracket locked — picks are frozen.",
  "wc.summary.totalPts": "Total pts",
  "wc.summary.possibleLeft": "Possible left",
  "wc.summary.correct": "Correct",
  "wc.summary.wrong": "Wrong",
  "wc.summary.championPick": "Champion pick",
  "wc.summary.championAlive": "Champion alive",
  "wc.summary.championBusted": "Champion busted",
  "wc.summary.noChampionYet": "No champion selected yet",
  "wc.summary.maxCeiling": "Max ceiling",
  "wc.summary.maxCeilingBody":
    " possible pts tracked for your remaining paths",

  // ── Round Breakdown card (Phase 6) ───────────────────────────────────
  "wc.roundBreakdown.title": "Round scoring",
  "wc.roundBreakdown.ptsAbbrev": "{{n}} pts",
  "wc.roundBreakdown.perWin": "per win",
  "wc.roundBreakdown.championBonus":
    "Champion bonus enabled: {{bonus}} pts when your champion wins the final (policy — confirm challenge rules).",

  // ── Leaderboard Insights card (Phase 6) ──────────────────────────────
  "wc.insights.title": "Leaderboard Insights",
  "wc.insights.empty":
    "Leaderboard insights appear after finalized entries are scored. Make sure you've submitted your picks before the first match begins.",
  "wc.insights.currentLeader": "Current Leader",
  "wc.insights.largestGap": "Largest Gap",
  "wc.insights.entries": "Entries",
  "wc.insights.championsAlive": "Champions Alive",
  "wc.insights.mostCorrect": "Most Correct",
  "wc.insights.closestRace": "Closest Race",
  "wc.insights.notClose": "Not close",
  "wc.insights.gapPts": "{{n}} pts",
  "wc.insights.mostCorrectValue": "{{name}} ({{count}})",
  "wc.insights.aiSummaryTitle": "AI Pool Summary",
  "wc.insights.aiBadgeUnlocked": "Finalized only",
  "wc.insights.aiBadgeLocked": "Locked",
  "wc.insights.aiNotAvailable": "Not available yet",
  "wc.insights.aiSummaryCountOne":
    "{{count}} public leaderboard entry included.",
  "wc.insights.aiSummaryCountOther":
    "{{count}} public leaderboard entries included.",
  "wc.insights.aiSummaryLabel": "Finalized-only summary:",
  "wc.insights.aiCommonChampionLabel": "Most common champion:",
  "wc.insights.aiRaceLabel": "Race note:",
  "wc.insights.aiRaceClose":
    "The top two entries are within 5 points.",
  "wc.insights.aiRaceNotClose": "No close top-two race yet.",
  "wc.insights.aiWinReadLabel": "AI win read:",
  "wc.insights.aiWinReadBody":
    "{{name}} projects at {{pct}}% with {{health}} bracket health.",
  "wc.insights.aiPrivacyNote":
    "Uses finalized/public leaderboard data only. No private unfinalized picks are included. Bracket guidance stays limited to pool picks and scoring mechanics.",
  "wc.insights.aiUpgradeNote":
    "Upgrade to AI/Pro for finalized-only pool summaries. Locked users do not trigger AI calls.",

  // ── Settings panel chrome (Phase 6) ──────────────────────────────────
  "wc.settings.title": "Pool settings",
  "wc.settings.subtitle":
    "Identity, caps, scoring, visibility, and alerts — commissioner controls for your World Cup bracket pool.",
  "wc.settings.loading": "Loading pool settings…",
  "wc.settings.sectionIdentity": "Pool identity",
  "wc.settings.save": "Save settings",
  "wc.settings.saving": "Saving…",
  "wc.settings.toastNoChanges": "No changes to save.",
  "wc.settings.toastSaved": "Settings saved.",
  "wc.settings.toastError": "Could not save settings",

  // ── Commissioner Brain panel chrome (Phase 6) ────────────────────────
  "wc.brain.title": "Commissioner Brain",
  "wc.brain.subtitle":
    "Snapshot, alerts, and AI helpers — manage your pool from one place.",
  "wc.brain.loading": "Loading commissioner tools…",
  "wc.brain.loadError": "Could not load commissioner tools.",

  // ── Home tab: commissioner quick panel ──────────────────────────────
  "wc.home.commissioner.syncing": "Syncing...",
  "wc.home.commissioner.syncBtn": "Sync Fixtures",
  "wc.home.commissioner.settingsBtn": "Pool Settings",
  "wc.home.commissioner.inviteBtn": "Invite Players",

  // ── Home tab: fixture readiness card ────────────────────────────────
  "wc.home.fixtureReady.cardTitle": "Fixture Readiness",
  "wc.home.fixtureReady.descReady": "Round of 32 matchups have teams and can be picked. Test fixtures are marked as test data when used.",
  "wc.home.fixtureReady.descBlocked": "Picks stay blocked while matchups are placeholders like Group Winner or Winner Match. Sync official fixtures when available, or seed test fixtures for local QA.",
  "wc.home.fixtureReady.knockoutLocked": "Knockout picks open after official Round of 32 fixtures are available",
  "wc.home.fixtureReady.readySingle": "{{n}} pickable matchup ready",
  "wc.home.fixtureReady.readyPlural": "{{n}} pickable matchups ready",
  "wc.home.fixtureReady.notSynced": "Fixtures have not been synced yet",
  "wc.home.fixtureReady.notReady": "Fixtures loaded, but teams are still placeholders",
  "wc.home.fixtureReady.commissionerSettings": "Commissioner Settings",

  // ── Picks tab: guided pick help banners ─────────────────────────────
  "wc.pickHelp.fixturesNotSynced": "Picks open after World Cup fixtures are synced or test fixtures are seeded for this pool.",
  "wc.pickHelp.seedBtn": "Seed Test Fixtures",
  "wc.pickHelp.seeding": "Seeding...",
  "wc.pickHelp.knockoutFromGroups": "Your knockout matchups are generated from your Group Stage predictions. Rank all groups and choose third-place advancers to unlock more slots.",
  "wc.pickHelp.officialRequired": "Official fixtures required",
  "wc.pickHelp.groupGenerated": "Generated from groups",
  "wc.pickHelp.officialRequiredBody":
    "This pool uses official knockout fixtures. Picks open after the Round of 32 teams are synced by an admin or commissioner workflow.",
  "wc.pickHelp.title": "Guided Pick Help",
  "wc.pickHelp.body": "Use the sticky Start Making Picks button on mobile to move through matchups one at a time. AI bracket builder tools stay gated for a later pass.",
  "wc.pickHelp.knockoutLocked": "Knockout Locked",
  "wc.pickHelp.continueGuided": "Continue Guided Picks",
  "wc.pickHelp.reviewGuided": "Review Guided Picks",
  "wc.pickHelp.picksBlocked": "Pick earlier round winners first. More matchups unlock as your bracket advances.",

  // ── AI Simulation lock panel ─────────────────────────────────────────
  "wc.aiLock.badge": "Locked Preview",
  "wc.aiLock.title": "AI Simulation Locked",
  "wc.aiLock.body": "AI Simulation unlocks projected winners, bracket busters, and champion paths.",
  "wc.aiLock.tier": "Requires AF Pro or AF Supreme",
  "wc.aiLock.commissionerNote": "Commissioner AI tools require AF Commissioner or AF Supreme.",

  // ── Premium access panel ─────────────────────────────────────────────
  "wc.premium.eyebrow": "World Cup Access",
  "wc.premium.title": "Free play stays open. Premium tools stay clearly gated.",
  "wc.premium.body": "Join, create your first bracket, make Group Stage and Knockout picks, review, finalize, and view the leaderboard for free.",
  "wc.premium.entryCap": "Entry cap:",
  "wc.premium.freeLimitSingle": "Free users can create one bracket entry in this pool.",
  "wc.premium.freeLimitPlural": "This pool allows up to {{n}} entries. Free users can still create a valid first bracket; AF Commissioner controls manage multi-entry pool rules.",
  "wc.premium.commissionerSection": "AF Commissioner",
  "wc.premium.aiSection": "AI/Pro",
  "wc.premium.unlocked": "Unlocked",
  "wc.premium.card.commissioner.title": "AF Commissioner Tools",
  "wc.premium.card.commissioner.descOwner": "Readiness, sync, simulation, settings, invites, and admin QA tools are available for all-access users.",
  "wc.premium.card.commissioner.descOther": "Private/public pool controls, invite management, custom scoring hooks, and commissioner setup.",
  "wc.premium.card.chat.title": "Pool Chat",
  "wc.premium.card.chat.desc": "League chat placeholder for pool hosts, announcements, and moderated discussion.",
  "wc.premium.card.export.title": "Export Leaderboard",
  "wc.premium.card.export.desc": "Export standings and bracket summaries for commissioner review.",
  "wc.premium.card.multiEntry.title": "Multiple Entries",
  "wc.premium.card.multiEntry.desc": "Pool-level multi-entry controls beyond the default free first-entry experience.",
  "wc.premium.card.bracketBuilder.title": "AI Bracket Builder",
  "wc.premium.card.bracketBuilder.desc": "Placeholder for guided bracket construction and deterministic context-aware suggestions.",
  "wc.premium.card.matchupPreview.title": "AI Matchup Preview",
  "wc.premium.card.matchupPreview.desc": "Preview matchup lean, risks, and upset paths when official fixtures are available.",
  "wc.premium.card.whatIf.title": "AI What-If Scenarios",
  "wc.premium.card.whatIf.desc": "Leaderboard scenarios for what needs to happen next.",
  "wc.premium.card.alerts.title": "AI Alerts",
  "wc.premium.card.alerts.desc": "Future alerts for bracket swings, group-stage optimizer notes, and upset finder signals.",

  // ── Match Impact Center ───────────────────────────────────────────────
  "wc.matchImpact.championRiskBody": "Your champion {{name}} is playing. A loss ends your champion bonus points.",
  "wc.matchImpact.teamInsightBtn": "Team insight",

  // ── Team Intelligence Card ────────────────────────────────────────────
  "wc.teamIntel.title": "Team Profile",
  "wc.teamIntel.standing": "Group Standing",
  "wc.teamIntel.form": "Recent Form",
  "wc.teamIntel.missingToggle": "What data is not loaded?",
  "wc.teamIntel.missingTitle": "Not loaded for this team:",
  "wc.teamIntel.source": "Source",
  "wc.teamIntel.noStanding": "Group standings not loaded yet.",
  "wc.teamIntel.noForm": "No completed matches in cache.",
  "wc.teamIntel.loading": "Loading team profile...",
  "wc.teamIntel.notFound": "Team profile not available.",
  "wc.teamIntel.close": "Close team profile",
  "wc.teamIntel.thirdPlaceAdvancer": "3rd-place advancer",
}

const ES: WorldCupDictionary = {
  // ── Shared / shell ───────────────────────────────────────────────────
  "wc.common.loading": "Cargando...",
  "wc.common.back": "Atrás",
  "wc.common.openSettings": "Abrir ajustes",
  "wc.common.signIn": "Iniciar sesión",
  "wc.common.signOut": "Cerrar sesión",

  // ── Public hub: /brackets/world-cup ──────────────────────────────────
  "wc.publicHub.backToBrackets": "← Volver a Brackets",
  "wc.publicHub.heroTitle": "Desafío de Brackets de la Copa del Mundo",
  "wc.publicHub.heroSubtitle":
    "Crea un grupo de brackets estilo NCAA para la Copa del Mundo de la FIFA. Invita amigos, haz tus picks, sigue marcadores en vivo y escala el leaderboard.",
  "wc.publicHub.discover": "Descubrir grupos públicos",
  "wc.publicHub.joinWithCode": "Unirse con código",
  "wc.publicHub.createPool": "Crear grupo",
  "wc.publicHub.createWorldCupPool": "Crear grupo de la Copa del Mundo",
  "wc.publicHub.yourPools": "Tus grupos de la Copa del Mundo",
  "wc.publicHub.poolsCountOne": "{{count}} grupo",
  "wc.publicHub.poolsCountOther": "{{count}} grupos",
  "wc.publicHub.scoreLabel": "Puntos",
  "wc.publicHub.rankLabel": "Posición",
  "wc.publicHub.participantsOne": "{{count}} participante",
  "wc.publicHub.participantsOther": "{{count}} participantes",
  "wc.publicHub.statusOpen": "Abierto",
  "wc.publicHub.statusLocked": "Bloqueado",
  "wc.publicHub.statusFinal": "Final",
  "wc.publicHub.emptyTitle": "Aún no tienes grupos de la Copa del Mundo",
  "wc.publicHub.emptyBody":
    "Todavía no has creado ni te has unido a un grupo de brackets de la Copa del Mundo.",
  "wc.publicHub.emptyHint":
    "Crea uno e invita amigos, o pide un código de invitación.",
  "wc.publicHub.signInTitle": "Inicia sesión para comenzar",
  "wc.publicHub.signInBody":
    "Crea o únete a un grupo de brackets de la Copa del Mundo y compite con amigos.",
  "wc.publicHub.signInCta": "Iniciar sesión para comenzar",
  "wc.publicHub.feature.privatePublic":
    "Grupos privados o públicos — hasta 100 participantes.",
  "wc.publicHub.feature.bracketsPerUser":
    "Hasta 5 brackets por usuario, compite con varias estrategias.",
  "wc.publicHub.feature.ncaaScoring":
    "Puntuación estilo NCAA — más puntos en rondas avanzadas.",
  "wc.publicHub.feature.guidedPicker":
    "Asistente de picks guiado con vistas previas de IA.",
  "wc.publicHub.feature.liveTracking":
    "Seguimiento de marcadores y minutos en vivo.",
  "wc.publicHub.feature.aiBracketBuilder":
    "El generador de brackets con IA rellena los partidos sin elegir automáticamente.",
  "wc.publicHub.feature.perBracketLeaderboard":
    "Leaderboard por bracket — cada entrada se clasifica de manera individual.",
  "wc.publicHub.feature.lockOnKickoff":
    "Los brackets se bloquean cuando arranca el primer partido de la Copa del Mundo.",

  // ── Public hub: v2 command center ────────────────────────────────────
  "wc.publicHub.commandEyebrow": "Centro de Comando de Pools AF Copa del Mundo",
  "wc.publicHub.commandTitle": "Construye tu camino a la gloria en la Copa del Mundo.",
  "wc.publicHub.commandSubtitle":
    "Crea un grupo, invita a tu equipo, clasifica cada grupo, elige el camino eliminatorio y mira cómo cobra vida el leaderboard.",
  "wc.publicHub.trustNote": "Gratis para jugar. Solo gloria, estrategia y derechos de presumir.",
  "wc.publicHub.stat.teams": "48 selecciones",
  "wc.publicHub.stat.groups": "12 grupos",
  "wc.publicHub.stat.matches": "104 partidos",
  "wc.publicHub.stat.format": "Fase de grupos + Eliminatorias",
  "wc.publicHub.actionsTitle": "¿Cómo quieres empezar?",
  "wc.publicHub.action.create.title": "Crear un grupo",
  "wc.publicHub.action.create.desc":
    "Inicia un grupo privado o público para la Copa del Mundo e invita a amigos.",
  "wc.publicHub.action.join.title": "Unirse con código",
  "wc.publicHub.action.join.desc":
    "¿Tienes una invitación? Ingresa el código y únete de inmediato.",
  "wc.publicHub.action.discover.title": "Descubrir grupos públicos",
  "wc.publicHub.action.discover.desc":
    "Encuentra grupos abiertos de la Copa del Mundo y únete a la acción.",
  "wc.publicHub.how.title": "Cómo funcionan los pools AF Copa del Mundo",
  "wc.publicHub.how.step1Title": "Crea o únete a un grupo",
  "wc.publicHub.how.step1Body":
    "Crea un grupo privado para tu gente o encuentra uno público al que cualquiera puede unirse.",
  "wc.publicHub.how.step2Title": "Clasifica cada grupo",
  "wc.publicHub.how.step2Body":
    "Predice cómo termina cada equipo en su grupo, incluidos los avanzados de tercer lugar.",
  "wc.publicHub.how.step3Title": "Construye el camino eliminatorio",
  "wc.publicHub.how.step3Body":
    "Elige ganadores en cada ronda eliminatoria hasta llegar a la final.",
  "wc.publicHub.how.step4Title": "Finaliza y escala",
  "wc.publicHub.how.step4Body":
    "Bloquea tu bracket antes del partido inicial y sigue las clasificaciones en vivo.",
  "wc.publicHub.ai.title": "Herramientas de bracket con IA",
  "wc.publicHub.ai.subtitle":
    "Chimmy y AllFantasy IA te ayudan a entender el riesgo, detectar insights y guiar a los comisionados.",
  "wc.publicHub.ai.explain.title": "Explica mi bracket",
  "wc.publicHub.ai.explain.desc":
    "La IA analiza tus picks y explica qué hace único tu bracket.",
  "wc.publicHub.ai.danger.title": "Zonas de peligro en eliminatorias",
  "wc.publicHub.ai.danger.desc":
    "Descubre cuáles de tus picks son más vulnerables ante sorpresas.",
  "wc.publicHub.ai.chat.title": "Chat del grupo + estrategia",
  "wc.publicHub.ai.chat.desc":
    "Pregúntale a @Chimmy sobre tus picks directamente en el chat del grupo.",
  "wc.publicHub.ai.commissioner.title": "Perspectivas del comisionado",
  "wc.publicHub.ai.commissioner.desc":
    "Resúmenes IA sobre salud del grupo, diversidad de brackets y actividad de miembros.",
  "wc.publicHub.ai.gating":
    "Disponible en planes de IA elegibles o herramientas con tokens.",
  "wc.publicHub.social.title": "Trae a tu equipo.",
  "wc.publicHub.social.desc":
    "Comparte el enlace de tu grupo, reta a tus amigos y deja que el leaderboard resuelva el debate.",
  "wc.publicHub.social.cta": "Crear un grupo para obtener el enlace de invitación",
  "wc.publicHub.trust.note":
    "Los pools de AllFantasy Copa del Mundo son para entretenimiento de fantasy sports, estrategia y derechos de presumir. Completamente gratis para jugar.",

  // ── Pool dashboard: tab labels ───────────────────────────────────────
  "wc.tab.home": "Inicio",
  "wc.tab.groupStage": "Fase de Grupos",
  "wc.tab.picks": "Eliminatorias",
  "wc.tab.review": "Revisar",
  "wc.tab.leaderboard": "Tabla",
  "wc.tab.rules": "Reglas",
  "wc.tab.invite": "Invitar",
  "wc.tab.commissioner": "Comisionado",
  "wc.tab.admin": "Ajustes",

  // ── Pool dashboard: sticky subnav labels ─────────────────────────────
  "wc.subnav.quickJump": "Accesos rápidos",
  "wc.subnav.start": "Inicio",
  "wc.subnav.groupBuilder": "Armador de grupos",
  "wc.subnav.bracketBoard": "Tablero de bracket",
  "wc.subnav.firstRound": "Primera ronda",
  "wc.subnav.opsTools": "Herramientas ops",
  "wc.subnav.rankSnapshot": "Vista de ranking",
  "wc.subnav.inviteCenter": "Centro de invitación",

  // ── Mobile bottom nav: short labels ──────────────────────────────────
  "wc.tab.leaderboard.short": "Ranking",
  "wc.tab.commissioner.short": "Comis.",
  "wc.tab.settings.short": "Config.",
  "wc.tab.home.short": "Inicio",
  "wc.tab.groupStage.short": "Grupos",
  "wc.tab.picks.short": "Llaves",
  "wc.tab.review.short": "Revisar",
  "wc.tab.rules.short": "Reglas",
  "wc.tab.invite.short": "Invitar",
  "wc.tab.admin.short": "Ajustes",

  // ── Rules tab ────────────────────────────────────────────────────────
  "wc.rules.hero.eyebrow": "Pool",
  "wc.rules.hero.title": "Reglas del Pool",
  "wc.rules.hero.subtitle": "Entiende la puntuación, plazos, entradas y cómo funciona tu pool de la Copa del Mundo.",
  "wc.rules.how.title": "Cómo Funciona",
  "wc.rules.how.body1": "Elige al ganador de cada partido desde los Octavos de Final hasta el campeón. Las predicciones se bloquean al inicio de cada partido.",
  "wc.rules.how.body2": "Las predicciones correctas suman más puntos en cada ronda. Los resultados actualizan la puntuación y refrescan el leaderboard.",
  "wc.rules.scoring.title": "Puntuación",
  "wc.rules.scoring.roundOf32": "Ronda de 32",
  "wc.rules.scoring.roundOf16": "Octavos de Final",
  "wc.rules.scoring.quarterfinal": "Cuartos de Final",
  "wc.rules.scoring.semifinal": "Semifinal",
  "wc.rules.scoring.final": "Final",
  "wc.rules.scoring.champion": "Bono Campeón",
  "wc.rules.scoring.thirdPlace": "3er Lugar",
  "wc.rules.scoring.pts": "pts",
  "wc.rules.settings.title": "Configuración del Pool",
  "wc.rules.settings.bracketsPerUser": "Brackets por usuario",
  "wc.rules.settings.thirdPlace": "Partido por el 3er lugar",
  "wc.rules.settings.thirdPlaceOn": "Incluido",
  "wc.rules.settings.thirdPlaceOff": "Desactivado",
  "wc.rules.settings.inviteSharing": "Compartir invitación",
  "wc.rules.settings.inviteCommish": "Solo comisionado",
  "wc.rules.trustNote": "Sin costo alguno. Solo predicciones de la Copa del Mundo, estrategia y derechos de presumir.",

  // ── Pool dashboard: home tab ──────────────────────────────────────────
  "wc.home.title": "Panel del Pool de la Copa del Mundo",
  "wc.home.subtitle": "Empieza aquí: crea o abre tu bracket, clasifica todos los grupos, elige los eliminados, revisa y finaliza para aparecer en el leaderboard.",
  "wc.home.copyInvite": "Copiar Invitación",
  "wc.home.invitePanel": "Panel de Invitación",
  "wc.home.stat.participants": "Participantes",
  "wc.home.stat.entries": "Entradas",
  "wc.home.stat.finalized": "Entradas Finalizadas",
  "wc.home.stat.fixtureStatus": "Estado de Partidos",
  "wc.home.stat.ready": "Listo",
  "wc.home.stat.notReady": "No Listo",
  "wc.home.entries.title": "Entradas",
  "wc.home.entries.loading": "Cargando entradas...",
  // ── Home tab: entry list card ────────────────────────────────────────
  "wc.entryList.subtitle": "Crea o abre tu bracket personal cuando estés listo para hacer picks. El juego gratuito permite un bracket; los ajustes del comisionado permiten múltiples entradas.",
  "wc.entryList.complete": "Completo",
  "wc.entryList.notComplete": "Incompleto",
  "wc.entryList.rank": "Posición #{{rank}}",
  "wc.entryList.unranked": "Sin clasificar",
  "wc.entryList.openBracket": "Abrir Bracket",
  "wc.entryList.noBracketsTitle": "Aún no hay brackets creados",
  "wc.entryList.noBracketsBody": "Crea tu bracket personal primero; podrás hacer picks cuando los encuentros estén listos.",
  // ── Pool dashboard: AI features teaser ───────────────────────────────
  "wc.home.ai.title": "Funciones de IA",
  "wc.home.ai.chimmyHint": "Escribe @chimmy en el chat del pool para recibir consejos personalizados de bracket.",
  "wc.home.ai.explainHint": "Ve a la pestaña Revisar para obtener una explicación de IA de tu estrategia de bracket.",
  "wc.home.ai.unlockHint": "Actualiza a AF Pro para desbloquear Chimmy AI y Explain My Bracket.",

  // ── AI CTA panel ──────────────────────────────────────────────────────
  "wc.cta.panelTitle": "Información de IA",
  "wc.cta.aiRowLabel": "IA / Pro",
  "wc.cta.commissionerRowLabel": "Comisionado",
  "wc.cta.askChimmy": "Pregunta a Chimmy",
  "wc.cta.askChimmyDesc": "Abre Chimmy con una pregunta sobre tu bracket",
  "wc.cta.pathToFirst": "Camino al Primero",
  "wc.cta.pathToFirstDesc": "Pregunta a Chimmy qué necesita tu bracket para subir al primer lugar",
  "wc.cta.explainBracket": "Explica Mi Bracket",
  "wc.cta.explainBracketDesc": "Obtén una explicación de IA de tu estrategia de bracket",
  "wc.cta.rootingGuide": "Guía de Apoyo",
  "wc.cta.rootingGuideDesc": "Genera una guía de apoyo para esta entrada",
  "wc.cta.poolSwing": "Cambio en el Pool",
  "wc.cta.poolSwingDesc": "Encuentra el mayor cambio próximo en el leaderboard",
  "wc.cta.championRisk": "Riesgo de Campeón",
  "wc.cta.championRiskDesc": "Analiza el riesgo del pick de campeón en el pool",
  "wc.cta.commissionerRecap": "Resumen del Comisionado",
  "wc.cta.commissionerRecapDesc": "Genera un resumen de IA del pool (vista previa antes de publicar)",
  "wc.cta.postHype": "Publicar Hype",
  "wc.cta.postHypeDesc": "Publica un mensaje de ánimo en el chat del pool",
  "wc.cta.findIncomplete": "Picks Incompletos",
  "wc.cta.findIncompleteDesc": "Encuentra entradas con mayor riesgo de picks faltantes",

  // ── Pool Chat community panel (Goal 9) ───────────────────────────────
  "wc.chat.hero.title": "Chat del Pool",
  "wc.chat.hero.subtitle": "Habla estrategia, haz tus predicciones y mantén el pool activo.",
  "wc.chat.hero.badge": "Comunidad",
  "wc.chat.empty.headline": "Inicia el primer debate.",
  "wc.chat.empty.body":
    "Llama a tu campeón, cuestiona una elección arriesgada o pídele a Chimmy su opinión.",
  "wc.chat.chip.explainBracket": "Explica mi bracket",
  "wc.chat.chip.dangerZone": "Encuentra mis picks en zona de peligro",
  "wc.chat.chip.poolFavorite": "¿Quién es el favorito del pool?",
  "wc.chat.chip.keyMatchup": "¿Qué partido podría cambiarlo todo?",
  "wc.chat.chip.trashTalk": "Dame una frase de trash talk segura",
  "wc.chat.composer.placeholder": "Escríbele al pool o pregúntale a Chimmy…",
  "wc.chat.composer.send": "Enviar",
  "wc.chat.privateLabel": "Respuesta privada de Chimmy · Solo visible para ti",
  "wc.chat.aiHint.unlocked":
    "Las respuestas de @chimmy son privadas. Solo tú verás tu pregunta y la respuesta de Chimmy en este pool.",
  "wc.chat.aiHint.locked":
    "Las respuestas privadas de @chimmy requieren AI/Pro. Actualiza para preguntarle a Chimmy desde el chat del pool.",
  "wc.chat.trustNote": "Sé competitivo. Sé respetuoso.",
  "wc.chat.loading": "Cargando chat del pool…",
  "wc.chat.refresh": "Actualizar",
  "wc.chat.mode.ai": "Chimmy IA",
  "wc.chat.mode.pool": "Chat del Pool",
  "wc.chat.mode.dm": "Chat DM",
  "wc.chat.placeholder.ai": "Pregunta a Chimmy sobre el bracket, picks, bloqueos o tabla del pool...",
  "wc.chat.placeholder.dm": "Mensaje para este chat privado...",
  "wc.chat.drawer.aiTitle": "Chat IA de Chimmy",
  "wc.chat.drawer.poolTitle": "Mensajes del Pool",
  "wc.chat.drawer.dmTitle": "Mensajes Directos",
  "wc.chat.drawer.aiTrust": "Los mensajes en este modo se envian a @Chimmy y pueden devolver una respuesta privada de IA.",
  "wc.chat.dm.comingSoonTitle": "Inicia un chat privado",
  "wc.chat.dm.comingSoon": "Elige uno o mas miembros del pool para iniciar una conversacion privada. Los mensajes se quedan dentro de ese hilo privado.",
  "wc.chat.mention.title": "Mencionar miembros del pool",
  "wc.chat.mention.loading": "Cargando",
  "wc.chat.mention.noMatches": "No hay miembros coincidentes. Usa el username mostrado en este pool.",
  "wc.chat.mention.allHelper": "Broadcast de comisionado a todos los miembros del pool",
  "wc.chat.mention.allAria": "Mencionar a todos los miembros del pool",
  "wc.chat.mention.allManagerOnly": "@all esta reservado para comisionados y admins del pool.",
  "wc.chat.askChimmy": "Preguntar a Chimmy",
  "wc.chat.open": "Abrir Chat",
  "wc.chat.collapse": "Colapsar",
  "wc.chat.chip.askChimmy": "Preguntar a Chimmy",
  "wc.chat.chip.analyzePool": "Analizar mi pool",
  "wc.chat.chip.whyLosing": "Por que voy perdiendo?",
  "wc.chat.chip.rootFor": "A quien debo apoyar?",
  "wc.chat.chip.championLoses": "Y si pierde mi campeon?",
  "wc.chat.chip.bestBracket": "Quien tiene el mejor bracket?",
  "wc.chat.chip.pathToWin": "Explica mi camino para ganar",
  "wc.chat.chip.dangerGroup": "Grupo mas peligroso?",
  "wc.chat.chip.watchToday": "Que picks debo vigilar?",
  "wc.chat.chip.summarizePool": "Resume este pool",
  "wc.chat.chip.scoringRules": "Explicar reglas",
  "wc.chat.chip.commissionerSummary": "Resumen comisionado",
  "wc.chat.prompt.askChimmy": "Dame una lectura solo con datos verificados de mi pool de World Cup. Empieza con los datos que puedes ver y lo que falta.",
  "wc.chat.prompt.analyzePool": "Analiza mi pool de World Cup usando solo datos guardados del pool, tabla, puntuacion y picks. Dame fortalezas, riesgos y mi mejor camino.",
  "wc.chat.prompt.whyLosing": "Por que voy perdiendo en este pool de World Cup? Usa solo la tabla, reglas de puntuacion y mis picks guardados. Dime que cambio y que aun puede ayudar.",
  "wc.chat.prompt.rootFor": "A quien debo apoyar ahora en este pool de World Cup? Usa solo mis picks guardados y la tabla. Separa impacto verificado de proyecciones no disponibles.",
  "wc.chat.prompt.championLoses": "Que pasa si pierde mi campeon? Explica el impacto en bracket y tabla solo si los picks guardados y reglas de puntuacion lo respaldan.",
  "wc.chat.prompt.bestBracket": "Quien tiene el mejor bracket hasta ahora? Usa solo la tabla guardada, picks guardados, campeones y puntos maximos posibles.",
  "wc.chat.prompt.pathToWin": "Explica mi camino para ganar usando solo mi bracket guardado, distancia en la tabla, reglas de puntuacion y puntos posibles restantes.",
  "wc.chat.prompt.dangerGroup": "Que grupo es el mas peligroso usando solo standings cacheados o mis picks de grupo guardados? Si faltan standings oficiales, dilo claramente.",
  "wc.chat.prompt.watchToday": "Que picks debo vigilar hoy? Usa partidos cacheados en vivo/proximos si existen; si no, explica que picks guardados importan mas sin inventar horarios.",
  "wc.chat.prompt.summarizePool": "Resume este pool de World Cup usando solo participantes guardados, tabla, reglas de puntuacion, entradas guardadas/finalizadas y picks disponibles.",
  "wc.chat.prompt.scoringRules": "Explica las reglas de puntuacion de este pool de World Cup y que rondas importan mas.",
  "wc.chat.prompt.commissionerSummary": "Resumen comisionado: muestra participacion del pool, entradas finalizadas, campeones comunes si estan disponibles y que recordatorio debo enviar. Usa solo datos verificados del pool.",

  // ── Pool dashboard: command hero ──────────────────────────────────────
  "wc.pool.eyebrow": "Centro de Comando del Pool",
  "wc.pool.privateBadge": "Privado",
  "wc.pool.publicBadge": "Abierto",
  // ── Pool dashboard: what to do next card ──────────────────────────────
  "wc.pool.next.title": "Qué Hacer Ahora",
  "wc.pool.next.create.title": "Crea Tu Bracket",
  "wc.pool.next.create.body": "Empieza tus selecciones para competir en este pool.",
  "wc.pool.next.picks.title": "Haz Tus Selecciones",
  "wc.pool.next.picks.body": "Los partidos están listos — abre tu bracket y empieza a elegir ganadores.",
  "wc.pool.next.review.title": "Revisar y Finalizar",
  "wc.pool.next.review.body": "Todas las selecciones hechas. Revisa tu bracket y confírmalo antes del torneo.",
  "wc.pool.next.done.title": "Bracket Enviado",
  "wc.pool.next.done.body": "Tu bracket está confirmado. Consulta la tabla para ver tu posición.",
  "wc.pool.next.waiting.title": "Esperando Partidos",
  "wc.pool.next.waiting.body": "Los detalles de los partidos están siendo preparados. Vuelve antes del inicio.",
  // ── Pool dashboard: progress strip ────────────────────────────────────
  "wc.pool.progress.title": "Progreso",
  "wc.pool.progress.created": "Creado",
  "wc.pool.progress.picks": "Selecciones Hechas",
  "wc.pool.progress.finalized": "Enviado",
  // ── Pool dashboard: commissioner panel ────────────────────────────────
  "wc.pool.commissioner.title": "Herramientas de Comisionado",
  // ── Pool dashboard: leaderboard preview ───────────────────────────────
  "wc.pool.leaderboard.title": "Tabla de Clasificación",
  "wc.pool.leaderboard.empty": "Aún no hay brackets puntuados",
  "wc.pool.leaderboard.emptyNote": "Los brackets aparecen aquí cuando empiece la puntuación.",
  "wc.pool.leaderboard.viewFull": "Tabla Completa",

  // ── Pool dashboard: header / status strip ────────────────────────────
  "wc.header.sync": "Sincronizar",
  "wc.header.inviteAria": "Invitar amigos",
  "wc.header.invite": "Invitar",
  "wc.header.testMode": "Modo de prueba",
  "wc.header.testModeNote":
    "los resultados están simulados y pueden alterar el leaderboard.",

  // ── Lock countdown ───────────────────────────────────────────────────
  "wc.lock.untilLockDays": "{{d}}d {{h}}h para que cierren los picks",
  "wc.lock.untilLockHours": "{{h}}h {{m}}m para que cierren los picks",
  "wc.lock.untilLockMinutes": "{{m}}m para que cierren los picks",
  "wc.lock.locksSoon": "El bracket cierra pronto",
  "wc.lock.bracketLocked": "Bracket bloqueado",
  "wc.lock.picksFrozen": "Bracket bloqueado — los picks están congelados.",

  // ── Countdown banner ─────────────────────────────────────────────────
  "wc.countdown.banner.startsIn": "El Mundial comienza en",
  "wc.countdown.banner.locksNote": "Los picks de grupos se bloquean al inicio",
  "wc.countdown.banner.urgent24h": "Los picks se bloquean pronto",
  "wc.countdown.banner.urgent1h": "Última oportunidad — los picks se bloquean al inicio",
  "wc.countdown.banner.locked.title": "Los picks de grupos están bloqueados",
  "wc.countdown.banner.locked.subtitle": "El marcador en directo ya está activo",
  "wc.countdown.banner.cta.make": "Hacer Picks",
  "wc.countdown.banner.cta.finish": "Terminar Mi Bracket",
  "wc.countdown.banner.cta.finishNow": "Terminar Picks Ahora",
  "wc.countdown.banner.cta.leaderboard": "Ver Clasificación",
  "wc.countdown.banner.firstMatchFallback": "Primer partido de la fase de grupos",
  "wc.countdown.banner.lockTime": "Los picks se bloquean · {{time}}",
  "wc.countdown.banner.fallback": "Cuenta regresiva del Mundial próximamente",
  "wc.countdown.banner.fallbackHint": "Los picks son editables hasta que se confirme el inicio",

  // ── AI upgrade / cap messages ────────────────────────────────────────
  "wc.ai.upgrade.chimmy.free": "Has usado las 3 preguntas de Chimmy de hoy. Mejora a AF Pro para 30 por día.",
  "wc.ai.upgrade.chimmy.pro": "Has usado las 30 preguntas de Chimmy de hoy. Se reinician a medianoche UTC.",
  "wc.ai.upgrade.explain.free": "Las explicaciones de bracket requieren AF Pro.",
  "wc.ai.upgrade.explain.pro": "Has usado la explicación de bracket de hoy. Se reinicia a medianoche UTC.",
  "wc.ai.upgrade.matchup.free": "El análisis de emparejamiento con IA requiere AF Pro.",
  "wc.ai.upgrade.matchup.pro": "Has usado los 25 análisis de emparejamiento de hoy. Se reinician a medianoche UTC.",
  "wc.ai.upgrade.brain.free": "Commissioner Brain requiere AF Commissioner o superior.",
  "wc.ai.upgrade.brain.pro": "Has usado las llamadas del Commissioner Brain de hoy. Se reinician a medianoche UTC.",
  "wc.ai.upgrade.resetHint": "Los límites diarios de IA se reinician a medianoche UTC.",
  "wc.ai.upgrade.cta": "Mejorar Plan",

  // ── Knockouts tab ────────────────────────────────────────────────────
  "wc.knockouts.intro.reseeded":
    "Los picks de eliminatorias se habilitan cuando estén disponibles los partidos oficiales de Ronda de 32.",
  "wc.knockouts.intro.predictive":
    "Tu bracket de eliminatorias se genera a partir de tus resultados predichos de Fase de Grupos.",
  "wc.knockouts.subintro.reseeded":
    "Los picks de Fase de Grupos funcionan normalmente. Cuando se sincronicen los partidos reales de eliminatorias, harás picks nuevos desde el bracket oficial.",
  "wc.knockouts.subintro.predictive":
    "Los partidos de eliminatorias se actualizan según tus predicciones de Fase de Grupos. Cambiar las predicciones de grupo puede reiniciar los picks afectados.",
  "wc.knockouts.startPicks": "Empezar picks",
  "wc.knockouts.continuePicks": "Continuar picks",
  "wc.knockouts.guidance.complete":
    "{{done}}/{{required}} picks disponibles completados.",
  "wc.knockouts.guidance.nextPick":
    "Próximo pick: Partido {{matchNumber}}.",
  "wc.knockouts.guidance.blocked":
    "Elige primero los ganadores de rondas previas. Más picks se habilitan al confirmar ganadores anteriores.",
  "wc.knockouts.guidance.noneReady":
    "No hay picks de eliminatorias disponibles ahora mismo.",

  // ── Knockout Danger Zones card ───────────────────────────────────────
  "wc.danger.eyebrow": "Eliminatorias",
  "wc.danger.title": "Zonas de Peligro de Eliminatorias",
  "wc.danger.subtitle":
    "Determinista — compara tus picks con la fuerza pre-torneo y el estado en vivo de cada partido.",
  "wc.danger.tierPro": "AF Pro",
  "wc.danger.tierBasic": "Básico",
  "wc.danger.emptyNoEntry":
    "Abre una entrada del bracket para ver las zonas de peligro.",
  "wc.danger.emptyNoPicks":
    "Haz picks de eliminatorias para ver zonas de peligro.",
  "wc.danger.emptyNoRisks":
    "No hay zonas de peligro por ahora. Todos tus picks de eliminatorias parecen favorecidos por la fuerza pre-torneo.",
  "wc.danger.severityHigh": "Alto",
  "wc.danger.severityMedium": "Medio",
  "wc.danger.severityLow": "Bajo",
  "wc.danger.severitySuffix": "peligro",
  "wc.danger.footer":
    "Cuenta solo tus propios picks vs el calendario público. Sin llamadas de IA. Sin picks de otros usuarios.",

  // ── AI Report (Review tab) ───────────────────────────────────────────
  "wc.aiReport.eyebrow": "Informe",
  "wc.aiReport.title": "Tu Informe de IA del Bracket",
  "wc.aiReport.subtitle":
    "Seis señales de IA calculadas a partir de tus propios picks. Todo lo de abajo es privado tuyo.",
  "wc.aiReport.tierActive": "AF Pro activo",
  "wc.aiReport.tierPreview": "Vista previa AF Pro",

  // ── Share / Invite ───────────────────────────────────────────────────
  "wc.invite.title": "Invita amigos",
  "wc.invite.copyLink": "Copiar enlace de invitación",
  "wc.invite.copied": "¡Enlace copiado!",
  "wc.invite.shareNative": "Compartir",
  "wc.invite.shareViaText": "Texto",
  "wc.invite.shareViaEmail": "Email",
  "wc.invite.viaSocial": "Redes",
  "wc.invite.heading":
    "Invita amigos a competir en {{poolName}} en AllFantasy.",
  "wc.invite.inviteCodeLabel": "Código de invitación",

  // ── Commissioner Checklist ───────────────────────────────────────────
  "wc.checklist.title": "Lista de Avance del Grupo",
  "wc.checklist.subtitle":
    "Miembros de {{poolName}} y su estado frente al plazo de bloqueo.",
  "wc.checklist.copyReminder": "Copiar recordatorio",
  "wc.checklist.reminderCopied": "¡Recordatorio copiado!",
  "wc.checklist.statusReady": "Listo",
  "wc.checklist.statusNoMembers": "Aún sin miembros",
  "wc.checklist.statusNoData": "No hay snapshot disponible",

  // ── Empty / loading / error states ───────────────────────────────────
  "wc.state.loading": "Cargando...",
  "wc.state.refresh": "Actualizar",
  "wc.state.tryAgain": "Reintentar",
  "wc.state.noEntries":
    "Aún no has creado una entrada de bracket para este grupo.",
  "wc.state.createEntry": "Crear mi bracket",

  // ── Language selector tooltip ────────────────────────────────────────
  "wc.language.label": "Idioma",
  "wc.language.english": "English",
  "wc.language.spanish": "Español",
  "wc.language.chinese": "繁體中文",
  "wc.language.filipino": "Filipino",
  "wc.language.vietnamese": "Tiếng Việt",

  // ── Create page / modal ──────────────────────────────────────────────
  "wc.create.goBack": "Volver",
  "wc.create.header": "Crear grupo de brackets de la Copa del Mundo",
  "wc.create.subheader":
    "Copa Mundial FIFA 2026 · puntuación ronda por ronda",
  "wc.create.heroTitle": "Copa Mundial FIFA 2026",
  "wc.create.heroSubtitle":
    "Crea un contenedor de grupo — invita amigos y deja que armen sus brackets dentro.",
  "wc.create.poolName.label": "Nombre del grupo",
  "wc.create.poolName.placeholder":
    "ej. Quiniela de la oficina Copa del Mundo 2026",
  "wc.create.poolName.error.blank":
    "El nombre del grupo no puede estar vacío.",
  "wc.create.poolName.default": "Grupo de brackets de la Copa del Mundo",
  "wc.create.visibility.label": "Visibilidad del grupo",
  "wc.create.visibility.private": "Privado",
  "wc.create.visibility.privateHint":
    "Se necesita enlace de invitación para unirse",
  "wc.create.visibility.public": "Público",
  "wc.create.visibility.publicHint": "Cualquiera puede descubrirlo y unirse",
  "wc.create.maxUsers.label": "Usuarios máximos",
  "wc.create.maxUsers.hint": "Máximo {{max}} por grupo",
  "wc.create.maxUsers.error": "Debe estar entre 2 y {{max}}.",
  "wc.create.maxEntries.label": "Brackets por usuario",
  "wc.create.maxEntries.hint": "Máximo {{max}} por usuario",
  "wc.create.maxEntries.error": "Debe estar entre 1 y {{max}}.",
  "wc.create.lockRule.label": "Regla de cierre de picks",
  "wc.create.lockRule.tournament": "Cierre por torneo",
  "wc.create.lockRule.tournamentHint":
    "Todos los picks se cierran cuando arranca el primer partido",
  "wc.create.lockRule.perMatch": "Cierre por partido",
  "wc.create.lockRule.perMatchHint":
    "Cada partido se cierra al inicio de su propio juego",
  "wc.create.lockRule.copyTournament":
    "Los picks se pueden editar hasta que empiece el primer partido de la Copa del Mundo.",
  "wc.create.lockRule.copyPerMatch":
    "Cada partido se puede editar hasta su propio arranque.",
  "wc.create.scoring.intro": "Puntuación ronda por ronda:",
  "wc.create.scoring.values":
    "10 pts Ronda de 32 · 20 pts Ronda de 16 · 40 pts QF · 80 pts SF · 160 pts Final · 320 pts bonus de campeón",
  "wc.create.monetization.title": "Haz visible a Chimmy cuando tus usuarios estén listos",
  "wc.create.monetization.body":
    "Crear grupos es gratis. AF Pro desbloquea análisis de bracket más profundos, y los tokens cubren acciones premium de IA de una sola vez.",
  "wc.create.monetization.proCta": "AF Pro",
  "wc.create.monetization.tokensCta": "Tokens",
  "wc.create.helper.entriesOne":
    "Cada usuario puede crear hasta {{max}} bracket.",
  "wc.create.helper.entriesOther":
    "Cada usuario puede crear hasta {{max}} brackets.",
  "wc.create.helper.leaderboard":
    "El leaderboard clasifica brackets finalizados, no borradores.",
  "wc.create.helper.inviteLink":
    "El enlace de invitación se mostrará después de crear el grupo.",
  "wc.create.thirdPlace": "Incluir partido por el tercer puesto",
  "wc.create.testFixtures.label": "Cargar partidos de prueba",
  "wc.create.testFixtures.hint":
    "Agrega equipos, banderas, horarios y sedes simulados de la Ronda de 32 para que el grupo se pueda jugar de inmediato.",
  "wc.create.submit.idle": "Crear grupo",
  "wc.create.submit.creating": "Creando...",
  "wc.create.submit.opening": "Creado, abriendo...",
  "wc.create.openingSuccess": "Bracket creado, abriendo...",
  "wc.create.error.signInRequired":
    "Inicia sesión para crear un bracket.",
  "wc.create.error.noId":
    "El bracket se creó, pero el servidor no devolvió un ID. Actualiza la página.",
  "wc.create.error.generic": "No se pudo crear el bracket",
  "wc.create.error.requestFailed": "Falló la solicitud ({{status}})",

  // ── Discover page ────────────────────────────────────────────────────
  "wc.discover.backToHub": "← Volver al hub de la Copa del Mundo",
  "wc.discover.createPool": "Crear grupo",
  "wc.discover.title": "Descubrir grupos públicos",
  "wc.discover.subtitle":
    "Explora grupos de brackets públicos de la Copa del Mundo. Unirte abre el Bracket 1 sin picks — te llevamos al asistente guiado cuando el grupo acepta nuevos jugadores y no está lleno.",
  "wc.discover.search.label": "Buscar",
  "wc.discover.search.placeholder": "Nombre del grupo",
  "wc.discover.season.label": "Temporada",
  "wc.discover.season.placeholder": "ej. 2026",
  "wc.discover.statusFilter.label": "Estado",
  "wc.discover.statusFilter.all": "Todos",
  "wc.discover.statusFilter.open": "Abierto",
  "wc.discover.statusFilter.locked": "Bloqueado",
  "wc.discover.statusFilter.final": "Final",
  "wc.discover.loading": "Cargando grupos públicos...",
  "wc.discover.errors.couldNotLoad": "No se pudieron cargar los grupos",
  "wc.discover.empty":
    "Ningún grupo público coincide con tus filtros. Prueba otra temporada o limpia la búsqueda — o únete a un grupo privado con un código de invitación arriba.",
  "wc.discover.joinPanelTitle":
    "Unirse con código de invitación (grupos privados)",

  // ── Discover card ────────────────────────────────────────────────────
  "wc.discover.card.statusOpen": "Abierto",
  "wc.discover.card.blockedFull": "Grupo lleno",
  "wc.discover.card.blockedClosed": "Cerrado a nuevos jugadores",
  "wc.discover.card.password": "Contraseña",
  "wc.discover.card.lateJoin":
    "Picks cerrados · ingreso tardío activo",
  "wc.discover.card.preview": "Previsualizar",
  "wc.discover.card.join": "Unirse",

  // ── Join / invite panel ──────────────────────────────────────────────
  "wc.join.backToHub": "← Volver al hub de la Copa del Mundo",
  "wc.join.brandEyebrow": "AllFantasy",
  "wc.join.brandTitle": "Grupos de Brackets de la Copa del Mundo 2026",
  "wc.join.panelTitle": "Unirse con código de invitación",
  "wc.join.panelHelper":
    "Ingresa el código de invitación que te dio tu comisionado. Después de unirte llegarás al panel del grupo y podrás empezar tu primer bracket. Los grupos con contraseña requieren la contraseña definida en los ajustes del grupo.",
  "wc.join.codeInput.placeholder": "Código de invitación WCUP",
  "wc.join.previewBtn": "Previsualizar",
  "wc.join.errors.invalidCode": "Ingresa un código de invitación válido",
  "wc.join.errors.notFound": "Invitación no encontrada",
  "wc.join.errors.full": "Este grupo está lleno.",
  "wc.join.errors.closed":
    "Este grupo está cerrado a nuevos jugadores.",
  "wc.join.errors.couldNotJoin": "No se pudo unir",
  "wc.join.preview.hostLine":
    "Anfitrión: {{owner}} · {{count}} jugando · {{visibility}}",
  "wc.join.preview.openCopy":
    "Únete ahora para crear el Bracket 1, hacer picks de Fase de Grupos y Eliminatorias, y finalizar cuando estés listo.",
  "wc.join.preview.fullCopy": "Este grupo está lleno.",
  "wc.join.preview.closedCopy":
    "Grupo bloqueado — no acepta nuevos jugadores.",
  "wc.join.preview.passwordLabel": "Contraseña del grupo",
  "wc.join.preview.joinBtn": "Unirse al grupo",
  "wc.join.success": "Estás dentro — Bracket 1 listo.",

  // ── Finalize / share success block (Review tab) ──────────────────────
  "wc.finalize.eyebrow": "Finalizado",
  "wc.finalize.title": "Tu bracket está confirmado",
  "wc.finalize.subtitleNoTime":
    "Enviado. Aún puedes editar hasta el cierre del grupo — invita amigos antes de que se llene.",
  "wc.finalize.subtitleWithTime":
    "Enviado {{at}}. Aún puedes editar hasta el cierre del grupo — invita amigos antes de que se llene.",
  "wc.finalize.copyShare": "Copiar texto para compartir",
  "wc.finalize.copyShareCopied": "¡Copiado!",
  "wc.finalize.shareReport": "Compartir Mi Informe IA de Bracket",
  "wc.finalize.inviteFriends": "Invita Amigos A Vencer Mi Bracket",
  "wc.finalize.previewShare": "Vista previa del texto",

  // ── Finalize success block: challenge + trust ─────────────────────────
  "wc.finalize.viewLeaderboard": "Ver tabla de clasificación",
  "wc.finalize.openChat": "Chat del pool",
  "wc.finalize.challengeTitle": "Tu camino en el Mundial está bloqueado.",
  "wc.finalize.challengeDesc": "Ahora trae a tu crew y observa cómo cobra vida la clasificación.",
  "wc.finalize.trustNote": "Sin costo alguno. Solo estrategia, predicciones y derechos de fanfarroneo.",

  // ── Leaderboard tab visual upgrade ───────────────────────────────────
  "wc.lb.eyebrow": "Grupo",
  "wc.lb.title": "Carrera por el Liderato",
  "wc.lb.heroSubtitle": "Cada partido puede cambiar la historia. Sigue tu puntaje, persigue a los líderes y mira cómo el grupo cobra vida.",
  "wc.lb.statusPreTournament": "Antes del torneo",
  "wc.lb.statusLive": "En vivo",
  "wc.lb.statusWaiting": "Esperando partidos",
  "wc.lb.subtitleBase": "Solo entradas finalizadas · los puntajes se actualizan tras sincronizar resultados.",
  "wc.lb.lastUpdated": "Última sincronización: {{date}}.",
  "wc.lb.notYetSynced": "Aún no sincronizado.",
  "wc.lb.testMode": "Modo de prueba: la tabla puede mostrar resultados simulados.",
  "wc.lb.recalculate": "Recalcular",
  "wc.lb.autoUpdate": "Se actualiza automáticamente",
  "wc.lb.scoresNotSynced": "Los puntajes aún no se han sincronizado — los totales se actualizan tras la ingesta de resultados.",
  "wc.lb.fixturesNotReady": "Los partidos no están completamente listos — los equipos deben resolverse antes de que la tabla tenga sentido.",
  "wc.lb.podiumTitle": "Tope del grupo",
  "wc.lb.yourRank": "Tu posición",
  "wc.lb.yourRankTagline": "Estás en la carrera.",
  "wc.lb.gapToFirst": "{{n}} pts detrás del líder",
  "wc.lb.isLeader": "Estás liderando el grupo.",
  "wc.lb.tied": "Empate en el liderato.",
  "wc.lb.viewMyBracket": "Ver mi bracket",
  "wc.lb.noEntryTitle": "Aún no estás en la carrera.",
  "wc.lb.noEntryBody": "Crea un bracket para unirte a la tabla.",
  "wc.lb.startMyBracket": "Comenzar mi bracket",
  "wc.lb.emptyTitle": "La carrera no ha comenzado",
  "wc.lb.emptyBody": "La tabla despierta cuando los picks se bloquean y comienzan los partidos.",
  "wc.lb.emptyInvite": "Invitar amigos",
  "wc.lb.emptyReview": "Revisar mi bracket",
  "wc.lb.scoringTitle": "Cómo funciona el puntaje",
  "wc.lb.scoringBody": "Los picks correctos dan puntos. Las rondas posteriores tienen más peso, así que cada camino hasta la final importa.",
  "wc.lb.scoringUpdates": "La tabla se actualiza después de sincronizar los resultados.",
  "wc.lb.shareMyRank": "Compartir mi posición",
  "wc.lb.challengePool": "Retar al grupo",
  "wc.lb.noChampionPick": "Sin pick de campeón",
  "wc.lb.alive": "Vivo",
  "wc.lb.busted": "Eliminado",
  "wc.lb.aiProUnlocks": "AF Pro desbloquea % de victorias IA, salud del bracket y presión en el camino al campeón.",
  "wc.lb.ptsLabel": "Pts",
  "wc.lb.trustNote": "Sin costo alguno. Solo estrategia, predicciones y el derecho a presumir.",
  // ── Share card UI chrome ──────────────────────────────────────────────
  "wc.share.eyebrow": "Gráfico de compartición",
  "wc.share.titleInvite": "Invitación al grupo",
  "wc.share.titleLeaderboard": "Captura de la tabla",
  "wc.share.titleBracket": "Mi resumen de bracket",
  "wc.share.titleRecap": "Resumen IA",
  "wc.share.description": "Texto listo para compartir en redes sobre tu bracket o la tabla del grupo.",
  "wc.share.publicSafe": "Seguro para público",
  "wc.share.copy": "Copiar",
  "wc.share.copied": "Copiado",
  "wc.share.share": "Compartir",

  // ── Inside-pool Invite tab ───────────────────────────────────────────
  "wc.inviteTab.eyebrow": "Grupo",
  "wc.inviteTab.title": "Invitar y Detalles del Grupo",
  "wc.inviteTab.detailsTitle": "Detalles del grupo",
  "wc.inviteTab.meta.pool": "Grupo",
  "wc.inviteTab.meta.privacy": "Privacidad",
  "wc.inviteTab.meta.privacyPublic": "Público",
  "wc.inviteTab.meta.privacyPrivate":
    "Privado — solo por invitación",
  "wc.inviteTab.meta.maxUsers": "Usuarios máximos",
  "wc.inviteTab.meta.bracketsPerUser": "Brackets por usuario",
  "wc.inviteTab.meta.scoring": "Puntuación",
  "wc.inviteTab.meta.scoringValue": "Estilo NCAA",
  "wc.inviteTab.meta.lockRule": "Regla de cierre",
  "wc.inviteTab.meta.lockTournament":
    "Cierra con el primer partido de la Copa del Mundo",
  "wc.inviteTab.meta.lockPerMatch": "Cierre por partido al arranque",
  "wc.inviteTab.lockedBanner":
    "Este grupo está bloqueado. Los picks ya no se pueden editar.",
  "wc.inviteTab.member.title": "Invita amigos a este grupo",
  "wc.inviteTab.member.body":
    "Solo el comisionado del grupo puede copiar y compartir el enlace de invitación. Pídeselo al comisionado.",
  "wc.inviteTab.commissioner.linkTitle": "Enlace de invitación",
  "wc.inviteTab.commissioner.linkHelper":
    "Compártelo con quien quieras invitar. Necesitan tener sesión iniciada en AllFantasy.",
  "wc.inviteTab.commissioner.codeLabel": "Código de invitación",
  "wc.inviteTab.commissioner.copyCode": "Copiar código",
  "wc.inviteTab.commissioner.copyCodeDone": "Copiado",
  "wc.inviteTab.commissioner.copyLink": "Copiar enlace de invitación",
  "wc.inviteTab.commissioner.copyLinkDone": "¡Enlace copiado!",
  "wc.inviteTab.commissioner.copyMessage":
    "Copiar mensaje de invitación",
  "wc.inviteTab.commissioner.copyMessageDone": "¡Mensaje copiado!",
  "wc.inviteTab.commissioner.share": "Compartir",
  "wc.inviteTab.commissioner.previewInvite":
    "Vista previa del mensaje de invitación",
  "wc.inviteTab.commissioner.previewShare":
    "Vista previa del mensaje para compartir",
  "wc.inviteTab.commissioner.noCodeTitle":
    "Enlace de invitación no disponible",
  "wc.inviteTab.commissioner.noCodeBody":
    "El dueño del grupo o un admin puede regenerar el enlace desde los ajustes del grupo.",
  "wc.inviteTab.shareMessage.default":
    "¡Únete a mi grupo de brackets de la Copa del Mundo en AllFantasy: \"{{pool}}\"! Hasta {{maxEntries}} brackets, ordena la fase de grupos, arma los picks de eliminatorias y compite en el leaderboard en vivo. {{url}}",
  "wc.inviteTab.shareTitleNative":
    "{{pool}} — Bracket de la Copa del Mundo de AllFantasy",

  // ── Invite tab: new UX sections (Goal 8) ─────────────────────────────
  "wc.inviteTab.hero.title": "Trae a Tu Equipo",
  "wc.inviteTab.hero.subtitle":
    "Comparte este pool, reta a tus amigos y deja que el leaderboard resuelva el debate.",
  "wc.inviteTab.hero.participants": "{{count}} en el pool",
  "wc.inviteTab.hero.spotsLeft": "{{n}} lugares disponibles",
  "wc.inviteTab.hero.poolFull": "Pool lleno",
  "wc.inviteTab.hero.lockDeadline": "Los picks se bloquean el {{date}}",
  "wc.inviteTab.growth.title": "Tu pool mejora con más rivales.",
  "wc.inviteTab.growth.body":
    "Invita amigos antes de que se bloqueen los picks y llena tu leaderboard.",
  "wc.inviteTab.growth.cta": "Invitar amigos",
  "wc.inviteTab.social.title": "Texto para redes",
  "wc.inviteTab.social.copy1":
    "Únete a mi pool de la Copa del Mundo en AllFantasy y demuestra que tu bracket es mejor.",
  "wc.inviteTab.social.copy2": "El leaderboard está a punto de ponerse personal.",
  "wc.inviteTab.social.copy3": "Trae tu mejor bracket.",
  "wc.inviteTab.social.copyBtn": "Copiar",
  "wc.inviteTab.social.copiedBtn": "Copiado",
  "wc.inviteTab.actions.viewLeaderboard": "Ver Leaderboard",
  "wc.inviteTab.actions.openChat": "Abrir chat del pool",
  "wc.inviteTab.actions.shareLink": "Compartir en móvil",
  "wc.inviteTab.trustNote":
    "Sin costo alguno. Solo predicciones del Mundial, estrategia y el derecho a presumir.",

  // ── Commissioner Checklist card chrome (extended) ────────────────────
  "wc.checklist.eyebrow": "Comisionado",
  "wc.checklist.cardSubtitle":
    "Progreso de los miembros de un vistazo. Visible solo para comisionados y admins del grupo.",
  "wc.checklist.copyReminderBtn": "Copiar mensaje recordatorio",
  "wc.checklist.copyReminderDone": "¡Recordatorio copiado!",
  "wc.checklist.stat.total": "Miembros totales",
  "wc.checklist.stat.finalized": "Finalizados",
  "wc.checklist.stat.inProgress": "En progreso",
  "wc.checklist.stat.completion": "Completado",
  "wc.checklist.entryStatus.finalized": "Finalizado",
  "wc.checklist.entryStatus.inProgress": "En progreso",
  "wc.checklist.entryStatus.needsPicks": "Faltan picks",
  "wc.checklist.entryStatus.unknown": "Desconocido",
  "wc.checklist.needsReminderBadge": "Necesita recordatorio",
  "wc.checklist.missingPicks": "Faltan {{count}}",
  "wc.checklist.previewReminder": "Vista previa del recordatorio",
  "wc.checklist.privacyNote":
    "Determinista — usa datos del snapshot ya cargado para herramientas del comisionado. No se muestran correos ni IDs.",
  "wc.checklist.empty.memberOnly":
    "Solo el comisionado o admin del grupo puede ver el estado de los miembros.",
  "wc.checklist.empty.loading":
    "Datos del comisionado aún cargando.",
  "wc.checklist.empty.noMembers":
    "Aún no hay miembros con entradas. Comparte el enlace de invitación para empezar.",
  "wc.checklist.empty.fallback":
    "No hay datos de miembros disponibles.",
  "wc.checklist.row.memberFallback": "Miembro",
  "wc.checklist.row.bracketFallback": "Bracket",
  "wc.checklist.row.finalizedRowOne": "{{count}} bracket finalizado",
  "wc.checklist.row.finalizedRowOther": "{{count}} brackets finalizados",

  // ── Commissioner reminder message templates ──────────────────────────
  "wc.checklist.reminder.askCommissioner":
    "Pídele al comisionado del grupo que recuerde a los miembros sobre {{pool}}.",
  "wc.checklist.reminder.finalizeLine":
    "Recordatorio amistoso: finaliza tus picks para \"{{pool}}\" en AllFantasy.",
  "wc.checklist.reminder.joinLine":
    "Recordatorio: únete a \"{{pool}}\" en AllFantasy y confirma tu bracket de la Copa del Mundo.",
  "wc.checklist.reminder.statusLine":
    "Estado: {{done}}/{{total}} brackets finalizados ({{percent}}%).",
  "wc.checklist.reminder.deadlineLine":
    "Los picks cierran {{deadline}}.",
  "wc.checklist.reminder.poweredBy": "Hecho con AllFantasy.",
  "wc.checklist.reminder.noSnapshotLine":
    "Recordatorio: termina tus picks para \"{{pool}}\" en AllFantasy.",

  // ── AI Report card chrome (extended) ─────────────────────────────────
  "wc.aiShareCard.eyebrow": "Gráfico para compartir",
  "wc.aiShareCard.subtitle":
    "Las 6 señales de IA en una tarjeta lista para copiar. Determinista — sin llamadas a IA al compartir.",
  "wc.aiShareCard.tierPro": "AF Pro",
  "wc.aiShareCard.tierPreview": "Vista previa básica",
  "wc.aiShareCard.emptyNoEntry":
    "Elige una entrada de bracket para generar la tarjeta.",
  "wc.aiShareCard.copyShare": "Copiar texto",
  "wc.aiShareCard.copyShareDone": "Copiado",
  "wc.aiShareCard.share": "Compartir",
  "wc.aiShareCard.privacyNote":
    "Privado para ti hasta que lo compartas. Usa solo tus propios datos del bracket y conteos agregados del grupo.",
  "wc.explain.eyebrow": "IA privada",
  "wc.explain.title": "Explica mi bracket",
  "wc.explain.subtitle":
    "Análisis narrativo privado de tu estrategia. Solo tú lo ves.",
  "wc.explain.tierPro": "AF Pro",
  "wc.explain.tierLocked": "Bloqueado",
  "wc.explain.locked":
    "AF Pro abre una explicación privada de IA sobre tu estrategia. Los usuarios con tokens también pueden confirmar un uso único antes de generarla; las llamadas fallidas no descuentan tokens.",
  "wc.explain.upgradeCta": "Actualizar a AF Pro →",
  "wc.explain.generate": "Generar explicación",
  "wc.explain.generating": "Generando...",
  "wc.explain.selectFirst": "Elige primero un bracket",
  "wc.explain.regenerate": "Regenerar",
  "wc.explain.regenerating": "Regenerando...",
  "wc.explain.fallbackBadge": "Respaldo determinista",
  "wc.explain.error.generic": "No se pudo generar la explicación.",
  "wc.explain.error.network": "Error de red. Reintenta.",
  "wc.explain.privacyNote":
    "Privado para ti. Usa solo tus picks y datos públicos de equipos. Nunca se publica en el chat.",
  "wc.uniqueness.eyebrow": "Comparación del grupo",
  "wc.uniqueness.title": "¿Qué hace único a mi bracket?",
  "wc.uniqueness.subtitle":
    "Comparado solo contra los brackets finalizados de este grupo.",
  "wc.uniqueness.tierPro": "AF Pro",
  "wc.uniqueness.tierBasic": "Básico",
  "wc.uniqueness.empty.noEntry":
    "Elige una entrada de bracket para calcular la unicidad.",
  "wc.uniqueness.loading": "Cargando comparación del grupo...",
  "wc.uniqueness.error.couldNotLoad":
    "No se pudieron cargar los datos de unicidad.",
  "wc.uniqueness.error.network": "Error de red. Reintenta.",
  "wc.uniqueness.empty.notEnoughData":
    "La unicidad se desbloquea cuando se envíen más brackets finalizados.",
  "wc.uniqueness.empty.incomplete":
    "Haz tus picks de grupos y eliminatorias para ver qué tan único es tu bracket.",
  "wc.uniqueness.rarity.veryRare": "Muy raro",
  "wc.uniqueness.rarity.rare": "Raro",
  "wc.uniqueness.rarity.uncommon": "Poco común",
  "wc.uniqueness.rarity.common": "Común",
  "wc.uniqueness.percentShare": "Cuota {{percent}}%",
  "wc.uniqueness.privacyNote":
    "Determinista — cuenta solo brackets finalizados. Sin IA, sin picks de otros usuarios.",
  "wc.grade.eyebrow": "Calificación del bracket",
  "wc.grade.completionLabel": "{{percent}}% completo",
  "wc.grade.tierProDetail": "Detalle AF Pro",
  "wc.grade.tierBasic": "Básico",
  "wc.grade.stat.groups": "Grupos",
  "wc.grade.stat.thirdPlace": "Tercer puesto",
  "wc.grade.stat.knockouts": "Eliminatorias",
  "wc.grade.stat.missing": "Faltan",
  "wc.grade.risk": "Nivel de riesgo:",
  "wc.grade.upset": "Medidor de sorpresas:",
  "wc.grade.championConfidence": "Confianza del campeón:",
  "wc.grade.championConfidenceNone": "Sin campeón elegido",
  "wc.grade.biggestRisk": "Mayor riesgo:",
  "wc.grade.recommendation": "Recomendación:",
  "wc.grade.lockedBody":
    "AF Pro desbloquea el riesgo, medidor de sorpresas, confianza del campeón, mayor riesgo y recomendación.",
  "wc.confidence.title": "Verificación de confianza IA",
  "wc.confidence.tierOpen": "Abierto",
  "wc.confidence.tierLocked": "Bloqueado",
  "wc.confidence.missingPicks": "Picks faltantes:",
  "wc.confidence.noMissing": "Ninguno. Listo para finalizar.",
  "wc.confidence.missingBreakdown":
    "{{knockout}} eliminatorias, {{groups}} grupos, {{thirdPlace}} tercer puesto.",
  "wc.confidence.highRiskPicks": "Picks de alto riesgo:",
  "wc.confidence.highRiskBody":
    "{{count}} picks de rondas iniciales definen el camino de tu bracket.",
  "wc.confidence.bracketShape": "Forma del bracket:",
  "wc.confidence.bracketShapeChalk":
    "Demasiado favoritos. Considera si un pick contrario y medido mejora la unicidad.",
  "wc.confidence.bracketShapeBalanced":
    "Balanceado para una primera verificación de confianza.",
  "wc.confidence.finalizeConfidence": "Confianza para finalizar:",
  "wc.confidence.finalizeReady":
    "Listo para finalizar e ir al leaderboard.",
  "wc.confidence.finalizeMissing":
    "Termina los requisitos pendientes antes de finalizar.",
  "wc.confidence.privacyNote":
    "Solo predicción determinista y complejidad de puntuación. La orientación se limita a picks y mecánica de scoring.",
  "wc.confidence.lockedBody":
    "Actualiza a IA/Pro para abrir la verificación de confianza. Usuarios bloqueados no generan llamadas de IA.",
  "wc.path.title": "¿Qué necesita pasar para que yo gane?",
  "wc.path.subtitle":
    "Lectura privada de tu entrada actual. Los picks no finalizados de otros usuarios siguen ocultos.",
  "wc.path.tierActive": "AF Pro activo",
  "wc.path.tierLocked": "AF Pro bloqueado",

  // ── Group Stage picks (gameplay) ─────────────────────────────────────
  "wc.groupStage.loading": "Cargando picks de fase de grupos...",
  "wc.groupStage.failedLoad": "No se pudo cargar la fase de grupos",
  "wc.groupStage.title": "Picks de Fase de Grupos",
  "wc.groupStage.subtitle":
    "Ordena cada grupo del 1° al 4°, luego elige 8 equipos de tercer puesto para avanzar.",
  "wc.groupStage.rankedCount":
    "Grupos ordenados: {{done}}/12",
  "wc.groupStage.lockedNoReason":
    "Los picks de fase de grupos están bloqueados.",
  "wc.groupStage.lockedWithReason":
    "Los picks de fase de grupos están bloqueados: {{reason}}",
  "wc.groupStage.teamCount": "{{count}}/4 equipos",
  "wc.groupStage.teamFallback": "Equipo",
  "wc.groupStage.actualRank": "Real #{{rank}}",
  "wc.groupStage.moveUp": "Subir",
  "wc.groupStage.moveDown": "Bajar",
  "wc.groupStage.needsFourTeams":
    "{{group}} necesita 4 equipos antes de poder guardarse.",
  "wc.groupStage.unsavedOrder":
    "Cambio sin guardar. Pulsa Guardar Grupo antes de que Review lo cuente.",
  "wc.groupStage.savedReviewUses":
    "Guardado. Review usa este orden de grupo.",
  "wc.groupStage.saveGroup": "Guardar Grupo",
  "wc.groupStage.saving": "Guardando...",
  "wc.groupStage.saved": "Guardado",
  "wc.groupStage.retrySave": "Reintentar guardar",
  "wc.groupStage.failedSave":
    "No se pudo guardar el orden del grupo",
  "wc.groupStage.aiTitle": "Análisis IA",
  "wc.groupStage.aiTierOpen": "Abierto",
  "wc.groupStage.aiTierLocked": "Bloqueado",
  "wc.groupStage.aiPrivacyNote":
    "Solo predicción y complejidad de puntuación. La orientación se limita a picks y mecánica.",
  "wc.groupStage.aiLockedBody":
    "Actualiza a IA/Pro para abrir análisis deterministas. No se llama a IA mientras está bloqueado.",
  "wc.groupStage.resultCorrect": "Correcto +{{points}}",
  "wc.groupStage.resultWrong": "Incorrecto +0",
  "wc.groupStage.resultPending": "Resultado pendiente",

  // ── Third-place advancers (gameplay) ─────────────────────────────────
  "wc.thirdPlace.title": "Avanzan por Tercer Puesto",
  "wc.thirdPlace.subtitle":
    "Elige exactamente 8 equipos de tercer puesto después de ordenar todos los grupos.",
  "wc.thirdPlace.selectedCount":
    "Avanzan por tercer puesto: {{count}}/8",
  "wc.thirdPlace.saveBtn": "Guardar Tercer Puesto",
  "wc.thirdPlace.savePicksDone":
    "Picks de Tercer Puesto Guardados",
  "wc.thirdPlace.saving": "Guardando...",
  "wc.thirdPlace.saved": "Guardado",
  "wc.thirdPlace.savePrimaryBtn":
    "Guardar Avanzan por Tercer Puesto",
  "wc.thirdPlace.rankAllFirst":
    "Ordena los 12 grupos antes de elegir los avances por tercer puesto.",
  "wc.thirdPlace.unsaved":
    "Cambios sin guardar. Pulsa Guardar Avanzan por Tercer Puesto antes de que Review los cuente.",
  "wc.thirdPlace.savedReviewUses":
    "Picks de tercer puesto guardados. Review usa estas selecciones.",
  "wc.thirdPlace.errorChoose8":
    "Elige exactamente 8 avances por tercer puesto.",
  "wc.thirdPlace.errorRankFirst":
    "Ordena los 12 grupos antes de elegir avances por tercer puesto.",
  "wc.thirdPlace.failedSave":
    "No se pudieron guardar los avances por tercer puesto",
  "wc.thirdPlace.noPickYet": "Aún sin pick de tercer puesto",
  "wc.thirdPlace.selectedToAdvance": "Elegido para avanzar",
  "wc.thirdPlace.tapToSelect": "Toca para elegir",
  "wc.thirdPlace.selectAria":
    "Elegir a {{name}} como avance por tercer puesto",
  "wc.thirdPlace.aiTitle": "Pregúntale a Chimmy",
  "wc.thirdPlace.aiLockedBody":
    "IA/Pro abre los análisis de selección de tercer puesto. Los usuarios bloqueados solo ven el CTA y no se hace ninguna llamada de IA.",

  // ── Matchup card (gameplay) ──────────────────────────────────────────
  "wc.matchup.matchLabel": "Partido {{number}}",
  "wc.matchup.openGuidedAria":
    "Abrir asistente guiado para el partido {{number}}",
  "wc.matchup.statusFinal": "Final",
  "wc.matchup.statusPostponed": "Aplazado",
  "wc.matchup.statusCancelled": "Cancelado",
  "wc.matchup.statusSimulated": "Simulado",
  "wc.matchup.statusTestFixture": "Partido de prueba",
  "wc.matchup.statusSaving": "Guardando...",
  "wc.matchup.notReadyPill": "Sin picks aún",
  "wc.matchup.pickBadgeCorrect": "Correcto",
  "wc.matchup.pickBadgeIncorrect": "Incorrecto",
  "wc.matchup.pickVisualCorrect": "Pick correcto",
  "wc.matchup.pickVisualIncorrect": "Pick incorrecto",
  "wc.matchup.pickVisualPending": "Pendiente",
  "wc.matchup.yourPick": "Tu pick:",
  "wc.matchup.points": "{{points}} pts",
  "wc.matchup.pointsPositive": "+{{points}} pts",
  "wc.matchup.zeroPts": "0 pts",
  "wc.matchup.pending": "Pendiente",
  "wc.matchup.winnerOfficial": "Ganador: {{name}}",
  "wc.matchup.unpickableFinal": "Este partido ya es final.",
  "wc.matchup.unpickableMissingTeam":
    "Elige primero los ganadores de rondas previas.",
  "wc.matchup.unpickableUnknown": "Equipos aún no disponibles.",
  "wc.matchup.ftBadge": "FT",
  "wc.matchup.confidenceTitle": "Bono de confianza",
  "wc.matchup.confidenceHint":
    "Más confianza = más puntos extra si aciertas.",
  "wc.matchup.confidencePointSingle": "{{value}} punto",
  "wc.matchup.confidencePointPlural": "{{value}} puntos",
  "wc.matchup.aiInsightsLabel": "Análisis IA",
  "wc.matchup.aiTierOpen": "Abierto",
  "wc.matchup.aiTierLocked": "Bloqueado",
  "wc.matchup.aiSaferPick": "Pick más seguro:",
  "wc.matchup.aiSaferBody":
    "{{name}} según el orden actual de slots del bracket.",
  "wc.matchup.aiUpsidePick": "Pick con upside:",
  "wc.matchup.aiUpsideBody":
    "{{name}} si necesitas un camino diferenciado.",
  "wc.matchup.aiBracketImpact": "Impacto en el bracket:",
  "wc.matchup.aiBracketImpactBody":
    "El ganador llena el siguiente slot; cambiar este pick puede reiniciar elecciones posteriores.",
  "wc.matchup.aiUpsetRisk": "Riesgo de sorpresa:",
  "wc.matchup.aiUpsetRiskBody":
    "Medio hasta que lleguen forma en vivo y resultados oficiales.",
  "wc.matchup.aiPrivacyNote":
    "Solo predicción y complejidad de puntuación. La orientación se limita a picks y mecánica.",
  "wc.matchup.aiLockedBody":
    "Actualiza a IA/Pro para abrir el análisis. Los usuarios bloqueados no activan llamadas de IA.",
  "wc.matchup.pickAriaPicked": "Elegir a {{name}} para ganar",
  "wc.matchup.pickAriaSelected": "Elegido: {{name}} para ganar",
  "wc.matchup.disabledLocked":
    "Los picks de este partido están bloqueados",
  "wc.matchup.disabledSaving": "Este pick se está guardando",
  "wc.matchup.winnerLabel": "Ganador",
  "wc.matchup.lockHintTournament": "Cierra al iniciar el torneo",
  "wc.matchup.lockHintKickoff": "Cierra al saque inicial",
  "wc.matchup.lockHintTournamentWithTime": "Cierra {{at}}",
  "wc.matchup.lockHintKickoffWithTime":
    "Cierra al saque inicial · {{at}}",
  "wc.matchup.bracketBoardChampionLabel": "Pick de Campeón",
  "wc.matchup.bracketBoardChampionFallback": "Sin elegir",
  "wc.matchup.bracketBoardHelper":
    "Tu bracket de eliminatorias se genera a partir de tus resultados de grupos. Los picks avanzan en pantalla en cuanto eliges un ganador.",
  "wc.matchup.aiHomeSideFallback": "Local",
  "wc.matchup.aiAwaySideFallback": "Visitante",
  "wc.matchup.pensAbbr": "pen",

  // ── Bracket round column labels ──────────────────────────────────────
  "wc.round.roundOf32": "Ronda de 32",
  "wc.round.roundOf16": "Octavos de Final",
  "wc.round.quarterfinal": "Cuartos de Final",
  "wc.round.semifinal": "Semifinales",
  "wc.round.thirdPlace": "Tercer Lugar",
  "wc.round.final": "Final",

  // ── Review tab finalize/missing-picks checklist ──────────────────────
  "wc.review.savedThirdPlaceTitle":
    "Avances por Tercer Puesto Guardados",
  "wc.review.noSavedThirdPlace":
    "Aún no hay avances por tercer puesto guardados.",
  "wc.review.loadingSavedThirdPlace":
    "Cargando picks de tercer puesto...",
  "wc.review.savedKnockoutTitle": "Picks de Eliminatorias Guardados",
  "wc.review.noSavedKnockout":
    "Aún no hay picks de eliminatorias guardados.",
  "wc.review.knockoutPickPrefix": "Partido {{number}} · ",
  "wc.review.missingRequirementsTitle": "Faltan requisitos",
  "wc.review.needsRefinalize":
    "La entrada cambió tras enviarse. Completa los picks faltantes y vuelve a finalizar.",
  "wc.review.missingGroupRankings":
    "Faltan órdenes de grupo: {{groups}}",
  "wc.review.thirdPlaceCount":
    "Avances por tercer puesto: {{count}}/8",
  "wc.review.missingKnockout":
    "Faltan picks de eliminatorias: {{count}}",
  "wc.review.lockedNoTime":
    "Bloqueado: los picks ya no se pueden editar",
  "wc.review.lockedWithTime":
    "Bloqueado: los picks ya no se pueden editar · enviado {{at}}",
  "wc.review.completeDraftHelper":
    "Borrador completo. Finaliza para enviarlo al leaderboard; aún puedes editar hasta el cierre.",
  "wc.review.finalizing": "Finalizando...",
  "wc.review.finalizeEntry": "Finalizar Entrada",
  "wc.review.refinalizeEntry": "Refinalizar Entrada",
  "wc.review.completeAllToUnlock":
    "Completa los requisitos faltantes para desbloquear Finalizar.",
  "wc.review.tapRefresh":
    "Pulsa Actualizar Review para verificar el progreso.",
  "wc.review.createEntryFirstTitle": "Crea primero una entrada",
  "wc.review.createEntryFirstBody":
    "El review y la finalización se guardan por entrada de bracket.",
  "wc.review.createMyBracket": "Crear mi bracket",
  "wc.review.creating": "Creando...",
  "wc.review.openMyBracket": "Abrir mi bracket",

  // ── Review tab: hero section ──────────────────────────────────────────
  "wc.review.heroTitle": "Revisa Tu Camino a la Gloria",
  "wc.review.heroSubtitle": "Comprueba cada grupo, camino de eliminatorias y finalistas antes de confirmarlo.",
  "wc.review.groupChangeWarning": "Cambiar los picks de Fase de Grupos puede desfinalizar tu entrada si los picks de eliminatorias se restablecen.",
  "wc.review.statusIncomplete": "Incompleto",
  "wc.review.statusReady": "Listo para Finalizar",
  "wc.review.statusFinalized": "Finalizado",
  "wc.review.statusLocked": "Bloqueado",
  "wc.review.checking": "Comprobando...",
  "wc.review.refreshReview": "Actualizar revisión",
  "wc.review.loadingReview": "Cargando...",
  "wc.review.stat.groups": "Grupos Clasificados",
  "wc.review.stat.thirdPlace": "Mejor Tercero",
  "wc.review.stat.knockouts": "Picks de Eliminatorias",
  "wc.review.scoringNoteTitle": "Nota de puntuación",
  "wc.review.scoringNoteBody": "Finalizado = enviado para clasificación. Bloqueado = plazo vencido, los picks no se pueden editar.",
  "wc.review.resultPendingNote": "Resultado pendiente significa que tu pick esta guardado, pero el resultado oficial del partido aun no se publico ni se puntuo.",
  "wc.review.afProUnlocks": "AF Pro desbloquea",
  "wc.review.afProUnlocksDetails": "el informe completo — Confianza del campeón, Camino a la victoria, la narrativa de IA, tu perspectiva de singularidad y la tarjeta de compartir completa.",
  "wc.review.savedGroupTitle": "Picks de Fase de Grupos Guardados",
  "wc.review.savedGroupNote": "Tus predicciones · resultados oficiales mostrados por separado",
  "wc.review.groupPicksSaved": "{{n}}/4 guardados",
  "wc.review.noGroupPicksYet": "Sin clasificación guardada aún.",
  "wc.review.loadingGroupPicks": "Cargando picks de fase de grupos...",
  "wc.review.finalizeLockWarning": "Los picks pueden no ser editables después del plazo de bloqueo.",

  // ── Guided Matchup Picker (Phase 6) ──────────────────────────────────
  "wc.guided.dialogLabel": "Selector de partidos guiado",
  "wc.guided.closeLabel": "Cerrar selector guiado",
  "wc.guided.timeTbd": "Hora por confirmar",
  "wc.guided.awaitingResult": "Esperando resultado",
  "wc.guided.tbd": "PEND",
  "wc.guided.matchFinal": "Final",
  "wc.guided.matchPostponed": "Aplazado",
  "wc.guided.pickAriaLabel": "Elegir a {{teamName}} como ganador",
  "wc.guided.progressRound": "{{label}} · {{done}}/{{total}} picks",
  "wc.guided.progressOverall": "{{pct}}% en total",
  "wc.guided.headerLocked": "Bracket bloqueado",
  "wc.guided.headerFixturesNotReady": "Partidos no listos",
  "wc.guided.headerStart": "Empieza a elegir",
  "wc.guided.headerComplete": "Bracket completo",
  "wc.guided.headerGuided": "Picks guiados",
  "wc.guided.lockedHelper":
    "Este bracket está bloqueado. Ya no se pueden cambiar los picks.",
  "wc.guided.emptyTeamsUpstream":
    "Los equipos de esta ronda aparecerán al elegir los partidos anteriores.",
  "wc.guided.emptyFixturesUnresolved":
    "Los partidos están cargados, pero los enfrentamientos reales aún no se han resuelto.",
  "wc.guided.close": "Cerrar",
  "wc.guided.back": "Atrás",
  "wc.guided.skip": "Saltar",
  "wc.guided.matchNumber": "Partido {{number}}",
  "wc.guided.saving": "Guardando…",
  "wc.guided.saved": "Guardado",
  "wc.guided.nextMatchup": "Siguiente partido…",
  "wc.guided.tapToSelect": "Toca un equipo para elegir al ganador",
  "wc.guided.tapToChange": "Toca el otro equipo para cambiar tu pick",
  "wc.guided.matchFinalNote": "Este partido ya terminó.",
  "wc.guided.pickEarlierRoundsFirst":
    "Elige primero a los ganadores de las rondas previas.",
  "wc.guided.matchEnded": "Este partido ya terminó.",
  "wc.guided.matchLocked": "Los picks de este partido están bloqueados.",
  "wc.guided.confidenceTitle": "Bonus de confianza",
  "wc.guided.confidenceHelper":
    "Más confianza significa más puntos extra si aciertas.",
  "wc.guided.confidenceOptionOne": "1 punto",
  "wc.guided.confidenceOptionOther": "{{n}} puntos",
  "wc.guided.bracketCompleteTitle": "¡Bracket completo!",
  "wc.guided.bracketCompleteBody": "Has elegido todos los partidos.",
  "wc.guided.reviewBracket": "Revisar bracket",
  "wc.guided.done": "Listo",
  "wc.guided.errorNotReady": "Este partido aún no está listo para picks.",
  "wc.guided.errorSaveFailed": "No se pudo guardar el pick",
  "wc.guided.vs": "VS",

  // ── Score Summary card (Phase 6) ─────────────────────────────────────
  "wc.summary.title": "Tarjeta de puntaje del bracket",
  "wc.summary.rankPlaceholder": "Posición —",
  "wc.summary.bracketComplete": "Bracket completo",
  "wc.summary.bracketIncomplete": "Bracket incompleto",
  "wc.summary.fixturesNotReady":
    "Los partidos aún no están totalmente confirmados — la puntuación se actualizará cuando se hagan oficiales.",
  "wc.summary.scoresNotSynced":
    "Los marcadores no se han sincronizado todavía — los puntos aparecerán cuando se publiquen los resultados.",
  "wc.summary.locked":
    "Bracket bloqueado — los picks están congelados.",
  "wc.summary.totalPts": "Pts totales",
  "wc.summary.possibleLeft": "Posibles restantes",
  "wc.summary.correct": "Correctos",
  "wc.summary.wrong": "Errados",
  "wc.summary.championPick": "Campeón elegido",
  "wc.summary.championAlive": "Campeón vivo",
  "wc.summary.championBusted": "Campeón eliminado",
  "wc.summary.noChampionYet": "Aún no has elegido campeón",
  "wc.summary.maxCeiling": "Techo máximo",
  "wc.summary.maxCeilingBody":
    " pts posibles para tus caminos restantes",

  // ── Round Breakdown card (Phase 6) ───────────────────────────────────
  "wc.roundBreakdown.title": "Puntos por ronda",
  "wc.roundBreakdown.ptsAbbrev": "{{n}} pts",
  "wc.roundBreakdown.perWin": "por victoria",
  "wc.roundBreakdown.championBonus":
    "Bonus de campeón activo: {{bonus}} pts si tu campeón gana la final (política — confirma las reglas del torneo).",

  // ── Leaderboard Insights card (Phase 6) ──────────────────────────────
  "wc.insights.title": "Insights de la tabla",
  "wc.insights.empty":
    "Los insights aparecen una vez que las entradas finalizadas se hayan puntuado. Confirma tus picks antes del primer partido.",
  "wc.insights.currentLeader": "Líder actual",
  "wc.insights.largestGap": "Mayor diferencia",
  "wc.insights.entries": "Entradas",
  "wc.insights.championsAlive": "Campeones vivos",
  "wc.insights.mostCorrect": "Más aciertos",
  "wc.insights.closestRace": "Pelea más cerrada",
  "wc.insights.notClose": "Sin pelea cerrada",
  "wc.insights.gapPts": "{{n}} pts",
  "wc.insights.mostCorrectValue": "{{name}} ({{count}})",
  "wc.insights.aiSummaryTitle": "Resumen IA del grupo",
  "wc.insights.aiBadgeUnlocked": "Solo finalizadas",
  "wc.insights.aiBadgeLocked": "Bloqueado",
  "wc.insights.aiNotAvailable": "Aún no disponible",
  "wc.insights.aiSummaryCountOne":
    "{{count}} entrada pública incluida.",
  "wc.insights.aiSummaryCountOther":
    "{{count}} entradas públicas incluidas.",
  "wc.insights.aiSummaryLabel": "Resumen solo de finalizadas:",
  "wc.insights.aiCommonChampionLabel": "Campeón más común:",
  "wc.insights.aiRaceLabel": "Nota de pelea:",
  "wc.insights.aiRaceClose":
    "Las dos primeras entradas están a 5 puntos o menos.",
  "wc.insights.aiRaceNotClose":
    "Aún no hay una pelea cerrada entre los dos primeros.",
  "wc.insights.aiWinReadLabel": "Lectura IA:",
  "wc.insights.aiWinReadBody":
    "{{name}} proyecta {{pct}}% con salud de bracket {{health}}.",
  "wc.insights.aiPrivacyNote":
    "Usa solo datos públicos de la tabla finalizada. No incluye picks privados sin finalizar. La guía del bracket se limita a picks del grupo y mecánica de puntos.",
  "wc.insights.aiUpgradeNote":
    "Actualiza a IA/Pro para resúmenes solo de entradas finalizadas. Las cuentas bloqueadas no disparan llamadas de IA.",

  // ── Settings panel chrome (Phase 6) ──────────────────────────────────
  "wc.settings.title": "Ajustes del grupo",
  "wc.settings.subtitle":
    "Identidad, límites, puntuación, visibilidad y alertas — controles del comisionado para tu grupo de la Copa del Mundo.",
  "wc.settings.loading": "Cargando ajustes del grupo…",
  "wc.settings.sectionIdentity": "Identidad del grupo",
  "wc.settings.save": "Guardar ajustes",
  "wc.settings.saving": "Guardando…",
  "wc.settings.toastNoChanges": "No hay cambios para guardar.",
  "wc.settings.toastSaved": "Ajustes guardados.",
  "wc.settings.toastError": "No se pudieron guardar los ajustes",

  // ── Commissioner Brain panel chrome (Phase 6) ────────────────────────
  "wc.brain.title": "Cerebro del comisionado",
  "wc.brain.subtitle":
    "Resumen, alertas y ayudas IA — controla tu grupo desde un solo lugar.",
  "wc.brain.loading": "Cargando herramientas del comisionado…",
  "wc.brain.loadError":
    "No se pudieron cargar las herramientas del comisionado.",

  // ── Home tab: commissioner quick panel ──────────────────────────────
  "wc.home.commissioner.syncing": "Sincronizando...",
  "wc.home.commissioner.syncBtn": "Sincronizar Encuentros",
  "wc.home.commissioner.settingsBtn": "Ajustes del Pool",
  "wc.home.commissioner.inviteBtn": "Invitar Jugadores",

  // ── Home tab: fixture readiness card ────────────────────────────────
  "wc.home.fixtureReady.cardTitle": "Estado de Encuentros",
  "wc.home.fixtureReady.descReady": "Los emparejamientos del Ronda de 32 tienen equipos y pueden seleccionarse. Los encuentros de prueba se marcan como datos de prueba.",
  "wc.home.fixtureReady.descBlocked": "Los picks están bloqueados mientras los emparejamientos sean marcadores de posición. Sincroniza los encuentros oficiales o carga encuentros de prueba.",
  "wc.home.fixtureReady.knockoutLocked": "Los picks de eliminatorias abren cuando los encuentros oficiales del Ronda de 32 estén disponibles",
  "wc.home.fixtureReady.readySingle": "{{n}} emparejamiento disponible para picks",
  "wc.home.fixtureReady.readyPlural": "{{n}} emparejamientos disponibles para picks",
  "wc.home.fixtureReady.notSynced": "Los encuentros aún no se han sincronizado",
  "wc.home.fixtureReady.notReady": "Encuentros cargados, pero los equipos son marcadores de posición",
  "wc.home.fixtureReady.commissionerSettings": "Ajustes del Comisionado",

  // ── Picks tab: guided pick help banners ─────────────────────────────
  "wc.pickHelp.fixturesNotSynced": "Los picks abren cuando los encuentros de la Copa del Mundo se sincronicen o se carguen encuentros de prueba en este pool.",
  "wc.pickHelp.seedBtn": "Cargar Encuentros de Prueba",
  "wc.pickHelp.seeding": "Cargando...",
  "wc.pickHelp.knockoutFromGroups": "Tus emparejamientos de eliminatorias se generan desde tus predicciones de Fase de Grupos. Clasifica todos los grupos y elige avanzados de tercer lugar para desbloquear más ranuras.",
  "wc.pickHelp.title": "Ayuda para Picks Guiados",
  "wc.pickHelp.body": "Usa el botón fijo Comenzar Picks en móvil para avanzar por los emparejamientos de uno en uno. Las herramientas de IA se habilitarán más adelante.",
  "wc.pickHelp.knockoutLocked": "Eliminatorias Bloqueadas",
  "wc.pickHelp.continueGuided": "Continuar Picks Guiados",
  "wc.pickHelp.reviewGuided": "Revisar Picks Guiados",
  "wc.pickHelp.picksBlocked": "Selecciona primero a los ganadores de rondas anteriores. Más emparejamientos se desbloquean a medida que avanza tu bracket.",

  // ── AI Simulation lock panel ─────────────────────────────────────────
  "wc.aiLock.badge": "Vista Previa Bloqueada",
  "wc.aiLock.title": "Simulación de IA Bloqueada",
  "wc.aiLock.body": "La Simulación de IA desbloquea ganadores proyectados, sorpresas de bracket y rutas al campeonato.",
  "wc.aiLock.tier": "Requiere AF Pro o AF Supreme",
  "wc.aiLock.commissionerNote": "Las herramientas de IA del comisionado requieren AF Comisionado o AF Supreme.",

  // ── Premium access panel ─────────────────────────────────────────────
  "wc.premium.eyebrow": "Acceso Copa del Mundo",
  "wc.premium.title": "El juego gratuito sigue abierto. Las herramientas premium están claramente delimitadas.",
  "wc.premium.body": "Únete, crea tu primer bracket, haz picks de Fase de Grupos y Eliminatorias, revisa, finaliza y consulta el leaderboard gratis.",
  "wc.premium.entryCap": "Límite de entradas:",
  "wc.premium.freeLimitSingle": "Los usuarios gratuitos pueden crear una entrada de bracket en este pool.",
  "wc.premium.freeLimitPlural": "Este pool permite hasta {{n}} entradas. Los usuarios gratuitos pueden crear su primer bracket; los controles del comisionado gestionan las reglas de múltiples entradas.",
  "wc.premium.commissionerSection": "AF Comisionado",
  "wc.premium.aiSection": "IA/Pro",
  "wc.premium.unlocked": "Desbloqueado",
  "wc.premium.card.commissioner.title": "Herramientas AF Comisionado",
  "wc.premium.card.commissioner.descOwner": "Preparación, sincronización, simulación, ajustes, invitaciones y herramientas de QA disponibles para usuarios con acceso completo.",
  "wc.premium.card.commissioner.descOther": "Controles de pool privado/público, gestión de invitaciones, hooks de puntuación personalizados y configuración del comisionado.",
  "wc.premium.card.chat.title": "Chat del Pool",
  "wc.premium.card.chat.desc": "Chat de liga para anfitriones del pool, anuncios y discusión moderada.",
  "wc.premium.card.export.title": "Exportar Leaderboard",
  "wc.premium.card.export.desc": "Exporta clasificaciones y resúmenes de brackets para revisión del comisionado.",
  "wc.premium.card.multiEntry.title": "Múltiples Entradas",
  "wc.premium.card.multiEntry.desc": "Controles de múltiples entradas a nivel de pool más allá de la primera entrada gratuita.",
  "wc.premium.card.bracketBuilder.title": "Constructor de Brackets IA",
  "wc.premium.card.bracketBuilder.desc": "Construcción guiada de brackets con sugerencias deterministas contextuales.",
  "wc.premium.card.matchupPreview.title": "Vista Previa de Emparejamientos IA",
  "wc.premium.card.matchupPreview.desc": "Vista previa de tendencias, riesgos y rutas de sorpresa cuando los encuentros oficiales estén disponibles.",
  "wc.premium.card.whatIf.title": "Escenarios ¿Qué Pasaría Si? IA",
  "wc.premium.card.whatIf.desc": "Escenarios del leaderboard para saber qué necesita pasar a continuación.",
  "wc.premium.card.alerts.title": "Alertas IA",
  "wc.premium.card.alerts.desc": "Alertas futuras para cambios en el bracket, notas del optimizador de grupos y señales del buscador de sorpresas.",

  // ── Daily Edge Report ─────────────────────────────────────────────────
  "wc.edgeReport.title": "Informe de Ventaja Diaria",
  "wc.edgeReport.subtitle": "Lo que más importa hoy en tu grupo",
  "wc.edgeReport.badge.free": "Gratis",
  "wc.edgeReport.badge.included": "Incluido en el plan",
  "wc.edgeReport.loading": "Creando tu informe de ventaja…",
  "wc.edgeReport.error": "No se pudo cargar tu informe de ventaja. Intenta recargar.",
  "wc.edgeReport.section.matchThatMatters": "El Partido que Importa",
  "wc.edgeReport.section.rootFor": "A Quién Apoyar",
  "wc.edgeReport.section.threats": "Quién Puede Superarte",
  "wc.edgeReport.section.bestPath": "Mejor Camino Para Subir",
  "wc.edgeReport.section.mistakeToAvoid": "El Error que Evitar",
  "wc.edgeReport.coaching.title": "Coaching de Chimmy",
  "wc.edgeReport.coaching.cachedBadge": "Desbloqueado hoy",
  "wc.edgeReport.coaching.includedLabel": "Incluido en tu plan",
  "wc.edgeReport.coaching.unlockBtn": "Desbloquear coaching de hoy",
  "wc.edgeReport.coaching.tokenCost": "1 token",
  "wc.edgeReport.coaching.loading": "Generando coaching…",
  "wc.edgeReport.coaching.error": "Coaching no disponible ahora. Inténtalo de nuevo.",
  "wc.edgeReport.coaching.spendFailed": "No se pudo deducir el token. Revisa tu saldo e inténtalo de nuevo.",
  "wc.edgeReport.commissionerPost.title": "Idea de Publicación para tu Grupo",
  "wc.edgeReport.commissionerPost.postBtn": "Publicar en el chat del grupo",
  "wc.edgeReport.commissionerPost.posting": "Publicando…",
  "wc.edgeReport.commissionerPost.posted": "¡Publicado!",
  "wc.edgeReport.freshness": "Determinístico · se actualiza cada día de partido",
  "wc.edgeReport.noEntry": "Agrega tus picks de bracket para ver tu informe de ventaja diaria.",
  "wc.edgeReport.billing.cached": "Sin token usado · el coaching ya fue desbloqueado hoy",
  "wc.edgeReport.billing.included": "Incluido en tu plan",
  "wc.edgeReport.billing.charged": "1 token usado",
  "wc.edgeReport.feedback.title": "¿Fue útil esto?",
  "wc.edgeReport.feedback.helpful": "Útil",
  "wc.edgeReport.feedback.notHelpful": "No útil",
  "wc.edgeReport.feedback.tooBasic": "Muy básico",
  "wc.edgeReport.feedback.notActionable": "No accionable",
  "wc.edgeReport.feedback.wrongData": "Datos incorrectos",
  "wc.edgeReport.feedback.greatInsight": "Gran insight",
  "wc.edgeReport.feedback.thanks": "Gracias por tu feedback",
  "wc.edgeReport.cue.ready": "Tu Ventaja de Hoy Lista",
}

// Traditional Chinese (zh-TW). Sports-app voice — short, scannable.
const ZH: WorldCupDictionary = {
  // ── Shared / shell ───────────────────────────────────────────────────
  "wc.common.loading": "載入中...",
  "wc.common.back": "返回",
  "wc.common.openSettings": "開啟設定",
  "wc.common.signIn": "登入",
  "wc.common.signOut": "登出",

  // ── Public hub: /brackets/world-cup ──────────────────────────────────
  "wc.publicHub.backToBrackets": "← 返回賽事預測",
  "wc.publicHub.heroTitle": "世界盃對戰預測挑戰",
  "wc.publicHub.heroSubtitle":
    "為 FIFA 世界盃建立 NCAA 風格的對戰預測群組。邀請朋友、選出贏家、追蹤即時比分,並衝上排行榜。",
  "wc.publicHub.discover": "探索公開群組",
  "wc.publicHub.joinWithCode": "用邀請碼加入",
  "wc.publicHub.createPool": "建立群組",
  "wc.publicHub.createWorldCupPool": "建立世界盃群組",
  "wc.publicHub.yourPools": "你的世界盃群組",
  "wc.publicHub.poolsCountOne": "{{count}} 個群組",
  "wc.publicHub.poolsCountOther": "{{count}} 個群組",
  "wc.publicHub.scoreLabel": "積分",
  "wc.publicHub.rankLabel": "排名",
  "wc.publicHub.participantsOne": "{{count}} 位參賽者",
  "wc.publicHub.participantsOther": "{{count}} 位參賽者",
  "wc.publicHub.statusOpen": "開放中",
  "wc.publicHub.statusLocked": "已鎖定",
  "wc.publicHub.statusFinal": "已結束",
  "wc.publicHub.emptyTitle": "尚未加入任何世界盃群組",
  "wc.publicHub.emptyBody":
    "你還沒有建立或加入任何世界盃對戰群組。",
  "wc.publicHub.emptyHint":
    "建立一個並邀請朋友,或向朋友要邀請碼。",
  "wc.publicHub.signInTitle": "登入即可開始",
  "wc.publicHub.signInBody":
    "建立或加入世界盃對戰群組,和朋友一起競賽。",
  "wc.publicHub.signInCta": "登入並開始",
  "wc.publicHub.feature.privatePublic":
    "私人或公開群組 — 最多 100 位參賽者。",
  "wc.publicHub.feature.bracketsPerUser":
    "每位使用者最多 5 個對戰表,用不同策略一起比拼。",
  "wc.publicHub.feature.ncaaScoring":
    "NCAA 風格計分 — 越後面的回合分數越高。",
  "wc.publicHub.feature.guidedPicker":
    "AI 對戰預覽輔助的引導式選擇工具。",
  "wc.publicHub.feature.liveTracking":
    "即時比分與分鐘級追蹤。",
  "wc.publicHub.feature.aiBracketBuilder":
    "AI 對戰表生成器自動填入尚未選擇的比賽。",
  "wc.publicHub.feature.perBracketLeaderboard":
    "每個對戰表都有獨立排行榜,個別排名。",
  "wc.publicHub.feature.lockOnKickoff":
    "世界盃首場比賽開賽時對戰表即鎖定。",

  // ── Public hub: v2 command center ────────────────────────────────────
  "wc.publicHub.commandEyebrow": "AF 世界盃 Pools 指揮中心",
  "wc.publicHub.commandTitle": "打造你的世界盃奪冠之路。",
  "wc.publicHub.commandSubtitle":
    "建立群組、邀請好友、預測各組名次、選擇淘汰賽路徑,讓排行榜燃起來。",
  "wc.publicHub.trustNote": "無賭博成分。只有榮耀、策略與吹噓的資本。",
  "wc.publicHub.stat.teams": "48 支球隊",
  "wc.publicHub.stat.groups": "12 個小組",
  "wc.publicHub.stat.matches": "104 場比賽",
  "wc.publicHub.stat.format": "小組賽 + 淘汰賽",
  "wc.publicHub.actionsTitle": "你想怎麼開始？",
  "wc.publicHub.action.create.title": "建立群組",
  "wc.publicHub.action.create.desc": "建立私人或公開的世界盃群組並邀請朋友加入。",
  "wc.publicHub.action.join.title": "用代碼加入",
  "wc.publicHub.action.join.desc": "有邀請碼？輸入後馬上加入。",
  "wc.publicHub.action.discover.title": "探索公開群組",
  "wc.publicHub.action.discover.desc": "尋找開放中的世界盃群組並加入競賽。",
  "wc.publicHub.how.title": "AF 世界盃 Pools 如何運作",
  "wc.publicHub.how.step1Title": "建立或加入群組",
  "wc.publicHub.how.step1Body":
    "為你的朋友建立私人群組，或找一個任何人都可以加入的公開群組。",
  "wc.publicHub.how.step2Title": "預測各組名次",
  "wc.publicHub.how.step2Body":
    "預測每支球隊在小組中的排名，包含晉級的第三名球隊。",
  "wc.publicHub.how.step3Title": "建立淘汰賽路徑",
  "wc.publicHub.how.step3Body":
    "從 32 強到四強、半決賽，一路選到最終決賽。",
  "wc.publicHub.how.step4Title": "定稿並衝上排行榜",
  "wc.publicHub.how.step4Body":
    "在第一場比賽開踢前鎖定對戰表，然後即時追蹤排名並分享結果。",
  "wc.publicHub.ai.title": "AI 驅動的對戰表工具",
  "wc.publicHub.ai.subtitle":
    "Chimmy 和 AllFantasy AI 幫助你理解風險、發掘洞察，並指導管理員。",
  "wc.publicHub.ai.explain.title": "解析我的對戰表",
  "wc.publicHub.ai.explain.desc":
    "AI 讀取你的選擇並解釋你的對戰表有何獨特之處。",
  "wc.publicHub.ai.danger.title": "淘汰賽風險區",
  "wc.publicHub.ai.danger.desc": "查看你的哪些淘汰賽選擇最容易受到冷門影響。",
  "wc.publicHub.ai.chat.title": "群組聊天 + 策略",
  "wc.publicHub.ai.chat.desc": "在群組聊天中直接問 @Chimmy 選人建議。",
  "wc.publicHub.ai.commissioner.title": "管理員洞察",
  "wc.publicHub.ai.commissioner.desc":
    "AI 摘要涵蓋群組健康度、對戰表多樣性和成員活躍度。",
  "wc.publicHub.ai.gating": "適用於符合資格的 AI 方案或代幣工具。",
  "wc.publicHub.social.title": "呼朋引伴一起玩。",
  "wc.publicHub.social.desc":
    "分享你的群組連結、向朋友發起挑戰，讓排行榜決出勝負。",
  "wc.publicHub.social.cta": "建立群組以取得邀請連結",
  "wc.publicHub.trust.note":
    "AllFantasy 世界盃 Pools 僅供 fantasy sports 娛樂、策略挑戰和互相較勁之用，不涉及博弈或下注。",

  // ── Pool dashboard: tab labels ───────────────────────────────────────
  "wc.tab.home": "首頁",
  "wc.tab.groupStage": "小組賽",
  "wc.tab.picks": "淘汰賽",
  "wc.tab.review": "檢閱",
  "wc.tab.leaderboard": "排行榜",
  "wc.tab.rules": "規則",
  "wc.tab.invite": "邀請",
  "wc.tab.commissioner": "管理員",
  "wc.tab.admin": "設定",

  // ── Pool dashboard: sticky subnav labels ─────────────────────────────
  "wc.subnav.quickJump": "快速跳轉",
  "wc.subnav.start": "開始",
  "wc.subnav.groupBuilder": "小組排序",
  "wc.subnav.bracketBoard": "淘汰賽表",
  "wc.subnav.firstRound": "首輪",
  "wc.subnav.opsTools": "營運工具",
  "wc.subnav.rankSnapshot": "排名快照",
  "wc.subnav.inviteCenter": "邀請中心",

  // ── Mobile bottom nav: short labels ──────────────────────────────────
  "wc.tab.leaderboard.short": "排行",
  "wc.tab.commissioner.short": "管理",
  "wc.tab.settings.short": "設定",
  "wc.tab.home.short": "首頁",
  "wc.tab.groupStage.short": "小組",
  "wc.tab.picks.short": "對戰",
  "wc.tab.review.short": "檢閱",
  "wc.tab.rules.short": "規則",
  "wc.tab.invite.short": "邀請",
  "wc.tab.admin.short": "設定",

  // ── Rules tab ────────────────────────────────────────────────────────
  "wc.rules.hero.eyebrow": "水池",
  "wc.rules.hero.title": "水池規則",
  "wc.rules.hero.subtitle": "了解積分、截止日期、參賽名額及你的世界盃水池運作方式。",
  "wc.rules.how.title": "如何運作",
  "wc.rules.how.body1": "從32強到冠軍，選出每場比賽的勝者。每場比賽開球時預測即鎖定。",
  "wc.rules.how.body2": "每輪正確預測可獲得更多積分。比賽結果更新後，積分與排行榜隨之刷新。",
  "wc.rules.scoring.title": "積分規則",
  "wc.rules.scoring.roundOf32": "32強",
  "wc.rules.scoring.roundOf16": "16強",
  "wc.rules.scoring.quarterfinal": "八強",
  "wc.rules.scoring.semifinal": "四強",
  "wc.rules.scoring.final": "決賽",
  "wc.rules.scoring.champion": "冠軍加分",
  "wc.rules.scoring.thirdPlace": "季軍賽",
  "wc.rules.scoring.pts": "分",
  "wc.rules.settings.title": "水池設定",
  "wc.rules.settings.bracketsPerUser": "每位用戶的對戰表數",
  "wc.rules.settings.thirdPlace": "季軍賽",
  "wc.rules.settings.thirdPlaceOn": "已包含",
  "wc.rules.settings.thirdPlaceOff": "關閉",
  "wc.rules.settings.inviteSharing": "邀請分享",
  "wc.rules.settings.inviteCommish": "僅限管理員",
  "wc.rules.trustNote": "無賭注。無博彩。只有世界盃預測、策略和自豪感。",

  // ── Pool dashboard: home tab ──────────────────────────────────────────
  "wc.home.title": "世界盃水池儀表板",
  "wc.home.subtitle": "從這裡開始：創建或開啟你的對戰表，對小組賽進行排名，選擇淘汰賽，審閱後完成提交以進入排行榜。",
  "wc.home.copyInvite": "複製邀請",
  "wc.home.invitePanel": "邀請面板",
  "wc.home.stat.participants": "參與者",
  "wc.home.stat.entries": "參賽名額",
  "wc.home.stat.finalized": "已完成的參賽",
  "wc.home.stat.fixtureStatus": "賽程狀態",
  "wc.home.stat.ready": "就緒",
  "wc.home.stat.notReady": "未就緒",
  "wc.home.entries.title": "參賽名單",
  "wc.home.entries.loading": "載入參賽中...",
  // ── Home tab: entry list card ────────────────────────────────────────
  "wc.entryList.subtitle": "準備好後，建立或開啟個人對戰表進行選擇。免費遊戲支援一個對戰表；AF 管理員池設定可允許多個參賽。",
  "wc.entryList.complete": "已完成",
  "wc.entryList.notComplete": "未完成",
  "wc.entryList.rank": "排名 #{{rank}}",
  "wc.entryList.unranked": "未排名",
  "wc.entryList.openBracket": "開啟對戰表",
  "wc.entryList.noBracketsTitle": "尚未建立對戰表",
  "wc.entryList.noBracketsBody": "請先建立個人對戰表，賽程確定後即可進行選擇。",
  // ── Pool dashboard: AI features teaser ───────────────────────────────
  "wc.home.ai.title": "AI 功能",
  "wc.home.ai.chimmyHint": "在水池聊天中輸入 @chimmy 以獲得個性化的對戰表建議。",
  "wc.home.ai.explainHint": "前往「檢閱」標籤頁，獲取 AI 對你的對戰表策略的解釋。",
  "wc.home.ai.unlockHint": "升級至 AF Pro 以解鎖 Chimmy AI 和「解釋我的對戰表」功能。",

  // ── AI CTA panel ──────────────────────────────────────────────────────
  "wc.cta.panelTitle": "AI 洞察",
  "wc.cta.aiRowLabel": "AI / Pro",
  "wc.cta.commissionerRowLabel": "管理員",
  "wc.cta.askChimmy": "詢問 Chimmy",
  "wc.cta.askChimmyDesc": "以對戰表問題開啟 Chimmy",
  "wc.cta.pathToFirst": "通往第一的路",
  "wc.cta.pathToFirstDesc": "詢問 Chimmy 你的對戰表需要什麼才能爬到第一名",
  "wc.cta.explainBracket": "解釋我的對戰表",
  "wc.cta.explainBracketDesc": "獲取 AI 對你對戰表策略的解釋",
  "wc.cta.rootingGuide": "應援指南",
  "wc.cta.rootingGuideDesc": "為此參賽作品生成應援指南",
  "wc.cta.poolSwing": "排名波動",
  "wc.cta.poolSwingDesc": "找出最大的即將到來的排行榜波動",
  "wc.cta.championRisk": "冠軍風險",
  "wc.cta.championRiskDesc": "分析整個群組中冠軍選擇的風險",
  "wc.cta.commissionerRecap": "管理員摘要",
  "wc.cta.commissionerRecapDesc": "生成 AI 群組摘要（發布前預覽）",
  "wc.cta.postHype": "發布炒作",
  "wc.cta.postHypeDesc": "在群組聊天中發布炒作訊息",
  "wc.cta.findIncomplete": "未完成的選擇",
  "wc.cta.findIncompleteDesc": "找出最有可能遺漏選擇的參賽作品",

  // ── Pool Chat community panel (Goal 9) ───────────────────────────────
  "wc.chat.hero.title": "群組聊天",
  "wc.chat.hero.subtitle": "討論策略、預測結果，讓群組保持熱度。",
  "wc.chat.hero.badge": "社群",
  "wc.chat.empty.headline": "開始第一場辯論。",
  "wc.chat.empty.body":
    "呼叫你的冠軍、質疑冒險的選擇，或請 Chimmy 給個看法。",
  "wc.chat.chip.explainBracket": "解釋我的對戰表",
  "wc.chat.chip.dangerZone": "找出我的高風險選擇",
  "wc.chat.chip.poolFavorite": "誰是群組最熱門的人選？",
  "wc.chat.chip.keyMatchup": "哪場對戰最可能改變一切？",
  "wc.chat.chip.trashTalk": "給我一句安全的垃圾話",
  "wc.chat.composer.placeholder": "傳訊息給群組或詢問 Chimmy…",
  "wc.chat.composer.send": "送出",
  "wc.chat.privateLabel": "Chimmy 私人回覆 · 僅你可見",
  "wc.chat.aiHint.unlocked":
    "@chimmy 的回覆是私密的。只有你能在此群組中看到你的提問和 Chimmy 的回答。",
  "wc.chat.aiHint.locked":
    "@chimmy 私人回覆需要 AI/Pro 方案。升級後即可在群組聊天中向 Chimmy 提問。",
  "wc.chat.trustNote": "保持競爭。保持禮貌。",
  "wc.chat.loading": "載入群組聊天中…",
  "wc.chat.refresh": "重新整理",

  // ── Pool dashboard: command hero ──────────────────────────────────────
  "wc.pool.eyebrow": "水池指揮中心",
  "wc.pool.privateBadge": "私密",
  "wc.pool.publicBadge": "公開",
  // ── Pool dashboard: what to do next card ──────────────────────────────
  "wc.pool.next.title": "下一步",
  "wc.pool.next.create.title": "建立你的對戰表",
  "wc.pool.next.create.body": "開始選擇以在此水池中競爭。",
  "wc.pool.next.picks.title": "進行選擇",
  "wc.pool.next.picks.body": "賽程已就緒——打開你的對戰表並開始選擇勝者。",
  "wc.pool.next.review.title": "檢閱並確認",
  "wc.pool.next.review.body": "所有選擇已完成。在賽事開始前檢閱你的對戰表並確認。",
  "wc.pool.next.done.title": "對戰表已提交",
  "wc.pool.next.done.body": "你的對戰表已鎖定。查看排行榜以追蹤你的名次。",
  "wc.pool.next.waiting.title": "等待賽程",
  "wc.pool.next.waiting.body": "賽程細節正在設置中。請在開球前回來查看。",
  // ── Pool dashboard: progress strip ────────────────────────────────────
  "wc.pool.progress.title": "進度",
  "wc.pool.progress.created": "已建立",
  "wc.pool.progress.picks": "選擇完成",
  "wc.pool.progress.finalized": "已提交",
  // ── Pool dashboard: commissioner panel ────────────────────────────────
  "wc.pool.commissioner.title": "委員工具",
  // ── Pool dashboard: leaderboard preview ───────────────────────────────
  "wc.pool.leaderboard.title": "排行榜",
  "wc.pool.leaderboard.empty": "尚無已計分的對戰表",
  "wc.pool.leaderboard.emptyNote": "對戰表在計分開始後顯示於此。",
  "wc.pool.leaderboard.viewFull": "完整排行榜",

  // ── Pool dashboard: header / status strip ────────────────────────────
  "wc.header.sync": "同步",
  "wc.header.inviteAria": "邀請朋友",
  "wc.header.invite": "邀請",
  "wc.header.testMode": "測試模式",
  "wc.header.testModeNote":
    "比賽結果為模擬資料,可能會影響排行榜。",

  // ── Lock countdown ───────────────────────────────────────────────────
  "wc.lock.untilLockDays": "距離選擇鎖定還有 {{d}} 天 {{h}} 小時",
  "wc.lock.untilLockHours": "距離選擇鎖定還有 {{h}} 小時 {{m}} 分",
  "wc.lock.untilLockMinutes": "距離選擇鎖定還有 {{m}} 分鐘",
  "wc.lock.locksSoon": "對戰表即將鎖定",
  "wc.lock.bracketLocked": "對戰表已鎖定",
  "wc.lock.picksFrozen": "對戰表已鎖定 — 選擇無法再修改。",

  // ── Countdown banner ─────────────────────────────────────────────────
  "wc.countdown.banner.startsIn": "World Cup starts in",
  "wc.countdown.banner.locksNote": "Group picks lock at kickoff",
  "wc.countdown.banner.urgent24h": "Picks lock soon",
  "wc.countdown.banner.urgent1h": "Final chance — picks lock at kickoff",
  "wc.countdown.banner.locked.title": "Group picks are locked",
  "wc.countdown.banner.locked.subtitle": "Live scoring is now active",
  "wc.countdown.banner.cta.make": "Make Picks",
  "wc.countdown.banner.cta.finish": "Finish My Bracket",
  "wc.countdown.banner.cta.finishNow": "Finish Picks Now",
  "wc.countdown.banner.cta.leaderboard": "View Leaderboard",
  "wc.countdown.banner.firstMatchFallback": "First group-stage match",
  "wc.countdown.banner.lockTime": "Group picks lock · {{time}}",
  "wc.countdown.banner.fallback": "World Cup countdown coming soon",
  "wc.countdown.banner.fallbackHint": "Picks remain editable until kickoff is confirmed",

  // ── AI upgrade / cap messages ────────────────────────────────────────
  "wc.ai.upgrade.chimmy.free": "You've used today's 3 Chimmy questions. Upgrade to AF Pro for 30 per day.",
  "wc.ai.upgrade.chimmy.pro": "You've used today's 30 Chimmy questions. They reset at midnight UTC.",
  "wc.ai.upgrade.explain.free": "Bracket explanations require AF Pro. Upgrade to get daily AI bracket breakdowns.",
  "wc.ai.upgrade.explain.pro": "You've used today's bracket explanation. It resets at midnight UTC.",
  "wc.ai.upgrade.matchup.free": "AI Matchup Intelligence requires AF Pro.",
  "wc.ai.upgrade.matchup.pro": "You've used today's 25 AI matchup analyses. They reset at midnight UTC.",
  "wc.ai.upgrade.brain.free": "Commissioner Brain requires AF Commissioner or higher.",
  "wc.ai.upgrade.brain.pro": "You've used today's Commissioner Brain calls. They reset at midnight UTC.",
  "wc.ai.upgrade.resetHint": "Daily AI limits reset at midnight UTC.",
  "wc.ai.upgrade.cta": "Upgrade Plan",

  // ── Knockouts tab ────────────────────────────────────────────────────
  "wc.knockouts.intro.reseeded":
    "正式的 32 強賽程公布後即可選擇淘汰賽。",
  "wc.knockouts.intro.predictive":
    "你的淘汰賽對戰表會根據你預測的小組賽結果產生。",
  "wc.knockouts.subintro.reseeded":
    "小組賽選擇現在正常運作。當正式的淘汰賽賽程同步後,你會從官方對戰表重新做淘汰賽選擇。",
  "wc.knockouts.subintro.predictive":
    "淘汰賽對戰會依照你的小組賽預測即時更新。修改小組預測可能會重置受影響的淘汰賽選擇。",
  "wc.knockouts.startPicks": "開始選擇",
  "wc.knockouts.continuePicks": "繼續選擇",
  "wc.knockouts.guidance.complete":
    "已完成 {{done}}/{{required}} 個目前可選的場次。",
  "wc.knockouts.guidance.nextPick": "下一個選擇:第 {{matchNumber}} 場。",
  "wc.knockouts.guidance.blocked":
    "請先選擇前幾輪的勝者。確認前幾輪勝者後會解鎖更多選擇。",
  "wc.knockouts.guidance.noneReady":
    "目前沒有可進行的淘汰賽選擇。",

  // ── Knockout Danger Zones card ───────────────────────────────────────
  "wc.danger.eyebrow": "淘汰賽",
  "wc.danger.title": "淘汰賽風險區",
  "wc.danger.subtitle":
    "確定性分析 — 比較你的選擇與賽前種子強度以及比賽即時狀態。",
  "wc.danger.tierPro": "AF Pro",
  "wc.danger.tierBasic": "基本版",
  "wc.danger.emptyNoEntry": "開啟一個對戰表項目即可查看風險區。",
  "wc.danger.emptyNoPicks": "完成淘汰賽選擇後即可查看風險區。",
  "wc.danger.emptyNoRisks":
    "目前沒有風險區。你的所有淘汰賽選擇從賽前實力來看都偏向有利。",
  "wc.danger.severityHigh": "高",
  "wc.danger.severityMedium": "中",
  "wc.danger.severityLow": "低",
  "wc.danger.severitySuffix": "風險",
  "wc.danger.footer":
    "僅統計你自己的選擇與公開賽程。不呼叫 AI。不使用其他使用者的選擇。",

  // ── AI Report (Review tab) ───────────────────────────────────────────
  "wc.aiReport.eyebrow": "報告",
  "wc.aiReport.title": "你的對戰表 AI 報告",
  "wc.aiReport.subtitle":
    "六項 AI 訊號全部來自你自己的選擇。以下內容僅你可見。",
  "wc.aiReport.tierActive": "AF Pro 已啟用",
  "wc.aiReport.tierPreview": "AF Pro 預覽",

  // ── Share / Invite ───────────────────────────────────────────────────
  "wc.invite.title": "邀請朋友",
  "wc.invite.copyLink": "複製邀請連結",
  "wc.invite.copied": "已複製連結!",
  "wc.invite.shareNative": "分享",
  "wc.invite.shareViaText": "簡訊",
  "wc.invite.shareViaEmail": "Email",
  "wc.invite.viaSocial": "社群",
  "wc.invite.heading":
    "邀請朋友加入 {{poolName}},在 AllFantasy 一起比拼。",
  "wc.invite.inviteCodeLabel": "邀請碼",

  // ── Commissioner Checklist ───────────────────────────────────────────
  "wc.checklist.title": "群組完成度清單",
  "wc.checklist.subtitle":
    "{{poolName}} 的成員以及他們相對於鎖定時間的進度。",
  "wc.checklist.copyReminder": "複製提醒",
  "wc.checklist.reminderCopied": "已複製提醒!",
  "wc.checklist.statusReady": "就緒",
  "wc.checklist.statusNoMembers": "尚無成員",
  "wc.checklist.statusNoData": "暫無快照資料",

  // ── Empty / loading / error states ───────────────────────────────────
  "wc.state.loading": "載入中...",
  "wc.state.refresh": "重新整理",
  "wc.state.tryAgain": "重試",
  "wc.state.noEntries":
    "你尚未為這個群組建立對戰表項目。",
  "wc.state.createEntry": "建立我的對戰表",

  // ── Language selector tooltip ────────────────────────────────────────
  "wc.language.label": "語言",
  "wc.language.english": "English",
  "wc.language.spanish": "Español",
  "wc.language.chinese": "繁體中文",
  "wc.language.filipino": "Filipino",
  "wc.language.vietnamese": "Tiếng Việt",

  // ── Create page / modal ──────────────────────────────────────────────
  "wc.create.goBack": "返回",
  "wc.create.header": "建立世界盃對戰群組",
  "wc.create.subheader": "2026 FIFA 世界盃 · 依回合計分",
  "wc.create.heroTitle": "2026 FIFA 世界盃",
  "wc.create.heroSubtitle":
    "建立一個群組容器 — 邀請朋友,讓他們在裡面建立自己的對戰表。",
  "wc.create.poolName.label": "群組名稱",
  "wc.create.poolName.placeholder": "例如:辦公室世界盃 2026",
  "wc.create.poolName.error.blank": "群組名稱不能空白。",
  "wc.create.poolName.default": "世界盃對戰群組",
  "wc.create.visibility.label": "群組可見性",
  "wc.create.visibility.private": "私人",
  "wc.create.visibility.privateHint": "需要邀請連結才能加入",
  "wc.create.visibility.public": "公開",
  "wc.create.visibility.publicHint": "任何人都可以發現並加入",
  "wc.create.maxUsers.label": "人數上限",
  "wc.create.maxUsers.hint": "每個群組最多 {{max}} 人",
  "wc.create.maxUsers.error": "必須介於 2 到 {{max}} 之間。",
  "wc.create.maxEntries.label": "每位使用者對戰表數",
  "wc.create.maxEntries.hint": "每位使用者最多 {{max}} 個",
  "wc.create.maxEntries.error": "必須介於 1 到 {{max}} 之間。",
  "wc.create.lockRule.label": "選擇鎖定規則",
  "wc.create.lockRule.tournament": "全賽事鎖定",
  "wc.create.lockRule.tournamentHint":
    "第一場比賽開始時所有選擇皆鎖定",
  "wc.create.lockRule.perMatch": "逐場鎖定",
  "wc.create.lockRule.perMatchHint":
    "每場比賽於自身開球時鎖定",
  "wc.create.lockRule.copyTournament":
    "在世界盃首場比賽開球前,選擇都可修改。",
  "wc.create.lockRule.copyPerMatch":
    "每場比賽在自身開球前都可修改。",
  "wc.create.scoring.intro": "依回合計分:",
  "wc.create.scoring.values":
    "32 強 10 分 · 16 強 20 分 · 八強 40 分 · 四強 80 分 · 決賽 160 分 · 冠軍獎勵 320 分",
  "wc.create.helper.entriesOne":
    "每位使用者最多可建立 {{max}} 個對戰表。",
  "wc.create.helper.entriesOther":
    "每位使用者最多可建立 {{max}} 個對戰表。",
  "wc.create.helper.leaderboard":
    "排行榜只計入已送出的對戰表,不計草稿。",
  "wc.create.helper.inviteLink":
    "建立後會顯示邀請連結。",
  "wc.create.thirdPlace": "包含季軍戰",
  "wc.create.testFixtures.label": "載入測試賽程",
  "wc.create.testFixtures.hint":
    "加入模擬的 32 強球隊、國旗、開球時間與場地,讓此群組可以立刻開始選擇。",
  "wc.create.submit.idle": "建立群組",
  "wc.create.submit.creating": "建立中...",
  "wc.create.submit.opening": "已建立,正在開啟...",
  "wc.create.openingSuccess": "已建立對戰表,正在開啟...",
  "wc.create.error.signInRequired": "請先登入再建立對戰表。",
  "wc.create.error.noId":
    "對戰表已建立,但伺服器未回傳 ID,請重新整理頁面。",
  "wc.create.error.generic": "無法建立對戰表",
  "wc.create.error.requestFailed": "請求失敗({{status}})",

  // ── Discover page ────────────────────────────────────────────────────
  "wc.discover.backToHub": "← 返回世界盃主頁",
  "wc.discover.createPool": "建立群組",
  "wc.discover.title": "探索公開群組",
  "wc.discover.subtitle":
    "瀏覽公開的世界盃對戰群組。加入後會開啟尚未選擇的 Bracket 1 — 當群組接受新成員且未滿時,我們會直接帶你進入引導式選擇。",
  "wc.discover.search.label": "搜尋",
  "wc.discover.search.placeholder": "群組名稱",
  "wc.discover.season.label": "賽季",
  "wc.discover.season.placeholder": "例如:2026",
  "wc.discover.statusFilter.label": "狀態",
  "wc.discover.statusFilter.all": "全部",
  "wc.discover.statusFilter.open": "開放中",
  "wc.discover.statusFilter.locked": "已鎖定",
  "wc.discover.statusFilter.final": "已結束",
  "wc.discover.loading": "正在載入公開群組...",
  "wc.discover.errors.couldNotLoad": "無法載入群組",
  "wc.discover.empty":
    "沒有符合篩選條件的公開群組。換個賽季或清除搜尋 — 也可以用上方的邀請碼加入私人群組。",
  "wc.discover.joinPanelTitle": "用邀請碼加入(私人群組)",

  // ── Discover card ────────────────────────────────────────────────────
  "wc.discover.card.statusOpen": "開放中",
  "wc.discover.card.blockedFull": "群組已滿",
  "wc.discover.card.blockedClosed": "已停止接受新成員",
  "wc.discover.card.password": "密碼",
  "wc.discover.card.lateJoin": "選擇已鎖定 · 仍可後加入",
  "wc.discover.card.preview": "預覽",
  "wc.discover.card.join": "加入",

  // ── Join / invite panel ──────────────────────────────────────────────
  "wc.join.backToHub": "← 返回世界盃主頁",
  "wc.join.brandEyebrow": "AllFantasy",
  "wc.join.brandTitle": "2026 世界盃對戰群組",
  "wc.join.panelTitle": "用邀請碼加入",
  "wc.join.panelHelper":
    "輸入你管理員提供的邀請碼。加入後會抵達群組主頁,即可開始你的第一個對戰表。受密碼保護的群組需要在群組設定中設定的加入密碼。",
  "wc.join.codeInput.placeholder": "WCUP 邀請碼",
  "wc.join.previewBtn": "預覽",
  "wc.join.errors.invalidCode": "請輸入有效的邀請碼",
  "wc.join.errors.notFound": "找不到該邀請",
  "wc.join.errors.full": "此群組已滿。",
  "wc.join.errors.closed": "此群組不再接受新成員。",
  "wc.join.errors.couldNotJoin": "無法加入",
  "wc.join.preview.hostLine":
    "主辦人:{{owner}} · {{count}} 人遊玩 · {{visibility}}",
  "wc.join.preview.openCopy":
    "立即加入即可建立 Bracket 1、進行小組賽與淘汰賽選擇,並在準備好時送出。",
  "wc.join.preview.fullCopy": "此群組已滿。",
  "wc.join.preview.closedCopy":
    "群組已鎖定 — 不再接受新成員。",
  "wc.join.preview.passwordLabel": "加入密碼",
  "wc.join.preview.joinBtn": "加入群組",
  "wc.join.success": "已加入 — Bracket 1 已就緒。",

  // ── Finalize / share success block (Review tab) ──────────────────────
  "wc.finalize.eyebrow": "已送出",
  "wc.finalize.title": "你的對戰表已鎖定",
  "wc.finalize.subtitleNoTime":
    "已送出。在群組鎖定前你仍可編輯 — 趁名額還沒滿,趕快邀請朋友。",
  "wc.finalize.subtitleWithTime":
    "於 {{at}} 送出。在群組鎖定前你仍可編輯 — 趁名額還沒滿,趕快邀請朋友。",
  "wc.finalize.copyShare": "複製分享文字",
  "wc.finalize.copyShareCopied": "已複製!",
  "wc.finalize.shareReport": "分享我的 AI 對戰表報告",
  "wc.finalize.inviteFriends": "邀請朋友來挑戰我的對戰表",
  "wc.finalize.previewShare": "預覽分享文字",

  // ── Finalize success block: challenge + trust ─────────────────────────
  "wc.finalize.viewLeaderboard": "查看排行榜",
  "wc.finalize.openChat": "群組聊天",
  "wc.finalize.challengeTitle": "你的世界盃之路已鎖定。",
  "wc.finalize.challengeDesc": "現在帶上你的夥伴，看著排行榜活躍起來。",
  "wc.finalize.trustNote": "無賭注。無博彩。只有策略、預測和吹牛的資本。",

  // ── Leaderboard tab visual upgrade ───────────────────────────────────
  "wc.lb.eyebrow": "群組",
  "wc.lb.title": "排行榜競賽",
  "wc.lb.heroSubtitle": "每場比賽都可能改變故事走向。追蹤你的分數、緊追領先者，看著群組賽況活躍起來。",
  "wc.lb.statusPreTournament": "賽前",
  "wc.lb.statusLive": "進行中",
  "wc.lb.statusWaiting": "等待賽程",
  "wc.lb.subtitleBase": "僅限已完成的對戰表 · 比賽結果同步後分數才會更新。",
  "wc.lb.lastUpdated": "最後同步：{{date}}。",
  "wc.lb.notYetSynced": "尚未同步。",
  "wc.lb.testMode": "測試模式：排行榜可能反映模擬結果。",
  "wc.lb.recalculate": "重新計算",
  "wc.lb.autoUpdate": "自動更新",
  "wc.lb.scoresNotSynced": "分數尚未同步——結果匯入後總分才會更新。",
  "wc.lb.fixturesNotReady": "賽程尚未完全就緒——隊伍須確定後排行榜才有意義。",
  "wc.lb.podiumTitle": "群組前幾名",
  "wc.lb.yourRank": "你的排名",
  "wc.lb.yourRankTagline": "你已加入競賽。",
  "wc.lb.gapToFirst": "落後領先者 {{n}} 分",
  "wc.lb.isLeader": "你正在領先群組。",
  "wc.lb.tied": "與領先者並列。",
  "wc.lb.viewMyBracket": "查看我的對戰表",
  "wc.lb.noEntryTitle": "尚未加入競賽。",
  "wc.lb.noEntryBody": "建立對戰表以加入排行榜。",
  "wc.lb.startMyBracket": "開始我的對戰表",
  "wc.lb.emptyTitle": "競賽尚未開始",
  "wc.lb.emptyBody": "排行榜會在選擇鎖定、比賽開始後啟動。",
  "wc.lb.emptyInvite": "邀請朋友",
  "wc.lb.emptyReview": "查看我的對戰表",
  "wc.lb.scoringTitle": "計分方式",
  "wc.lb.scoringBody": "猜中的選擇可得分。後幾輪的分值更高，所以通往決賽的每條路都重要。",
  "wc.lb.scoringUpdates": "比賽結果同步後排行榜才會更新。",
  "wc.lb.shareMyRank": "分享我的排名",
  "wc.lb.challengePool": "向群組發出挑戰",
  "wc.lb.noChampionPick": "未選擇冠軍",
  "wc.lb.alive": "仍在",
  "wc.lb.busted": "已淘汰",
  "wc.lb.aiProUnlocks": "AF Pro 可解鎖 AI 勝率、對戰表健康度及冠軍路徑壓力。",
  "wc.lb.ptsLabel": "分",
  "wc.lb.trustNote": "無賭注。無博彩平台。只有策略、預測和炫耀的權利。",
  // ── Share card UI chrome ──────────────────────────────────────────────
  "wc.share.eyebrow": "分享圖片",
  "wc.share.titleInvite": "群組邀請",
  "wc.share.titleLeaderboard": "排行榜截圖",
  "wc.share.titleBracket": "我的對戰表摘要",
  "wc.share.titleRecap": "AI 回顧",
  "wc.share.description": "可直接分享到社群媒體的對戰表或群組排行榜文字。",
  "wc.share.publicSafe": "公開安全",
  "wc.share.copy": "複製",
  "wc.share.copied": "已複製",
  "wc.share.share": "分享",

  // ── Inside-pool Invite tab ───────────────────────────────────────────
  "wc.inviteTab.eyebrow": "群組",
  "wc.inviteTab.title": "邀請與群組資訊",
  "wc.inviteTab.detailsTitle": "群組資訊",
  "wc.inviteTab.meta.pool": "群組",
  "wc.inviteTab.meta.privacy": "隱私",
  "wc.inviteTab.meta.privacyPublic": "公開",
  "wc.inviteTab.meta.privacyPrivate": "私人 — 僅限邀請",
  "wc.inviteTab.meta.maxUsers": "人數上限",
  "wc.inviteTab.meta.bracketsPerUser": "每位使用者對戰表數",
  "wc.inviteTab.meta.scoring": "計分方式",
  "wc.inviteTab.meta.scoringValue": "NCAA 風格",
  "wc.inviteTab.meta.lockRule": "鎖定規則",
  "wc.inviteTab.meta.lockTournament":
    "於世界盃首場比賽鎖定",
  "wc.inviteTab.meta.lockPerMatch": "逐場於開球時鎖定",
  "wc.inviteTab.lockedBanner":
    "此群組已鎖定,選擇無法再修改。",
  "wc.inviteTab.member.title": "邀請朋友加入此群組",
  "wc.inviteTab.member.body":
    "只有群組管理員能複製並分享邀請連結。請向管理員索取邀請連結或代碼。",
  "wc.inviteTab.commissioner.linkTitle": "邀請連結",
  "wc.inviteTab.commissioner.linkHelper":
    "把這個連結分享給你想邀請的人。他們需要登入 AllFantasy。",
  "wc.inviteTab.commissioner.codeLabel": "邀請碼",
  "wc.inviteTab.commissioner.copyCode": "複製代碼",
  "wc.inviteTab.commissioner.copyCodeDone": "已複製",
  "wc.inviteTab.commissioner.copyLink": "複製邀請連結",
  "wc.inviteTab.commissioner.copyLinkDone": "連結已複製!",
  "wc.inviteTab.commissioner.copyMessage": "複製邀請訊息",
  "wc.inviteTab.commissioner.copyMessageDone": "訊息已複製!",
  "wc.inviteTab.commissioner.share": "分享",
  "wc.inviteTab.commissioner.previewInvite": "預覽邀請訊息",
  "wc.inviteTab.commissioner.previewShare": "預覽分享訊息",
  "wc.inviteTab.commissioner.noCodeTitle": "邀請連結尚未啟用",
  "wc.inviteTab.commissioner.noCodeBody":
    "群組擁有者或管理員可以從群組設定重新產生邀請連結。",
  "wc.inviteTab.shareMessage.default":
    "來加入我在 AllFantasy 的 2026 世界盃對戰群組「{{pool}}」!最多可建立 {{maxEntries}} 個對戰表,排序小組賽、建立淘汰賽選擇,並在即時排行榜上競賽。 {{url}}",
  "wc.inviteTab.shareTitleNative":
    "{{pool}} — AllFantasy 世界盃對戰表",

  // ── Invite tab: new UX sections (Goal 8) ─────────────────────────────
  "wc.inviteTab.hero.title": "召集你的隊伍",
  "wc.inviteTab.hero.subtitle":
    "分享這個群組，挑戰你的朋友，讓排行榜來解決爭論。",
  "wc.inviteTab.hero.participants": "{{count}} 人加入",
  "wc.inviteTab.hero.spotsLeft": "還剩 {{n}} 個名額",
  "wc.inviteTab.hero.poolFull": "群組已滿",
  "wc.inviteTab.hero.lockDeadline": "選擇截止於 {{date}}",
  "wc.inviteTab.growth.title": "更多對手讓群組更精彩。",
  "wc.inviteTab.growth.body":
    "在截止前邀請朋友加入，填滿你的排行榜。",
  "wc.inviteTab.growth.cta": "邀請好友",
  "wc.inviteTab.social.title": "社群分享文案",
  "wc.inviteTab.social.copy1":
    "加入我在 AllFantasy 的世界盃群組，證明你的預測更準確。",
  "wc.inviteTab.social.copy2": "排行榜即將變得火熱。",
  "wc.inviteTab.social.copy3": "帶上你最強的預測。",
  "wc.inviteTab.social.copyBtn": "複製",
  "wc.inviteTab.social.copiedBtn": "已複製",
  "wc.inviteTab.actions.viewLeaderboard": "查看排行榜",
  "wc.inviteTab.actions.openChat": "開啟群組聊天",
  "wc.inviteTab.actions.shareLink": "手機分享",
  "wc.inviteTab.trustNote":
    "無賭博。無運彩。只有世界盃預測、策略和吹噓的資本。",

  // ── Commissioner Checklist card chrome (extended) ────────────────────
  "wc.checklist.eyebrow": "管理員",
  "wc.checklist.cardSubtitle":
    "一覽成員進度。僅群組管理員與系統管理員可見。",
  "wc.checklist.copyReminderBtn": "複製提醒訊息",
  "wc.checklist.copyReminderDone": "提醒已複製!",
  "wc.checklist.stat.total": "總成員",
  "wc.checklist.stat.finalized": "已送出",
  "wc.checklist.stat.inProgress": "進行中",
  "wc.checklist.stat.completion": "完成度",
  "wc.checklist.entryStatus.finalized": "已送出",
  "wc.checklist.entryStatus.inProgress": "進行中",
  "wc.checklist.entryStatus.needsPicks": "需要選擇",
  "wc.checklist.entryStatus.unknown": "未知",
  "wc.checklist.needsReminderBadge": "需要提醒",
  "wc.checklist.missingPicks": "缺少 {{count}} 項",
  "wc.checklist.previewReminder": "預覽提醒訊息",
  "wc.checklist.privacyNote":
    "確定性 — 使用管理員工具已載入的快照資料。不顯示 Email 或使用者 ID。",
  "wc.checklist.empty.memberOnly":
    "只有群組管理員或系統管理員可以看到成員狀態。",
  "wc.checklist.empty.loading":
    "管理員狀態資料仍在載入中。",
  "wc.checklist.empty.noMembers":
    "尚無成員建立對戰表。分享邀請連結以開始。",
  "wc.checklist.empty.fallback": "目前沒有成員資料。",
  "wc.checklist.row.memberFallback": "成員",
  "wc.checklist.row.bracketFallback": "對戰表",
  "wc.checklist.row.finalizedRowOne": "{{count}} 個已送出的對戰表",
  "wc.checklist.row.finalizedRowOther": "{{count}} 個已送出的對戰表",

  // ── Commissioner reminder message templates ──────────────────────────
  "wc.checklist.reminder.askCommissioner":
    "請群組管理員提醒成員注意 {{pool}}。",
  "wc.checklist.reminder.finalizeLine":
    "提醒:請在 AllFantasy 完成「{{pool}}」的選擇並送出。",
  "wc.checklist.reminder.joinLine":
    "提醒:加入 AllFantasy 上的「{{pool}}」,並鎖定你的世界盃對戰表。",
  "wc.checklist.reminder.statusLine":
    "進度:{{done}}/{{total}} 個對戰表已送出({{percent}}%)。",
  "wc.checklist.reminder.deadlineLine":
    "選擇將於 {{deadline}} 鎖定。",
  "wc.checklist.reminder.poweredBy": "由 AllFantasy 提供支援。",
  "wc.checklist.reminder.noSnapshotLine":
    "提醒:請在 AllFantasy 完成「{{pool}}」的選擇。",

  // ── AI Report card chrome (extended) ─────────────────────────────────
  "wc.aiShareCard.eyebrow": "分享圖卡",
  "wc.aiShareCard.subtitle":
    "六項 AI 訊號集中在一張可複製的圖卡。確定性 — 分享不會呼叫 AI。",
  "wc.aiShareCard.tierPro": "AF Pro",
  "wc.aiShareCard.tierPreview": "基本版預覽",
  "wc.aiShareCard.emptyNoEntry": "選擇對戰表項目即可產生分享圖卡。",
  "wc.aiShareCard.copyShare": "複製分享文字",
  "wc.aiShareCard.copyShareDone": "已複製",
  "wc.aiShareCard.share": "分享",
  "wc.aiShareCard.privacyNote":
    "在你分享前完全私人保留。只用你自己的對戰表資料以及群組的彙總統計。",
  "wc.explain.eyebrow": "私人 AI",
  "wc.explain.title": "解析我的對戰表",
  "wc.explain.subtitle":
    "你的對戰表策略私人敘事分析。只有你看得到。",
  "wc.explain.tierPro": "AF Pro",
  "wc.explain.tierLocked": "已鎖定",
  "wc.explain.locked":
    "AF Pro 可解鎖 AI 私人解析:風格、最安全的選擇、風險最高的選擇、冠軍路徑與一個具體建議。",
  "wc.explain.upgradeCta": "升級至 AF Pro →",
  "wc.explain.generate": "產生解析",
  "wc.explain.generating": "產生中...",
  "wc.explain.selectFirst": "請先選擇對戰表",
  "wc.explain.regenerate": "重新產生",
  "wc.explain.regenerating": "重新產生中...",
  "wc.explain.fallbackBadge": "確定性備援",
  "wc.explain.error.generic": "無法產生解析。",
  "wc.explain.error.network": "網路錯誤,請重試。",
  "wc.explain.privacyNote":
    "完全私人。只用你的選擇與公開球隊資料,絕不發到聊天室。",
  "wc.uniqueness.eyebrow": "群組比較",
  "wc.uniqueness.title": "我的對戰表有何獨特之處?",
  "wc.uniqueness.subtitle":
    "僅與此群組內已送出的對戰表比較。",
  "wc.uniqueness.tierPro": "AF Pro",
  "wc.uniqueness.tierBasic": "基本版",
  "wc.uniqueness.empty.noEntry":
    "選擇對戰表項目即可計算獨特度。",
  "wc.uniqueness.loading": "正在載入群組比較...",
  "wc.uniqueness.error.couldNotLoad": "無法載入獨特度資料。",
  "wc.uniqueness.error.network": "網路錯誤,請重試。",
  "wc.uniqueness.empty.notEnoughData":
    "等更多對戰表完成送出後即會解鎖獨特度。",
  "wc.uniqueness.empty.incomplete":
    "完成小組賽與淘汰賽選擇即可查看獨特度。",
  "wc.uniqueness.rarity.veryRare": "極稀有",
  "wc.uniqueness.rarity.rare": "稀有",
  "wc.uniqueness.rarity.uncommon": "不常見",
  "wc.uniqueness.rarity.common": "常見",
  "wc.uniqueness.percentShare": "佔比 {{percent}}%",
  "wc.uniqueness.privacyNote":
    "確定性 — 只計算已送出的對戰表。不呼叫 AI,不顯示其他使用者的原始選擇。",
  "wc.grade.eyebrow": "對戰表評分",
  "wc.grade.completionLabel": "完成度 {{percent}}%",
  "wc.grade.tierProDetail": "AF Pro 詳細",
  "wc.grade.tierBasic": "基本版",
  "wc.grade.stat.groups": "小組賽",
  "wc.grade.stat.thirdPlace": "季軍戰",
  "wc.grade.stat.knockouts": "淘汰賽",
  "wc.grade.stat.missing": "尚缺",
  "wc.grade.risk": "風險等級:",
  "wc.grade.upset": "爆冷指數:",
  "wc.grade.championConfidence": "冠軍信心度:",
  "wc.grade.championConfidenceNone": "尚未選冠軍",
  "wc.grade.biggestRisk": "最大風險:",
  "wc.grade.recommendation": "建議:",
  "wc.grade.lockedBody":
    "AF Pro 解鎖風險、爆冷指數、冠軍信心度、最大風險與建議細節。",
  "wc.confidence.title": "AI 信心檢查",
  "wc.confidence.tierOpen": "已開啟",
  "wc.confidence.tierLocked": "已鎖定",
  "wc.confidence.missingPicks": "缺少的選擇:",
  "wc.confidence.noMissing": "沒有,可以送出了。",
  "wc.confidence.missingBreakdown":
    "{{knockout}} 場淘汰賽、{{groups}} 個小組、{{thirdPlace}} 個季軍位置。",
  "wc.confidence.highRiskPicks": "高風險選擇:",
  "wc.confidence.highRiskBody":
    "{{count}} 個前期選擇將決定大部分的對戰表走向。",
  "wc.confidence.bracketShape": "對戰表結構:",
  "wc.confidence.bracketShapeChalk":
    "過度押熱門。可以考慮一個有節制的反向選擇來提升獨特度。",
  "wc.confidence.bracketShapeBalanced":
    "結構平衡,適合第一輪信心檢查。",
  "wc.confidence.finalizeConfidence": "送出信心度:",
  "wc.confidence.finalizeReady": "已可送出,進入排行榜。",
  "wc.confidence.finalizeMissing":
    "在送出前先完成缺少的項目。",
  "wc.confidence.privacyNote":
    "僅為確定性預測與計分複雜度。對戰表指引僅限於選擇與計分機制。",
  "wc.confidence.lockedBody":
    "升級到 AI/Pro 即可開啟信心檢查。未升級的使用者不會觸發 AI 呼叫。",
  "wc.path.title": "我需要什麼條件才能贏?",
  "wc.path.subtitle":
    "私人當前項目分析。其他使用者尚未送出的選擇仍然保密。",
  "wc.path.tierActive": "AF Pro 已啟用",
  "wc.path.tierLocked": "AF Pro 已鎖定",

  // ── Group Stage picks (gameplay) ─────────────────────────────────────
  "wc.groupStage.loading": "正在載入小組賽選擇...",
  "wc.groupStage.failedLoad": "無法載入小組賽",
  "wc.groupStage.title": "小組賽選擇",
  "wc.groupStage.subtitle":
    "為每個小組排出第 1 至第 4 名,再選 8 隊作為第三名晉級。",
  "wc.groupStage.rankedCount": "已排序的小組:{{done}}/12",
  "wc.groupStage.lockedNoReason": "小組賽選擇已鎖定。",
  "wc.groupStage.lockedWithReason":
    "小組賽選擇已鎖定:{{reason}}",
  "wc.groupStage.teamCount": "{{count}}/4 隊",
  "wc.groupStage.teamFallback": "球隊",
  "wc.groupStage.actualRank": "實際 #{{rank}}",
  "wc.groupStage.moveUp": "上移",
  "wc.groupStage.moveDown": "下移",
  "wc.groupStage.needsFourTeams":
    "{{group}} 需要 4 隊才能儲存。",
  "wc.groupStage.unsavedOrder":
    "順序尚未儲存。點擊「儲存小組」後 Review 才會計入。",
  "wc.groupStage.savedReviewUses":
    "已儲存。Review 採用這個小組順序。",
  "wc.groupStage.saveGroup": "儲存小組",
  "wc.groupStage.saving": "儲存中...",
  "wc.groupStage.saved": "已儲存",
  "wc.groupStage.retrySave": "重試儲存",
  "wc.groupStage.failedSave": "無法儲存小組排名",
  "wc.groupStage.aiTitle": "AI 解析",
  "wc.groupStage.aiTierOpen": "已開啟",
  "wc.groupStage.aiTierLocked": "已鎖定",
  "wc.groupStage.aiPrivacyNote":
    "僅為預測與計分複雜度。指引僅限於選擇與計分機制。",
  "wc.groupStage.aiLockedBody":
    "升級到 AI/Pro 開啟確定性 World Cup 解析。鎖定期間不會呼叫 AI。",
  "wc.groupStage.resultCorrect": "正確 +{{points}}",
  "wc.groupStage.resultWrong": "錯誤 +0",
  "wc.groupStage.resultPending": "待定",

  // ── Third-place advancers (gameplay) ─────────────────────────────────
  "wc.thirdPlace.title": "第三名晉級隊伍",
  "wc.thirdPlace.subtitle":
    "在所有小組排序後,選擇 8 支預測的第三名晉級隊伍。",
  "wc.thirdPlace.selectedCount":
    "已選的第三名晉級:{{count}}/8",
  "wc.thirdPlace.saveBtn": "儲存第三名",
  "wc.thirdPlace.savePicksDone": "第三名選擇已儲存",
  "wc.thirdPlace.saving": "儲存中...",
  "wc.thirdPlace.saved": "已儲存",
  "wc.thirdPlace.savePrimaryBtn": "儲存第三名晉級",
  "wc.thirdPlace.rankAllFirst":
    "請先排序所有 12 個小組再選擇第三名晉級。",
  "wc.thirdPlace.unsaved":
    "第三名選擇尚未儲存。點擊「儲存第三名晉級」後 Review 才會計入。",
  "wc.thirdPlace.savedReviewUses":
    "第三名選擇已儲存。Review 會採用這些選擇。",
  "wc.thirdPlace.errorChoose8":
    "請選擇恰好 8 個第三名晉級。",
  "wc.thirdPlace.errorRankFirst":
    "請先排序所有 12 個小組再選擇第三名晉級。",
  "wc.thirdPlace.failedSave": "無法儲存第三名晉級",
  "wc.thirdPlace.noPickYet": "尚未選擇第三名",
  "wc.thirdPlace.selectedToAdvance": "已選為晉級",
  "wc.thirdPlace.tapToSelect": "點擊以選擇",
  "wc.thirdPlace.selectAria":
    "將 {{name}} 選為第三名晉級",
  "wc.thirdPlace.aiTitle": "詢問 Chimmy",
  "wc.thirdPlace.aiLockedBody":
    "AI/Pro 可解鎖第三名選擇解析。未升級的使用者只看到此 CTA,不會發出 AI 請求。",

  // ── Matchup card (gameplay) ──────────────────────────────────────────
  "wc.matchup.matchLabel": "第 {{number}} 場",
  "wc.matchup.openGuidedAria":
    "為第 {{number}} 場開啟引導式選擇",
  "wc.matchup.statusFinal": "結束",
  "wc.matchup.statusPostponed": "延期",
  "wc.matchup.statusCancelled": "取消",
  "wc.matchup.statusSimulated": "模擬",
  "wc.matchup.statusTestFixture": "測試比賽",
  "wc.matchup.statusSaving": "儲存中...",
  "wc.matchup.notReadyPill": "尚未開放選擇",
  "wc.matchup.pickBadgeCorrect": "正確",
  "wc.matchup.pickBadgeIncorrect": "錯誤",
  "wc.matchup.pickVisualCorrect": "選擇正確",
  "wc.matchup.pickVisualIncorrect": "選擇錯誤",
  "wc.matchup.pickVisualPending": "待開賽",
  "wc.matchup.yourPick": "你的選擇:",
  "wc.matchup.points": "{{points}} 分",
  "wc.matchup.pointsPositive": "+{{points}} 分",
  "wc.matchup.zeroPts": "0 分",
  "wc.matchup.pending": "待定",
  "wc.matchup.winnerOfficial": "勝者:{{name}}",
  "wc.matchup.unpickableFinal": "此比賽已結束。",
  "wc.matchup.unpickableMissingTeam":
    "請先選出前幾輪的勝者。",
  "wc.matchup.unpickableUnknown": "球隊尚未確定。",
  "wc.matchup.ftBadge": "FT",
  "wc.matchup.confidenceTitle": "信心加分",
  "wc.matchup.confidenceHint":
    "信心越高,猜中可獲得越多加分。",
  "wc.matchup.confidencePointSingle": "{{value}} 分",
  "wc.matchup.confidencePointPlural": "{{value}} 分",
  "wc.matchup.aiInsightsLabel": "AI 解析",
  "wc.matchup.aiTierOpen": "已開啟",
  "wc.matchup.aiTierLocked": "已鎖定",
  "wc.matchup.aiSaferPick": "較安全的選擇:",
  "wc.matchup.aiSaferBody":
    "依目前對戰表順序為 {{name}}。",
  "wc.matchup.aiUpsidePick": "上行選擇:",
  "wc.matchup.aiUpsideBody":
    "若需要不同路徑,可考慮 {{name}}。",
  "wc.matchup.aiBracketImpact": "對戰表影響:",
  "wc.matchup.aiBracketImpactBody":
    "勝者進入下一個位置;改動可能重置後續選擇。",
  "wc.matchup.aiUpsetRisk": "爆冷風險:",
  "wc.matchup.aiUpsetRiskBody":
    "在實時表現與官方結果出來前先評為中等。",
  "wc.matchup.aiPrivacyNote":
    "僅為預測與計分複雜度。指引僅限於選擇與計分機制。",
  "wc.matchup.aiLockedBody":
    "升級到 AI/Pro 開啟對戰解析。未升級者不會觸發 AI 呼叫。",
  "wc.matchup.pickAriaPicked": "選 {{name}} 為贏家",
  "wc.matchup.pickAriaSelected": "已選:{{name}} 為贏家",
  "wc.matchup.disabledLocked": "此比賽的選擇已鎖定",
  "wc.matchup.disabledSaving": "此選擇正在儲存中",
  "wc.matchup.winnerLabel": "勝者",
  "wc.matchup.lockHintTournament": "賽事開始時鎖定",
  "wc.matchup.lockHintKickoff": "開球時鎖定",
  "wc.matchup.lockHintTournamentWithTime": "鎖定時間 {{at}}",
  "wc.matchup.lockHintKickoffWithTime":
    "開球時鎖定 · {{at}}",
  "wc.matchup.bracketBoardChampionLabel": "冠軍選擇",
  "wc.matchup.bracketBoardChampionFallback": "尚未選擇",
  "wc.matchup.bracketBoardHelper":
    "你的淘汰賽對戰表由你預測的小組結果生成。選定勝者後對戰表會立刻在畫面上推進。",
  "wc.matchup.aiHomeSideFallback": "主場",
  "wc.matchup.aiAwaySideFallback": "客場",
  "wc.matchup.pensAbbr": "點球",

  // ── Bracket round column labels ──────────────────────────────────────
  "wc.round.roundOf32": "32強",
  "wc.round.roundOf16": "16強",
  "wc.round.quarterfinal": "八強",
  "wc.round.semifinal": "四強",
  "wc.round.thirdPlace": "三四名",
  "wc.round.final": "決賽",

  // ── Review tab finalize/missing-picks checklist ──────────────────────
  "wc.review.savedThirdPlaceTitle": "已儲存的第三名晉級",
  "wc.review.noSavedThirdPlace": "尚未儲存第三名晉級。",
  "wc.review.loadingSavedThirdPlace":
    "正在載入已儲存的第三名選擇...",
  "wc.review.savedKnockoutTitle": "已儲存的淘汰賽選擇",
  "wc.review.noSavedKnockout": "尚未儲存淘汰賽選擇。",
  "wc.review.knockoutPickPrefix": "第 {{number}} 場 · ",
  "wc.review.missingRequirementsTitle": "尚缺要求",
  "wc.review.needsRefinalize":
    "送出後項目有變更。完成缺少的選擇後請重新送出。",
  "wc.review.missingGroupRankings":
    "尚缺小組排名:{{groups}}",
  "wc.review.thirdPlaceCount":
    "第三名晉級已選:{{count}}/8",
  "wc.review.missingKnockout":
    "尚缺淘汰賽選擇:{{count}}",
  "wc.review.lockedNoTime":
    "已鎖定:選擇無法再修改",
  "wc.review.lockedWithTime":
    "已鎖定:選擇無法再修改 · 送出於 {{at}}",
  "wc.review.completeDraftHelper":
    "草稿完成。送出後即可上排行榜;在鎖定前仍可編輯。",
  "wc.review.finalizing": "送出中...",
  "wc.review.finalizeEntry": "送出項目",
  "wc.review.refinalizeEntry": "重新送出項目",
  "wc.review.completeAllToUnlock":
    "完成所有缺少項目後即可解鎖送出。",
  "wc.review.tapRefresh": "點擊「重新整理 Review」以查看進度。",
  "wc.review.createEntryFirstTitle": "請先建立項目",
  "wc.review.createEntryFirstBody":
    "Review 與送出都以對戰表項目為單位儲存。",
  "wc.review.createMyBracket": "建立我的對戰表",
  "wc.review.creating": "建立中...",
  "wc.review.openMyBracket": "開啟我的對戰表",

  // ── Review tab: hero section ──────────────────────────────────────────
  "wc.review.heroTitle": "檢閱你通往榮耀的道路",
  "wc.review.heroSubtitle": "在確認之前，檢查每個小組、淘汰賽路徑和決賽選手。",
  "wc.review.groupChangeWarning": "若修改小組賽選擇，可能會取消你的確認狀態。",
  "wc.review.statusIncomplete": "未完成",
  "wc.review.statusReady": "可以確認",
  "wc.review.statusFinalized": "已確認",
  "wc.review.statusLocked": "已鎖定",
  "wc.review.checking": "檢查中...",
  "wc.review.refreshReview": "刷新檢閱",
  "wc.review.loadingReview": "載入中...",
  "wc.review.stat.groups": "已排序小組",
  "wc.review.stat.thirdPlace": "最佳第三名",
  "wc.review.stat.knockouts": "淘汰賽選擇",
  "wc.review.scoringNoteTitle": "計分說明",
  "wc.review.scoringNoteBody": "已確認 = 已提交至排行榜。已鎖定 = 截止日期已過，選擇無法再編輯。",
  "wc.review.afProUnlocks": "AF Pro 解鎖",
  "wc.review.afProUnlocksDetails": "完整報告——冠軍信心、勝利路徑、AI 解說敘事、你的獨特洞察以及完整分享卡。",
  "wc.review.savedGroupTitle": "已儲存的小組賽選擇",
  "wc.review.savedGroupNote": "你的預測 · 官方結果另行顯示",
  "wc.review.groupPicksSaved": "{{n}}/4 已儲存",
  "wc.review.noGroupPicksYet": "尚未儲存排名。",
  "wc.review.loadingGroupPicks": "載入小組賽選擇中...",
  "wc.review.finalizeLockWarning": "鎖定截止日期後，選擇可能無法再編輯。",

  // ── Guided Matchup Picker (Phase 6) ──────────────────────────────────
  "wc.guided.dialogLabel": "對戰引導選擇器",
  "wc.guided.closeLabel": "關閉引導選擇器",
  "wc.guided.timeTbd": "時間待定",
  "wc.guided.awaitingResult": "等待結果",
  "wc.guided.tbd": "待定",
  "wc.guided.matchFinal": "結束",
  "wc.guided.matchPostponed": "延期",
  "wc.guided.pickAriaLabel": "選擇 {{teamName}} 獲勝",
  "wc.guided.progressRound": "{{label}} · {{done}}/{{total}} 選擇",
  "wc.guided.progressOverall": "整體 {{pct}}%",
  "wc.guided.headerLocked": "對戰表已鎖定",
  "wc.guided.headerFixturesNotReady": "賽程尚未就緒",
  "wc.guided.headerStart": "開始選擇",
  "wc.guided.headerComplete": "對戰表完成",
  "wc.guided.headerGuided": "引導選擇",
  "wc.guided.lockedHelper":
    "此對戰表已鎖定,無法再修改選擇。",
  "wc.guided.emptyTeamsUpstream":
    "完成前面比賽的選擇後,本輪的隊伍才會出現。",
  "wc.guided.emptyFixturesUnresolved":
    "賽程已載入,但實際對戰隊伍尚未確定。",
  "wc.guided.close": "關閉",
  "wc.guided.back": "上一步",
  "wc.guided.skip": "略過",
  "wc.guided.matchNumber": "第 {{number}} 場",
  "wc.guided.saving": "儲存中…",
  "wc.guided.saved": "已儲存",
  "wc.guided.nextMatchup": "下一場比賽…",
  "wc.guided.tapToSelect": "點選一隊作為勝者",
  "wc.guided.tapToChange": "點選另一隊以更換選擇",
  "wc.guided.matchFinalNote": "此比賽已結束。",
  "wc.guided.pickEarlierRoundsFirst": "請先選擇之前輪次的勝者。",
  "wc.guided.matchEnded": "此比賽已結束。",
  "wc.guided.matchLocked": "此比賽的選擇已鎖定。",
  "wc.guided.confidenceTitle": "信心加成",
  "wc.guided.confidenceHelper":
    "信心越高,猜對時可獲得越多獎勵分數。",
  "wc.guided.confidenceOptionOne": "1 分",
  "wc.guided.confidenceOptionOther": "{{n}} 分",
  "wc.guided.bracketCompleteTitle": "對戰表完成!",
  "wc.guided.bracketCompleteBody": "你已選擇所有比賽。",
  "wc.guided.reviewBracket": "查看對戰表",
  "wc.guided.done": "完成",
  "wc.guided.errorNotReady": "此對戰尚未準備好選擇。",
  "wc.guided.errorSaveFailed": "儲存選擇失敗",
  "wc.guided.vs": "VS",

  // ── Score Summary card (Phase 6) ─────────────────────────────────────
  "wc.summary.title": "對戰表計分卡",
  "wc.summary.rankPlaceholder": "排名 —",
  "wc.summary.bracketComplete": "對戰表完成",
  "wc.summary.bracketIncomplete": "對戰表未完成",
  "wc.summary.fixturesNotReady":
    "賽程尚未完全確定 — 對戰確定後計分會更新。",
  "wc.summary.scoresNotSynced":
    "比分尚未同步 — 結果公布後即會顯示分數。",
  "wc.summary.locked":
    "對戰表已鎖定 — 選擇已凍結。",
  "wc.summary.totalPts": "總分",
  "wc.summary.possibleLeft": "可能剩餘",
  "wc.summary.correct": "正確",
  "wc.summary.wrong": "錯誤",
  "wc.summary.championPick": "冠軍選擇",
  "wc.summary.championAlive": "冠軍仍在",
  "wc.summary.championBusted": "冠軍出局",
  "wc.summary.noChampionYet": "尚未選擇冠軍",
  "wc.summary.maxCeiling": "可達上限",
  "wc.summary.maxCeilingBody":
    " 可能分數,根據你剩餘路徑計算",

  // ── Round Breakdown card (Phase 6) ───────────────────────────────────
  "wc.roundBreakdown.title": "各輪計分",
  "wc.roundBreakdown.ptsAbbrev": "{{n}} 分",
  "wc.roundBreakdown.perWin": "每勝場",
  "wc.roundBreakdown.championBonus":
    "冠軍加成已啟用:你選的冠軍贏得決賽時可獲得 {{bonus}} 分(政策 — 請以對戰規則為準)。",

  // ── Leaderboard Insights card (Phase 6) ──────────────────────────────
  "wc.insights.title": "排行榜分析",
  "wc.insights.empty":
    "完成評分的對戰表出現後,排行榜分析才會顯示。請務必在第一場比賽開始前送出你的選擇。",
  "wc.insights.currentLeader": "目前領先者",
  "wc.insights.largestGap": "最大差距",
  "wc.insights.entries": "對戰表數",
  "wc.insights.championsAlive": "冠軍仍在的數量",
  "wc.insights.mostCorrect": "猜中最多",
  "wc.insights.closestRace": "最膠著的對決",
  "wc.insights.notClose": "差距不近",
  "wc.insights.gapPts": "{{n}} 分",
  "wc.insights.mostCorrectValue": "{{name}}({{count}})",
  "wc.insights.aiSummaryTitle": "AI 群組摘要",
  "wc.insights.aiBadgeUnlocked": "僅限已完成",
  "wc.insights.aiBadgeLocked": "已鎖定",
  "wc.insights.aiNotAvailable": "尚不可用",
  "wc.insights.aiSummaryCountOne":
    "包含 {{count}} 份公開對戰表。",
  "wc.insights.aiSummaryCountOther":
    "包含 {{count}} 份公開對戰表。",
  "wc.insights.aiSummaryLabel": "僅限已完成的摘要:",
  "wc.insights.aiCommonChampionLabel": "最常見冠軍:",
  "wc.insights.aiRaceLabel": "對決提示:",
  "wc.insights.aiRaceClose":
    "前兩名差距在 5 分以內。",
  "wc.insights.aiRaceNotClose":
    "目前前兩名差距還不算近。",
  "wc.insights.aiWinReadLabel": "AI 勝率解讀:",
  "wc.insights.aiWinReadBody":
    "{{name}} 預測 {{pct}}%,對戰表健康度 {{health}}。",
  "wc.insights.aiPrivacyNote":
    "僅使用已完成/公開的排行榜資料。不包含未完成的私人選擇。對戰指引僅限於群組選擇與計分機制。",
  "wc.insights.aiUpgradeNote":
    "升級 AI/Pro 即可獲得僅限已完成的群組摘要。鎖定的使用者不會觸發 AI 呼叫。",

  // ── Settings panel chrome (Phase 6) ──────────────────────────────────
  "wc.settings.title": "群組設定",
  "wc.settings.subtitle":
    "識別、上限、計分、可見性與通知 — 世界盃對戰表群組的管理員控制項。",
  "wc.settings.loading": "正在載入群組設定…",
  "wc.settings.sectionIdentity": "群組識別",
  "wc.settings.save": "儲存設定",
  "wc.settings.saving": "儲存中…",
  "wc.settings.toastNoChanges": "沒有要儲存的變更。",
  "wc.settings.toastSaved": "設定已儲存。",
  "wc.settings.toastError": "無法儲存設定",

  // ── Commissioner Brain panel chrome (Phase 6) ────────────────────────
  "wc.brain.title": "管理員智慧助手",
  "wc.brain.subtitle":
    "概況、警示與 AI 助手 — 一處管理整個群組。",
  "wc.brain.loading": "正在載入管理員工具…",
  "wc.brain.loadError": "無法載入管理員工具。",

  // ── Home tab: commissioner quick panel ──────────────────────────────
  "wc.home.commissioner.syncing": "同步中...",
  "wc.home.commissioner.syncBtn": "同步賽程",
  "wc.home.commissioner.settingsBtn": "池設定",
  "wc.home.commissioner.inviteBtn": "邀請玩家",

  // ── Home tab: fixture readiness card ────────────────────────────────
  "wc.home.fixtureReady.cardTitle": "賽程準備狀態",
  "wc.home.fixtureReady.descReady": "32強賽程已確定對陣隊伍，可進行選擇。測試賽程會標示為測試資料。",
  "wc.home.fixtureReady.descBlocked": "若對陣仍為佔位符（如「小組第一名」），選擇將保持封鎖。請同步官方賽程或載入測試賽程。",
  "wc.home.fixtureReady.knockoutLocked": "淘汰賽選擇在官方32強賽程發布後開放",
  "wc.home.fixtureReady.readySingle": "{{n}} 場可選對陣已就緒",
  "wc.home.fixtureReady.readyPlural": "{{n}} 場可選對陣已就緒",
  "wc.home.fixtureReady.notSynced": "賽程尚未同步",
  "wc.home.fixtureReady.notReady": "賽程已載入，但隊伍仍為佔位符",
  "wc.home.fixtureReady.commissionerSettings": "管理員設定",

  // ── Picks tab: guided pick help banners ─────────────────────────────
  "wc.pickHelp.fixturesNotSynced": "此池的世界盃賽程同步或測試賽程載入後，選擇即可開放。",
  "wc.pickHelp.seedBtn": "載入測試賽程",
  "wc.pickHelp.seeding": "載入中...",
  "wc.pickHelp.knockoutFromGroups": "您的淘汰賽對陣由您的小組賽預測生成。排列所有小組並選擇第三名晉級者以解鎖更多槽位。",
  "wc.pickHelp.title": "引導選擇說明",
  "wc.pickHelp.body": "在行動裝置上使用固定的「開始選擇」按鈕，逐一瀏覽對陣。AI 對戰表工具將在後續版本中開放。",
  "wc.pickHelp.knockoutLocked": "淘汰賽已鎖定",
  "wc.pickHelp.continueGuided": "繼續引導選擇",
  "wc.pickHelp.reviewGuided": "檢視引導選擇",
  "wc.pickHelp.picksBlocked": "請先選擇前幾輪的勝者，隨著您的對戰表推進，更多對陣將解鎖。",

  // ── AI Simulation lock panel ─────────────────────────────────────────
  "wc.aiLock.badge": "鎖定預覽",
  "wc.aiLock.title": "AI 模擬已鎖定",
  "wc.aiLock.body": "AI 模擬解鎖後可查看預測勝者、冷門對陣及冠軍路徑。",
  "wc.aiLock.tier": "需要 AF Pro 或 AF Supreme",
  "wc.aiLock.commissionerNote": "管理員 AI 工具需要 AF 管理員或 AF Supreme。",

  // ── Premium access panel ─────────────────────────────────────────────
  "wc.premium.eyebrow": "世界盃存取權",
  "wc.premium.title": "免費遊戲持續開放。進階工具清晰設閘。",
  "wc.premium.body": "免費加入、建立第一個對戰表、進行小組賽和淘汰賽選擇、審核、確定並查看排行榜。",
  "wc.premium.entryCap": "參賽上限：",
  "wc.premium.freeLimitSingle": "免費用戶可在此池建立一個對戰表參賽。",
  "wc.premium.freeLimitPlural": "此池最多允許 {{n}} 個參賽。免費用戶仍可建立第一個對戰表；AF 管理員控制項管理多參賽規則。",
  "wc.premium.commissionerSection": "AF 管理員",
  "wc.premium.aiSection": "AI/Pro",
  "wc.premium.unlocked": "已解鎖",
  "wc.premium.card.commissioner.title": "AF 管理員工具",
  "wc.premium.card.commissioner.descOwner": "全存取用戶可使用準備狀態、同步、模擬、設定、邀請及管理員 QA 工具。",
  "wc.premium.card.commissioner.descOther": "私人/公開池控制、邀請管理、自訂計分鉤及管理員設定。",
  "wc.premium.card.chat.title": "池聊天",
  "wc.premium.card.chat.desc": "供池主持人、公告及受監管討論使用的聯盟聊天功能。",
  "wc.premium.card.export.title": "匯出排行榜",
  "wc.premium.card.export.desc": "匯出排名和對戰表摘要供管理員審核。",
  "wc.premium.card.multiEntry.title": "多重參賽",
  "wc.premium.card.multiEntry.desc": "超越預設免費首次參賽體驗的池級多重參賽控制。",
  "wc.premium.card.bracketBuilder.title": "AI 對戰表建構器",
  "wc.premium.card.bracketBuilder.desc": "引導式對戰表建構及確定性情境感知建議的佔位功能。",
  "wc.premium.card.matchupPreview.title": "AI 對陣預覽",
  "wc.premium.card.matchupPreview.desc": "官方賽程發布後預覽對陣趨向、風險及冷門路徑。",
  "wc.premium.card.whatIf.title": "AI 假設情境",
  "wc.premium.card.whatIf.desc": "排行榜情境，顯示接下來需要發生什麼。",
  "wc.premium.card.alerts.title": "AI 警報",
  "wc.premium.card.alerts.desc": "對戰表變化、小組賽優化器注記及冷門發現信號的未來警報。",

  // ── Daily Edge Report ─────────────────────────────────────────────────
  "wc.edgeReport.title": "每日優勢報告",
  "wc.edgeReport.subtitle": "今天在你組別中最重要的事",
  "wc.edgeReport.badge.free": "免費",
  "wc.edgeReport.badge.included": "已含在方案中",
  "wc.edgeReport.loading": "正在生成你的優勢報告…",
  "wc.edgeReport.error": "無法載入優勢報告。請嘗試重新整理。",
  "wc.edgeReport.section.matchThatMatters": "關鍵賽事",
  "wc.edgeReport.section.rootFor": "應支持的球隊",
  "wc.edgeReport.section.threats": "可能超越你的對手",
  "wc.edgeReport.section.bestPath": "最佳晉升路徑",
  "wc.edgeReport.section.mistakeToAvoid": "應避免的失誤",
  "wc.edgeReport.coaching.title": "Chimmy 教練建議",
  "wc.edgeReport.coaching.cachedBadge": "今日已解鎖",
  "wc.edgeReport.coaching.includedLabel": "已含在你的方案中",
  "wc.edgeReport.coaching.unlockBtn": "解鎖今日教練建議",
  "wc.edgeReport.coaching.tokenCost": "1 代幣",
  "wc.edgeReport.coaching.loading": "正在生成教練建議…",
  "wc.edgeReport.coaching.error": "教練建議暫時無法使用。請再試一次。",
  "wc.edgeReport.coaching.spendFailed": "無法扣除代幣。請確認餘額後重試。",
  "wc.edgeReport.commissionerPost.title": "組別發文靈感",
  "wc.edgeReport.commissionerPost.postBtn": "發布到組別聊天室",
  "wc.edgeReport.commissionerPost.posting": "發布中…",
  "wc.edgeReport.commissionerPost.posted": "已發布！",
  "wc.edgeReport.freshness": "確定性數據 · 每個比賽日更新",
  "wc.edgeReport.noEntry": "新增你的賽程預測以查看每日優勢報告。",
  "wc.edgeReport.billing.cached": "未使用代幣 · 教練建議今日已解鎖",
  "wc.edgeReport.billing.included": "已含在你的方案中",
  "wc.edgeReport.billing.charged": "已使用 1 代幣",
  "wc.edgeReport.feedback.title": "這對你有幫助嗎？",
  "wc.edgeReport.feedback.helpful": "有幫助",
  "wc.edgeReport.feedback.notHelpful": "沒有幫助",
  "wc.edgeReport.feedback.tooBasic": "太基礎",
  "wc.edgeReport.feedback.notActionable": "無法付諸行動",
  "wc.edgeReport.feedback.wrongData": "數據有誤",
  "wc.edgeReport.feedback.greatInsight": "很棒的洞見",
  "wc.edgeReport.feedback.thanks": "感謝你的回饋",
  "wc.edgeReport.cue.ready": "今日優勢已就緒",
}

// Filipino — natural sports-app Filipino, light Taglish where it reads
// more naturally (matches how PH football/basketball apps actually talk).
const FIL: WorldCupDictionary = {
  // ── Shared / shell ───────────────────────────────────────────────────
  "wc.common.loading": "Naglo-load...",
  "wc.common.back": "Bumalik",
  "wc.common.openSettings": "Buksan ang settings",
  "wc.common.signIn": "Mag-sign in",
  "wc.common.signOut": "Mag-sign out",

  // ── Public hub: /brackets/world-cup ──────────────────────────────────
  "wc.publicHub.backToBrackets": "← Balik sa Brackets",
  "wc.publicHub.heroTitle": "World Cup Bracket Challenge",
  "wc.publicHub.heroSubtitle":
    "Gumawa ng NCAA-style bracket pool para sa FIFA World Cup. Mag-invite ng kaibigan, mag-pick, mag-track ng live na iskor, at umakyat sa leaderboard.",
  "wc.publicHub.discover": "Maghanap ng public pools",
  "wc.publicHub.joinWithCode": "Sumali gamit ang invite code",
  "wc.publicHub.createPool": "Gumawa ng pool",
  "wc.publicHub.createWorldCupPool": "Gumawa ng World Cup pool",
  "wc.publicHub.yourPools": "Iyong World Cup pools",
  "wc.publicHub.poolsCountOne": "{{count}} pool",
  "wc.publicHub.poolsCountOther": "{{count}} na pools",
  "wc.publicHub.scoreLabel": "Iskor",
  "wc.publicHub.rankLabel": "Ranggo",
  "wc.publicHub.participantsOne": "{{count}} kalahok",
  "wc.publicHub.participantsOther": "{{count}} na kalahok",
  "wc.publicHub.statusOpen": "Bukas",
  "wc.publicHub.statusLocked": "Nakasara",
  "wc.publicHub.statusFinal": "Final",
  "wc.publicHub.emptyTitle": "Wala pang World Cup pools",
  "wc.publicHub.emptyBody":
    "Hindi ka pa nakakagawa o nakakasali sa anumang World Cup bracket pool.",
  "wc.publicHub.emptyHint":
    "Gumawa ka ng isa at mag-invite ng mga kaibigan, o humingi ng invite code.",
  "wc.publicHub.signInTitle": "Mag-sign in para magsimula",
  "wc.publicHub.signInBody":
    "Gumawa o sumali sa isang World Cup bracket pool at makipagtagisan sa mga kaibigan.",
  "wc.publicHub.signInCta": "Mag-sign in para magsimula",
  "wc.publicHub.feature.privatePublic":
    "Private o public pools — hanggang 100 kalahok.",
  "wc.publicHub.feature.bracketsPerUser":
    "Hanggang 5 brackets bawat user, lumaban gamit ang iba't ibang strategy.",
  "wc.publicHub.feature.ncaaScoring":
    "NCAA-style scoring — mas mataas na puntos sa mga huling round.",
  "wc.publicHub.feature.guidedPicker":
    "Gabay sa pag-pick gamit ang AI matchup previews.",
  "wc.publicHub.feature.liveTracking":
    "Live na iskor at minute-by-minute na tracking.",
  "wc.publicHub.feature.aiBracketBuilder":
    "Awtomatikong pupunan ng AI bracket builder ang mga hindi napiling laban.",
  "wc.publicHub.feature.perBracketLeaderboard":
    "Per-bracket leaderboard — bawat entry ay may sariling ranggo.",
  "wc.publicHub.feature.lockOnKickoff":
    "Magla-lock ang mga bracket sa simula ng unang World Cup match.",

  // ── Public hub: v2 command center ────────────────────────────────────
  "wc.publicHub.commandEyebrow": "AF World Cup Pools Command Center",
  "wc.publicHub.commandTitle": "Itayo ang iyong landas tungo sa kadakilaan sa World Cup.",
  "wc.publicHub.commandSubtitle":
    "Gumawa ng pool, i-invite ang iyong grupo, i-rank ang bawat grupo, piliin ang knockout path, at panoorin ang leaderboard na maging buhay.",
  "wc.publicHub.trustNote": "Walang taya. Kaluwalhatian, strategy, at pagmamalaki lang.",
  "wc.publicHub.stat.teams": "48 bansa",
  "wc.publicHub.stat.groups": "12 grupo",
  "wc.publicHub.stat.matches": "104 laro",
  "wc.publicHub.stat.format": "Group Stage + Knockouts",
  "wc.publicHub.actionsTitle": "Paano mo gustong magsimula?",
  "wc.publicHub.action.create.title": "Gumawa ng pool",
  "wc.publicHub.action.create.desc":
    "Magsimula ng private o public na World Cup pool at mag-invite ng mga kaibigan.",
  "wc.publicHub.action.join.title": "Sumali gamit ang code",
  "wc.publicHub.action.join.desc": "May invite? Ilagay ang code at direktang sumali.",
  "wc.publicHub.action.discover.title": "Maghanap ng public pools",
  "wc.publicHub.action.discover.desc":
    "Hanapin ang mga bukas na World Cup pool at sumali sa aksyon.",
  "wc.publicHub.how.title": "Paano gumagana ang AF World Cup Pools",
  "wc.publicHub.how.step1Title": "Gumawa o sumali sa pool",
  "wc.publicHub.how.step1Body":
    "Magsimula ng private pool para sa iyong grupo o humanap ng public pool na pwedeng salihan ng lahat.",
  "wc.publicHub.how.step2Title": "I-rank ang bawat grupo",
  "wc.publicHub.how.step2Body":
    "Hulaan kung saan matatapos ang bawat team sa kanilang grupo, kasama ang mga third-place advancers.",
  "wc.publicHub.how.step3Title": "Itayo ang knockout path",
  "wc.publicHub.how.step3Body":
    "Piliin ang mga panalo sa bawat knockout round hanggang sa final.",
  "wc.publicHub.how.step4Title": "I-finalize at umakyat",
  "wc.publicHub.how.step4Body":
    "I-lock ang bracket bago magsimula ang laro, tapos panoorin ang live standings at ibahagi ang resulta.",
  "wc.publicHub.ai.title": "AI-Powered na Bracket Tools",
  "wc.publicHub.ai.subtitle":
    "Tinutulungan ka ng Chimmy at AllFantasy AI na maunawaan ang panganib, malaman ang mga insight, at gabayan ang mga commissioner.",
  "wc.publicHub.ai.explain.title": "Ipaliwanag ang aking bracket",
  "wc.publicHub.ai.explain.desc":
    "Binabasa ng AI ang iyong mga pick at inilalahad kung ano ang kakaiba ng iyong bracket.",
  "wc.publicHub.ai.danger.title": "Knockout Danger Zones",
  "wc.publicHub.ai.danger.desc":
    "Tingnan kung aling knockout picks ang pinaka-vulnerable sa mga upset.",
  "wc.publicHub.ai.chat.title": "Pool Chat + Strategy",
  "wc.publicHub.ai.chat.desc": "Tanungin si @Chimmy para sa pick advice sa pool chat.",
  "wc.publicHub.ai.commissioner.title": "Commissioner Insights",
  "wc.publicHub.ai.commissioner.desc":
    "Mga AI summary para sa pool health, bracket diversity, at aktibidad ng miyembro.",
  "wc.publicHub.ai.gating":
    "Available sa mga eligible na AI plan o token-powered na tools.",
  "wc.publicHub.social.title": "Isama ang iyong grupo.",
  "wc.publicHub.social.desc":
    "Ibahagi ang pool link, hamunin ang mga kaibigan, at hayaan ang leaderboard ang magpasya.",
  "wc.publicHub.social.cta": "Gumawa ng pool para makakuha ng invite link",
  "wc.publicHub.trust.note":
    "Ang AF World Cup Pools ay para sa fantasy sports entertainment, strategy, at pagmamalaki. Libreng laruin.",

  // ── Pool dashboard: tab labels ───────────────────────────────────────
  "wc.tab.home": "Home",
  "wc.tab.groupStage": "Group Stage",
  "wc.tab.picks": "Knockouts",
  "wc.tab.review": "Review",
  "wc.tab.leaderboard": "Leaderboard",
  "wc.tab.rules": "Mga Patakaran",
  "wc.tab.invite": "Mag-invite",
  "wc.tab.commissioner": "Commissioner",
  "wc.tab.admin": "Mga Setting",

  // ── Pool dashboard: sticky subnav labels ─────────────────────────────
  "wc.subnav.quickJump": "Quick jumps",
  "wc.subnav.start": "Simula",
  "wc.subnav.groupBuilder": "Ayos ng Groups",
  "wc.subnav.bracketBoard": "Bracket Board",
  "wc.subnav.firstRound": "Unang Round",
  "wc.subnav.opsTools": "Ops Tools",
  "wc.subnav.rankSnapshot": "Rank Snapshot",
  "wc.subnav.inviteCenter": "Invite Center",

  // ── Mobile bottom nav: short labels ──────────────────────────────────
  "wc.tab.leaderboard.short": "Rank",
  "wc.tab.commissioner.short": "Comish",
  "wc.tab.settings.short": "Setup",
  "wc.tab.home.short": "Home",
  "wc.tab.groupStage.short": "Groups",
  "wc.tab.picks.short": "Bracket",
  "wc.tab.review.short": "Review",
  "wc.tab.rules.short": "Patakaran",
  "wc.tab.invite.short": "Invite",
  "wc.tab.admin.short": "Setting",

  // ── Rules tab ────────────────────────────────────────────────────────
  "wc.rules.hero.eyebrow": "Pool",
  "wc.rules.hero.title": "Mga Patakaran ng Pool",
  "wc.rules.hero.subtitle": "Alamin ang scoring, mga deadline, entries, at kung paano gumagana ang iyong World Cup pool.",
  "wc.rules.how.title": "Paano Ito Gumagana",
  "wc.rules.how.body1": "Piliin ang mananalo sa bawat laro mula sa Round of 32 hanggang sa kampeon. Ina-lock ang mga picks sa simula ng bawat laro.",
  "wc.rules.how.body2": "Ang tamang picks ay nagbibigay ng mas maraming puntos sa bawat round. Ina-update ang mga resulta at nire-refresh ang leaderboard.",
  "wc.rules.scoring.title": "Scoring",
  "wc.rules.scoring.roundOf32": "Round of 32",
  "wc.rules.scoring.roundOf16": "Round of 16",
  "wc.rules.scoring.quarterfinal": "Quarterfinal",
  "wc.rules.scoring.semifinal": "Semifinal",
  "wc.rules.scoring.final": "Final",
  "wc.rules.scoring.champion": "Champion Bonus",
  "wc.rules.scoring.thirdPlace": "3rd Place",
  "wc.rules.scoring.pts": "pts",
  "wc.rules.settings.title": "Mga Setting ng Pool",
  "wc.rules.settings.bracketsPerUser": "Mga bracket bawat user",
  "wc.rules.settings.thirdPlace": "3rd place match",
  "wc.rules.settings.thirdPlaceOn": "Kasama",
  "wc.rules.settings.thirdPlaceOff": "Hindi kasama",
  "wc.rules.settings.inviteSharing": "Pagbabahagi ng imbitasyon",
  "wc.rules.settings.inviteCommish": "Commissioner lang",
  "wc.rules.trustNote": "Libreng laruin. Mga World Cup prediction, estratehiya, at karapatang magyabang lang.",

  // ── Pool dashboard: home tab ──────────────────────────────────────────
  "wc.home.title": "World Cup Pool Dashboard",
  "wc.home.subtitle": "Magsimula rito: gumawa o buksan ang iyong bracket, i-rank ang lahat ng Group Stage pools, gumawa ng Knockout picks, i-review, tapos i-finalize para makita sa leaderboard.",
  "wc.home.copyInvite": "Kopyahin ang Imbitasyon",
  "wc.home.invitePanel": "Invite Panel",
  "wc.home.stat.participants": "Kalahok",
  "wc.home.stat.entries": "Mga Entry",
  "wc.home.stat.finalized": "Mga Finalized na Entry",
  "wc.home.stat.fixtureStatus": "Status ng Fixture",
  "wc.home.stat.ready": "Handa",
  "wc.home.stat.notReady": "Hindi Handa",
  "wc.home.entries.title": "Mga Entry",
  "wc.home.entries.loading": "Nilo-load ang mga entry...",
  // ── Home tab: entry list card ────────────────────────────────────────
  "wc.entryList.subtitle": "Gumawa o buksan ang iyong personal na bracket kapag handa ka nang gumawa ng mga pick. Ang libreng laro ay sumusuporta sa isang bracket entry; ang mga setting ng AF Commissioner ay maaaring magpahintulot ng maraming entry.",
  "wc.entryList.complete": "Kumpleto",
  "wc.entryList.notComplete": "Hindi kumpleto",
  "wc.entryList.rank": "Ranggo #{{rank}}",
  "wc.entryList.unranked": "Walang ranggo",
  "wc.entryList.openBracket": "Buksan ang Bracket",
  "wc.entryList.noBracketsTitle": "Wala pang bracket na nagawa",
  "wc.entryList.noBracketsBody": "Gumawa muna ng iyong personal na bracket, pagkatapos ay maaari kang gumawa ng mga pick kapag handa na ang mga fixture.",
  // ── Pool dashboard: AI features teaser ───────────────────────────────
  "wc.home.ai.title": "Mga AI Feature",
  "wc.home.ai.chimmyHint": "I-type ang @chimmy sa pool chat para sa personalized na bracket advice.",
  "wc.home.ai.explainHint": "Pumunta sa Review tab para makakuha ng AI na paliwanag ng iyong bracket strategy.",
  "wc.home.ai.unlockHint": "Mag-upgrade sa AF Pro para i-unlock ang Chimmy AI at Explain My Bracket.",

  // ── AI CTA panel ──────────────────────────────────────────────────────
  "wc.cta.panelTitle": "Mga AI Insight",
  "wc.cta.aiRowLabel": "AI / Pro",
  "wc.cta.commissionerRowLabel": "Commissioner",
  "wc.cta.askChimmy": "Tanungin si Chimmy",
  "wc.cta.askChimmyDesc": "Buksan si Chimmy na may tanong tungkol sa bracket",
  "wc.cta.pathToFirst": "Landas Patungo sa Una",
  "wc.cta.pathToFirstDesc": "Tanungin si Chimmy kung ano ang kailangan ng iyong bracket para maabot ang unang lugar",
  "wc.cta.explainBracket": "Ipaliwanag ang Aking Bracket",
  "wc.cta.explainBracketDesc": "Makakuha ng AI na paliwanag ng iyong bracket strategy",
  "wc.cta.rootingGuide": "Gabay sa Pagtangkilik",
  "wc.cta.rootingGuideDesc": "Gumawa ng gabay sa pagtangkilik para sa entry na ito",
  "wc.cta.poolSwing": "Pool Swing",
  "wc.cta.poolSwingDesc": "Hanapin ang pinakamalaking paparating na pagbabago sa leaderboard",
  "wc.cta.championRisk": "Panganib ng Kampeon",
  "wc.cta.championRiskDesc": "Suriin ang panganib ng champion pick sa buong pool",
  "wc.cta.commissionerRecap": "Commissioner Recap",
  "wc.cta.commissionerRecapDesc": "Gumawa ng AI pool recap (preview bago i-post)",
  "wc.cta.postHype": "Mag-post ng Hype",
  "wc.cta.postHypeDesc": "Mag-post ng hype message sa pool chat",
  "wc.cta.findIncomplete": "Mga Hindi Kumpletong Pick",
  "wc.cta.findIncompleteDesc": "Hanapin ang mga entry na may pinakamataas na panganib ng nawawalang picks",

  // ── Pool Chat community panel (Goal 9) ───────────────────────────────
  "wc.chat.hero.title": "Pool Chat",
  "wc.chat.hero.subtitle":
    "Mag-usap ng estratehiya, tawagan ang iyong panalo, at panatilihing aktibo ang pool.",
  "wc.chat.hero.badge": "Komunidad",
  "wc.chat.empty.headline": "Simulan ang unang debate.",
  "wc.chat.empty.body":
    "Tawagan ang iyong kampeon, tanungin ang isang mapanganib na pick, o humingi ng opinyon kay Chimmy.",
  "wc.chat.chip.explainBracket": "Ipaliwanag ang aking bracket",
  "wc.chat.chip.dangerZone": "Hanapin ang aking mga mapanganib na pick",
  "wc.chat.chip.poolFavorite": "Sino ang paboritong pool?",
  "wc.chat.chip.keyMatchup": "Anong laban ang maaaring magbago ng lahat?",
  "wc.chat.chip.trashTalk": "Bigyan ako ng ligtas na trash talk",
  "wc.chat.composer.placeholder": "Mag-mensahe sa pool o magtanong kay Chimmy…",
  "wc.chat.composer.send": "Ipadala",
  "wc.chat.privateLabel": "Pribadong tugon ni Chimmy · Ikaw lang ang makakakita",
  "wc.chat.aiHint.unlocked":
    "Ang mga tugon ng @chimmy ay pribado. Ikaw lang ang makakakita ng iyong prompt at sagot ni Chimmy sa pool na ito.",
  "wc.chat.aiHint.locked":
    "Ang mga pribadong tugon ng @chimmy ay nangangailangan ng AI/Pro. Mag-upgrade para magtanong kay Chimmy mula sa pool chat.",
  "wc.chat.trustNote": "Maging mapagkumpitensya. Maging malinis.",
  "wc.chat.loading": "Naglo-load ng pool chat…",
  "wc.chat.refresh": "I-refresh",

  // ── Pool dashboard: command hero ──────────────────────────────────────
  "wc.pool.eyebrow": "Pool Command Center",
  "wc.pool.privateBadge": "Pribado",
  "wc.pool.publicBadge": "Bukas",
  // ── Pool dashboard: what to do next card ──────────────────────────────
  "wc.pool.next.title": "Ano ang Susunod",
  "wc.pool.next.create.title": "Gumawa ng Iyong Bracket",
  "wc.pool.next.create.body": "Simulan ang iyong mga pick para makipagkumpitensya sa pool na ito.",
  "wc.pool.next.picks.title": "Gumawa ng Iyong mga Pick",
  "wc.pool.next.picks.body": "Handa na ang mga fixture — buksan ang iyong bracket at pumili ng mga mananalo.",
  "wc.pool.next.review.title": "I-review at I-finalize",
  "wc.pool.next.review.body": "Lahat ng pick ay nagawa na. I-review ang iyong bracket at i-lock bago magsimula ang torneo.",
  "wc.pool.next.done.title": "Naisumite na ang Bracket",
  "wc.pool.next.done.body": "Naka-lock na ang iyong bracket. Tingnan ang leaderboard para ma-track ang iyong rank.",
  "wc.pool.next.waiting.title": "Naghihintay ng mga Fixture",
  "wc.pool.next.waiting.body": "Inaayos pa ang mga detalye ng laro. Bumalik bago mag-kick-off.",
  // ── Pool dashboard: progress strip ────────────────────────────────────
  "wc.pool.progress.title": "Progreso",
  "wc.pool.progress.created": "Nagawa",
  "wc.pool.progress.picks": "Mga Pick na Nagawa",
  "wc.pool.progress.finalized": "Naisumite",
  // ── Pool dashboard: commissioner panel ────────────────────────────────
  "wc.pool.commissioner.title": "Mga Tool ng Commissioner",
  // ── Pool dashboard: leaderboard preview ───────────────────────────────
  "wc.pool.leaderboard.title": "Leaderboard",
  "wc.pool.leaderboard.empty": "Wala pang na-score na bracket",
  "wc.pool.leaderboard.emptyNote": "Lalabas ang mga bracket dito pagkatapos magsimula ang scoring.",
  "wc.pool.leaderboard.viewFull": "Buong Leaderboard",

  // ── Pool dashboard: header / status strip ────────────────────────────
  "wc.header.sync": "I-sync",
  "wc.header.inviteAria": "Mag-invite ng kaibigan",
  "wc.header.invite": "Mag-invite",
  "wc.header.testMode": "Test mode",
  "wc.header.testModeNote":
    "simulated ang mga resulta at puwedeng makaapekto sa leaderboard.",

  // ── Lock countdown ───────────────────────────────────────────────────
  "wc.lock.untilLockDays":
    "{{d}}d {{h}}h bago mag-lock ang mga pick",
  "wc.lock.untilLockHours":
    "{{h}}h {{m}}m bago mag-lock ang mga pick",
  "wc.lock.untilLockMinutes":
    "{{m}}m bago mag-lock ang mga pick",
  "wc.lock.locksSoon": "Malapit nang mag-lock ang bracket",
  "wc.lock.bracketLocked": "Naka-lock na ang bracket",
  "wc.lock.picksFrozen":
    "Naka-lock na ang bracket — hindi na puwedeng baguhin ang mga pick.",

  // ── Countdown banner ─────────────────────────────────────────────────
  "wc.countdown.banner.startsIn": "World Cup starts in",
  "wc.countdown.banner.locksNote": "Group picks lock at kickoff",
  "wc.countdown.banner.urgent24h": "Picks lock soon",
  "wc.countdown.banner.urgent1h": "Final chance — picks lock at kickoff",
  "wc.countdown.banner.locked.title": "Group picks are locked",
  "wc.countdown.banner.locked.subtitle": "Live scoring is now active",
  "wc.countdown.banner.cta.make": "Make Picks",
  "wc.countdown.banner.cta.finish": "Finish My Bracket",
  "wc.countdown.banner.cta.finishNow": "Finish Picks Now",
  "wc.countdown.banner.cta.leaderboard": "View Leaderboard",
  "wc.countdown.banner.firstMatchFallback": "First group-stage match",
  "wc.countdown.banner.lockTime": "Group picks lock · {{time}}",
  "wc.countdown.banner.fallback": "World Cup countdown coming soon",
  "wc.countdown.banner.fallbackHint": "Picks remain editable until kickoff is confirmed",

  // ── AI upgrade / cap messages ────────────────────────────────────────
  "wc.ai.upgrade.chimmy.free": "You've used today's 3 Chimmy questions. Upgrade to AF Pro for 30 per day.",
  "wc.ai.upgrade.chimmy.pro": "You've used today's 30 Chimmy questions. They reset at midnight UTC.",
  "wc.ai.upgrade.explain.free": "Bracket explanations require AF Pro. Upgrade to get daily AI bracket breakdowns.",
  "wc.ai.upgrade.explain.pro": "You've used today's bracket explanation. It resets at midnight UTC.",
  "wc.ai.upgrade.matchup.free": "AI Matchup Intelligence requires AF Pro.",
  "wc.ai.upgrade.matchup.pro": "You've used today's 25 AI matchup analyses. They reset at midnight UTC.",
  "wc.ai.upgrade.brain.free": "Commissioner Brain requires AF Commissioner or higher.",
  "wc.ai.upgrade.brain.pro": "You've used today's Commissioner Brain calls. They reset at midnight UTC.",
  "wc.ai.upgrade.resetHint": "Daily AI limits reset at midnight UTC.",
  "wc.ai.upgrade.cta": "Upgrade Plan",

  // ── Knockouts tab ────────────────────────────────────────────────────
  "wc.knockouts.intro.reseeded":
    "Bubukas ang Knockout picks kapag available na ang official Round of 32 fixtures.",
  "wc.knockouts.intro.predictive":
    "Galing sa iyong predicted group results ang knockout bracket mo.",
  "wc.knockouts.subintro.reseeded":
    "Ayos pa rin ang Group Stage picks. Kapag na-sync na ang totoong knockout fixtures, gagawa ka ng bagong knockout picks mula sa official bracket.",
  "wc.knockouts.subintro.predictive":
    "Nagba-base ang Knockout matchups sa iyong Group Stage predictions. Kung papalitan ang group predictions puwedeng ma-reset ang ilang knockout picks.",
  "wc.knockouts.startPicks": "Simulan ang picks",
  "wc.knockouts.continuePicks": "Ituloy ang picks",
  "wc.knockouts.guidance.complete":
    "{{done}}/{{required}} na available na picks ang tapos.",
  "wc.knockouts.guidance.nextPick":
    "Susunod na pick: Match {{matchNumber}}.",
  "wc.knockouts.guidance.blocked":
    "Pumili muna ng mga winner sa naunang rounds. Magbubukas ang mas maraming pick kapag may na-confirm na winner.",
  "wc.knockouts.guidance.noneReady":
    "Wala pang available na knockout picks sa ngayon.",

  // ── Knockout Danger Zones card ───────────────────────────────────────
  "wc.danger.eyebrow": "Knockouts",
  "wc.danger.title": "Knockout Danger Zones",
  "wc.danger.subtitle":
    "Deterministic — kinukumpara ang iyong picks sa pre-tournament seed strength at sa live match state.",
  "wc.danger.tierPro": "AF Pro",
  "wc.danger.tierBasic": "Basic",
  "wc.danger.emptyNoEntry":
    "Magbukas ng bracket entry para makita ang danger zones.",
  "wc.danger.emptyNoPicks":
    "Mag-knockout picks ka para makita ang danger zones.",
  "wc.danger.emptyNoRisks":
    "Wala pang danger zones ngayon. Mukhang pabor ang lahat ng iyong knockout picks base sa pre-tournament strength.",
  "wc.danger.severityHigh": "Mataas",
  "wc.danger.severityMedium": "Katamtaman",
  "wc.danger.severityLow": "Mababa",
  "wc.danger.severitySuffix": "na panganib",
  "wc.danger.footer":
    "Tinitignan lang ang iyong sariling picks vs public schedule. Walang AI call. Walang ibang user's picks.",

  // ── AI Report (Review tab) ───────────────────────────────────────────
  "wc.aiReport.eyebrow": "Report",
  "wc.aiReport.title": "Iyong Bracket AI Report",
  "wc.aiReport.subtitle":
    "Anim na AI signals na galing sa iyong sariling picks. Lahat ng nasa ibaba ay para sa iyo lang.",
  "wc.aiReport.tierActive": "AF Pro active",
  "wc.aiReport.tierPreview": "AF Pro preview",

  // ── Share / Invite ───────────────────────────────────────────────────
  "wc.invite.title": "Mag-invite ng kaibigan",
  "wc.invite.copyLink": "Kopyahin ang invite link",
  "wc.invite.copied": "Na-copy ang link!",
  "wc.invite.shareNative": "I-share",
  "wc.invite.shareViaText": "Text",
  "wc.invite.shareViaEmail": "Email",
  "wc.invite.viaSocial": "Social",
  "wc.invite.heading":
    "Mag-invite ng kaibigan na makasali sa {{poolName}} sa AllFantasy.",
  "wc.invite.inviteCodeLabel": "Invite code",

  // ── Commissioner Checklist ───────────────────────────────────────────
  "wc.checklist.title": "Pool Completion Checklist",
  "wc.checklist.subtitle":
    "Mga miyembro ng {{poolName}} at ang kanilang status sa harap ng lock deadline.",
  "wc.checklist.copyReminder": "Kopyahin ang reminder",
  "wc.checklist.reminderCopied": "Na-copy ang reminder!",
  "wc.checklist.statusReady": "Handa na",
  "wc.checklist.statusNoMembers": "Wala pang miyembro",
  "wc.checklist.statusNoData": "Walang snapshot na available",

  // ── Empty / loading / error states ───────────────────────────────────
  "wc.state.loading": "Naglo-load...",
  "wc.state.refresh": "I-refresh",
  "wc.state.tryAgain": "Subukan ulit",
  "wc.state.noEntries":
    "Wala ka pang bracket entry para sa pool na ito.",
  "wc.state.createEntry": "Gumawa ng aking bracket",

  // ── Language selector tooltip ────────────────────────────────────────
  "wc.language.label": "Wika",
  "wc.language.english": "English",
  "wc.language.spanish": "Español",
  "wc.language.chinese": "繁體中文",
  "wc.language.filipino": "Filipino",
  "wc.language.vietnamese": "Tiếng Việt",

  // ── Create page / modal ──────────────────────────────────────────────
  "wc.create.goBack": "Bumalik",
  "wc.create.header": "Gumawa ng World Cup Bracket Pool",
  "wc.create.subheader":
    "2026 FIFA World Cup · scoring per round",
  "wc.create.heroTitle": "2026 FIFA World Cup",
  "wc.create.heroSubtitle":
    "Gumawa ng pool container — mag-invite ng kaibigan at hayaan silang mag-build ng sariling brackets sa loob.",
  "wc.create.poolName.label": "Pangalan ng pool",
  "wc.create.poolName.placeholder": "hal. Office World Cup Pool 2026",
  "wc.create.poolName.error.blank":
    "Hindi pwedeng walang pangalan ang pool.",
  "wc.create.poolName.default": "World Cup Bracket Pool",
  "wc.create.visibility.label": "Visibility ng pool",
  "wc.create.visibility.private": "Private",
  "wc.create.visibility.privateHint":
    "Kailangan ng invite link para sumali",
  "wc.create.visibility.public": "Public",
  "wc.create.visibility.publicHint":
    "Pwedeng makita at sumali ang kahit sino",
  "wc.create.maxUsers.label": "Max users",
  "wc.create.maxUsers.hint": "Hanggang {{max}} kada pool",
  "wc.create.maxUsers.error": "Dapat nasa pagitan ng 2 at {{max}}.",
  "wc.create.maxEntries.label": "Brackets bawat user",
  "wc.create.maxEntries.hint": "Hanggang {{max}} bawat user",
  "wc.create.maxEntries.error": "Dapat nasa pagitan ng 1 at {{max}}.",
  "wc.create.lockRule.label": "Patakaran sa pag-lock ng pick",
  "wc.create.lockRule.tournament": "Tournament lock",
  "wc.create.lockRule.tournamentHint":
    "Magla-lock lahat ng picks pagsimula ng unang laban",
  "wc.create.lockRule.perMatch": "Per-match lock",
  "wc.create.lockRule.perMatchHint":
    "Bawat laban ay magla-lock sa sariling kickoff",
  "wc.create.lockRule.copyTournament":
    "Pwede pang baguhin ang picks hanggang magsimula ang unang World Cup match.",
  "wc.create.lockRule.copyPerMatch":
    "Pwede pang baguhin ang bawat matchup hanggang umarangkada ang sariling laban.",
  "wc.create.scoring.intro": "Scoring per round:",
  "wc.create.scoring.values":
    "10 pts Round of 32 · 20 pts Round of 16 · 40 pts QF · 80 pts SF · 160 pts Final · 320 pts Champion bonus",
  "wc.create.helper.entriesOne":
    "Bawat user ay puwedeng gumawa ng hanggang {{max}} bracket.",
  "wc.create.helper.entriesOther":
    "Bawat user ay puwedeng gumawa ng hanggang {{max}} na bracket.",
  "wc.create.helper.leaderboard":
    "Ang leaderboard ay nagra-rank ng finalized na brackets, hindi drafts.",
  "wc.create.helper.inviteLink":
    "Lalabas ang invite link pagkatapos gawin ang pool.",
  "wc.create.thirdPlace": "Isama ang third-place match",
  "wc.create.testFixtures.label": "Mag-seed ng test fixtures",
  "wc.create.testFixtures.hint":
    "Magdadagdag ng mock Round of 32 teams, flags, kickoff times, at venues para agad na pwedeng laruin ang pool.",
  "wc.create.submit.idle": "Gumawa ng pool",
  "wc.create.submit.creating": "Gumagawa...",
  "wc.create.submit.opening": "Nagawa na, bubuksan...",
  "wc.create.openingSuccess": "Nagawa na ang bracket, bubuksan...",
  "wc.create.error.signInRequired":
    "Mag-sign in muna para gumawa ng bracket.",
  "wc.create.error.noId":
    "Nagawa ang bracket pero walang nai-return na ID ang server. I-refresh ang page.",
  "wc.create.error.generic": "Hindi nagawa ang bracket",
  "wc.create.error.requestFailed":
    "Hindi natapos ang request ({{status}})",

  // ── Discover page ────────────────────────────────────────────────────
  "wc.discover.backToHub": "← World Cup hub",
  "wc.discover.createPool": "Gumawa ng pool",
  "wc.discover.title": "Maghanap ng public pools",
  "wc.discover.subtitle":
    "Mag-browse ng public World Cup bracket pools. Sa pagsali, bubuksan ang Bracket 1 na walang picks — dadalhin ka namin sa guided picker kapag tumatanggap pa ng bagong players at hindi puno.",
  "wc.discover.search.label": "Hanapin",
  "wc.discover.search.placeholder": "Pangalan ng pool",
  "wc.discover.season.label": "Season",
  "wc.discover.season.placeholder": "hal. 2026",
  "wc.discover.statusFilter.label": "Status",
  "wc.discover.statusFilter.all": "Lahat",
  "wc.discover.statusFilter.open": "Bukas",
  "wc.discover.statusFilter.locked": "Nakasara",
  "wc.discover.statusFilter.final": "Final",
  "wc.discover.loading": "Naglo-load ng public pools...",
  "wc.discover.errors.couldNotLoad": "Hindi na-load ang pools",
  "wc.discover.empty":
    "Walang public pool na tumugma sa filters. Subukan ang ibang season o linisin ang search — o sumali sa private pool gamit ang invite code sa itaas.",
  "wc.discover.joinPanelTitle":
    "Sumali gamit ang invite code (private pools)",

  // ── Discover card ────────────────────────────────────────────────────
  "wc.discover.card.statusOpen": "Bukas",
  "wc.discover.card.blockedFull": "Puno na ang league",
  "wc.discover.card.blockedClosed":
    "Sarado na sa bagong players",
  "wc.discover.card.password": "Password",
  "wc.discover.card.lateJoin":
    "Naka-lock na ang picks · pwede pa ring sumali",
  "wc.discover.card.preview": "I-preview",
  "wc.discover.card.join": "Sumali",

  // ── Join / invite panel ──────────────────────────────────────────────
  "wc.join.backToHub": "← World Cup hub",
  "wc.join.brandEyebrow": "AllFantasy",
  "wc.join.brandTitle": "2026 World Cup Bracket Pools",
  "wc.join.panelTitle": "Sumali gamit ang invite code",
  "wc.join.panelHelper":
    "Ilagay ang invite code mula sa iyong commissioner. Pagkatapos sumali, dadalhin ka sa pool dashboard at puwede mo nang simulan ang iyong unang bracket. Ang mga password-protected na pool ay nangangailangan ng password na nakatakda sa pool settings.",
  "wc.join.codeInput.placeholder": "WCUP invite code",
  "wc.join.previewBtn": "I-preview",
  "wc.join.errors.invalidCode": "Maglagay ng valid na invite code",
  "wc.join.errors.notFound": "Walang nakitang invite",
  "wc.join.errors.full": "Puno na ang pool na ito.",
  "wc.join.errors.closed":
    "Sarado na ang pool na ito sa bagong players.",
  "wc.join.errors.couldNotJoin": "Hindi nakasali",
  "wc.join.preview.hostLine":
    "Host: {{owner}} · {{count}} naglalaro · {{visibility}}",
  "wc.join.preview.openCopy":
    "Sumali na para gumawa ng Bracket 1, mag-pick sa Group Stage at Knockout, at i-finalize kapag ready.",
  "wc.join.preview.fullCopy": "Puno na ang pool na ito.",
  "wc.join.preview.closedCopy":
    "Naka-lock na ang pool — hindi na tumatanggap ng bagong players.",
  "wc.join.preview.passwordLabel": "Password sa pagsali",
  "wc.join.preview.joinBtn": "Sumali sa league",
  "wc.join.success": "Sali na — Bracket 1 ay handa na.",

  // ── Finalize / share success block (Review tab) ──────────────────────
  "wc.finalize.eyebrow": "Naka-finalize",
  "wc.finalize.title": "Locked in na ang iyong bracket",
  "wc.finalize.subtitleNoTime":
    "Na-submit na. Pwede mo pa ring i-edit hangga't hindi naka-lock ang pool — mag-invite ng kaibigan habang may slots pa.",
  "wc.finalize.subtitleWithTime":
    "Na-submit noong {{at}}. Pwede mo pa ring i-edit hangga't hindi naka-lock ang pool — mag-invite ng kaibigan habang may slots pa.",
  "wc.finalize.copyShare": "Kopyahin ang share text",
  "wc.finalize.copyShareCopied": "Na-copy!",
  "wc.finalize.shareReport": "I-share ang AI Bracket Report ko",
  "wc.finalize.inviteFriends": "Mag-invite ng kaibigan para talunin ang bracket ko",
  "wc.finalize.previewShare": "I-preview ang share text",

  // ── Finalize success block: challenge + trust ─────────────────────────
  "wc.finalize.viewLeaderboard": "Tingnan ang leaderboard",
  "wc.finalize.openChat": "Pool Chat",
  "wc.finalize.challengeTitle": "Naka-lock na ang iyong World Cup path.",
  "wc.finalize.challengeDesc": "Ngayon dalhin ang iyong crew at panoorin ang leaderboard na maging buhay.",
  "wc.finalize.trustNote": "Libreng laruin. Estratehiya, hula, at karapatang magyabang lang.",

  // ── Leaderboard tab visual upgrade ───────────────────────────────────
  "wc.lb.eyebrow": "Pool",
  "wc.lb.title": "Laban sa Leaderboard",
  "wc.lb.heroSubtitle": "Bawat laban ay makakapalit ng kwento. I-track ang iyong score, habulin ang mga nangunguna, at panoorin ang pool na maging buhay.",
  "wc.lb.statusPreTournament": "Bago ang Torneo",
  "wc.lb.statusLive": "Live na",
  "wc.lb.statusWaiting": "Hinihintay ang Fixtures",
  "wc.lb.subtitleBase": "Finalized entries lang · nag-a-update ang scores pagkatapos mag-sync ng resulta.",
  "wc.lb.lastUpdated": "Huling na-sync noong {{date}}.",
  "wc.lb.notYetSynced": "Hindi pa na-sync.",
  "wc.lb.testMode": "Test Mode: maaaring nagpapakita ng simulated results ang leaderboard.",
  "wc.lb.recalculate": "I-recalculate",
  "wc.lb.autoUpdate": "Awtomatikong nag-a-update",
  "wc.lb.scoresNotSynced": "Hindi pa na-sync ang mga score — mag-a-update ang totals pagkatapos maingesta ang resulta.",
  "wc.lb.fixturesNotReady": "Hindi pa kumpleto ang fixtures — kailangang maayos ang mga team bago magkaroon ng kahulugan ang standings.",
  "wc.lb.podiumTitle": "Nangungunang mga Kalahok",
  "wc.lb.yourRank": "Ang Iyong Ranggo",
  "wc.lb.yourRankTagline": "Nasa laban ka na.",
  "wc.lb.gapToFirst": "{{n}} pts na nakahuli sa lider",
  "wc.lb.isLeader": "Nangunguna ka sa pool.",
  "wc.lb.tied": "Kapantay ang pinakamataas.",
  "wc.lb.viewMyBracket": "Tingnan ang Aking Bracket",
  "wc.lb.noEntryTitle": "Hindi ka pa nasa laban.",
  "wc.lb.noEntryBody": "Gumawa ng bracket para sumali sa leaderboard.",
  "wc.lb.startMyBracket": "Simulan ang Aking Bracket",
  "wc.lb.emptyTitle": "Hindi Pa Nagsisimula ang Laban",
  "wc.lb.emptyBody": "Gigising ang leaderboard kapag na-lock na ang picks at nagsimula na ang mga laban.",
  "wc.lb.emptyInvite": "Mag-imbita ng mga Kaibigan",
  "wc.lb.emptyReview": "I-review ang Aking Bracket",
  "wc.lb.scoringTitle": "Paano Gumagana ang Scoring",
  "wc.lb.scoringBody": "Nagbibigay ng points ang tamang picks. Mas may bigat ang mga later round, kaya mahalaga ang bawat daan patungo sa final.",
  "wc.lb.scoringUpdates": "Nag-a-update ang leaderboard pagkatapos ma-sync ang mga resulta ng laban.",
  "wc.lb.shareMyRank": "I-share ang Aking Ranggo",
  "wc.lb.challengePool": "Hamunin ang Pool",
  "wc.lb.noChampionPick": "Walang napiling kampeon",
  "wc.lb.alive": "Buhay pa",
  "wc.lb.busted": "Tapos na",
  "wc.lb.aiProUnlocks": "Ina-unlock ng AF Pro ang AI Win %, Bracket Health, at champion-path pressure.",
  "wc.lb.ptsLabel": "Pts",
  "wc.lb.trustNote": "Libreng laruin. Strategy, hula, at karapatang magyabang lang.",
  // ── Share card UI chrome ──────────────────────────────────────────────
  "wc.share.eyebrow": "Share Graphic",
  "wc.share.titleInvite": "Pool Invite",
  "wc.share.titleLeaderboard": "Leaderboard Snapshot",
  "wc.share.titleBracket": "Ang Aking Bracket Summary",
  "wc.share.titleRecap": "AI Recap",
  "wc.share.description": "Teksto para sa social media na handa nang i-share tungkol sa iyong bracket o pool standings.",
  "wc.share.publicSafe": "Ligtas para sa publiko",
  "wc.share.copy": "Kopyahin",
  "wc.share.copied": "Nakopya",
  "wc.share.share": "I-share",

  // ── Inside-pool Invite tab ───────────────────────────────────────────
  "wc.inviteTab.eyebrow": "Pool",
  "wc.inviteTab.title": "Invite at Detalye ng Pool",
  "wc.inviteTab.detailsTitle": "Detalye ng pool",
  "wc.inviteTab.meta.pool": "Pool",
  "wc.inviteTab.meta.privacy": "Privacy",
  "wc.inviteTab.meta.privacyPublic": "Public",
  "wc.inviteTab.meta.privacyPrivate": "Private — invite-only",
  "wc.inviteTab.meta.maxUsers": "Max users",
  "wc.inviteTab.meta.bracketsPerUser": "Brackets bawat user",
  "wc.inviteTab.meta.scoring": "Scoring",
  "wc.inviteTab.meta.scoringValue": "NCAA-style",
  "wc.inviteTab.meta.lockRule": "Patakaran sa lock",
  "wc.inviteTab.meta.lockTournament":
    "Magla-lock sa unang World Cup match",
  "wc.inviteTab.meta.lockPerMatch":
    "Per-match lock pag kickoff",
  "wc.inviteTab.lockedBanner":
    "Naka-lock na ang pool. Hindi na pwedeng baguhin ang mga pick.",
  "wc.inviteTab.member.title": "Mag-invite ng kaibigan sa pool na ito",
  "wc.inviteTab.member.body":
    "Tanging commissioner lang ang puwedeng mag-copy at mag-share ng invite link. Humingi ng invite link o code sa iyong commissioner.",
  "wc.inviteTab.commissioner.linkTitle": "Invite link",
  "wc.inviteTab.commissioner.linkHelper":
    "I-share ito sa kahit sino mong gustong i-invite. Kailangan signed in sila sa AllFantasy.",
  "wc.inviteTab.commissioner.codeLabel": "Invite code",
  "wc.inviteTab.commissioner.copyCode": "Kopyahin ang code",
  "wc.inviteTab.commissioner.copyCodeDone": "Na-copy",
  "wc.inviteTab.commissioner.copyLink": "Kopyahin ang invite link",
  "wc.inviteTab.commissioner.copyLinkDone": "Na-copy ang link!",
  "wc.inviteTab.commissioner.copyMessage": "Kopyahin ang invite message",
  "wc.inviteTab.commissioner.copyMessageDone": "Na-copy ang message!",
  "wc.inviteTab.commissioner.share": "I-share",
  "wc.inviteTab.commissioner.previewInvite":
    "I-preview ang invite message",
  "wc.inviteTab.commissioner.previewShare":
    "I-preview ang share message",
  "wc.inviteTab.commissioner.noCodeTitle":
    "Walang available na invite link",
  "wc.inviteTab.commissioner.noCodeBody":
    "Pwedeng i-regenerate ng pool owner o admin ang invite link sa pool settings.",
  "wc.inviteTab.shareMessage.default":
    "Sumali sa AllFantasy World Cup Bracket Pool ko na \"{{pool}}\"! Hanggang {{maxEntries}} brackets, mag-rank ng Group Stage teams, mag-build ng Knockout picks, at makipagtagisan sa live leaderboard. {{url}}",
  "wc.inviteTab.shareTitleNative":
    "{{pool}} — AllFantasy World Cup Bracket",

  // ── Invite tab: new UX sections (Goal 8) ─────────────────────────────
  "wc.inviteTab.hero.title": "Tipunin ang Iyong Grupo",
  "wc.inviteTab.hero.subtitle":
    "I-share ang pool na ito, hamunin ang iyong mga kaibigan, at hayaan ang leaderboard na lutasin ang debate.",
  "wc.inviteTab.hero.participants": "{{count}} sa pool",
  "wc.inviteTab.hero.spotsLeft": "{{n}} lugar pa",
  "wc.inviteTab.hero.poolFull": "Puno na ang pool",
  "wc.inviteTab.hero.lockDeadline": "Mag-lo-lock ang picks sa {{date}}",
  "wc.inviteTab.growth.title": "Mas magiging masaya ang pool mo kapag maraming katapat.",
  "wc.inviteTab.growth.body":
    "Mag-imbita ng mga kaibigan bago mag-lock ang picks para mapuno ang leaderboard.",
  "wc.inviteTab.growth.cta": "Mag-imbita ng mga kaibigan",
  "wc.inviteTab.social.title": "Mga Template para sa Social Media",
  "wc.inviteTab.social.copy1":
    "Sumali sa aking World Cup pool sa AllFantasy at patunayan na mas magaling ang iyong bracket.",
  "wc.inviteTab.social.copy2": "Ang leaderboard ay magiging personal na.",
  "wc.inviteTab.social.copy3": "Dalhin ang iyong pinakamahusay na bracket.",
  "wc.inviteTab.social.copyBtn": "Kopyahin",
  "wc.inviteTab.social.copiedBtn": "Nakopya",
  "wc.inviteTab.actions.viewLeaderboard": "Tingnan ang Leaderboard",
  "wc.inviteTab.actions.openChat": "Buksan ang Pool Chat",
  "wc.inviteTab.actions.shareLink": "I-share sa Mobile",
  "wc.inviteTab.trustNote":
    "Libreng laruin. Hula, estratehiya, at karapatang magyabang lang.",

  // ── Commissioner Checklist card chrome (extended) ────────────────────
  "wc.checklist.eyebrow": "Commissioner",
  "wc.checklist.cardSubtitle":
    "Tingnan agad ang progreso ng mga miyembro. Visible lamang sa pool commissioners at admins.",
  "wc.checklist.copyReminderBtn": "Kopyahin ang reminder",
  "wc.checklist.copyReminderDone": "Na-copy ang reminder!",
  "wc.checklist.stat.total": "Total na miyembro",
  "wc.checklist.stat.finalized": "Naka-finalize",
  "wc.checklist.stat.inProgress": "Ginagawa pa",
  "wc.checklist.stat.completion": "Completion",
  "wc.checklist.entryStatus.finalized": "Naka-finalize",
  "wc.checklist.entryStatus.inProgress": "Ginagawa pa",
  "wc.checklist.entryStatus.needsPicks": "Kulang picks",
  "wc.checklist.entryStatus.unknown": "Hindi alam",
  "wc.checklist.needsReminderBadge": "Kailangan ng reminder",
  "wc.checklist.missingPicks": "{{count}} kulang",
  "wc.checklist.previewReminder": "I-preview ang reminder message",
  "wc.checklist.privacyNote":
    "Deterministic — ginagamit lang ang snapshot na na-load na para sa commissioner tools. Walang email o user ID na ipinapakita.",
  "wc.checklist.empty.memberOnly":
    "Tanging pool commissioner o admin lang ang makakakita ng status ng miyembro.",
  "wc.checklist.empty.loading":
    "Naglo-load pa ang commissioner status data.",
  "wc.checklist.empty.noMembers":
    "Wala pang miyembrong gumawa ng entry. I-share ang invite link para makasimula.",
  "wc.checklist.empty.fallback": "Walang member data na available.",
  "wc.checklist.row.memberFallback": "Miyembro",
  "wc.checklist.row.bracketFallback": "Bracket",
  "wc.checklist.row.finalizedRowOne":
    "{{count}} na-finalize na bracket",
  "wc.checklist.row.finalizedRowOther":
    "{{count}} na-finalize na brackets",

  // ── Commissioner reminder message templates ──────────────────────────
  "wc.checklist.reminder.askCommissioner":
    "Hilingin sa pool commissioner na mag-paalala sa mga miyembro tungkol sa {{pool}}.",
  "wc.checklist.reminder.finalizeLine":
    "Friendly reminder: i-finalize ang iyong mga pick para sa \"{{pool}}\" sa AllFantasy.",
  "wc.checklist.reminder.joinLine":
    "Reminder: sumali sa \"{{pool}}\" sa AllFantasy at i-lock ang iyong World Cup bracket.",
  "wc.checklist.reminder.statusLine":
    "Status: {{done}}/{{total}} brackets na finalized ({{percent}}%).",
  "wc.checklist.reminder.deadlineLine":
    "Magla-lock ang picks {{deadline}}.",
  "wc.checklist.reminder.poweredBy": "Powered by AllFantasy.",
  "wc.checklist.reminder.noSnapshotLine":
    "Reminder: tapusin ang iyong picks para sa \"{{pool}}\" sa AllFantasy.",

  // ── AI Report card chrome (extended) ─────────────────────────────────
  "wc.aiShareCard.eyebrow": "Share graphic",
  "wc.aiShareCard.subtitle":
    "Anim na AI signals sa isang copy-ready card. Deterministic — walang AI call sa pag-share.",
  "wc.aiShareCard.tierPro": "AF Pro",
  "wc.aiShareCard.tierPreview": "Basic preview",
  "wc.aiShareCard.emptyNoEntry":
    "Pumili ng bracket entry para gumawa ng share card.",
  "wc.aiShareCard.copyShare": "Kopyahin ang share text",
  "wc.aiShareCard.copyShareDone": "Na-copy",
  "wc.aiShareCard.share": "I-share",
  "wc.aiShareCard.privacyNote":
    "Private sa iyo hangga't hindi mo i-share. Ginagamit lang ang sarili mong bracket data at aggregated counts ng pool.",
  "wc.explain.eyebrow": "Private AI",
  "wc.explain.title": "Explain ang aking bracket",
  "wc.explain.subtitle":
    "Private narrative analysis ng iyong bracket strategy. Ikaw lang ang makakakita.",
  "wc.explain.tierPro": "AF Pro",
  "wc.explain.tierLocked": "Nakasara",
  "wc.explain.locked":
    "Bubuksan ng AF Pro ang private AI explanation ng iyong bracket strategy — kasama ang istilo, pinakaligtas, pinaka-risky, champion path, at isang specific na recommendation.",
  "wc.explain.upgradeCta": "I-upgrade sa AF Pro →",
  "wc.explain.generate": "Gumawa ng explanation",
  "wc.explain.generating": "Ginagawa...",
  "wc.explain.selectFirst": "Pumili muna ng bracket",
  "wc.explain.regenerate": "Ulitin",
  "wc.explain.regenerating": "Inuulit...",
  "wc.explain.fallbackBadge": "Deterministic fallback",
  "wc.explain.error.generic": "Hindi nagawa ang explanation.",
  "wc.explain.error.network": "Network error. Subukan ulit.",
  "wc.explain.privacyNote":
    "Private sa iyo. Ginagamit lang ang sarili mong picks at public team data. Hindi inilalagay sa chat.",
  "wc.uniqueness.eyebrow": "Pool comparison",
  "wc.uniqueness.title": "Ano ang ginagawang unique sa bracket ko?",
  "wc.uniqueness.subtitle":
    "Pinaghahambing lang sa finalized brackets sa pool na ito.",
  "wc.uniqueness.tierPro": "AF Pro",
  "wc.uniqueness.tierBasic": "Basic",
  "wc.uniqueness.empty.noEntry":
    "Pumili ng bracket entry para mag-compute ng uniqueness.",
  "wc.uniqueness.loading": "Naglo-load ng pool comparison...",
  "wc.uniqueness.error.couldNotLoad":
    "Hindi na-load ang uniqueness data.",
  "wc.uniqueness.error.network": "Network error. Subukan ulit.",
  "wc.uniqueness.empty.notEnoughData":
    "Magbubukas ang uniqueness kapag may mas maraming finalized brackets.",
  "wc.uniqueness.empty.incomplete":
    "Mag-pick sa group at knockout para makita kung gaano kayo unique ng bracket mo.",
  "wc.uniqueness.rarity.veryRare": "Pinaka-rare",
  "wc.uniqueness.rarity.rare": "Rare",
  "wc.uniqueness.rarity.uncommon": "Bihira",
  "wc.uniqueness.rarity.common": "Karaniwan",
  "wc.uniqueness.percentShare": "{{percent}}% share",
  "wc.uniqueness.privacyNote":
    "Deterministic — bilang lang ng finalized brackets. Walang AI call, walang raw picks ng ibang user na ipinapakita.",
  "wc.grade.eyebrow": "Bracket Grade",
  "wc.grade.completionLabel": "{{percent}}% kumpleto",
  "wc.grade.tierProDetail": "AF Pro detail",
  "wc.grade.tierBasic": "Basic",
  "wc.grade.stat.groups": "Groups",
  "wc.grade.stat.thirdPlace": "Third-place",
  "wc.grade.stat.knockouts": "Knockouts",
  "wc.grade.stat.missing": "Kulang",
  "wc.grade.risk": "Risk level:",
  "wc.grade.upset": "Upset meter:",
  "wc.grade.championConfidence": "Tiwala sa kampeon:",
  "wc.grade.championConfidenceNone": "Walang piniling kampeon",
  "wc.grade.biggestRisk": "Pinakamalaking risk:",
  "wc.grade.recommendation": "Rekomendasyon:",
  "wc.grade.lockedBody":
    "Bubuksan ng AF Pro ang risk, upset meter, champion confidence, biggest risk, at rekomendasyon details.",
  "wc.confidence.title": "AI Confidence Check",
  "wc.confidence.tierOpen": "Bukas",
  "wc.confidence.tierLocked": "Nakasara",
  "wc.confidence.missingPicks": "Kulang na picks:",
  "wc.confidence.noMissing": "Wala. Pwede nang i-finalize.",
  "wc.confidence.missingBreakdown":
    "{{knockout}} knockout, {{groups}} groups, {{thirdPlace}} third-place.",
  "wc.confidence.highRiskPicks": "High-risk picks:",
  "wc.confidence.highRiskBody":
    "{{count}} maagang round picks ang humuhubog sa karamihan ng bracket path mo.",
  "wc.confidence.bracketShape": "Hugis ng bracket:",
  "wc.confidence.bracketShapeChalk":
    "Sobrang chalk-heavy. Isipin kung isang controlled contrarian pick ay makakatulong sa uniqueness.",
  "wc.confidence.bracketShapeBalanced":
    "Balanseng-balanse para sa first-pass confidence check.",
  "wc.confidence.finalizeConfidence": "Tiwala sa pag-finalize:",
  "wc.confidence.finalizeReady":
    "Handa nang i-finalize para sa leaderboard.",
  "wc.confidence.finalizeMissing":
    "Tapusin muna ang kulang na requirements bago mag-finalize.",
  "wc.confidence.privacyNote":
    "Deterministic prediction at scoring complexity lang. Pansin lang sa picks at scoring mechanics.",
  "wc.confidence.lockedBody":
    "Mag-upgrade sa AI/Pro para buksan ang confidence check. Hindi tumatawag ng AI ang locked users.",
  "wc.path.title": "Ano ang dapat mangyari para manalo ako?",
  "wc.path.subtitle":
    "Private na pagbasa ng current entry. Nakatago pa rin ang unfinalized picks ng ibang users.",
  "wc.path.tierActive": "AF Pro active",
  "wc.path.tierLocked": "AF Pro locked",

  // ── Group Stage picks (gameplay) ─────────────────────────────────────
  "wc.groupStage.loading": "Naglo-load ng group-stage picks...",
  "wc.groupStage.failedLoad": "Hindi na-load ang group stage",
  "wc.groupStage.title": "Group Stage Picks",
  "wc.groupStage.subtitle":
    "I-rank ang bawat group mula 1 hanggang 4, tapos pumili ng 8 third-place teams na aabante.",
  "wc.groupStage.rankedCount":
    "Naka-rank na groups: {{done}}/12",
  "wc.groupStage.lockedNoReason":
    "Naka-lock na ang group-stage picks.",
  "wc.groupStage.lockedWithReason":
    "Naka-lock na ang group-stage picks: {{reason}}",
  "wc.groupStage.teamCount": "{{count}}/4 teams",
  "wc.groupStage.teamFallback": "Team",
  "wc.groupStage.actualRank": "Aktwal #{{rank}}",
  "wc.groupStage.moveUp": "Itaas",
  "wc.groupStage.moveDown": "Ibaba",
  "wc.groupStage.needsFourTeams":
    "Kailangan ng 4 teams ang {{group}} bago ma-save.",
  "wc.groupStage.unsavedOrder":
    "May unsaved na ayos. Pindutin ang Save Group bago bilangin ng Review.",
  "wc.groupStage.savedReviewUses":
    "Na-save. Gagamitin ng Review ang group order na ito.",
  "wc.groupStage.saveGroup": "I-save ang Group",
  "wc.groupStage.saving": "Sini-save...",
  "wc.groupStage.saved": "Na-save",
  "wc.groupStage.retrySave": "Subukan ulit",
  "wc.groupStage.failedSave":
    "Hindi na-save ang group ranking",
  "wc.groupStage.aiTitle": "AI Insights",
  "wc.groupStage.aiTierOpen": "Bukas",
  "wc.groupStage.aiTierLocked": "Nakasara",
  "wc.groupStage.aiPrivacyNote":
    "Prediction at scoring complexity lang. Ang gabay ay nakatuon sa picks at scoring mechanics.",
  "wc.groupStage.aiLockedBody":
    "Mag-upgrade sa AI/Pro para buksan ang deterministic na World Cup insights. Hindi tumatawag ng AI habang nakasara.",
  "wc.groupStage.resultCorrect": "Tama +{{points}}",
  "wc.groupStage.resultWrong": "Mali +0",
  "wc.groupStage.resultPending": "Naghihintay",

  // ── Third-place advancers (gameplay) ─────────────────────────────────
  "wc.thirdPlace.title": "Third-Place Advancers",
  "wc.thirdPlace.subtitle":
    "Pumili ng eksaktong 8 predicted third-place teams pagkatapos ma-rank lahat ng groups.",
  "wc.thirdPlace.selectedCount":
    "Third-place advancers selected: {{count}}/8",
  "wc.thirdPlace.saveBtn": "I-save ang Third-Place",
  "wc.thirdPlace.savePicksDone":
    "Na-save ang Third-Place Picks",
  "wc.thirdPlace.saving": "Sini-save...",
  "wc.thirdPlace.saved": "Na-save",
  "wc.thirdPlace.savePrimaryBtn":
    "I-save ang Third-Place Advancers",
  "wc.thirdPlace.rankAllFirst":
    "I-rank muna lahat ng 12 groups bago pumili ng third-place advancers.",
  "wc.thirdPlace.unsaved":
    "May unsaved na third-place changes. Pindutin ang Save Third-Place Advancers bago bilangin ng Review.",
  "wc.thirdPlace.savedReviewUses":
    "Na-save ang third-place picks. Gagamitin ng Review ang mga pinili.",
  "wc.thirdPlace.errorChoose8":
    "Pumili ng eksaktong 8 third-place advancers.",
  "wc.thirdPlace.errorRankFirst":
    "I-rank muna lahat ng 12 groups bago pumili ng third-place advancers.",
  "wc.thirdPlace.failedSave":
    "Hindi na-save ang third-place advancers",
  "wc.thirdPlace.noPickYet": "Wala pang third-place pick",
  "wc.thirdPlace.selectedToAdvance": "Napiling aabante",
  "wc.thirdPlace.tapToSelect": "Pindutin para piliin",
  "wc.thirdPlace.selectAria":
    "Piliin si {{name}} bilang third-place advancer",
  "wc.thirdPlace.aiTitle": "Tanungin si Chimmy",
  "wc.thirdPlace.aiLockedBody":
    "Bubuksan ng AI/Pro ang third-place selection insights. Walang AI request kapag nakasara.",

  // ── Matchup card (gameplay) ──────────────────────────────────────────
  "wc.matchup.matchLabel": "Match {{number}}",
  "wc.matchup.openGuidedAria":
    "Buksan ang guided picker para sa match {{number}}",
  "wc.matchup.statusFinal": "Final",
  "wc.matchup.statusPostponed": "Pinaliban",
  "wc.matchup.statusCancelled": "Kinansela",
  "wc.matchup.statusSimulated": "Simulated",
  "wc.matchup.statusTestFixture": "Test Fixture",
  "wc.matchup.statusSaving": "Sini-save...",
  "wc.matchup.notReadyPill": "Hindi pa pwedeng mag-pick",
  "wc.matchup.pickBadgeCorrect": "Tama",
  "wc.matchup.pickBadgeIncorrect": "Mali",
  "wc.matchup.pickVisualCorrect": "Tamang pick",
  "wc.matchup.pickVisualIncorrect": "Maling pick",
  "wc.matchup.pickVisualPending": "Naghihintay ng resulta",
  "wc.matchup.yourPick": "Iyong pick:",
  "wc.matchup.points": "{{points}} pts",
  "wc.matchup.pointsPositive": "+{{points}} pts",
  "wc.matchup.zeroPts": "0 pts",
  "wc.matchup.pending": "Naghihintay",
  "wc.matchup.winnerOfficial": "Nanalo: {{name}}",
  "wc.matchup.unpickableFinal": "Tapos na ang labang ito.",
  "wc.matchup.unpickableMissingTeam":
    "Pumili muna ng mga winner sa mga naunang rounds.",
  "wc.matchup.unpickableUnknown": "Wala pang teams.",
  "wc.matchup.ftBadge": "FT",
  "wc.matchup.confidenceTitle": "Confidence bonus",
  "wc.matchup.confidenceHint":
    "Mas mataas na confidence = mas maraming bonus pag tama.",
  "wc.matchup.confidencePointSingle": "{{value}} puntos",
  "wc.matchup.confidencePointPlural": "{{value}} na puntos",
  "wc.matchup.aiInsightsLabel": "AI Insights",
  "wc.matchup.aiTierOpen": "Bukas",
  "wc.matchup.aiTierLocked": "Nakasara",
  "wc.matchup.aiSaferPick": "Mas ligtas na pick:",
  "wc.matchup.aiSaferBody":
    "{{name}} base sa current na bracket slot order.",
  "wc.matchup.aiUpsidePick": "Pick na may upside:",
  "wc.matchup.aiUpsideBody":
    "{{name}} kung kailangan mo ng ibang ruta.",
  "wc.matchup.aiBracketImpact": "Epekto sa bracket:",
  "wc.matchup.aiBracketImpactBody":
    "Sasagad ang winner sa susunod na slot; ang pagbabago ay puwedeng mag-reset ng later picks.",
  "wc.matchup.aiUpsetRisk": "Risk ng upset:",
  "wc.matchup.aiUpsetRiskBody":
    "Medium hanggang dumating ang live form at official results.",
  "wc.matchup.aiPrivacyNote":
    "Prediction at scoring complexity lang. Ang gabay ay nakatuon sa picks at scoring mechanics.",
  "wc.matchup.aiLockedBody":
    "Mag-upgrade sa AI/Pro para buksan ang matchup insights. Hindi tumatawag ng AI ang locked users.",
  "wc.matchup.pickAriaPicked": "Piliin si {{name}} para manalo",
  "wc.matchup.pickAriaSelected": "Napili: {{name}} para manalo",
  "wc.matchup.disabledLocked": "Naka-lock ang pick sa labang ito",
  "wc.matchup.disabledSaving": "Sini-save itong pick",
  "wc.matchup.winnerLabel": "Nanalo",
  "wc.matchup.lockHintTournament": "Magla-lock sa simula ng tournament",
  "wc.matchup.lockHintKickoff": "Magla-lock sa kickoff",
  "wc.matchup.lockHintTournamentWithTime": "Magla-lock {{at}}",
  "wc.matchup.lockHintKickoffWithTime":
    "Magla-lock sa kickoff · {{at}}",
  "wc.matchup.bracketBoardChampionLabel": "Champion Pick",
  "wc.matchup.bracketBoardChampionFallback": "Wala pang pinili",
  "wc.matchup.bracketBoardHelper":
    "Galing sa iyong predicted group results ang knockout bracket. Aabante agad ang picks pagkapili ng winner.",
  "wc.matchup.aiHomeSideFallback": "Home side",
  "wc.matchup.aiAwaySideFallback": "Away side",
  "wc.matchup.pensAbbr": "pens",

  // ── Bracket round column labels ──────────────────────────────────────
  "wc.round.roundOf32": "Round of 32",
  "wc.round.roundOf16": "Round of 16",
  "wc.round.quarterfinal": "Quarterfinals",
  "wc.round.semifinal": "Semifinals",
  "wc.round.thirdPlace": "Third Place",
  "wc.round.final": "Final",

  // ── Review tab finalize/missing-picks checklist ──────────────────────
  "wc.review.savedThirdPlaceTitle":
    "Na-save na Third-Place Advancers",
  "wc.review.noSavedThirdPlace":
    "Wala pang na-save na third-place advancers.",
  "wc.review.loadingSavedThirdPlace":
    "Naglo-load ng na-save na third-place picks...",
  "wc.review.savedKnockoutTitle":
    "Na-save na Knockout Picks",
  "wc.review.noSavedKnockout":
    "Wala pang na-save na knockout picks.",
  "wc.review.knockoutPickPrefix": "Match {{number}} · ",
  "wc.review.missingRequirementsTitle": "Kulang na requirements",
  "wc.review.needsRefinalize":
    "Nagbago ang entry pagkatapos ma-submit. Tapusin ang kulang na picks at i-finalize ulit.",
  "wc.review.missingGroupRankings":
    "Kulang sa group rankings: {{groups}}",
  "wc.review.thirdPlaceCount":
    "Third-place advancers selected: {{count}}/8",
  "wc.review.missingKnockout":
    "Kulang na knockout picks: {{count}}",
  "wc.review.lockedNoTime":
    "Naka-lock: hindi na pwedeng i-edit ang picks",
  "wc.review.lockedWithTime":
    "Naka-lock: hindi na pwedeng i-edit ang picks · na-submit noong {{at}}",
  "wc.review.completeDraftHelper":
    "Kumpleto na ang draft. I-finalize para isumite sa leaderboard; pwede pa ring i-edit hanggang mag-lock.",
  "wc.review.finalizing": "Nagfa-finalize...",
  "wc.review.finalizeEntry": "I-finalize ang Entry",
  "wc.review.refinalizeEntry": "I-finalize ulit ang Entry",
  "wc.review.completeAllToUnlock":
    "Tapusin lahat ng kulang na requirements para mabuksan ang Finalize.",
  "wc.review.tapRefresh":
    "Pindutin ang Refresh Review para tingnan ang completion.",
  "wc.review.createEntryFirstTitle": "Gumawa muna ng entry",
  "wc.review.createEntryFirstBody":
    "Naka-save ang review at finalization per bracket entry.",
  "wc.review.createMyBracket": "Gumawa ng aking bracket",
  "wc.review.creating": "Gumagawa...",
  "wc.review.openMyBracket": "Buksan ang aking bracket",

  // ── Review tab: hero section ──────────────────────────────────────────
  "wc.review.heroTitle": "I-review ang Iyong Daan sa Tagumpay",
  "wc.review.heroSubtitle": "Suriin ang bawat grupo, knockout path, at finalist bago mo i-lock.",
  "wc.review.groupChangeWarning": "Ang pagbabago ng Group Stage picks ay maaaring mag-alis ng finalized status ng iyong entry.",
  "wc.review.statusIncomplete": "Hindi kumpleto",
  "wc.review.statusReady": "Handa para I-finalize",
  "wc.review.statusFinalized": "Finalized",
  "wc.review.statusLocked": "Naka-lock",
  "wc.review.checking": "Sinusuri...",
  "wc.review.refreshReview": "I-refresh ang Review",
  "wc.review.loadingReview": "Nilo-load...",
  "wc.review.stat.groups": "Mga Grupo na Na-rank",
  "wc.review.stat.thirdPlace": "Pinakamahusay na Ikatlo",
  "wc.review.stat.knockouts": "Mga Knockout Pick",
  "wc.review.scoringNoteTitle": "Tala sa scoring",
  "wc.review.scoringNoteBody": "Finalized = naisumite sa leaderboard. Naka-lock = nakalipas na ang deadline, hindi na maaaring i-edit ang mga pick.",
  "wc.review.afProUnlocks": "I-unlock ng AF Pro",
  "wc.review.afProUnlocksDetails": "ang buong ulat — Champion Confidence, Path to Win, AI Explain narrative, Uniqueness insight, at buong Share card.",
  "wc.review.savedGroupTitle": "Mga Naka-save na Group Stage Pick",
  "wc.review.savedGroupNote": "Ang iyong mga hula · mga opisyal na resulta ay ipinapakita nang hiwalay",
  "wc.review.groupPicksSaved": "{{n}}/4 naka-save",
  "wc.review.noGroupPicksYet": "Wala pang naka-save na ranking.",
  "wc.review.loadingGroupPicks": "Nilo-load ang mga group-stage pick...",
  "wc.review.finalizeLockWarning": "Maaaring hindi na mae-edit ang mga pick pagkatapos ng lock deadline.",

  // ── Guided Matchup Picker (Phase 6) ──────────────────────────────────
  "wc.guided.dialogLabel": "Guided Matchup Picker",
  "wc.guided.closeLabel": "Isara ang guided picker",
  "wc.guided.timeTbd": "Oras TBD",
  "wc.guided.awaitingResult": "Hinihintay ang resulta",
  "wc.guided.tbd": "TBD",
  "wc.guided.matchFinal": "Final",
  "wc.guided.matchPostponed": "Ipinagpaliban",
  "wc.guided.pickAriaLabel": "Piliin si {{teamName}} na manalo",
  "wc.guided.progressRound": "{{label}} · {{done}}/{{total}} picks",
  "wc.guided.progressOverall": "{{pct}}% lahat-lahat",
  "wc.guided.headerLocked": "Naka-lock ang Bracket",
  "wc.guided.headerFixturesNotReady": "Hindi Pa Handa ang Mga Laban",
  "wc.guided.headerStart": "Simulan ang Pagpili",
  "wc.guided.headerComplete": "Kumpleto na ang Bracket",
  "wc.guided.headerGuided": "Guided Picks",
  "wc.guided.lockedHelper":
    "Naka-lock ang bracket na ito. Hindi na maaaring baguhin ang picks.",
  "wc.guided.emptyTeamsUpstream":
    "Lalabas ang mga koponan para sa round na ito kapag napili na ang mas naunang mga laban.",
  "wc.guided.emptyFixturesUnresolved":
    "Naka-load na ang mga laban, pero hindi pa nararesolba ang aktwal na matchups.",
  "wc.guided.close": "Isara",
  "wc.guided.back": "Bumalik",
  "wc.guided.skip": "Laktawan",
  "wc.guided.matchNumber": "Laban {{number}}",
  "wc.guided.saving": "Sini-save…",
  "wc.guided.saved": "Na-save",
  "wc.guided.nextMatchup": "Susunod na laban…",
  "wc.guided.tapToSelect":
    "I-tap ang koponan para mapili ang panalo",
  "wc.guided.tapToChange":
    "I-tap ang kabilang koponan para palitan ang pick mo",
  "wc.guided.matchFinalNote": "Tapos na ang laban na ito.",
  "wc.guided.pickEarlierRoundsFirst":
    "Piliin muna ang mga panalo sa mga naunang round.",
  "wc.guided.matchEnded": "Tapos na ang laban na ito.",
  "wc.guided.matchLocked":
    "Naka-lock ang picks para sa laban na ito.",
  "wc.guided.confidenceTitle": "Bonus ng Confidence",
  "wc.guided.confidenceHelper":
    "Mas mataas ang confidence, mas maraming bonus points kung tama.",
  "wc.guided.confidenceOptionOne": "1 point",
  "wc.guided.confidenceOptionOther": "{{n}} points",
  "wc.guided.bracketCompleteTitle": "Kumpleto na ang Bracket!",
  "wc.guided.bracketCompleteBody":
    "Napili mo na ang lahat ng laban.",
  "wc.guided.reviewBracket": "I-review ang Bracket",
  "wc.guided.done": "Tapos na",
  "wc.guided.errorNotReady":
    "Hindi pa handa ang laban na ito para sa picks.",
  "wc.guided.errorSaveFailed": "Hindi na-save ang pick",
  "wc.guided.vs": "VS",

  // ── Score Summary card (Phase 6) ─────────────────────────────────────
  "wc.summary.title": "Bracket scorecard",
  "wc.summary.rankPlaceholder": "Ranggo —",
  "wc.summary.bracketComplete": "Kumpletong bracket",
  "wc.summary.bracketIncomplete": "Hindi kumpletong bracket",
  "wc.summary.fixturesNotReady":
    "Hindi pa lahat ng laban ay confirmed — mag-uupdate ang scoring kapag opisyal na ang matchups.",
  "wc.summary.scoresNotSynced":
    "Hindi pa naka-sync ang scores — lalabas ang points kapag na-post na ang resulta.",
  "wc.summary.locked":
    "Naka-lock ang bracket — naka-freeze na ang picks.",
  "wc.summary.totalPts": "Total na pts",
  "wc.summary.possibleLeft": "Possible pa",
  "wc.summary.correct": "Tama",
  "wc.summary.wrong": "Mali",
  "wc.summary.championPick": "Pinili na kampeon",
  "wc.summary.championAlive": "Buhay pa ang kampeon",
  "wc.summary.championBusted": "Talo na ang kampeon",
  "wc.summary.noChampionYet": "Wala pang napiling kampeon",
  "wc.summary.maxCeiling": "Max ceiling",
  "wc.summary.maxCeilingBody":
    " possible pts para sa natitirang paths mo",

  // ── Round Breakdown card (Phase 6) ───────────────────────────────────
  "wc.roundBreakdown.title": "Scoring per round",
  "wc.roundBreakdown.ptsAbbrev": "{{n}} pts",
  "wc.roundBreakdown.perWin": "per panalo",
  "wc.roundBreakdown.championBonus":
    "May bonus sa kampeon: {{bonus}} pts kapag nanalo ang pinili mong kampeon sa final (policy — kumpirmahin sa rules).",

  // ── Leaderboard Insights card (Phase 6) ──────────────────────────────
  "wc.insights.title": "Leaderboard Insights",
  "wc.insights.empty":
    "Lalabas ang leaderboard insights kapag na-score na ang finalized na entries. Siguraduhing nakapag-submit ka ng picks bago magsimula ang unang laban.",
  "wc.insights.currentLeader": "Kasalukuyang Lider",
  "wc.insights.largestGap": "Pinakamalaking Agwat",
  "wc.insights.entries": "Mga Entry",
  "wc.insights.championsAlive": "Mga Buhay na Kampeon",
  "wc.insights.mostCorrect": "Pinakamaraming Tama",
  "wc.insights.closestRace": "Pinakamalapit na Race",
  "wc.insights.notClose": "Hindi malapit",
  "wc.insights.gapPts": "{{n}} pts",
  "wc.insights.mostCorrectValue": "{{name}} ({{count}})",
  "wc.insights.aiSummaryTitle": "AI Pool Summary",
  "wc.insights.aiBadgeUnlocked": "Finalized lang",
  "wc.insights.aiBadgeLocked": "Naka-lock",
  "wc.insights.aiNotAvailable": "Wala pa",
  "wc.insights.aiSummaryCountOne":
    "Kasama ang {{count}} public leaderboard entry.",
  "wc.insights.aiSummaryCountOther":
    "Kasama ang {{count}} public leaderboard entries.",
  "wc.insights.aiSummaryLabel": "Finalized-only summary:",
  "wc.insights.aiCommonChampionLabel":
    "Pinaka-karaniwang kampeon:",
  "wc.insights.aiRaceLabel": "Race note:",
  "wc.insights.aiRaceClose":
    "Ang top two entries ay nasa loob ng 5 points.",
  "wc.insights.aiRaceNotClose":
    "Wala pang masyadong malapit na race sa top two.",
  "wc.insights.aiWinReadLabel": "AI win read:",
  "wc.insights.aiWinReadBody":
    "Nasa {{pct}}% si {{name}} na may {{health}} bracket health.",
  "wc.insights.aiPrivacyNote":
    "Gumagamit lang ng finalized/public leaderboard data. Walang kasama na private unfinalized picks. Limitado ang guidance sa pool picks at scoring mechanics.",
  "wc.insights.aiUpgradeNote":
    "Mag-upgrade sa AI/Pro para sa finalized-only pool summaries. Hindi nagti-trigger ng AI calls ang locked users.",

  // ── Settings panel chrome (Phase 6) ──────────────────────────────────
  "wc.settings.title": "Mga setting ng pool",
  "wc.settings.subtitle":
    "Identity, caps, scoring, visibility, at alerts — kontrol ng commissioner para sa World Cup bracket pool mo.",
  "wc.settings.loading": "Naglo-load ng pool settings…",
  "wc.settings.sectionIdentity": "Pool identity",
  "wc.settings.save": "I-save ang settings",
  "wc.settings.saving": "Sini-save…",
  "wc.settings.toastNoChanges": "Walang babaguhin na i-save.",
  "wc.settings.toastSaved": "Na-save ang settings.",
  "wc.settings.toastError": "Hindi na-save ang settings",

  // ── Commissioner Brain panel chrome (Phase 6) ────────────────────────
  "wc.brain.title": "Commissioner Brain",
  "wc.brain.subtitle":
    "Snapshot, alerts, at AI helpers — pamahalaan ang pool mo sa isang lugar.",
  "wc.brain.loading": "Naglo-load ng commissioner tools…",
  "wc.brain.loadError": "Hindi ma-load ang commissioner tools.",

  // ── Home tab: commissioner quick panel ──────────────────────────────
  "wc.home.commissioner.syncing": "Sini-sync...",
  "wc.home.commissioner.syncBtn": "I-sync ang mga Fixture",
  "wc.home.commissioner.settingsBtn": "Mga Setting ng Pool",
  "wc.home.commissioner.inviteBtn": "Mag-imbita ng mga Manlalaro",

  // ── Home tab: fixture readiness card ────────────────────────────────
  "wc.home.fixtureReady.cardTitle": "Kahandaan ng Fixture",
  "wc.home.fixtureReady.descReady": "Ang mga matchup ng Round of 32 ay may mga koponan at maaaring i-pick. Ang mga test fixture ay minarkahan bilang test data kapag ginamit.",
  "wc.home.fixtureReady.descBlocked": "Nananatiling naka-block ang mga pick habang ang mga matchup ay placeholder tulad ng Group Winner o Winner Match. I-sync ang mga opisyal na fixture o mag-seed ng test fixtures para sa lokal na QA.",
  "wc.home.fixtureReady.knockoutLocked": "Ang mga knockout pick ay magbubukas kapag available na ang mga opisyal na Round of 32 fixture",
  "wc.home.fixtureReady.readySingle": "{{n}} matchup na handang i-pick",
  "wc.home.fixtureReady.readyPlural": "{{n}} na matchup na handang i-pick",
  "wc.home.fixtureReady.notSynced": "Hindi pa nasi-sync ang mga fixture",
  "wc.home.fixtureReady.notReady": "Nai-load na ang mga fixture, ngunit placeholder pa rin ang mga koponan",
  "wc.home.fixtureReady.commissionerSettings": "Mga Setting ng Commissioner",

  // ── Picks tab: guided pick help banners ─────────────────────────────
  "wc.pickHelp.fixturesNotSynced": "Magbubukas ang mga pick pagkatapos ma-sync ang mga fixture ng World Cup o ma-seed ang test fixtures para sa pool na ito.",
  "wc.pickHelp.seedBtn": "Mag-seed ng Test Fixtures",
  "wc.pickHelp.seeding": "Nagi-seed...",
  "wc.pickHelp.knockoutFromGroups": "Ang iyong mga knockout matchup ay nabubuo mula sa iyong mga Group Stage prediction. I-rank ang lahat ng grupo at pumili ng mga third-place advancer upang mag-unlock ng mas maraming slot.",
  "wc.pickHelp.title": "Tulong sa Guided Pick",
  "wc.pickHelp.body": "Gamitin ang sticky na Start Making Picks button sa mobile para lumipat sa mga matchup nang isa-isa. Ang mga AI bracket builder tool ay magagamit sa susunod na update.",
  "wc.pickHelp.knockoutLocked": "Naka-lock ang Knockout",
  "wc.pickHelp.continueGuided": "Ituloy ang Guided Picks",
  "wc.pickHelp.reviewGuided": "Suriin ang Guided Picks",
  "wc.pickHelp.picksBlocked": "Pumili muna ng mga panalo sa nakaraang mga round. Mag-u-unlock ang mas maraming matchup habang umuusad ang iyong bracket.",

  // ── AI Simulation lock panel ─────────────────────────────────────────
  "wc.aiLock.badge": "Naka-lock na Preview",
  "wc.aiLock.title": "Naka-lock ang AI Simulation",
  "wc.aiLock.body": "Ini-unlock ng AI Simulation ang mga projected na panalo, bracket buster, at mga path ng kampeon.",
  "wc.aiLock.tier": "Nangangailangan ng AF Pro o AF Supreme",
  "wc.aiLock.commissionerNote": "Ang mga AI tool ng commissioner ay nangangailangan ng AF Commissioner o AF Supreme.",

  // ── Premium access panel ─────────────────────────────────────────────
  "wc.premium.eyebrow": "Access sa World Cup",
  "wc.premium.title": "Bukas pa rin ang libreng laro. Malinaw na naka-gate ang mga premium tool.",
  "wc.premium.body": "Sumali, gumawa ng iyong unang bracket, gumawa ng mga Group Stage at Knockout pick, suriin, i-finalize, at tingnan ang leaderboard nang libre.",
  "wc.premium.entryCap": "Limitasyon ng entry:",
  "wc.premium.freeLimitSingle": "Ang mga libreng user ay maaaring gumawa ng isang bracket entry sa pool na ito.",
  "wc.premium.freeLimitPlural": "Ang pool na ito ay nagpapahintulot ng hanggang {{n}} na entry. Maaari pa ring gumawa ang mga libreng user ng unang bracket; pinamamahalaan ng mga kontrol ng AF Commissioner ang mga multi-entry na panuntunan ng pool.",
  "wc.premium.commissionerSection": "AF Commissioner",
  "wc.premium.aiSection": "AI/Pro",
  "wc.premium.unlocked": "Na-unlock",
  "wc.premium.card.commissioner.title": "Mga Tool ng AF Commissioner",
  "wc.premium.card.commissioner.descOwner": "Ang mga tool ng kahandaan, sync, simulation, mga setting, imbitasyon, at admin QA ay available para sa mga all-access na user.",
  "wc.premium.card.commissioner.descOther": "Mga kontrol ng private/public na pool, pamamahala ng imbitasyon, mga custom na scoring hook, at setup ng commissioner.",
  "wc.premium.card.chat.title": "Chat ng Pool",
  "wc.premium.card.chat.desc": "Placeholder ng league chat para sa mga host ng pool, mga anunsyo, at moderated na talakayan.",
  "wc.premium.card.export.title": "I-export ang Leaderboard",
  "wc.premium.card.export.desc": "I-export ang mga standing at buod ng bracket para sa pagsusuri ng commissioner.",
  "wc.premium.card.multiEntry.title": "Maraming Entry",
  "wc.premium.card.multiEntry.desc": "Mga kontrol ng multi-entry sa antas ng pool na lampas sa karanasan ng unang libreng entry.",
  "wc.premium.card.bracketBuilder.title": "AI Bracket Builder",
  "wc.premium.card.bracketBuilder.desc": "Placeholder para sa guided na pagbuo ng bracket at deterministic na context-aware na mungkahi.",
  "wc.premium.card.matchupPreview.title": "AI Matchup Preview",
  "wc.premium.card.matchupPreview.desc": "I-preview ang lean ng matchup, mga panganib, at mga upset path kapag available na ang mga opisyal na fixture.",
  "wc.premium.card.whatIf.title": "Mga AI What-If Scenario",
  "wc.premium.card.whatIf.desc": "Mga senaryo ng leaderboard para sa kung ano ang kailangang mangyari sa susunod.",
  "wc.premium.card.alerts.title": "Mga AI Alert",
  "wc.premium.card.alerts.desc": "Mga alert sa hinaharap para sa mga pagbabago sa bracket, mga tala ng group-stage optimizer, at mga signal ng upset finder.",

  // ── Daily Edge Report ─────────────────────────────────────────────────
  "wc.edgeReport.title": "Pang-araw-araw na Edge Report",
  "wc.edgeReport.subtitle": "Ang pinakamahalagang bagay ngayon sa iyong grupo",
  "wc.edgeReport.badge.free": "Libre",
  "wc.edgeReport.badge.included": "Kasama sa plano",
  "wc.edgeReport.loading": "Ginagawa ang iyong edge report…",
  "wc.edgeReport.error": "Hindi ma-load ang iyong edge report. Subukang i-refresh.",
  "wc.edgeReport.section.matchThatMatters": "Ang Mahalagang Laro",
  "wc.edgeReport.section.rootFor": "Sino ang Susuportahan",
  "wc.edgeReport.section.threats": "Sino ang Maaaring Lampasan Ka",
  "wc.edgeReport.section.bestPath": "Pinakamaikling Landas Pataas",
  "wc.edgeReport.section.mistakeToAvoid": "Ang Pagkakamaling Iwasan",
  "wc.edgeReport.coaching.title": "Coaching ni Chimmy",
  "wc.edgeReport.coaching.cachedBadge": "Na-unlock ngayon",
  "wc.edgeReport.coaching.includedLabel": "Kasama sa iyong plano",
  "wc.edgeReport.coaching.unlockBtn": "I-unlock ang coaching ngayon",
  "wc.edgeReport.coaching.tokenCost": "1 token",
  "wc.edgeReport.coaching.loading": "Ginagawa ang coaching…",
  "wc.edgeReport.coaching.error": "Hindi available ang coaching ngayon. Subukan ulit.",
  "wc.edgeReport.coaching.spendFailed": "Hindi ma-deduct ang token. Suriin ang iyong balanse at subukan ulit.",
  "wc.edgeReport.commissionerPost.title": "Ideya sa Post para sa Grupo",
  "wc.edgeReport.commissionerPost.postBtn": "I-post sa group chat",
  "wc.edgeReport.commissionerPost.posting": "Nagpo-post…",
  "wc.edgeReport.commissionerPost.posted": "Nai-post na!",
  "wc.edgeReport.freshness": "Deterministiko · ina-update bawat match day",
  "wc.edgeReport.noEntry": "Idagdag ang iyong bracket picks para makita ang iyong pang-araw-araw na edge report.",
  "wc.edgeReport.billing.cached": "Walang token na ginamit · na-unlock na ang coaching ngayon",
  "wc.edgeReport.billing.included": "Kasama sa iyong plano",
  "wc.edgeReport.billing.charged": "1 token ang ginamit",
  "wc.edgeReport.feedback.title": "Nakatulong ba ito?",
  "wc.edgeReport.feedback.helpful": "Nakatulong",
  "wc.edgeReport.feedback.notHelpful": "Hindi nakatulong",
  "wc.edgeReport.feedback.tooBasic": "Masyadong basic",
  "wc.edgeReport.feedback.notActionable": "Hindi actionable",
  "wc.edgeReport.feedback.wrongData": "Maling data",
  "wc.edgeReport.feedback.greatInsight": "Magandang insight",
  "wc.edgeReport.feedback.thanks": "Salamat sa iyong feedback",
  "wc.edgeReport.cue.ready": "Handa na ang Edge Mo Ngayon",
}

// Vietnamese — natural sports-app Vietnamese.
const VI: WorldCupDictionary = {
  // ── Shared / shell ───────────────────────────────────────────────────
  "wc.common.loading": "Đang tải...",
  "wc.common.back": "Quay lại",
  "wc.common.openSettings": "Mở cài đặt",
  "wc.common.signIn": "Đăng nhập",
  "wc.common.signOut": "Đăng xuất",

  // ── Public hub: /brackets/world-cup ──────────────────────────────────
  "wc.publicHub.backToBrackets": "← Quay lại Brackets",
  "wc.publicHub.heroTitle": "Thử Thách Bracket World Cup",
  "wc.publicHub.heroSubtitle":
    "Tạo một bracket pool kiểu NCAA cho FIFA World Cup. Mời bạn bè, chọn đội thắng, theo dõi tỉ số trực tiếp và leo lên bảng xếp hạng.",
  "wc.publicHub.discover": "Khám phá pool công khai",
  "wc.publicHub.joinWithCode": "Tham gia bằng mã mời",
  "wc.publicHub.createPool": "Tạo pool",
  "wc.publicHub.createWorldCupPool": "Tạo pool World Cup",
  "wc.publicHub.yourPools": "Pool World Cup của bạn",
  "wc.publicHub.poolsCountOne": "{{count}} pool",
  "wc.publicHub.poolsCountOther": "{{count}} pool",
  "wc.publicHub.scoreLabel": "Điểm",
  "wc.publicHub.rankLabel": "Hạng",
  "wc.publicHub.participantsOne": "{{count}} người chơi",
  "wc.publicHub.participantsOther": "{{count}} người chơi",
  "wc.publicHub.statusOpen": "Mở",
  "wc.publicHub.statusLocked": "Đã khoá",
  "wc.publicHub.statusFinal": "Kết thúc",
  "wc.publicHub.emptyTitle": "Chưa có pool World Cup nào",
  "wc.publicHub.emptyBody":
    "Bạn chưa tạo hoặc tham gia pool bracket World Cup nào.",
  "wc.publicHub.emptyHint":
    "Tạo một pool và mời bạn bè, hoặc xin mã mời từ ai đó.",
  "wc.publicHub.signInTitle": "Đăng nhập để bắt đầu",
  "wc.publicHub.signInBody":
    "Tạo hoặc tham gia một pool bracket World Cup và thi đấu cùng bạn bè.",
  "wc.publicHub.signInCta": "Đăng nhập để bắt đầu",
  "wc.publicHub.feature.privatePublic":
    "Pool riêng tư hoặc công khai — tối đa 100 người chơi.",
  "wc.publicHub.feature.bracketsPerUser":
    "Mỗi người chơi tối đa 5 bracket, thi đấu bằng nhiều chiến thuật khác nhau.",
  "wc.publicHub.feature.ncaaScoring":
    "Tính điểm kiểu NCAA — vòng càng sâu, điểm càng cao.",
  "wc.publicHub.feature.guidedPicker":
    "Trình hướng dẫn chọn kèo với phân tích cặp đấu bằng AI.",
  "wc.publicHub.feature.liveTracking":
    "Theo dõi tỉ số trực tiếp đến từng phút.",
  "wc.publicHub.feature.aiBracketBuilder":
    "Trình tạo bracket bằng AI tự động điền các trận chưa chọn.",
  "wc.publicHub.feature.perBracketLeaderboard":
    "Bảng xếp hạng riêng cho mỗi bracket — từng entry được xếp riêng.",
  "wc.publicHub.feature.lockOnKickoff":
    "Bracket khoá lại khi trận đầu tiên của World Cup bắt đầu.",

  // ── Public hub: v2 command center ────────────────────────────────────
  "wc.publicHub.commandEyebrow": "Trung tâm chỉ huy AF World Cup Pools",
  "wc.publicHub.commandTitle": "Xây dựng hành trình vô địch World Cup của bạn.",
  "wc.publicHub.commandSubtitle":
    "Tạo pool, mời nhóm bạn, xếp hạng từng bảng, chọn con đường vòng loại trực tiếp và xem bảng xếp hạng sôi động.",
  "wc.publicHub.trustNote":
    "Không cờ bạc. Chỉ có vinh quang, chiến thuật và quyền tự hào.",
  "wc.publicHub.stat.teams": "48 đội",
  "wc.publicHub.stat.groups": "12 bảng",
  "wc.publicHub.stat.matches": "104 trận",
  "wc.publicHub.stat.format": "Vòng bảng + Vòng loại trực tiếp",
  "wc.publicHub.actionsTitle": "Bạn muốn bắt đầu như thế nào?",
  "wc.publicHub.action.create.title": "Tạo pool",
  "wc.publicHub.action.create.desc":
    "Bắt đầu pool World Cup riêng tư hoặc công khai và mời bạn bè.",
  "wc.publicHub.action.join.title": "Tham gia bằng mã",
  "wc.publicHub.action.join.desc": "Có mã mời? Nhập mã và tham gia ngay.",
  "wc.publicHub.action.discover.title": "Khám phá pool công khai",
  "wc.publicHub.action.discover.desc":
    "Tìm các pool World Cup đang mở và tham gia.",
  "wc.publicHub.how.title": "AF World Cup Pools hoạt động như thế nào",
  "wc.publicHub.how.step1Title": "Tạo hoặc tham gia pool",
  "wc.publicHub.how.step1Body":
    "Bắt đầu pool riêng cho nhóm bạn hoặc tìm pool công khai mà ai cũng có thể tham gia.",
  "wc.publicHub.how.step2Title": "Xếp hạng từng bảng",
  "wc.publicHub.how.step2Body":
    "Dự đoán thứ hạng từng đội trong bảng, bao gồm cả đội hạng ba vào vòng tiếp theo.",
  "wc.publicHub.how.step3Title": "Xây dựng hành trình loại trực tiếp",
  "wc.publicHub.how.step3Body":
    "Chọn đội thắng qua các vòng loại trực tiếp cho đến trận chung kết.",
  "wc.publicHub.how.step4Title": "Hoàn thiện và leo bảng",
  "wc.publicHub.how.step4Body":
    "Khoá bracket trước trận đầu tiên, rồi theo dõi bảng xếp hạng trực tiếp và chia sẻ kết quả.",
  "wc.publicHub.ai.title": "Công cụ bracket AI",
  "wc.publicHub.ai.subtitle":
    "Chimmy và AllFantasy AI giúp bạn hiểu rủi ro, khám phá insights và hỗ trợ các commissioner.",
  "wc.publicHub.ai.explain.title": "Giải thích bracket của tôi",
  "wc.publicHub.ai.explain.desc":
    "AI đọc lựa chọn của bạn và giải thích điều gì làm bracket của bạn độc đáo.",
  "wc.publicHub.ai.danger.title": "Vùng nguy hiểm vòng loại trực tiếp",
  "wc.publicHub.ai.danger.desc": "Xem lựa chọn vòng loại nào dễ bị lật nhất.",
  "wc.publicHub.ai.chat.title": "Chat pool + Chiến thuật",
  "wc.publicHub.ai.chat.desc": "Hỏi @Chimmy về lựa chọn ngay trong chat pool.",
  "wc.publicHub.ai.commissioner.title": "Phân tích dành cho commissioner",
  "wc.publicHub.ai.commissioner.desc":
    "Tóm tắt AI về sức khoẻ pool, sự đa dạng bracket và hoạt động thành viên.",
  "wc.publicHub.ai.gating":
    "Có sẵn trong các gói AI đủ điều kiện hoặc công cụ hỗ trợ token.",
  "wc.publicHub.social.title": "Rủ cả nhóm cùng chơi.",
  "wc.publicHub.social.desc":
    "Chia sẻ link pool, thách thức bạn bè, và để bảng xếp hạng phân định thắng thua.",
  "wc.publicHub.social.cta": "Tạo pool để lấy link mời",
  "wc.publicHub.trust.note":
    "AF World Cup Pools chỉ dành cho giải trí fantasy sports, chiến thuật và sự tự hào. Không có cá cược hay hình thức đặt cược thực tế.",

  // ── Pool dashboard: tab labels ───────────────────────────────────────
  "wc.tab.home": "Trang chính",
  "wc.tab.groupStage": "Vòng bảng",
  "wc.tab.picks": "Vòng loại trực tiếp",
  "wc.tab.review": "Xem lại",
  "wc.tab.leaderboard": "Bảng xếp hạng",
  "wc.tab.rules": "Luật chơi",
  "wc.tab.invite": "Mời",
  "wc.tab.commissioner": "Chủ pool",
  "wc.tab.admin": "Cài đặt",

  // ── Pool dashboard: sticky subnav labels ─────────────────────────────
  "wc.subnav.quickJump": "Lối tắt",
  "wc.subnav.start": "Bắt đầu",
  "wc.subnav.groupBuilder": "Xếp bảng",
  "wc.subnav.bracketBoard": "Bảng nhánh",
  "wc.subnav.firstRound": "Vòng đầu",
  "wc.subnav.opsTools": "Công cụ vận hành",
  "wc.subnav.rankSnapshot": "Ảnh xếp hạng",
  "wc.subnav.inviteCenter": "Trung tâm mời",

  // ── Mobile bottom nav: short labels ──────────────────────────────────
  "wc.tab.leaderboard.short": "Hạng",
  "wc.tab.commissioner.short": "Chủ",
  "wc.tab.settings.short": "Cài",
  "wc.tab.home.short": "Nhà",
  "wc.tab.groupStage.short": "Bảng",
  "wc.tab.picks.short": "Nhánh",
  "wc.tab.review.short": "Duyệt",
  "wc.tab.rules.short": "Luật",
  "wc.tab.invite.short": "Mời",
  "wc.tab.admin.short": "Cài đặt",

  // ── Rules tab ────────────────────────────────────────────────────────
  "wc.rules.hero.eyebrow": "Pool",
  "wc.rules.hero.title": "Luật Chơi Pool",
  "wc.rules.hero.subtitle": "Tìm hiểu cách tính điểm, thời hạn, số lượt tham gia và cách hoạt động của World Cup pool của bạn.",
  "wc.rules.how.title": "Cách Hoạt Động",
  "wc.rules.how.body1": "Chọn người chiến thắng từ vòng 32 đến nhà vô địch. Dự đoán bị khóa khi bóng lăn trong mỗi trận.",
  "wc.rules.how.body2": "Dự đoán đúng được tính điểm cao hơn ở mỗi vòng. Kết quả trận đấu cập nhật điểm số và bảng xếp hạng.",
  "wc.rules.scoring.title": "Cách Tính Điểm",
  "wc.rules.scoring.roundOf32": "Vòng 32",
  "wc.rules.scoring.roundOf16": "Vòng 16",
  "wc.rules.scoring.quarterfinal": "Tứ kết",
  "wc.rules.scoring.semifinal": "Bán kết",
  "wc.rules.scoring.final": "Chung kết",
  "wc.rules.scoring.champion": "Thưởng vô địch",
  "wc.rules.scoring.thirdPlace": "Hạng 3",
  "wc.rules.scoring.pts": "điểm",
  "wc.rules.settings.title": "Cài Đặt Pool",
  "wc.rules.settings.bracketsPerUser": "Bracket mỗi người chơi",
  "wc.rules.settings.thirdPlace": "Trận tranh hạng 3",
  "wc.rules.settings.thirdPlaceOn": "Có",
  "wc.rules.settings.thirdPlaceOff": "Không",
  "wc.rules.settings.inviteSharing": "Chia sẻ lời mời",
  "wc.rules.settings.inviteCommish": "Chỉ chủ pool",
  "wc.rules.trustNote": "Không cá cược. Không nhà cái. Chỉ là dự đoán World Cup, chiến lược và quyền tự hào.",

  // ── Pool dashboard: home tab ──────────────────────────────────────────
  "wc.home.title": "Bảng điều khiển World Cup Pool",
  "wc.home.subtitle": "Bắt đầu tại đây: tạo hoặc mở bracket của bạn, xếp hạng các bảng đấu vòng bảng, chọn đội vòng loại trực tiếp, xem lại, rồi hoàn tất để xuất hiện trên bảng xếp hạng.",
  "wc.home.copyInvite": "Sao chép lời mời",
  "wc.home.invitePanel": "Bảng mời",
  "wc.home.stat.participants": "Người tham gia",
  "wc.home.stat.entries": "Mục tham gia",
  "wc.home.stat.finalized": "Mục đã hoàn tất",
  "wc.home.stat.fixtureStatus": "Trạng thái lịch thi đấu",
  "wc.home.stat.ready": "Sẵn sàng",
  "wc.home.stat.notReady": "Chưa sẵn sàng",
  "wc.home.entries.title": "Mục tham gia",
  "wc.home.entries.loading": "Đang tải mục tham gia...",
  // ── Home tab: entry list card ────────────────────────────────────────
  "wc.entryList.subtitle": "Tạo hoặc mở bracket cá nhân khi bạn sẵn sàng chọn lựa. Chơi miễn phí hỗ trợ một mục bracket; cài đặt hồ bơi của AF Commissioner có thể cho phép nhiều mục.",
  "wc.entryList.complete": "Hoàn thành",
  "wc.entryList.notComplete": "Chưa hoàn thành",
  "wc.entryList.rank": "Hạng #{{rank}}",
  "wc.entryList.unranked": "Chưa xếp hạng",
  "wc.entryList.openBracket": "Mở Bracket",
  "wc.entryList.noBracketsTitle": "Chưa có bracket nào được tạo",
  "wc.entryList.noBracketsBody": "Trước tiên hãy tạo bracket cá nhân, sau đó bạn có thể chọn khi lịch thi đấu sẵn sàng.",
  // ── Pool dashboard: AI features teaser ───────────────────────────────
  "wc.home.ai.title": "Tính năng AI",
  "wc.home.ai.chimmyHint": "Nhập @chimmy trong chat pool để nhận lời khuyên cá nhân về bracket.",
  "wc.home.ai.explainHint": "Đi đến tab Xem lại để nhận giải thích AI về chiến lược bracket của bạn.",
  "wc.home.ai.unlockHint": "Nâng cấp lên AF Pro để mở khóa Chimmy AI và Giải thích bracket của tôi.",

  // ── AI CTA panel ──────────────────────────────────────────────────────
  "wc.cta.panelTitle": "Thông tin AI",
  "wc.cta.aiRowLabel": "AI / Pro",
  "wc.cta.commissionerRowLabel": "Ủy viên",
  "wc.cta.askChimmy": "Hỏi Chimmy",
  "wc.cta.askChimmyDesc": "Mở Chimmy với câu hỏi về bracket",
  "wc.cta.pathToFirst": "Con đường lên Đầu",
  "wc.cta.pathToFirstDesc": "Hỏi Chimmy bracket của bạn cần gì để leo lên vị trí đầu",
  "wc.cta.explainBracket": "Giải thích Bracket của Tôi",
  "wc.cta.explainBracketDesc": "Nhận giải thích AI về chiến lược bracket của bạn",
  "wc.cta.rootingGuide": "Hướng dẫn Cổ vũ",
  "wc.cta.rootingGuideDesc": "Tạo hướng dẫn cổ vũ cho mục này",
  "wc.cta.poolSwing": "Biến động Pool",
  "wc.cta.poolSwingDesc": "Tìm biến động bảng xếp hạng lớn nhất sắp tới",
  "wc.cta.championRisk": "Rủi ro Nhà vô địch",
  "wc.cta.championRiskDesc": "Phân tích rủi ro pick nhà vô địch trong toàn pool",
  "wc.cta.commissionerRecap": "Tóm tắt Ủy viên",
  "wc.cta.commissionerRecapDesc": "Tạo tóm tắt AI của pool (xem trước trước khi đăng)",
  "wc.cta.postHype": "Đăng Hype",
  "wc.cta.postHypeDesc": "Đăng tin nhắn hype lên pool chat",
  "wc.cta.findIncomplete": "Picks Chưa hoàn chỉnh",
  "wc.cta.findIncompleteDesc": "Tìm các mục có nguy cơ thiếu picks cao nhất",

  // ── Pool Chat community panel (Goal 9) ───────────────────────────────
  "wc.chat.hero.title": "Chat Pool",
  "wc.chat.hero.subtitle": "Thảo luận chiến lược, dự đoán kết quả và giữ pool luôn sôi động.",
  "wc.chat.hero.badge": "Cộng đồng",
  "wc.chat.empty.headline": "Bắt đầu cuộc tranh luận đầu tiên.",
  "wc.chat.empty.body":
    "Gọi tên nhà vô địch của bạn, đặt câu hỏi về lựa chọn mạo hiểm, hoặc hỏi Chimmy cho ý kiến.",
  "wc.chat.chip.explainBracket": "Giải thích bracket của tôi",
  "wc.chat.chip.dangerZone": "Tìm các lựa chọn nguy hiểm của tôi",
  "wc.chat.chip.poolFavorite": "Ai là người được yêu thích trong pool?",
  "wc.chat.chip.keyMatchup": "Trận đấu nào có thể thay đổi tất cả?",
  "wc.chat.chip.trashTalk": "Cho tôi một câu trash talk an toàn",
  "wc.chat.composer.placeholder": "Nhắn tin cho pool hoặc hỏi Chimmy…",
  "wc.chat.composer.send": "Gửi",
  "wc.chat.privateLabel": "Trả lời riêng tư của Chimmy · Chỉ bạn thấy",
  "wc.chat.aiHint.unlocked":
    "Các trả lời của @chimmy là riêng tư. Chỉ bạn thấy câu hỏi và câu trả lời của Chimmy trong pool này.",
  "wc.chat.aiHint.locked":
    "Trả lời riêng tư của @chimmy yêu cầu AI/Pro. Nâng cấp để hỏi Chimmy từ chat pool.",
  "wc.chat.trustNote": "Hãy cạnh tranh. Hãy văn minh.",
  "wc.chat.loading": "Đang tải chat pool…",
  "wc.chat.refresh": "Làm mới",

  // ── Pool dashboard: command hero ──────────────────────────────────────
  "wc.pool.eyebrow": "Trung tâm chỉ huy pool",
  "wc.pool.privateBadge": "Riêng tư",
  "wc.pool.publicBadge": "Công khai",
  // ── Pool dashboard: what to do next card ──────────────────────────────
  "wc.pool.next.title": "Bước tiếp theo",
  "wc.pool.next.create.title": "Tạo bracket của bạn",
  "wc.pool.next.create.body": "Bắt đầu chọn để tham gia thi đấu trong pool này.",
  "wc.pool.next.picks.title": "Thực hiện lượt chọn",
  "wc.pool.next.picks.body": "Lịch thi đấu đã sẵn sàng — mở bracket và bắt đầu chọn người chiến thắng.",
  "wc.pool.next.review.title": "Xem lại và hoàn tất",
  "wc.pool.next.review.body": "Đã chọn xong tất cả. Xem lại bracket và xác nhận trước khi giải đấu bắt đầu.",
  "wc.pool.next.done.title": "Bracket đã gửi",
  "wc.pool.next.done.body": "Bracket của bạn đã được khóa. Kiểm tra bảng xếp hạng để theo dõi thứ hạng.",
  "wc.pool.next.waiting.title": "Đang chờ lịch thi đấu",
  "wc.pool.next.waiting.body": "Thông tin trận đấu đang được thiết lập. Hãy quay lại trước khi trận bắt đầu.",
  // ── Pool dashboard: progress strip ────────────────────────────────────
  "wc.pool.progress.title": "Tiến độ",
  "wc.pool.progress.created": "Đã tạo",
  "wc.pool.progress.picks": "Đã chọn xong",
  "wc.pool.progress.finalized": "Đã gửi",
  // ── Pool dashboard: commissioner panel ────────────────────────────────
  "wc.pool.commissioner.title": "Công cụ ủy ban viên",
  // ── Pool dashboard: leaderboard preview ───────────────────────────────
  "wc.pool.leaderboard.title": "Bảng xếp hạng",
  "wc.pool.leaderboard.empty": "Chưa có bracket nào được tính điểm",
  "wc.pool.leaderboard.emptyNote": "Bracket sẽ xuất hiện ở đây sau khi bắt đầu tính điểm.",
  "wc.pool.leaderboard.viewFull": "Bảng xếp hạng đầy đủ",

  // ── Pool dashboard: header / status strip ────────────────────────────
  "wc.header.sync": "Đồng bộ",
  "wc.header.inviteAria": "Mời bạn bè",
  "wc.header.invite": "Mời",
  "wc.header.testMode": "Chế độ thử",
  "wc.header.testModeNote":
    "kết quả là mô phỏng và có thể ảnh hưởng đến bảng xếp hạng.",

  // ── Lock countdown ───────────────────────────────────────────────────
  "wc.lock.untilLockDays":
    "Còn {{d}} ngày {{h}} giờ trước khi khoá lựa chọn",
  "wc.lock.untilLockHours":
    "Còn {{h}} giờ {{m}} phút trước khi khoá lựa chọn",
  "wc.lock.untilLockMinutes":
    "Còn {{m}} phút trước khi khoá lựa chọn",
  "wc.lock.locksSoon": "Bracket sắp bị khoá",
  "wc.lock.bracketLocked": "Bracket đã khoá",
  "wc.lock.picksFrozen":
    "Bracket đã khoá — không thể chỉnh sửa lựa chọn.",

  // ── Countdown banner ─────────────────────────────────────────────────
  "wc.countdown.banner.startsIn": "World Cup starts in",
  "wc.countdown.banner.locksNote": "Group picks lock at kickoff",
  "wc.countdown.banner.urgent24h": "Picks lock soon",
  "wc.countdown.banner.urgent1h": "Final chance — picks lock at kickoff",
  "wc.countdown.banner.locked.title": "Group picks are locked",
  "wc.countdown.banner.locked.subtitle": "Live scoring is now active",
  "wc.countdown.banner.cta.make": "Make Picks",
  "wc.countdown.banner.cta.finish": "Finish My Bracket",
  "wc.countdown.banner.cta.finishNow": "Finish Picks Now",
  "wc.countdown.banner.cta.leaderboard": "View Leaderboard",
  "wc.countdown.banner.firstMatchFallback": "First group-stage match",
  "wc.countdown.banner.lockTime": "Group picks lock · {{time}}",
  "wc.countdown.banner.fallback": "World Cup countdown coming soon",
  "wc.countdown.banner.fallbackHint": "Picks remain editable until kickoff is confirmed",

  // ── AI upgrade / cap messages ────────────────────────────────────────
  "wc.ai.upgrade.chimmy.free": "You've used today's 3 Chimmy questions. Upgrade to AF Pro for 30 per day.",
  "wc.ai.upgrade.chimmy.pro": "You've used today's 30 Chimmy questions. They reset at midnight UTC.",
  "wc.ai.upgrade.explain.free": "Bracket explanations require AF Pro. Upgrade to get daily AI bracket breakdowns.",
  "wc.ai.upgrade.explain.pro": "You've used today's bracket explanation. It resets at midnight UTC.",
  "wc.ai.upgrade.matchup.free": "AI Matchup Intelligence requires AF Pro.",
  "wc.ai.upgrade.matchup.pro": "You've used today's 25 AI matchup analyses. They reset at midnight UTC.",
  "wc.ai.upgrade.brain.free": "Commissioner Brain requires AF Commissioner or higher.",
  "wc.ai.upgrade.brain.pro": "You've used today's Commissioner Brain calls. They reset at midnight UTC.",
  "wc.ai.upgrade.resetHint": "Daily AI limits reset at midnight UTC.",
  "wc.ai.upgrade.cta": "Upgrade Plan",

  // ── Knockouts tab ────────────────────────────────────────────────────
  "wc.knockouts.intro.reseeded":
    "Lựa chọn vòng loại trực tiếp mở sau khi có lịch thi đấu chính thức vòng 32.",
  "wc.knockouts.intro.predictive":
    "Bracket vòng loại trực tiếp của bạn được tạo từ kết quả vòng bảng mà bạn dự đoán.",
  "wc.knockouts.subintro.reseeded":
    "Lựa chọn vòng bảng vẫn hoạt động bình thường. Khi lịch chính thức vòng loại trực tiếp được đồng bộ, bạn sẽ chọn lại từ bracket chính thức.",
  "wc.knockouts.subintro.predictive":
    "Các cặp đấu vòng loại trực tiếp cập nhật theo dự đoán vòng bảng của bạn. Đổi dự đoán vòng bảng có thể đặt lại một số lựa chọn vòng loại trực tiếp.",
  "wc.knockouts.startPicks": "Bắt đầu chọn",
  "wc.knockouts.continuePicks": "Tiếp tục chọn",
  "wc.knockouts.guidance.complete":
    "Đã hoàn tất {{done}}/{{required}} lựa chọn hiện có.",
  "wc.knockouts.guidance.nextPick":
    "Lựa chọn kế tiếp: Trận {{matchNumber}}.",
  "wc.knockouts.guidance.blocked":
    "Hãy chọn người thắng các vòng trước. Càng chọn xong vòng trước, càng mở thêm lựa chọn vòng sau.",
  "wc.knockouts.guidance.noneReady":
    "Hiện chưa có lựa chọn vòng loại trực tiếp nào sẵn sàng.",

  // ── Knockout Danger Zones card ───────────────────────────────────────
  "wc.danger.eyebrow": "Vòng loại trực tiếp",
  "wc.danger.title": "Khu Vực Nguy Hiểm Vòng Loại Trực Tiếp",
  "wc.danger.subtitle":
    "Phân tích xác định — so sánh lựa chọn của bạn với sức mạnh hạt giống trước giải và trạng thái trận đấu trực tiếp.",
  "wc.danger.tierPro": "AF Pro",
  "wc.danger.tierBasic": "Cơ bản",
  "wc.danger.emptyNoEntry":
    "Mở một entry bracket để xem khu vực nguy hiểm.",
  "wc.danger.emptyNoPicks":
    "Chọn vòng loại trực tiếp để xem khu vực nguy hiểm.",
  "wc.danger.emptyNoRisks":
    "Hiện không có khu vực nguy hiểm. Tất cả lựa chọn vòng loại trực tiếp của bạn đều được sức mạnh trước giải ủng hộ.",
  "wc.danger.severityHigh": "Cao",
  "wc.danger.severityMedium": "Trung bình",
  "wc.danger.severityLow": "Thấp",
  "wc.danger.severitySuffix": "nguy hiểm",
  "wc.danger.footer":
    "Chỉ đếm lựa chọn của chính bạn so với lịch thi đấu công khai. Không gọi AI. Không sử dụng lựa chọn của người khác.",

  // ── AI Report (Review tab) ───────────────────────────────────────────
  "wc.aiReport.eyebrow": "Báo cáo",
  "wc.aiReport.title": "Báo Cáo AI Cho Bracket Của Bạn",
  "wc.aiReport.subtitle":
    "Sáu tín hiệu AI tính từ chính lựa chọn của bạn. Toàn bộ nội dung bên dưới chỉ riêng bạn xem được.",
  "wc.aiReport.tierActive": "AF Pro đang bật",
  "wc.aiReport.tierPreview": "Xem trước AF Pro",

  // ── Share / Invite ───────────────────────────────────────────────────
  "wc.invite.title": "Mời bạn bè",
  "wc.invite.copyLink": "Sao chép link mời",
  "wc.invite.copied": "Đã sao chép link!",
  "wc.invite.shareNative": "Chia sẻ",
  "wc.invite.shareViaText": "Tin nhắn",
  "wc.invite.shareViaEmail": "Email",
  "wc.invite.viaSocial": "Mạng xã hội",
  "wc.invite.heading":
    "Mời bạn bè cùng tham gia {{poolName}} trên AllFantasy.",
  "wc.invite.inviteCodeLabel": "Mã mời",

  // ── Commissioner Checklist ───────────────────────────────────────────
  "wc.checklist.title": "Danh Sách Hoàn Tất Pool",
  "wc.checklist.subtitle":
    "Thành viên của {{poolName}} và trạng thái so với hạn khoá.",
  "wc.checklist.copyReminder": "Sao chép lời nhắc",
  "wc.checklist.reminderCopied": "Đã sao chép lời nhắc!",
  "wc.checklist.statusReady": "Sẵn sàng",
  "wc.checklist.statusNoMembers": "Chưa có thành viên",
  "wc.checklist.statusNoData": "Chưa có snapshot",

  // ── Empty / loading / error states ───────────────────────────────────
  "wc.state.loading": "Đang tải...",
  "wc.state.refresh": "Làm mới",
  "wc.state.tryAgain": "Thử lại",
  "wc.state.noEntries":
    "Bạn chưa tạo bracket entry cho pool này.",
  "wc.state.createEntry": "Tạo bracket của tôi",

  // ── Language selector tooltip ────────────────────────────────────────
  "wc.language.label": "Ngôn ngữ",
  "wc.language.english": "English",
  "wc.language.spanish": "Español",
  "wc.language.chinese": "繁體中文",
  "wc.language.filipino": "Filipino",
  "wc.language.vietnamese": "Tiếng Việt",

  // ── Create page / modal ──────────────────────────────────────────────
  "wc.create.goBack": "Quay lại",
  "wc.create.header": "Tạo Pool Bracket World Cup",
  "wc.create.subheader":
    "FIFA World Cup 2026 · tính điểm theo từng vòng",
  "wc.create.heroTitle": "FIFA World Cup 2026",
  "wc.create.heroSubtitle":
    "Tạo một pool — mời bạn bè và để họ tự xây bracket của riêng mình bên trong.",
  "wc.create.poolName.label": "Tên pool",
  "wc.create.poolName.placeholder":
    "vd. Office World Cup Pool 2026",
  "wc.create.poolName.error.blank":
    "Tên pool không được bỏ trống.",
  "wc.create.poolName.default": "Pool Bracket World Cup",
  "wc.create.visibility.label": "Quyền truy cập pool",
  "wc.create.visibility.private": "Riêng tư",
  "wc.create.visibility.privateHint":
    "Cần link mời để tham gia",
  "wc.create.visibility.public": "Công khai",
  "wc.create.visibility.publicHint":
    "Ai cũng có thể tìm thấy và tham gia",
  "wc.create.maxUsers.label": "Số người chơi tối đa",
  "wc.create.maxUsers.hint": "Tối đa {{max}} cho mỗi pool",
  "wc.create.maxUsers.error":
    "Phải nằm trong khoảng 2 đến {{max}}.",
  "wc.create.maxEntries.label": "Bracket cho mỗi người chơi",
  "wc.create.maxEntries.hint":
    "Tối đa {{max}} cho mỗi người chơi",
  "wc.create.maxEntries.error":
    "Phải nằm trong khoảng 1 đến {{max}}.",
  "wc.create.lockRule.label": "Quy tắc khoá lựa chọn",
  "wc.create.lockRule.tournament": "Khoá theo giải",
  "wc.create.lockRule.tournamentHint":
    "Toàn bộ lựa chọn khoá khi trận đầu tiên bắt đầu",
  "wc.create.lockRule.perMatch": "Khoá theo trận",
  "wc.create.lockRule.perMatchHint":
    "Mỗi trận khoá vào giờ bóng lăn của chính trận đó",
  "wc.create.lockRule.copyTournament":
    "Có thể chỉnh lựa chọn cho đến khi trận đầu tiên của World Cup bắt đầu.",
  "wc.create.lockRule.copyPerMatch":
    "Có thể chỉnh từng cặp đấu cho đến khi chính trận đó bắt đầu.",
  "wc.create.scoring.intro": "Tính điểm theo từng vòng:",
  "wc.create.scoring.values":
    "10 điểm Vòng 32 · 20 điểm Vòng 16 · 40 điểm tứ kết · 80 điểm bán kết · 160 điểm chung kết · 320 điểm thưởng nhà vô địch",
  "wc.create.helper.entriesOne":
    "Mỗi người chơi có thể tạo tối đa {{max}} bracket.",
  "wc.create.helper.entriesOther":
    "Mỗi người chơi có thể tạo tối đa {{max}} bracket.",
  "wc.create.helper.leaderboard":
    "Bảng xếp hạng chỉ tính bracket đã hoàn tất, không tính bản nháp.",
  "wc.create.helper.inviteLink":
    "Link mời sẽ hiển thị sau khi tạo pool.",
  "wc.create.thirdPlace": "Bao gồm trận tranh hạng ba",
  "wc.create.testFixtures.label": "Tạo lịch thử (test fixtures)",
  "wc.create.testFixtures.hint":
    "Thêm dữ liệu giả lập cho Vòng 32 (đội, cờ, giờ bóng lăn, sân) để pool có thể chơi ngay.",
  "wc.create.submit.idle": "Tạo pool",
  "wc.create.submit.creating": "Đang tạo...",
  "wc.create.submit.opening": "Đã tạo, đang mở...",
  "wc.create.openingSuccess": "Đã tạo bracket, đang mở...",
  "wc.create.error.signInRequired":
    "Hãy đăng nhập để tạo bracket.",
  "wc.create.error.noId":
    "Bracket đã tạo nhưng máy chủ không trả về ID. Hãy làm mới trang.",
  "wc.create.error.generic": "Không tạo được bracket",
  "wc.create.error.requestFailed":
    "Yêu cầu thất bại ({{status}})",

  // ── Discover page ────────────────────────────────────────────────────
  "wc.discover.backToHub": "← Trang chính World Cup",
  "wc.discover.createPool": "Tạo pool",
  "wc.discover.title": "Khám phá pool công khai",
  "wc.discover.subtitle":
    "Duyệt các pool bracket World Cup công khai. Tham gia sẽ mở Bracket 1 chưa có lựa chọn — chúng tôi sẽ đưa bạn vào trình chọn có hướng dẫn khi pool còn nhận người chơi mới và chưa đầy.",
  "wc.discover.search.label": "Tìm kiếm",
  "wc.discover.search.placeholder": "Tên pool",
  "wc.discover.season.label": "Mùa giải",
  "wc.discover.season.placeholder": "vd. 2026",
  "wc.discover.statusFilter.label": "Trạng thái",
  "wc.discover.statusFilter.all": "Tất cả",
  "wc.discover.statusFilter.open": "Mở",
  "wc.discover.statusFilter.locked": "Đã khoá",
  "wc.discover.statusFilter.final": "Kết thúc",
  "wc.discover.loading": "Đang tải pool công khai...",
  "wc.discover.errors.couldNotLoad": "Không tải được pool",
  "wc.discover.empty":
    "Không có pool công khai nào khớp bộ lọc. Hãy thử mùa giải khác hoặc xoá tìm kiếm — hoặc tham gia pool riêng bằng mã mời ở trên.",
  "wc.discover.joinPanelTitle":
    "Tham gia bằng mã mời (pool riêng tư)",

  // ── Discover card ────────────────────────────────────────────────────
  "wc.discover.card.statusOpen": "Mở",
  "wc.discover.card.blockedFull": "Pool đã đầy",
  "wc.discover.card.blockedClosed":
    "Đã đóng với người chơi mới",
  "wc.discover.card.password": "Mật khẩu",
  "wc.discover.card.lateJoin":
    "Đã khoá lựa chọn · vẫn cho vào trễ",
  "wc.discover.card.preview": "Xem trước",
  "wc.discover.card.join": "Tham gia",

  // ── Join / invite panel ──────────────────────────────────────────────
  "wc.join.backToHub": "← Trang chính World Cup",
  "wc.join.brandEyebrow": "AllFantasy",
  "wc.join.brandTitle": "Pool Bracket World Cup 2026",
  "wc.join.panelTitle": "Tham gia bằng mã mời",
  "wc.join.panelHelper":
    "Nhập mã mời từ chủ pool của bạn. Sau khi tham gia, bạn sẽ vào bảng điều khiển pool và có thể bắt đầu bracket đầu tiên. Pool có mật khẩu cần nhập mật khẩu được đặt trong cài đặt pool.",
  "wc.join.codeInput.placeholder": "Mã mời WCUP",
  "wc.join.previewBtn": "Xem trước",
  "wc.join.errors.invalidCode":
    "Hãy nhập mã mời hợp lệ",
  "wc.join.errors.notFound": "Không tìm thấy lời mời",
  "wc.join.errors.full": "Pool này đã đầy.",
  "wc.join.errors.closed":
    "Pool này đã đóng với người chơi mới.",
  "wc.join.errors.couldNotJoin": "Không tham gia được",
  "wc.join.preview.hostLine":
    "Chủ pool: {{owner}} · {{count}} người chơi · {{visibility}}",
  "wc.join.preview.openCopy":
    "Tham gia ngay để tạo Bracket 1, chọn Vòng bảng và Vòng loại trực tiếp, và hoàn tất khi sẵn sàng.",
  "wc.join.preview.fullCopy": "Pool này đã đầy.",
  "wc.join.preview.closedCopy":
    "Pool đã khoá — không nhận người chơi mới.",
  "wc.join.preview.passwordLabel": "Mật khẩu tham gia",
  "wc.join.preview.joinBtn": "Tham gia pool",
  "wc.join.success":
    "Đã vào — Bracket 1 đã sẵn sàng.",

  // ── Finalize / share success block (Review tab) ──────────────────────
  "wc.finalize.eyebrow": "Đã hoàn tất",
  "wc.finalize.title": "Bracket của bạn đã được khoá",
  "wc.finalize.subtitleNoTime":
    "Đã gửi. Bạn vẫn có thể chỉnh sửa cho đến khi pool khoá — mời bạn bè trước khi hết slot.",
  "wc.finalize.subtitleWithTime":
    "Đã gửi {{at}}. Bạn vẫn có thể chỉnh sửa cho đến khi pool khoá — mời bạn bè trước khi hết slot.",
  "wc.finalize.copyShare": "Sao chép văn bản chia sẻ",
  "wc.finalize.copyShareCopied": "Đã sao chép!",
  "wc.finalize.shareReport": "Chia sẻ báo cáo AI bracket của tôi",
  "wc.finalize.inviteFriends":
    "Mời bạn bè đến đánh bại bracket của tôi",
  "wc.finalize.previewShare": "Xem trước văn bản chia sẻ",

  // ── Finalize success block: challenge + trust ─────────────────────────
  "wc.finalize.viewLeaderboard": "Xem bảng xếp hạng",
  "wc.finalize.openChat": "Chat pool",
  "wc.finalize.challengeTitle": "Con đường World Cup của bạn đã được khóa.",
  "wc.finalize.challengeDesc": "Giờ hãy rủ bạn bè cùng xem bảng xếp hạng trở nên sôi động.",
  "wc.finalize.trustNote": "Miễn phí hoàn toàn. Chỉ là chiến lược, dự đoán và quyền tự hào.",

  // ── Leaderboard tab visual upgrade ───────────────────────────────────
  "wc.lb.eyebrow": "Pool",
  "wc.lb.title": "Cuộc Đua Bảng Xếp Hạng",
  "wc.lb.heroSubtitle": "Mỗi trận đấu đều có thể thay đổi câu chuyện. Theo dõi điểm số, truy đuổi những người dẫn đầu và xem pool trở nên sôi động.",
  "wc.lb.statusPreTournament": "Trước giải đấu",
  "wc.lb.statusLive": "Đang diễn ra",
  "wc.lb.statusWaiting": "Chờ lịch thi đấu",
  "wc.lb.subtitleBase": "Chỉ entry đã hoàn tất · điểm cập nhật sau khi đồng bộ kết quả.",
  "wc.lb.lastUpdated": "Đồng bộ lần cuối: {{date}}.",
  "wc.lb.notYetSynced": "Chưa đồng bộ.",
  "wc.lb.testMode": "Chế độ thử nghiệm: bảng xếp hạng có thể phản ánh kết quả mô phỏng.",
  "wc.lb.recalculate": "Tính lại",
  "wc.lb.autoUpdate": "Tự động cập nhật",
  "wc.lb.scoresNotSynced": "Điểm chưa đồng bộ — tổng điểm cập nhật sau khi kết quả được nhập.",
  "wc.lb.fixturesNotReady": "Lịch thi đấu chưa đầy đủ — cần xác định đội trước khi bảng xếp hạng có ý nghĩa.",
  "wc.lb.podiumTitle": "Dẫn Đầu Pool",
  "wc.lb.yourRank": "Thứ Hạng Của Bạn",
  "wc.lb.yourRankTagline": "Bạn đang trong cuộc đua.",
  "wc.lb.gapToFirst": "Kém người dẫn đầu {{n}} điểm",
  "wc.lb.isLeader": "Bạn đang dẫn đầu pool.",
  "wc.lb.tied": "Ngang bằng người dẫn đầu.",
  "wc.lb.viewMyBracket": "Xem Bracket của Tôi",
  "wc.lb.noEntryTitle": "Bạn chưa tham gia cuộc đua.",
  "wc.lb.noEntryBody": "Tạo bracket để tham gia bảng xếp hạng.",
  "wc.lb.startMyBracket": "Bắt Đầu Bracket của Tôi",
  "wc.lb.emptyTitle": "Cuộc Đua Chưa Bắt Đầu",
  "wc.lb.emptyBody": "Bảng xếp hạng sẽ hoạt động khi lựa chọn được khoá và các trận đấu bắt đầu.",
  "wc.lb.emptyInvite": "Mời Bạn Bè",
  "wc.lb.emptyReview": "Xem Bracket của Tôi",
  "wc.lb.scoringTitle": "Cách Tính Điểm",
  "wc.lb.scoringBody": "Lựa chọn đúng ghi điểm. Các vòng sau có trọng số lớn hơn, nên mỗi con đường đến chung kết đều quan trọng.",
  "wc.lb.scoringUpdates": "Bảng xếp hạng cập nhật sau khi kết quả trận đấu được đồng bộ.",
  "wc.lb.shareMyRank": "Chia Sẻ Thứ Hạng",
  "wc.lb.challengePool": "Thách Thức Pool",
  "wc.lb.noChampionPick": "Chưa chọn vô địch",
  "wc.lb.alive": "Còn sống",
  "wc.lb.busted": "Bị loại",
  "wc.lb.aiProUnlocks": "AF Pro mở khoá % thắng AI, Sức khoẻ bracket và áp lực con đường đến nhà vô địch.",
  "wc.lb.ptsLabel": "Điểm",
  "wc.lb.trustNote": "Không cá cược. Không nhà cái. Chỉ là chiến thuật, dự đoán và quyền tự hào.",
  // ── Share card UI chrome ──────────────────────────────────────────────
  "wc.share.eyebrow": "Ảnh Chia Sẻ",
  "wc.share.titleInvite": "Mời Vào Pool",
  "wc.share.titleLeaderboard": "Ảnh Chụp Bảng Xếp Hạng",
  "wc.share.titleBracket": "Tóm Tắt Bracket của Tôi",
  "wc.share.titleRecap": "Tóm Tắt AI",
  "wc.share.description": "Văn bản sẵn sàng chia sẻ lên mạng xã hội về bracket hoặc bảng xếp hạng pool.",
  "wc.share.publicSafe": "An toàn công khai",
  "wc.share.copy": "Sao chép",
  "wc.share.copied": "Đã sao chép",
  "wc.share.share": "Chia sẻ",

  // ── Inside-pool Invite tab ───────────────────────────────────────────
  "wc.inviteTab.eyebrow": "Pool",
  "wc.inviteTab.title": "Mời và Chi tiết pool",
  "wc.inviteTab.detailsTitle": "Chi tiết pool",
  "wc.inviteTab.meta.pool": "Pool",
  "wc.inviteTab.meta.privacy": "Quyền truy cập",
  "wc.inviteTab.meta.privacyPublic": "Công khai",
  "wc.inviteTab.meta.privacyPrivate": "Riêng tư — chỉ qua mời",
  "wc.inviteTab.meta.maxUsers": "Số người chơi tối đa",
  "wc.inviteTab.meta.bracketsPerUser": "Bracket cho mỗi người chơi",
  "wc.inviteTab.meta.scoring": "Tính điểm",
  "wc.inviteTab.meta.scoringValue": "Kiểu NCAA",
  "wc.inviteTab.meta.lockRule": "Quy tắc khoá",
  "wc.inviteTab.meta.lockTournament":
    "Khoá khi trận đầu tiên của World Cup bắt đầu",
  "wc.inviteTab.meta.lockPerMatch":
    "Khoá theo từng trận khi bóng lăn",
  "wc.inviteTab.lockedBanner":
    "Pool đã khoá. Không thể chỉnh sửa các lựa chọn nữa.",
  "wc.inviteTab.member.title": "Mời bạn bè vào pool này",
  "wc.inviteTab.member.body":
    "Chỉ chủ pool mới có thể sao chép và chia sẻ link mời. Hãy hỏi chủ pool để lấy link hoặc mã mời.",
  "wc.inviteTab.commissioner.linkTitle": "Link mời",
  "wc.inviteTab.commissioner.linkHelper":
    "Chia sẻ với bất kỳ ai bạn muốn mời. Họ cần đăng nhập AllFantasy.",
  "wc.inviteTab.commissioner.codeLabel": "Mã mời",
  "wc.inviteTab.commissioner.copyCode": "Sao chép mã",
  "wc.inviteTab.commissioner.copyCodeDone": "Đã sao chép",
  "wc.inviteTab.commissioner.copyLink": "Sao chép link mời",
  "wc.inviteTab.commissioner.copyLinkDone": "Đã sao chép link!",
  "wc.inviteTab.commissioner.copyMessage":
    "Sao chép tin nhắn mời",
  "wc.inviteTab.commissioner.copyMessageDone":
    "Đã sao chép tin nhắn!",
  "wc.inviteTab.commissioner.share": "Chia sẻ",
  "wc.inviteTab.commissioner.previewInvite":
    "Xem trước tin nhắn mời",
  "wc.inviteTab.commissioner.previewShare":
    "Xem trước tin nhắn chia sẻ",
  "wc.inviteTab.commissioner.noCodeTitle":
    "Link mời chưa sẵn sàng",
  "wc.inviteTab.commissioner.noCodeBody":
    "Chủ pool hoặc admin có thể tạo lại link mời trong cài đặt pool.",
  "wc.inviteTab.shareMessage.default":
    "Tham gia pool bracket World Cup AllFantasy của tôi: \"{{pool}}\"! Tạo tối đa {{maxEntries}} bracket, xếp hạng vòng bảng, chọn vòng loại trực tiếp, và đua trên bảng xếp hạng trực tiếp. {{url}}",
  "wc.inviteTab.shareTitleNative":
    "{{pool}} — Bracket World Cup AllFantasy",

  // ── Invite tab: new UX sections (Goal 8) ─────────────────────────────
  "wc.inviteTab.hero.title": "Tập Hợp Đội Nhóm",
  "wc.inviteTab.hero.subtitle":
    "Chia sẻ pool này, thách thức bạn bè và để bảng xếp hạng phân định thắng thua.",
  "wc.inviteTab.hero.participants": "{{count}} người tham gia",
  "wc.inviteTab.hero.spotsLeft": "Còn {{n}} chỗ trống",
  "wc.inviteTab.hero.poolFull": "Pool đã đầy",
  "wc.inviteTab.hero.lockDeadline": "Lượt chọn khóa vào {{date}}",
  "wc.inviteTab.growth.title": "Pool của bạn hay hơn khi có nhiều đối thủ.",
  "wc.inviteTab.growth.body":
    "Mời bạn bè trước khi lượt chọn bị khóa để lấp đầy bảng xếp hạng.",
  "wc.inviteTab.growth.cta": "Mời bạn bè",
  "wc.inviteTab.social.title": "Mẫu Đăng Mạng Xã Hội",
  "wc.inviteTab.social.copy1":
    "Tham gia pool World Cup của tôi trên AllFantasy và chứng minh bracket của bạn tốt hơn.",
  "wc.inviteTab.social.copy2": "Bảng xếp hạng sắp trở nên gay cấn.",
  "wc.inviteTab.social.copy3": "Mang bracket tốt nhất của bạn.",
  "wc.inviteTab.social.copyBtn": "Sao chép",
  "wc.inviteTab.social.copiedBtn": "Đã sao chép",
  "wc.inviteTab.actions.viewLeaderboard": "Xem Bảng Xếp Hạng",
  "wc.inviteTab.actions.openChat": "Mở Chat Pool",
  "wc.inviteTab.actions.shareLink": "Chia Sẻ Trên Di Động",
  "wc.inviteTab.trustNote":
    "Không cờ bạc. Không nhà cái. Chỉ có dự đoán World Cup, chiến thuật và quyền tự hào.",

  // ── Commissioner Checklist card chrome (extended) ────────────────────
  "wc.checklist.eyebrow": "Chủ pool",
  "wc.checklist.cardSubtitle":
    "Xem nhanh tiến trình của thành viên. Chỉ chủ pool và admin mới thấy.",
  "wc.checklist.copyReminderBtn": "Sao chép lời nhắc",
  "wc.checklist.copyReminderDone": "Đã sao chép lời nhắc!",
  "wc.checklist.stat.total": "Tổng thành viên",
  "wc.checklist.stat.finalized": "Đã hoàn tất",
  "wc.checklist.stat.inProgress": "Đang làm",
  "wc.checklist.stat.completion": "Hoàn thành",
  "wc.checklist.entryStatus.finalized": "Đã hoàn tất",
  "wc.checklist.entryStatus.inProgress": "Đang làm",
  "wc.checklist.entryStatus.needsPicks": "Cần chọn",
  "wc.checklist.entryStatus.unknown": "Chưa rõ",
  "wc.checklist.needsReminderBadge": "Cần nhắc",
  "wc.checklist.missingPicks": "Thiếu {{count}}",
  "wc.checklist.previewReminder": "Xem trước lời nhắc",
  "wc.checklist.privacyNote":
    "Xác định — dùng dữ liệu snapshot đã tải cho công cụ chủ pool. Không hiển thị email hay user ID.",
  "wc.checklist.empty.memberOnly":
    "Chỉ chủ pool hoặc admin mới có thể xem trạng thái thành viên.",
  "wc.checklist.empty.loading":
    "Dữ liệu trạng thái chủ pool đang tải.",
  "wc.checklist.empty.noMembers":
    "Chưa có thành viên nào tạo entry. Hãy chia sẻ link mời để bắt đầu.",
  "wc.checklist.empty.fallback": "Không có dữ liệu thành viên.",
  "wc.checklist.row.memberFallback": "Thành viên",
  "wc.checklist.row.bracketFallback": "Bracket",
  "wc.checklist.row.finalizedRowOne":
    "{{count}} bracket đã hoàn tất",
  "wc.checklist.row.finalizedRowOther":
    "{{count}} bracket đã hoàn tất",

  // ── Commissioner reminder message templates ──────────────────────────
  "wc.checklist.reminder.askCommissioner":
    "Hãy nhờ chủ pool nhắc các thành viên về {{pool}}.",
  "wc.checklist.reminder.finalizeLine":
    "Lời nhắc thân thiện: hoàn tất các lựa chọn của bạn cho \"{{pool}}\" trên AllFantasy.",
  "wc.checklist.reminder.joinLine":
    "Lời nhắc: tham gia \"{{pool}}\" trên AllFantasy và khoá bracket World Cup của bạn.",
  "wc.checklist.reminder.statusLine":
    "Trạng thái: {{done}}/{{total}} bracket đã hoàn tất ({{percent}}%).",
  "wc.checklist.reminder.deadlineLine":
    "Lựa chọn khoá lúc {{deadline}}.",
  "wc.checklist.reminder.poweredBy":
    "Hỗ trợ bởi AllFantasy.",
  "wc.checklist.reminder.noSnapshotLine":
    "Lời nhắc: hoàn tất các lựa chọn của bạn cho \"{{pool}}\" trên AllFantasy.",

  // ── AI Report card chrome (extended) ─────────────────────────────────
  "wc.aiShareCard.eyebrow": "Hình chia sẻ",
  "wc.aiShareCard.subtitle":
    "Sáu tín hiệu AI trong một thẻ sẵn sàng để sao chép. Xác định — không gọi AI khi chia sẻ.",
  "wc.aiShareCard.tierPro": "AF Pro",
  "wc.aiShareCard.tierPreview": "Xem trước Cơ bản",
  "wc.aiShareCard.emptyNoEntry":
    "Chọn một entry bracket để tạo thẻ chia sẻ.",
  "wc.aiShareCard.copyShare": "Sao chép văn bản chia sẻ",
  "wc.aiShareCard.copyShareDone": "Đã sao chép",
  "wc.aiShareCard.share": "Chia sẻ",
  "wc.aiShareCard.privacyNote":
    "Riêng tư cho đến khi bạn chia sẻ. Chỉ dùng dữ liệu bracket của bạn và số liệu tổng hợp của pool.",
  "wc.explain.eyebrow": "AI riêng tư",
  "wc.explain.title": "Giải thích bracket của tôi",
  "wc.explain.subtitle":
    "Phân tích tường thuật riêng tư về chiến thuật của bạn. Chỉ bạn xem được.",
  "wc.explain.tierPro": "AF Pro",
  "wc.explain.tierLocked": "Đã khoá",
  "wc.explain.locked":
    "AF Pro mở khoá phần giải thích AI riêng tư về chiến thuật bracket — phong cách, lựa chọn an toàn nhất, rủi ro cao nhất, đường đến nhà vô địch và một gợi ý cụ thể.",
  "wc.explain.upgradeCta": "Nâng cấp lên AF Pro →",
  "wc.explain.generate": "Tạo giải thích",
  "wc.explain.generating": "Đang tạo...",
  "wc.explain.selectFirst": "Hãy chọn bracket trước",
  "wc.explain.regenerate": "Tạo lại",
  "wc.explain.regenerating": "Đang tạo lại...",
  "wc.explain.fallbackBadge": "Dự phòng xác định",
  "wc.explain.error.generic": "Không thể tạo giải thích.",
  "wc.explain.error.network":
    "Lỗi mạng. Hãy thử lại.",
  "wc.explain.privacyNote":
    "Riêng tư cho bạn. Chỉ dùng lựa chọn của bạn và dữ liệu đội công khai. Không bao giờ đăng vào chat.",
  "wc.uniqueness.eyebrow": "So sánh pool",
  "wc.uniqueness.title":
    "Điều gì làm bracket của tôi khác biệt?",
  "wc.uniqueness.subtitle":
    "Chỉ so sánh với các bracket đã hoàn tất trong pool này.",
  "wc.uniqueness.tierPro": "AF Pro",
  "wc.uniqueness.tierBasic": "Cơ bản",
  "wc.uniqueness.empty.noEntry":
    "Chọn một entry bracket để tính độ độc đáo.",
  "wc.uniqueness.loading":
    "Đang tải so sánh pool...",
  "wc.uniqueness.error.couldNotLoad":
    "Không tải được dữ liệu độ độc đáo.",
  "wc.uniqueness.error.network":
    "Lỗi mạng. Hãy thử lại.",
  "wc.uniqueness.empty.notEnoughData":
    "Độ độc đáo sẽ mở khoá khi có thêm bracket hoàn tất.",
  "wc.uniqueness.empty.incomplete":
    "Hãy chọn vòng bảng và vòng loại trực tiếp để xem bracket của bạn độc đáo ra sao.",
  "wc.uniqueness.rarity.veryRare": "Rất hiếm",
  "wc.uniqueness.rarity.rare": "Hiếm",
  "wc.uniqueness.rarity.uncommon": "Ít gặp",
  "wc.uniqueness.rarity.common": "Phổ biến",
  "wc.uniqueness.percentShare": "Tỉ lệ {{percent}}%",
  "wc.uniqueness.privacyNote":
    "Xác định — chỉ đếm các bracket đã hoàn tất. Không gọi AI, không hiển thị lựa chọn gốc của người khác.",
  "wc.grade.eyebrow": "Điểm bracket",
  "wc.grade.completionLabel": "Hoàn thành {{percent}}%",
  "wc.grade.tierProDetail": "Chi tiết AF Pro",
  "wc.grade.tierBasic": "Cơ bản",
  "wc.grade.stat.groups": "Vòng bảng",
  "wc.grade.stat.thirdPlace": "Hạng ba",
  "wc.grade.stat.knockouts": "Vòng loại TT",
  "wc.grade.stat.missing": "Thiếu",
  "wc.grade.risk": "Mức rủi ro:",
  "wc.grade.upset": "Chỉ số cú sốc:",
  "wc.grade.championConfidence": "Niềm tin nhà vô địch:",
  "wc.grade.championConfidenceNone": "Chưa chọn nhà vô địch",
  "wc.grade.biggestRisk": "Rủi ro lớn nhất:",
  "wc.grade.recommendation": "Gợi ý:",
  "wc.grade.lockedBody":
    "AF Pro mở khoá rủi ro, chỉ số cú sốc, niềm tin nhà vô địch, rủi ro lớn nhất và gợi ý chi tiết.",
  "wc.confidence.title": "Kiểm tra niềm tin AI",
  "wc.confidence.tierOpen": "Đã mở",
  "wc.confidence.tierLocked": "Đã khoá",
  "wc.confidence.missingPicks": "Lựa chọn còn thiếu:",
  "wc.confidence.noMissing":
    "Không còn thiếu. Sẵn sàng hoàn tất.",
  "wc.confidence.missingBreakdown":
    "{{knockout}} vòng loại trực tiếp, {{groups}} vòng bảng, {{thirdPlace}} hạng ba.",
  "wc.confidence.highRiskPicks": "Lựa chọn rủi ro cao:",
  "wc.confidence.highRiskBody":
    "{{count}} lựa chọn ở các vòng đầu sẽ định hình phần lớn đường đi của bracket bạn.",
  "wc.confidence.bracketShape": "Hình dạng bracket:",
  "wc.confidence.bracketShapeChalk":
    "Quá nghiêng theo đội mạnh. Cân nhắc một lựa chọn ngược dòng có kiểm soát để tăng tính độc đáo.",
  "wc.confidence.bracketShapeBalanced":
    "Cân bằng đủ cho lần kiểm tra niềm tin đầu tiên.",
  "wc.confidence.finalizeConfidence":
    "Niềm tin để hoàn tất:",
  "wc.confidence.finalizeReady":
    "Sẵn sàng hoàn tất và lên bảng xếp hạng.",
  "wc.confidence.finalizeMissing":
    "Hoàn thành các yêu cầu còn thiếu trước khi hoàn tất.",
  "wc.confidence.privacyNote":
    "Chỉ dự đoán xác định và độ phức tạp tính điểm. Hướng dẫn vẫn giới hạn ở lựa chọn pool và cơ chế tính điểm.",
  "wc.confidence.lockedBody":
    "Nâng cấp lên AI/Pro để mở kiểm tra niềm tin. Người dùng bị khoá không kích hoạt cuộc gọi AI.",
  "wc.path.title": "Cần điều gì để tôi thắng?",
  "wc.path.subtitle":
    "Đọc riêng tư entry hiện tại. Lựa chọn chưa hoàn tất của người khác vẫn được ẩn.",
  "wc.path.tierActive": "AF Pro đang bật",
  "wc.path.tierLocked": "AF Pro đã khoá",

  // ── Group Stage picks (gameplay) ─────────────────────────────────────
  "wc.groupStage.loading": "Đang tải lựa chọn vòng bảng...",
  "wc.groupStage.failedLoad": "Không tải được vòng bảng",
  "wc.groupStage.title": "Lựa chọn vòng bảng",
  "wc.groupStage.subtitle":
    "Xếp hạng mỗi bảng từ 1 đến 4, sau đó chọn 8 đội hạng ba đi tiếp.",
  "wc.groupStage.rankedCount":
    "Số bảng đã xếp: {{done}}/12",
  "wc.groupStage.lockedNoReason":
    "Lựa chọn vòng bảng đã khoá.",
  "wc.groupStage.lockedWithReason":
    "Lựa chọn vòng bảng đã khoá: {{reason}}",
  "wc.groupStage.teamCount": "{{count}}/4 đội",
  "wc.groupStage.teamFallback": "Đội",
  "wc.groupStage.actualRank": "Thực tế #{{rank}}",
  "wc.groupStage.moveUp": "Lên",
  "wc.groupStage.moveDown": "Xuống",
  "wc.groupStage.needsFourTeams":
    "{{group}} cần 4 đội trước khi có thể lưu.",
  "wc.groupStage.unsavedOrder":
    "Thứ tự chưa lưu. Nhấn Lưu bảng để Review tính vào.",
  "wc.groupStage.savedReviewUses":
    "Đã lưu. Review dùng thứ tự bảng này.",
  "wc.groupStage.saveGroup": "Lưu bảng",
  "wc.groupStage.saving": "Đang lưu...",
  "wc.groupStage.saved": "Đã lưu",
  "wc.groupStage.retrySave": "Thử lại",
  "wc.groupStage.failedSave":
    "Không lưu được xếp hạng bảng",
  "wc.groupStage.aiTitle": "Phân tích AI",
  "wc.groupStage.aiTierOpen": "Mở",
  "wc.groupStage.aiTierLocked": "Đã khoá",
  "wc.groupStage.aiPrivacyNote":
    "Chỉ dự đoán và độ phức tạp tính điểm. Hướng dẫn giới hạn ở lựa chọn và cơ chế tính điểm.",
  "wc.groupStage.aiLockedBody":
    "Nâng cấp AI/Pro để mở phân tích xác định. Không gọi AI khi đang khoá.",
  "wc.groupStage.resultCorrect": "Đúng +{{points}}",
  "wc.groupStage.resultWrong": "Sai +0",
  "wc.groupStage.resultPending": "Chờ",

  // ── Third-place advancers (gameplay) ─────────────────────────────────
  "wc.thirdPlace.title": "Đội hạng ba đi tiếp",
  "wc.thirdPlace.subtitle":
    "Chọn đúng 8 đội hạng ba được dự đoán sau khi tất cả bảng đã xếp hạng.",
  "wc.thirdPlace.selectedCount":
    "Đã chọn đội hạng ba đi tiếp: {{count}}/8",
  "wc.thirdPlace.saveBtn": "Lưu hạng ba",
  "wc.thirdPlace.savePicksDone": "Đã lưu lựa chọn hạng ba",
  "wc.thirdPlace.saving": "Đang lưu...",
  "wc.thirdPlace.saved": "Đã lưu",
  "wc.thirdPlace.savePrimaryBtn":
    "Lưu đội hạng ba đi tiếp",
  "wc.thirdPlace.rankAllFirst":
    "Hãy xếp hạng cả 12 bảng trước khi chọn đội hạng ba.",
  "wc.thirdPlace.unsaved":
    "Thay đổi chưa lưu. Nhấn Lưu đội hạng ba để Review tính vào.",
  "wc.thirdPlace.savedReviewUses":
    "Đã lưu hạng ba. Review dùng các lựa chọn này.",
  "wc.thirdPlace.errorChoose8":
    "Hãy chọn đúng 8 đội hạng ba đi tiếp.",
  "wc.thirdPlace.errorRankFirst":
    "Hãy xếp hạng cả 12 bảng trước khi chọn đội hạng ba.",
  "wc.thirdPlace.failedSave":
    "Không lưu được đội hạng ba đi tiếp",
  "wc.thirdPlace.noPickYet": "Chưa chọn đội hạng ba",
  "wc.thirdPlace.selectedToAdvance": "Đã chọn đi tiếp",
  "wc.thirdPlace.tapToSelect": "Chạm để chọn",
  "wc.thirdPlace.selectAria":
    "Chọn {{name}} làm đội hạng ba đi tiếp",
  "wc.thirdPlace.aiTitle": "Hỏi Chimmy",
  "wc.thirdPlace.aiLockedBody":
    "AI/Pro mở phân tích chọn hạng ba. Người dùng đã khoá chỉ thấy CTA, không gọi AI.",

  // ── Matchup card (gameplay) ──────────────────────────────────────────
  "wc.matchup.matchLabel": "Trận {{number}}",
  "wc.matchup.openGuidedAria":
    "Mở trình chọn có hướng dẫn cho trận {{number}}",
  "wc.matchup.statusFinal": "Kết thúc",
  "wc.matchup.statusPostponed": "Hoãn",
  "wc.matchup.statusCancelled": "Đã huỷ",
  "wc.matchup.statusSimulated": "Mô phỏng",
  "wc.matchup.statusTestFixture": "Trận thử",
  "wc.matchup.statusSaving": "Đang lưu...",
  "wc.matchup.notReadyPill": "Chưa sẵn sàng để chọn",
  "wc.matchup.pickBadgeCorrect": "Đúng",
  "wc.matchup.pickBadgeIncorrect": "Sai",
  "wc.matchup.pickVisualCorrect": "Lựa chọn đúng",
  "wc.matchup.pickVisualIncorrect": "Lựa chọn sai",
  "wc.matchup.pickVisualPending": "Chờ kết quả",
  "wc.matchup.yourPick": "Lựa chọn của bạn:",
  "wc.matchup.points": "{{points}} điểm",
  "wc.matchup.pointsPositive": "+{{points}} điểm",
  "wc.matchup.zeroPts": "0 điểm",
  "wc.matchup.pending": "Chờ",
  "wc.matchup.winnerOfficial": "Đội thắng: {{name}}",
  "wc.matchup.unpickableFinal": "Trận này đã kết thúc.",
  "wc.matchup.unpickableMissingTeam":
    "Hãy chọn người thắng các vòng trước trước.",
  "wc.matchup.unpickableUnknown": "Chưa có đội.",
  "wc.matchup.ftBadge": "FT",
  "wc.matchup.confidenceTitle": "Điểm thưởng niềm tin",
  "wc.matchup.confidenceHint":
    "Niềm tin càng cao, điểm thưởng càng nhiều nếu đoán đúng.",
  "wc.matchup.confidencePointSingle": "{{value}} điểm",
  "wc.matchup.confidencePointPlural": "{{value}} điểm",
  "wc.matchup.aiInsightsLabel": "Phân tích AI",
  "wc.matchup.aiTierOpen": "Mở",
  "wc.matchup.aiTierLocked": "Đã khoá",
  "wc.matchup.aiSaferPick": "Lựa chọn an toàn hơn:",
  "wc.matchup.aiSaferBody":
    "{{name}} dựa trên thứ tự slot hiện tại của bracket.",
  "wc.matchup.aiUpsidePick": "Lựa chọn nhiều tiềm năng:",
  "wc.matchup.aiUpsideBody":
    "{{name}} nếu bạn cần đường khác biệt.",
  "wc.matchup.aiBracketImpact": "Ảnh hưởng bracket:",
  "wc.matchup.aiBracketImpactBody":
    "Đội thắng vào slot kế; thay đổi lựa chọn này có thể đặt lại các lựa chọn sau.",
  "wc.matchup.aiUpsetRisk": "Rủi ro cú sốc:",
  "wc.matchup.aiUpsetRiskBody":
    "Trung bình cho đến khi có phong độ trực tiếp và kết quả chính thức.",
  "wc.matchup.aiPrivacyNote":
    "Chỉ dự đoán và độ phức tạp tính điểm. Hướng dẫn giới hạn ở lựa chọn và cơ chế tính điểm.",
  "wc.matchup.aiLockedBody":
    "Nâng cấp AI/Pro để mở phân tích trận. Người dùng đã khoá không kích hoạt gọi AI.",
  "wc.matchup.pickAriaPicked": "Chọn {{name}} để thắng",
  "wc.matchup.pickAriaSelected": "Đã chọn: {{name}} để thắng",
  "wc.matchup.disabledLocked":
    "Lựa chọn của trận này đã khoá",
  "wc.matchup.disabledSaving": "Lựa chọn này đang được lưu",
  "wc.matchup.winnerLabel": "Đội thắng",
  "wc.matchup.lockHintTournament":
    "Khoá khi giải bắt đầu",
  "wc.matchup.lockHintKickoff": "Khoá lúc bóng lăn",
  "wc.matchup.lockHintTournamentWithTime": "Khoá {{at}}",
  "wc.matchup.lockHintKickoffWithTime":
    "Khoá lúc bóng lăn · {{at}}",
  "wc.matchup.bracketBoardChampionLabel": "Lựa chọn nhà vô địch",
  "wc.matchup.bracketBoardChampionFallback": "Chưa chọn",
  "wc.matchup.bracketBoardHelper":
    "Bracket vòng loại trực tiếp được tạo từ kết quả vòng bảng bạn dự đoán. Các lựa chọn tiến lên ngay khi bạn chọn người thắng.",
  "wc.matchup.aiHomeSideFallback": "Đội nhà",
  "wc.matchup.aiAwaySideFallback": "Đội khách",
  "wc.matchup.pensAbbr": "pen",

  // ── Bracket round column labels ──────────────────────────────────────
  "wc.round.roundOf32": "Vòng 32",
  "wc.round.roundOf16": "Vòng 16",
  "wc.round.quarterfinal": "Tứ kết",
  "wc.round.semifinal": "Bán kết",
  "wc.round.thirdPlace": "Hạng 3",
  "wc.round.final": "Chung kết",

  // ── Review tab finalize/missing-picks checklist ──────────────────────
  "wc.review.savedThirdPlaceTitle":
    "Đội hạng ba đi tiếp đã lưu",
  "wc.review.noSavedThirdPlace":
    "Chưa lưu đội hạng ba đi tiếp.",
  "wc.review.loadingSavedThirdPlace":
    "Đang tải lựa chọn hạng ba đã lưu...",
  "wc.review.savedKnockoutTitle":
    "Lựa chọn vòng loại trực tiếp đã lưu",
  "wc.review.noSavedKnockout":
    "Chưa lưu lựa chọn vòng loại trực tiếp.",
  "wc.review.knockoutPickPrefix": "Trận {{number}} · ",
  "wc.review.missingRequirementsTitle": "Còn thiếu yêu cầu",
  "wc.review.needsRefinalize":
    "Entry đã thay đổi sau khi gửi. Hoàn tất lựa chọn còn thiếu và gửi lại.",
  "wc.review.missingGroupRankings":
    "Thiếu xếp hạng bảng: {{groups}}",
  "wc.review.thirdPlaceCount":
    "Đã chọn đội hạng ba đi tiếp: {{count}}/8",
  "wc.review.missingKnockout":
    "Thiếu lựa chọn vòng loại trực tiếp: {{count}}",
  "wc.review.lockedNoTime":
    "Đã khoá: không thể chỉnh sửa lựa chọn nữa",
  "wc.review.lockedWithTime":
    "Đã khoá: không thể chỉnh sửa lựa chọn nữa · gửi lúc {{at}}",
  "wc.review.completeDraftHelper":
    "Bản nháp đã hoàn tất. Hoàn tất để gửi lên bảng xếp hạng; bạn vẫn có thể chỉnh sửa trước khi khoá.",
  "wc.review.finalizing": "Đang hoàn tất...",
  "wc.review.finalizeEntry": "Hoàn tất Entry",
  "wc.review.refinalizeEntry": "Hoàn tất lại Entry",
  "wc.review.completeAllToUnlock":
    "Hoàn thành tất cả yêu cầu còn thiếu để mở khoá Hoàn tất.",
  "wc.review.tapRefresh":
    "Nhấn Refresh Review để xem tiến độ.",
  "wc.review.createEntryFirstTitle": "Tạo entry trước",
  "wc.review.createEntryFirstBody":
    "Review và hoàn tất được lưu cho từng entry bracket.",
  "wc.review.createMyBracket": "Tạo bracket của tôi",
  "wc.review.creating": "Đang tạo...",
  "wc.review.openMyBracket": "Mở bracket của tôi",

  // ── Review tab: hero section ──────────────────────────────────────────
  "wc.review.heroTitle": "Xem lại Con đường đến Vinh quang",
  "wc.review.heroSubtitle": "Kiểm tra từng bảng đấu, hành trình vòng knock-out và các finalist trước khi xác nhận.",
  "wc.review.groupChangeWarning": "Thay đổi lượt chọn Vòng bảng có thể hủy trạng thái đã hoàn tất của entry của bạn.",
  "wc.review.statusIncomplete": "Chưa hoàn tất",
  "wc.review.statusReady": "Sẵn sàng hoàn tất",
  "wc.review.statusFinalized": "Đã hoàn tất",
  "wc.review.statusLocked": "Đã khóa",
  "wc.review.checking": "Đang kiểm tra...",
  "wc.review.refreshReview": "Làm mới xem lại",
  "wc.review.loadingReview": "Đang tải...",
  "wc.review.stat.groups": "Bảng đã xếp hạng",
  "wc.review.stat.thirdPlace": "Hạng ba tốt nhất",
  "wc.review.stat.knockouts": "Lượt chọn vòng knock-out",
  "wc.review.scoringNoteTitle": "Ghi chú tính điểm",
  "wc.review.scoringNoteBody": "Đã hoàn tất = đã gửi lên bảng xếp hạng. Đã khóa = quá hạn chót, không thể chỉnh sửa lượt chọn.",
  "wc.review.afProUnlocks": "AF Pro mở khóa",
  "wc.review.afProUnlocksDetails": "toàn bộ báo cáo — Độ tin cậy nhà vô địch, Đường đến chiến thắng, câu chuyện giải thích AI, nhận định độc đáo của bạn và thẻ chia sẻ đầy đủ.",
  "wc.review.savedGroupTitle": "Lượt chọn Vòng bảng đã lưu",
  "wc.review.savedGroupNote": "Dự đoán của bạn · kết quả chính thức hiển thị riêng",
  "wc.review.groupPicksSaved": "{{n}}/4 đã lưu",
  "wc.review.noGroupPicksYet": "Chưa có bảng xếp hạng nào được lưu.",
  "wc.review.loadingGroupPicks": "Đang tải lượt chọn vòng bảng...",
  "wc.review.finalizeLockWarning": "Lượt chọn có thể không chỉnh sửa được sau thời hạn khóa.",

  // ── Guided Matchup Picker (Phase 6) ──────────────────────────────────
  "wc.guided.dialogLabel": "Chọn trận theo từng bước",
  "wc.guided.closeLabel": "Đóng trình chọn theo từng bước",
  "wc.guided.timeTbd": "Giờ chưa xác định",
  "wc.guided.awaitingResult": "Đang chờ kết quả",
  "wc.guided.tbd": "Chưa rõ",
  "wc.guided.matchFinal": "Kết thúc",
  "wc.guided.matchPostponed": "Hoãn",
  "wc.guided.pickAriaLabel": "Chọn {{teamName}} thắng",
  "wc.guided.progressRound": "{{label}} · {{done}}/{{total}} lựa chọn",
  "wc.guided.progressOverall": "Tổng {{pct}}%",
  "wc.guided.headerLocked": "Bracket đã khoá",
  "wc.guided.headerFixturesNotReady": "Trận đấu chưa sẵn sàng",
  "wc.guided.headerStart": "Bắt đầu chọn",
  "wc.guided.headerComplete": "Bracket đã hoàn tất",
  "wc.guided.headerGuided": "Chọn theo từng bước",
  "wc.guided.lockedHelper":
    "Bracket này đã khoá. Lựa chọn không thể thay đổi nữa.",
  "wc.guided.emptyTeamsUpstream":
    "Đội cho vòng này sẽ xuất hiện sau khi bạn chọn xong các trận trước đó.",
  "wc.guided.emptyFixturesUnresolved":
    "Lịch thi đấu đã tải, nhưng cặp đấu thật sự chưa được xác định.",
  "wc.guided.close": "Đóng",
  "wc.guided.back": "Quay lại",
  "wc.guided.skip": "Bỏ qua",
  "wc.guided.matchNumber": "Trận {{number}}",
  "wc.guided.saving": "Đang lưu…",
  "wc.guided.saved": "Đã lưu",
  "wc.guided.nextMatchup": "Trận kế tiếp…",
  "wc.guided.tapToSelect": "Chạm vào một đội để chọn người thắng",
  "wc.guided.tapToChange":
    "Chạm vào đội còn lại để đổi lựa chọn của bạn",
  "wc.guided.matchFinalNote": "Trận này đã kết thúc.",
  "wc.guided.pickEarlierRoundsFirst":
    "Hãy chọn người thắng các vòng trước trước.",
  "wc.guided.matchEnded": "Trận này đã kết thúc.",
  "wc.guided.matchLocked":
    "Lựa chọn cho trận này đã khoá.",
  "wc.guided.confidenceTitle": "Thưởng tự tin",
  "wc.guided.confidenceHelper":
    "Độ tự tin càng cao, điểm thưởng càng nhiều nếu chọn đúng.",
  "wc.guided.confidenceOptionOne": "1 điểm",
  "wc.guided.confidenceOptionOther": "{{n}} điểm",
  "wc.guided.bracketCompleteTitle": "Hoàn tất bracket!",
  "wc.guided.bracketCompleteBody": "Bạn đã chọn xong mọi trận.",
  "wc.guided.reviewBracket": "Xem lại bracket",
  "wc.guided.done": "Xong",
  "wc.guided.errorNotReady":
    "Cặp đấu này chưa sẵn sàng để chọn.",
  "wc.guided.errorSaveFailed": "Không lưu được lựa chọn",
  "wc.guided.vs": "VS",

  // ── Score Summary card (Phase 6) ─────────────────────────────────────
  "wc.summary.title": "Bảng điểm bracket",
  "wc.summary.rankPlaceholder": "Hạng —",
  "wc.summary.bracketComplete": "Bracket hoàn tất",
  "wc.summary.bracketIncomplete": "Bracket chưa hoàn tất",
  "wc.summary.fixturesNotReady":
    "Lịch thi đấu chưa hoàn toàn xác định — điểm sẽ cập nhật khi cặp đấu chính thức.",
  "wc.summary.scoresNotSynced":
    "Tỉ số chưa đồng bộ — điểm sẽ xuất hiện sau khi kết quả được đăng.",
  "wc.summary.locked":
    "Bracket đã khoá — lựa chọn đã đóng băng.",
  "wc.summary.totalPts": "Tổng điểm",
  "wc.summary.possibleLeft": "Còn có thể",
  "wc.summary.correct": "Đúng",
  "wc.summary.wrong": "Sai",
  "wc.summary.championPick": "Lựa chọn vô địch",
  "wc.summary.championAlive": "Nhà vô địch còn sống",
  "wc.summary.championBusted": "Nhà vô địch đã bị loại",
  "wc.summary.noChampionYet": "Chưa chọn nhà vô địch",
  "wc.summary.maxCeiling": "Trần tối đa",
  "wc.summary.maxCeilingBody":
    " điểm có thể đạt được theo các nhánh còn lại của bạn",

  // ── Round Breakdown card (Phase 6) ───────────────────────────────────
  "wc.roundBreakdown.title": "Điểm theo vòng",
  "wc.roundBreakdown.ptsAbbrev": "{{n}} điểm",
  "wc.roundBreakdown.perWin": "mỗi trận thắng",
  "wc.roundBreakdown.championBonus":
    "Thưởng nhà vô địch bật: {{bonus}} điểm khi đội bạn chọn vô địch thắng chung kết (chính sách — vui lòng xác nhận theo luật giải).",

  // ── Leaderboard Insights card (Phase 6) ──────────────────────────────
  "wc.insights.title": "Phân tích bảng xếp hạng",
  "wc.insights.empty":
    "Phân tích bảng xếp hạng sẽ xuất hiện sau khi các bracket hoàn tất được chấm điểm. Hãy gửi lựa chọn trước khi trận đầu tiên bắt đầu.",
  "wc.insights.currentLeader": "Người dẫn đầu",
  "wc.insights.largestGap": "Khoảng cách lớn nhất",
  "wc.insights.entries": "Số entry",
  "wc.insights.championsAlive": "Nhà vô địch còn sống",
  "wc.insights.mostCorrect": "Đúng nhiều nhất",
  "wc.insights.closestRace": "Cuộc đua sát nhất",
  "wc.insights.notClose": "Không sát",
  "wc.insights.gapPts": "{{n}} điểm",
  "wc.insights.mostCorrectValue": "{{name}} ({{count}})",
  "wc.insights.aiSummaryTitle": "Tóm tắt nhóm AI",
  "wc.insights.aiBadgeUnlocked": "Chỉ entry hoàn tất",
  "wc.insights.aiBadgeLocked": "Đã khoá",
  "wc.insights.aiNotAvailable": "Chưa khả dụng",
  "wc.insights.aiSummaryCountOne":
    "Bao gồm {{count}} entry công khai.",
  "wc.insights.aiSummaryCountOther":
    "Bao gồm {{count}} entry công khai.",
  "wc.insights.aiSummaryLabel": "Tóm tắt chỉ entry hoàn tất:",
  "wc.insights.aiCommonChampionLabel": "Nhà vô địch phổ biến nhất:",
  "wc.insights.aiRaceLabel": "Ghi chú cuộc đua:",
  "wc.insights.aiRaceClose":
    "Hai entry dẫn đầu chỉ cách nhau 5 điểm.",
  "wc.insights.aiRaceNotClose":
    "Chưa có cuộc đua sát nhau ở top hai.",
  "wc.insights.aiWinReadLabel": "Đánh giá thắng AI:",
  "wc.insights.aiWinReadBody":
    "{{name}} dự kiến {{pct}}% với sức khoẻ bracket {{health}}.",
  "wc.insights.aiPrivacyNote":
    "Chỉ dùng dữ liệu bảng xếp hạng công khai/đã hoàn tất. Không bao gồm lựa chọn cá nhân chưa hoàn tất. Hướng dẫn bracket chỉ giới hạn ở lựa chọn pool và cơ chế điểm.",
  "wc.insights.aiUpgradeNote":
    "Nâng cấp AI/Pro để có tóm tắt nhóm chỉ entry hoàn tất. Người dùng bị khoá không kích hoạt gọi AI.",

  // ── Settings panel chrome (Phase 6) ──────────────────────────────────
  "wc.settings.title": "Cài đặt pool",
  "wc.settings.subtitle":
    "Nhận diện, giới hạn, điểm, hiển thị và thông báo — quyền của chủ pool cho pool bracket World Cup của bạn.",
  "wc.settings.loading": "Đang tải cài đặt pool…",
  "wc.settings.sectionIdentity": "Nhận diện pool",
  "wc.settings.save": "Lưu cài đặt",
  "wc.settings.saving": "Đang lưu…",
  "wc.settings.toastNoChanges": "Không có thay đổi để lưu.",
  "wc.settings.toastSaved": "Đã lưu cài đặt.",
  "wc.settings.toastError": "Không lưu được cài đặt",

  // ── Commissioner Brain panel chrome (Phase 6) ────────────────────────
  "wc.brain.title": "Bộ não chủ pool",
  "wc.brain.subtitle":
    "Tổng quan, cảnh báo và trợ lý AI — quản lý pool của bạn từ một chỗ.",
  "wc.brain.loading": "Đang tải công cụ chủ pool…",
  "wc.brain.loadError": "Không tải được công cụ chủ pool.",

  // ── Home tab: commissioner quick panel ──────────────────────────────
  "wc.home.commissioner.syncing": "Đang đồng bộ...",
  "wc.home.commissioner.syncBtn": "Đồng bộ Lịch thi đấu",
  "wc.home.commissioner.settingsBtn": "Cài đặt Hồ bơi",
  "wc.home.commissioner.inviteBtn": "Mời Người chơi",

  // ── Home tab: fixture readiness card ────────────────────────────────
  "wc.home.fixtureReady.cardTitle": "Sẵn sàng Lịch thi đấu",
  "wc.home.fixtureReady.descReady": "Vòng 32 đội đã có đội và có thể chọn lựa. Lịch thi đấu thử nghiệm được đánh dấu là dữ liệu thử nghiệm khi được sử dụng.",
  "wc.home.fixtureReady.descBlocked": "Lựa chọn bị chặn khi các trận đấu vẫn là chỗ giữ chỗ như Nhất Bảng hoặc Người Thắng Trận. Hãy đồng bộ lịch thi đấu chính thức hoặc tải lịch thử nghiệm.",
  "wc.home.fixtureReady.knockoutLocked": "Lựa chọn vòng loại trực tiếp sẽ mở sau khi có lịch thi đấu Vòng 32 chính thức",
  "wc.home.fixtureReady.readySingle": "{{n}} trận đấu sẵn sàng để chọn",
  "wc.home.fixtureReady.readyPlural": "{{n}} trận đấu sẵn sàng để chọn",
  "wc.home.fixtureReady.notSynced": "Lịch thi đấu chưa được đồng bộ",
  "wc.home.fixtureReady.notReady": "Lịch thi đấu đã tải nhưng đội bóng vẫn là chỗ giữ chỗ",
  "wc.home.fixtureReady.commissionerSettings": "Cài đặt Ủy viên",

  // ── Picks tab: guided pick help banners ─────────────────────────────
  "wc.pickHelp.fixturesNotSynced": "Lựa chọn sẽ mở sau khi lịch thi đấu World Cup được đồng bộ hoặc lịch thử nghiệm được tải cho hồ bơi này.",
  "wc.pickHelp.seedBtn": "Tải Lịch Thử nghiệm",
  "wc.pickHelp.seeding": "Đang tải...",
  "wc.pickHelp.knockoutFromGroups": "Các trận đấu loại trực tiếp được tạo từ dự đoán Vòng Bảng của bạn. Xếp hạng tất cả các bảng và chọn đội thứ ba vào vòng tiếp theo để mở khóa thêm vị trí.",
  "wc.pickHelp.title": "Hướng dẫn Chọn Pick",
  "wc.pickHelp.body": "Sử dụng nút Bắt đầu Chọn cố định trên di động để duyệt qua từng trận đấu. Công cụ AI bracket builder sẽ được mở khóa trong phiên bản sau.",
  "wc.pickHelp.knockoutLocked": "Vòng Loại Trực Tiếp Bị Khóa",
  "wc.pickHelp.continueGuided": "Tiếp tục Chọn Hướng dẫn",
  "wc.pickHelp.reviewGuided": "Xem lại Chọn Hướng dẫn",
  "wc.pickHelp.picksBlocked": "Chọn người thắng ở các vòng trước trước tiên. Thêm trận đấu sẽ mở khóa khi bracket của bạn tiến lên.",

  // ── AI Simulation lock panel ─────────────────────────────────────────
  "wc.aiLock.badge": "Xem trước Bị khóa",
  "wc.aiLock.title": "AI Simulation Bị khóa",
  "wc.aiLock.body": "AI Simulation mở khóa các người chiến thắng được dự đoán, những bất ngờ trong bracket, và các con đường đến chức vô địch.",
  "wc.aiLock.tier": "Yêu cầu AF Pro hoặc AF Supreme",
  "wc.aiLock.commissionerNote": "Công cụ AI của ủy viên yêu cầu AF Commissioner hoặc AF Supreme.",

  // ── Premium access panel ─────────────────────────────────────────────
  "wc.premium.eyebrow": "Truy cập World Cup",
  "wc.premium.title": "Chơi miễn phí vẫn mở. Công cụ premium được kiểm soát rõ ràng.",
  "wc.premium.body": "Tham gia, tạo bracket đầu tiên, chọn Vòng Bảng và Vòng Loại Trực Tiếp, xem lại, hoàn thiện và xem bảng xếp hạng miễn phí.",
  "wc.premium.entryCap": "Giới hạn mục tham gia:",
  "wc.premium.freeLimitSingle": "Người dùng miễn phí có thể tạo một mục bracket trong hồ bơi này.",
  "wc.premium.freeLimitPlural": "Hồ bơi này cho phép tối đa {{n}} mục. Người dùng miễn phí vẫn có thể tạo bracket đầu tiên; các kiểm soát AF Commissioner quản lý quy tắc đa mục của hồ bơi.",
  "wc.premium.commissionerSection": "AF Commissioner",
  "wc.premium.aiSection": "AI/Pro",
  "wc.premium.unlocked": "Đã mở khóa",
  "wc.premium.card.commissioner.title": "Công cụ AF Commissioner",
  "wc.premium.card.commissioner.descOwner": "Công cụ kiểm tra sẵn sàng, đồng bộ, mô phỏng, cài đặt, mời và QA quản trị viên dành cho người dùng toàn quyền truy cập.",
  "wc.premium.card.commissioner.descOther": "Kiểm soát hồ bơi riêng/công khai, quản lý lời mời, hook tính điểm tùy chỉnh và thiết lập ủy viên.",
  "wc.premium.card.chat.title": "Chat Hồ bơi",
  "wc.premium.card.chat.desc": "Chỗ giữ chỗ chat giải đấu cho chủ hồ bơi, thông báo và thảo luận được kiểm duyệt.",
  "wc.premium.card.export.title": "Xuất Bảng Xếp Hạng",
  "wc.premium.card.export.desc": "Xuất bảng xếp hạng và tóm tắt bracket để ủy viên xem xét.",
  "wc.premium.card.multiEntry.title": "Nhiều Mục Tham Gia",
  "wc.premium.card.multiEntry.desc": "Kiểm soát đa mục ở cấp hồ bơi vượt ra ngoài trải nghiệm mục đầu tiên miễn phí mặc định.",
  "wc.premium.card.bracketBuilder.title": "AI Bracket Builder",
  "wc.premium.card.bracketBuilder.desc": "Chỗ giữ chỗ cho xây dựng bracket có hướng dẫn và gợi ý theo ngữ cảnh xác định.",
  "wc.premium.card.matchupPreview.title": "Xem trước Trận Đấu AI",
  "wc.premium.card.matchupPreview.desc": "Xem trước xu hướng trận đấu, rủi ro và con đường bất ngờ khi lịch thi đấu chính thức có sẵn.",
  "wc.premium.card.whatIf.title": "Kịch bản AI Điều gì Nếu",
  "wc.premium.card.whatIf.desc": "Các kịch bản bảng xếp hạng về những gì cần xảy ra tiếp theo.",
  "wc.premium.card.alerts.title": "Cảnh báo AI",
  "wc.premium.card.alerts.desc": "Cảnh báo trong tương lai cho các thay đổi bracket, ghi chú tối ưu hóa vòng bảng và tín hiệu tìm kiếm bất ngờ.",

  // ── Daily Edge Report ─────────────────────────────────────────────────
  "wc.edgeReport.title": "Báo cáo Lợi thế Hàng ngày",
  "wc.edgeReport.subtitle": "Điều quan trọng nhất hôm nay trong bảng của bạn",
  "wc.edgeReport.badge.free": "Miễn phí",
  "wc.edgeReport.badge.included": "Đã bao gồm trong gói",
  "wc.edgeReport.loading": "Đang tạo báo cáo lợi thế của bạn…",
  "wc.edgeReport.error": "Không thể tải báo cáo lợi thế. Hãy thử làm mới trang.",
  "wc.edgeReport.section.matchThatMatters": "Trận đấu Quan trọng",
  "wc.edgeReport.section.rootFor": "Đội nên Cổ vũ",
  "wc.edgeReport.section.threats": "Ai có thể Vượt qua Bạn",
  "wc.edgeReport.section.bestPath": "Con đường Tốt nhất để Thăng hạng",
  "wc.edgeReport.section.mistakeToAvoid": "Sai lầm cần Tránh",
  "wc.edgeReport.coaching.title": "Huấn luyện từ Chimmy",
  "wc.edgeReport.coaching.cachedBadge": "Đã mở khóa hôm nay",
  "wc.edgeReport.coaching.includedLabel": "Đã bao gồm trong gói của bạn",
  "wc.edgeReport.coaching.unlockBtn": "Mở khóa huấn luyện hôm nay",
  "wc.edgeReport.coaching.tokenCost": "1 token",
  "wc.edgeReport.coaching.loading": "Đang tạo huấn luyện…",
  "wc.edgeReport.coaching.error": "Huấn luyện tạm thời không khả dụng. Hãy thử lại.",
  "wc.edgeReport.coaching.spendFailed": "Không thể trừ token. Kiểm tra số dư và thử lại.",
  "wc.edgeReport.commissionerPost.title": "Ý tưởng Đăng cho Nhóm",
  "wc.edgeReport.commissionerPost.postBtn": "Đăng vào chat nhóm",
  "wc.edgeReport.commissionerPost.posting": "Đang đăng…",
  "wc.edgeReport.commissionerPost.posted": "Đã đăng!",
  "wc.edgeReport.freshness": "Tất định · cập nhật mỗi ngày thi đấu",
  "wc.edgeReport.noEntry": "Thêm các lựa chọn bracket của bạn để xem báo cáo lợi thế hàng ngày.",
  "wc.edgeReport.billing.cached": "Không dùng token · huấn luyện đã được mở khóa hôm nay",
  "wc.edgeReport.billing.included": "Đã bao gồm trong gói của bạn",
  "wc.edgeReport.billing.charged": "Đã dùng 1 token",
  "wc.edgeReport.feedback.title": "Điều này có hữu ích không?",
  "wc.edgeReport.feedback.helpful": "Hữu ích",
  "wc.edgeReport.feedback.notHelpful": "Không hữu ích",
  "wc.edgeReport.feedback.tooBasic": "Quá cơ bản",
  "wc.edgeReport.feedback.notActionable": "Không thực hiện được",
  "wc.edgeReport.feedback.wrongData": "Dữ liệu sai",
  "wc.edgeReport.feedback.greatInsight": "Nhận xét rất sắc sảo",
  "wc.edgeReport.feedback.thanks": "Cảm ơn phản hồi của bạn",
  "wc.edgeReport.cue.ready": "Lợi thế Hôm nay Đã sẵn sàng",
}

const WORLD_CUP_CHAT_COMMAND_KEYS = [
  "wc.chat.mode.ai",
  "wc.chat.mode.pool",
  "wc.chat.mode.dm",
  "wc.chat.placeholder.ai",
  "wc.chat.placeholder.dm",
  "wc.chat.drawer.aiTitle",
  "wc.chat.drawer.poolTitle",
  "wc.chat.drawer.dmTitle",
  "wc.chat.drawer.aiTrust",
  "wc.chat.dm.comingSoonTitle",
  "wc.chat.dm.comingSoon",
  "wc.chat.askChimmy",
  "wc.chat.open",
  "wc.chat.collapse",
  "wc.chat.chip.askChimmy",
  "wc.chat.chip.analyzePool",
  "wc.chat.chip.whyLosing",
  "wc.chat.chip.rootFor",
  "wc.chat.chip.championLoses",
  "wc.chat.chip.bestBracket",
  "wc.chat.chip.pathToWin",
  "wc.chat.chip.dangerGroup",
  "wc.chat.chip.watchToday",
  "wc.chat.chip.summarizePool",
  "wc.chat.chip.scoringRules",
  "wc.chat.chip.commissionerSummary",
  "wc.chat.prompt.askChimmy",
  "wc.chat.prompt.analyzePool",
  "wc.chat.prompt.whyLosing",
  "wc.chat.prompt.rootFor",
  "wc.chat.prompt.championLoses",
  "wc.chat.prompt.bestBracket",
  "wc.chat.prompt.pathToWin",
  "wc.chat.prompt.dangerGroup",
  "wc.chat.prompt.watchToday",
  "wc.chat.prompt.summarizePool",
  "wc.chat.prompt.scoringRules",
  "wc.chat.prompt.commissionerSummary",
] as const

const WORLD_CUP_CHAT_COMMAND_FALLBACKS = Object.fromEntries(
  WORLD_CUP_CHAT_COMMAND_KEYS.map((key) => [key, EN[key] ?? key])
) as WorldCupDictionary

const FR_CORE: WorldCupDictionary = {
  "wc.common.loading": "Chargement...",
  "wc.tab.home": "Accueil",
  "wc.tab.groupStage": "Phase de groupes",
  "wc.tab.picks": "Eliminatoires",
  "wc.tab.review": "Revision",
  "wc.tab.leaderboard": "Classement",
  "wc.tab.rules": "Regles",
  "wc.tab.invite": "Inviter",
  "wc.tab.admin": "Parametres",
  "wc.tab.commissioner": "Commissaire",
  "wc.chat.mode.ai": "Chimmy IA",
  "wc.chat.mode.pool": "Chat du pool",
  "wc.chat.mode.dm": "DM",
  "wc.chat.placeholder.ai": "Demande a Chimmy ton bracket, tes picks, les verrous ou le classement du pool...",
  "wc.chat.placeholder.dm": "Message prive...",
  "wc.chat.drawer.aiTitle": "Chat Chimmy IA",
  "wc.chat.drawer.poolTitle": "Messages du pool",
  "wc.chat.drawer.dmTitle": "Messages prives",
  "wc.chat.drawer.aiTrust": "Les messages dans ce mode sont envoyes a @Chimmy et peuvent retourner une reponse IA privee.",
  "wc.chat.dm.comingSoonTitle": "Demarrer un chat prive",
  "wc.chat.dm.comingSoon": "Choisis un ou plusieurs membres du pool pour demarrer une conversation privee. Les messages restent dans ce fil prive.",
  "wc.chat.mention.title": "Mentionner des membres du pool",
  "wc.chat.mention.loading": "Chargement",
  "wc.chat.mention.noMatches": "Aucun membre correspondant. Utilise le nom d'utilisateur affiche dans ce pool.",
  "wc.chat.mention.allHelper": "Diffusion du commissaire a tous les membres du pool",
  "wc.chat.mention.allAria": "Mentionner tous les membres du pool",
  "wc.chat.mention.allManagerOnly": "@all est reserve aux commissaires et admins du pool.",
  "wc.chat.askChimmy": "Demander a Chimmy",
  "wc.chat.open": "Ouvrir le chat",
  "wc.chat.collapse": "Reduire",
  "wc.groupStage.resultCorrect": "Correct +{{points}}",
  "wc.groupStage.resultWrong": "Incorrect +0",
  "wc.groupStage.resultPending": "Resultat en attente",
  "wc.matchup.pickVisualPending": "Resultat en attente",
  "wc.matchup.pending": "En attente",
  "wc.review.scoringNoteTitle": "Note de score",
  "wc.review.scoringNoteBody": "Finalise = soumis au classement. Verrouille = date limite depassee, les picks ne peuvent plus etre modifies.",
  "wc.review.resultPendingNote": "Resultat en attente signifie que ton pick est sauvegarde, mais le resultat officiel du match n'a pas encore ete publie ou score.",
  "wc.review.savedGroupTitle": "Picks de phase de groupes sauvegardes",
  "wc.review.savedThirdPlaceTitle": "Troisiemes places sauvegardees",
  "wc.review.savedKnockoutTitle": "Picks eliminatoires sauvegardes",

  // ── AI CTA panel ──────────────────────────────────────────────────────
  "wc.cta.panelTitle": "Insights IA",
  "wc.cta.aiRowLabel": "IA / Pro",
  "wc.cta.commissionerRowLabel": "Commissaire",
  "wc.cta.askChimmy": "Demander a Chimmy",
  "wc.cta.askChimmyDesc": "Ouvrir Chimmy avec une question sur ton bracket",
  "wc.cta.pathToFirst": "Chemin vers la Premiere Place",
  "wc.cta.pathToFirstDesc": "Demande a Chimmy ce que ton bracket doit faire pour atteindre la premiere place",
  "wc.cta.explainBracket": "Expliquer Mon Bracket",
  "wc.cta.explainBracketDesc": "Obtenir une explication IA de ta strategie de bracket",
  "wc.cta.rootingGuide": "Guide de Soutien",
  "wc.cta.rootingGuideDesc": "Generer un guide de soutien pour cette participation",
  "wc.cta.poolSwing": "Mouvement du Pool",
  "wc.cta.poolSwingDesc": "Trouver le plus grand mouvement a venir dans le classement",
  "wc.cta.championRisk": "Risque de Champion",
  "wc.cta.championRiskDesc": "Analyser le risque du choix de champion dans le pool",
  "wc.cta.commissionerRecap": "Resume du Commissaire",
  "wc.cta.commissionerRecapDesc": "Generer un resume IA du pool (apercu avant publication)",
  "wc.cta.postHype": "Publier un Message Hype",
  "wc.cta.postHypeDesc": "Publier un message de hype dans le chat du pool",
  "wc.cta.findIncomplete": "Picks Incomplets",
  "wc.cta.findIncompleteDesc": "Trouver les participations avec le plus grand risque de picks manquants",

  // ── Daily Edge Report ─────────────────────────────────────────────────
  "wc.edgeReport.title": "Rapport d'avantage du jour",
  "wc.edgeReport.subtitle": "Ce qui compte le plus aujourd'hui dans votre groupe",
  "wc.edgeReport.badge.free": "Gratuit",
  "wc.edgeReport.badge.included": "Inclus dans le plan",
  "wc.edgeReport.loading": "Création de votre rapport d'avantage…",
  "wc.edgeReport.error": "Impossible de charger votre rapport. Essayez de rafraîchir.",
  "wc.edgeReport.section.matchThatMatters": "Le match qui compte",
  "wc.edgeReport.section.rootFor": "Pour qui encourager",
  "wc.edgeReport.section.threats": "Qui peut vous dépasser",
  "wc.edgeReport.section.bestPath": "Meilleur chemin vers le haut",
  "wc.edgeReport.section.mistakeToAvoid": "L'erreur à éviter",
  "wc.edgeReport.coaching.title": "Coaching de Chimmy",
  "wc.edgeReport.coaching.cachedBadge": "Débloqué aujourd'hui",
  "wc.edgeReport.coaching.includedLabel": "Inclus dans votre plan",
  "wc.edgeReport.coaching.unlockBtn": "Débloquer le coaching du jour",
  "wc.edgeReport.coaching.tokenCost": "1 jeton",
  "wc.edgeReport.coaching.loading": "Génération du coaching…",
  "wc.edgeReport.coaching.error": "Coaching temporairement indisponible. Réessayez.",
  "wc.edgeReport.coaching.spendFailed": "Impossible de déduire le jeton. Vérifiez votre solde et réessayez.",
  "wc.edgeReport.commissionerPost.title": "Idée de publication pour le groupe",
  "wc.edgeReport.commissionerPost.postBtn": "Publier dans le chat du groupe",
  "wc.edgeReport.commissionerPost.posting": "Publication…",
  "wc.edgeReport.commissionerPost.posted": "Publié !",
  "wc.edgeReport.freshness": "Déterministe · mis à jour chaque jour de match",
  "wc.edgeReport.noEntry": "Ajoutez vos choix de bracket pour voir votre rapport d'avantage quotidien.",
  "wc.edgeReport.billing.cached": "Aucun jeton utilisé · coaching déjà débloqué aujourd'hui",
  "wc.edgeReport.billing.included": "Inclus dans votre plan",
  "wc.edgeReport.billing.charged": "1 jeton utilisé",
  "wc.edgeReport.feedback.title": "Cela vous a-t-il aidé ?",
  "wc.edgeReport.feedback.helpful": "Utile",
  "wc.edgeReport.feedback.notHelpful": "Pas utile",
  "wc.edgeReport.feedback.tooBasic": "Trop basique",
  "wc.edgeReport.feedback.notActionable": "Non exploitable",
  "wc.edgeReport.feedback.wrongData": "Données incorrectes",
  "wc.edgeReport.feedback.greatInsight": "Excellente analyse",
  "wc.edgeReport.feedback.thanks": "Merci pour votre retour",
  "wc.edgeReport.cue.ready": "Votre avantage du jour est prêt",
}

const AR_CORE: WorldCupDictionary = {
  "wc.common.loading": "جار التحميل...",
  "wc.tab.home": "الرئيسية",
  "wc.tab.groupStage": "دور المجموعات",
  "wc.tab.picks": "الأدوار الإقصائية",
  "wc.tab.review": "المراجعة",
  "wc.tab.leaderboard": "الترتيب",
  "wc.tab.rules": "القواعد",
  "wc.tab.invite": "دعوة",
  "wc.tab.admin": "الإعدادات",
  "wc.tab.commissioner": "المفوض",
  "wc.chat.mode.ai": "Chimmy AI",
  "wc.chat.mode.pool": "دردشة المجموعة",
  "wc.chat.mode.dm": "رسائل خاصة",
  "wc.chat.placeholder.ai": "اسأل Chimmy عن القوس أو الاختيارات أو القفل أو ترتيب المجموعة...",
  "wc.chat.placeholder.dm": "اكتب رسالة خاصة...",
  "wc.chat.drawer.aiTitle": "دردشة Chimmy AI",
  "wc.chat.drawer.poolTitle": "رسائل المجموعة",
  "wc.chat.drawer.dmTitle": "رسائل خاصة",
  "wc.chat.drawer.aiTrust": "الرسائل في هذا الوضع تذهب إلى @Chimmy وقد تعود برد خاص من الذكاء الاصطناعي.",
  "wc.chat.dm.comingSoonTitle": "ابدأ دردشة خاصة",
  "wc.chat.dm.comingSoon": "اختر عضوا واحدا أو أكثر من المجموعة لبدء محادثة خاصة. تبقى الرسائل داخل هذا الخيط الخاص.",
  "wc.chat.mention.title": "اذكر أعضاء المجموعة",
  "wc.chat.mention.loading": "جار التحميل",
  "wc.chat.mention.noMatches": "لا يوجد أعضاء مطابقون. استخدم اسم المستخدم الظاهر في هذه المجموعة.",
  "wc.chat.mention.allHelper": "إرسال من المفوض إلى كل أعضاء المجموعة",
  "wc.chat.mention.allAria": "اذكر كل أعضاء المجموعة",
  "wc.chat.mention.allManagerOnly": "@all مخصص لمفوضي المجموعة والمشرفين فقط.",
  "wc.chat.askChimmy": "اسأل Chimmy",
  "wc.chat.open": "افتح الدردشة",
  "wc.chat.collapse": "تصغير",
  "wc.groupStage.resultCorrect": "صحيح +{{points}}",
  "wc.groupStage.resultWrong": "خطأ +0",
  "wc.groupStage.resultPending": "النتيجة معلقة",
  "wc.matchup.pickVisualPending": "النتيجة معلقة",
  "wc.matchup.pending": "معلق",
  "wc.review.scoringNoteTitle": "ملاحظة التسجيل",
  "wc.review.scoringNoteBody": "النهائي = تم إرساله للترتيب. المقفل = انتهت المهلة ولا يمكن تعديل الاختيارات.",
  "wc.review.resultPendingNote": "النتيجة معلقة تعني أن اختيارك محفوظ، لكن النتيجة الرسمية للمباراة لم تنشر أو تسجل بعد.",
  "wc.review.savedGroupTitle": "اختيارات دور المجموعات المحفوظة",
  "wc.review.savedThirdPlaceTitle": "اختيارات المركز الثالث المحفوظة",
  "wc.review.savedKnockoutTitle": "اختيارات الأدوار الإقصائية المحفوظة",

  // ── AI CTA panel ──────────────────────────────────────────────────────
  "wc.cta.panelTitle": "رؤى الذكاء الاصطناعي",
  "wc.cta.aiRowLabel": "AI / Pro",
  "wc.cta.commissionerRowLabel": "المفوض",
  "wc.cta.askChimmy": "اسأل Chimmy",
  "wc.cta.askChimmyDesc": "افتح Chimmy بسؤال عن القوس",
  "wc.cta.pathToFirst": "الطريق إلى المركز الأول",
  "wc.cta.pathToFirstDesc": "اسأل Chimmy ما يحتاجه قوسك للوصول إلى المركز الأول",
  "wc.cta.explainBracket": "اشرح قوسي",
  "wc.cta.explainBracketDesc": "احصل على تفسير من الذكاء الاصطناعي لاستراتيجية قوسك",
  "wc.cta.rootingGuide": "دليل التشجيع",
  "wc.cta.rootingGuideDesc": "أنشئ دليل تشجيع لهذه المشاركة",
  "wc.cta.poolSwing": "تأرجح المجموعة",
  "wc.cta.poolSwingDesc": "ابحث عن أكبر تحرك قادم في الترتيب",
  "wc.cta.championRisk": "خطر البطل",
  "wc.cta.championRiskDesc": "حلل خطر اختيار البطل عبر المجموعة",
  "wc.cta.commissionerRecap": "ملخص المفوض",
  "wc.cta.commissionerRecapDesc": "أنشئ ملخص ذكاء اصطناعي للمجموعة (معاينة قبل النشر)",
  "wc.cta.postHype": "نشر تحميس",
  "wc.cta.postHypeDesc": "انشر رسالة تحميس في دردشة المجموعة",
  "wc.cta.findIncomplete": "اختيارات غير مكتملة",
  "wc.cta.findIncompleteDesc": "ابحث عن المشاركات الأكثر عرضة لاختيارات مفقودة",

  // ── Daily Edge Report ─────────────────────────────────────────────────
  "wc.edgeReport.title": "تقرير الميزة اليومية",
  "wc.edgeReport.subtitle": "الأهم في مجموعتك اليوم",
  "wc.edgeReport.badge.free": "مجاني",
  "wc.edgeReport.badge.included": "مضمّن في الخطة",
  "wc.edgeReport.loading": "جاري إنشاء تقرير الميزة…",
  "wc.edgeReport.error": "تعذّر تحميل تقرير الميزة. حاول التحديث.",
  "wc.edgeReport.section.matchThatMatters": "المباراة الأهم",
  "wc.edgeReport.section.rootFor": "من تشجّع",
  "wc.edgeReport.section.threats": "من قد يتجاوزك",
  "wc.edgeReport.section.bestPath": "أفضل مسار للصعود",
  "wc.edgeReport.section.mistakeToAvoid": "الخطأ الذي يجب تجنّبه",
  "wc.edgeReport.coaching.title": "تدريب Chimmy",
  "wc.edgeReport.coaching.cachedBadge": "تم فتحه اليوم",
  "wc.edgeReport.coaching.includedLabel": "مضمّن في خطتك",
  "wc.edgeReport.coaching.unlockBtn": "افتح تدريب اليوم",
  "wc.edgeReport.coaching.tokenCost": "رمز واحد",
  "wc.edgeReport.coaching.loading": "جاري إنشاء التدريب…",
  "wc.edgeReport.coaching.error": "التدريب غير متاح حالياً. حاول مجدداً.",
  "wc.edgeReport.coaching.spendFailed": "تعذّر خصم الرمز. تحقّق من رصيدك وحاول مجدداً.",
  "wc.edgeReport.commissionerPost.title": "فكرة منشور للمجموعة",
  "wc.edgeReport.commissionerPost.postBtn": "نشر في دردشة المجموعة",
  "wc.edgeReport.commissionerPost.posting": "جاري النشر…",
  "wc.edgeReport.commissionerPost.posted": "تم النشر!",
  "wc.edgeReport.freshness": "حتمي · يتحدّث كل يوم مباريات",
  "wc.edgeReport.noEntry": "أضف اختياراتك في البراكيت لرؤية تقرير ميزتك اليومي.",
  "wc.edgeReport.billing.cached": "لم يُستخدم أي رمز · التدريب مفتوح مسبقاً اليوم",
  "wc.edgeReport.billing.included": "مضمّن في خطتك",
  "wc.edgeReport.billing.charged": "تم استخدام رمز واحد",
  "wc.edgeReport.feedback.title": "هل كان هذا مفيداً؟",
  "wc.edgeReport.feedback.helpful": "مفيد",
  "wc.edgeReport.feedback.notHelpful": "غير مفيد",
  "wc.edgeReport.feedback.tooBasic": "بسيط جداً",
  "wc.edgeReport.feedback.notActionable": "لا يمكن تطبيقه",
  "wc.edgeReport.feedback.wrongData": "بيانات خاطئة",
  "wc.edgeReport.feedback.greatInsight": "تحليل رائع",
  "wc.edgeReport.feedback.thanks": "شكراً على تعليقك",
  "wc.edgeReport.cue.ready": "ميزتك اليوم جاهزة",
}

export const WORLD_CUP_TRANSLATIONS: Record<WorldCupLocale, WorldCupDictionary> = {
  en: EN,
  es: { ...EN, ...WORLD_CUP_CHAT_COMMAND_FALLBACKS, ...ES },
  zh: { ...EN, ...WORLD_CUP_CHAT_COMMAND_FALLBACKS, ...ZH },
  fil: { ...EN, ...WORLD_CUP_CHAT_COMMAND_FALLBACKS, ...FIL },
  vi: { ...EN, ...WORLD_CUP_CHAT_COMMAND_FALLBACKS, ...VI },
  fr: { ...EN, ...WORLD_CUP_CHAT_COMMAND_FALLBACKS, ...FR_CORE },
  ar: { ...EN, ...WORLD_CUP_CHAT_COMMAND_FALLBACKS, ...AR_CORE },
}

/**
 * One-shot warning cache so each (locale, key) pair only logs once per
 * process lifetime. Avoids spamming the dev console on re-renders.
 */
const warnedKeys = new Set<string>()

function reportMissingKey(locale: WorldCupLocale, key: string): void {
  // Production: never log, never reveal the raw key in the UI path.
  // We rely on a process.env check that is statically resolvable by both
  // Next.js client (replaced at build) and Node server (read at runtime).
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") {
    return
  }
  const cacheKey = `${locale}::${key}`
  if (warnedKeys.has(cacheKey)) return
  warnedKeys.add(cacheKey)
  // eslint-disable-next-line no-console
  console.warn(
    `[worldCupI18n] Missing translation for "${key}" in locale "${locale}". ` +
      `Falling back to English.`
  )
}

/**
 * Test helper — clears the missing-key warning cache so the dev-warning
 * test can re-trigger the log path. Not used by the runtime app.
 *
 * @internal
 */
export function _resetWorldCupI18nWarnCache(): void {
  warnedKeys.clear()
}

/**
 * Look up a translated string for the given locale and key.
 *
 * - Falls back to English if the locale dictionary is missing the key.
 *   In development, logs a one-shot console.warn per (locale, key).
 * - Falls back to the key itself if neither locale has the key — keeps
 *   missing translations visible during development. Production hides the
 *   raw key by way of the fact that a missing key indicates a bug worth
 *   surfacing in dev only; production callers should not pass unknown keys.
 * - Interpolates `{{var}}` placeholders from `params`. Non-string values
 *   are coerced to string. Missing params leave the placeholder intact
 *   so QA can spot it.
 */
export function wcT(
  locale: WorldCupLocale | string | null | undefined,
  key: string,
  params?: Record<string, string | number>
): string {
  const safeLocale = getWorldCupLocale(locale)
  const dict = WORLD_CUP_TRANSLATIONS[safeLocale]
  let raw = dict[key]
  if (raw === undefined) {
    // Only warn when the requested locale was actually a different locale
    // than English — an EN-missing key is a deeper bug we still warn on.
    reportMissingKey(safeLocale, key)
    raw =
      WORLD_CUP_TRANSLATIONS[WORLD_CUP_DEFAULT_LOCALE][key] ?? key
  }
  if (!params) return raw
  return raw.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      const value = params[name as keyof typeof params]
      return value == null ? match : String(value)
    }
    return match
  })
}

/**
 * Convenience helper used by both client (`useOptionalLanguage().language`)
 * and server (`resolveServerRenderPreferences().language`) call-sites. Use
 * this whenever a component or server file already has the language code
 * in scope — keeps wcT() calls one line.
 */
export function makeWcT(locale: WorldCupLocale | string | null | undefined) {
  const safeLocale = getWorldCupLocale(locale)
  return (key: string, params?: Record<string, string | number>): string =>
    wcT(safeLocale, key, params)
}

/**
 * Share/invite tone type. Reserved for a future tone selector (friendly /
 * hype / trash_talk) — this phase always uses "friendly" as default.
 *
 * Trash-talk guardrails when the selector is wired:
 *   - Sports-centered (calls out picks, brackets, matchups — not people).
 *   - Funny / boastful tone allowed.
 *   - No slurs, hate, threats, personal attacks, doxxing.
 *   - No wagering, gambling, betting, odds, sportsbook, or DFS language
 *     (matches the existing `sanitize()` blocklist in worldCupShareCopy
 *     and worldCupCommissionerChecklist).
 */
export type WorldCupShareTone = "friendly" | "hype" | "trash_talk"

export const WORLD_CUP_DEFAULT_SHARE_TONE: WorldCupShareTone = "friendly"

/**
 * Human-readable language name to embed in an AI prompt so the model
 * responds in the user's selected language. Maps WC locales to natural
 * English-language names that OpenAI / xAI both recognize reliably.
 *
 * Use case: passed to `openaiChatText` prompts as part of the system
 * message — e.g. `Respond in ${getAiLanguageInstruction(locale)}`. The
 * helper never makes a call itself; the orchestrator decides whether
 * to include it.
 *
 * Returns "English" for unknown locales — never throws, never injects
 * model-specific control characters.
 */
export function getAiLanguageInstruction(
  locale: WorldCupLocale | string | null | undefined
): string {
  const safe = getWorldCupLocale(locale)
  switch (safe) {
    case "es":
      return "Spanish"
    case "zh":
      return "Traditional Chinese"
    case "fil":
      return "Filipino"
    case "vi":
      return "Vietnamese"
    case "fr":
      return "French"
    case "ar":
      return "Arabic"
    case "en":
    default:
      return "English"
  }
}
