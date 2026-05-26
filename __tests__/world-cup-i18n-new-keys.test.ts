/**
 * Verifies that every new i18n key added in the World Cup UX Truth Audit
 * (subnav labels, mobile short-labels, home tab strings, AI teaser) is
 * present and non-empty in all five supported locales.
 *
 * Guards against missing-translation regressions where a key was added to
 * the EN dict but not the others.
 */
import { describe, expect, it } from "vitest"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"

const LOCALES = ["en", "es", "zh", "fil", "vi"] as const

const NEW_KEYS = [
  // Sticky subnav
  "wc.subnav.top",
  "wc.subnav.roundOf32",
  "wc.subnav.adminTest",
  // MatchupCard i18n fixes (Goal 11 Batch 3)
  "wc.matchup.aiHomeSideFallback",
  "wc.matchup.aiAwaySideFallback",
  "wc.matchup.pensAbbr",
  // Bracket round column labels (Goal 11)
  "wc.round.roundOf32",
  "wc.round.roundOf16",
  "wc.round.quarterfinal",
  "wc.round.semifinal",
  "wc.round.thirdPlace",
  "wc.round.final",
  // Mobile bottom nav short labels (original 3)
  "wc.tab.leaderboard.short",
  "wc.tab.commissioner.short",
  "wc.tab.settings.short",
  // Mobile bottom nav short labels (Goal 10 — all tabs)
  "wc.tab.home.short",
  "wc.tab.groupStage.short",
  "wc.tab.picks.short",
  "wc.tab.review.short",
  "wc.tab.rules.short",
  "wc.tab.invite.short",
  "wc.tab.admin.short",
  // Rules tab — hero
  "wc.rules.hero.eyebrow",
  "wc.rules.hero.title",
  "wc.rules.hero.subtitle",
  // Rules tab — how it works
  "wc.rules.how.title",
  "wc.rules.how.body1",
  "wc.rules.how.body2",
  // Rules tab — scoring
  "wc.rules.scoring.title",
  "wc.rules.scoring.roundOf32",
  "wc.rules.scoring.roundOf16",
  "wc.rules.scoring.quarterfinal",
  "wc.rules.scoring.semifinal",
  "wc.rules.scoring.final",
  "wc.rules.scoring.champion",
  "wc.rules.scoring.thirdPlace",
  "wc.rules.scoring.pts",
  // Rules tab — pool settings
  "wc.rules.settings.title",
  "wc.rules.settings.bracketsPerUser",
  "wc.rules.settings.thirdPlace",
  "wc.rules.settings.thirdPlaceOn",
  "wc.rules.settings.thirdPlaceOff",
  "wc.rules.settings.inviteSharing",
  "wc.rules.settings.inviteCommish",
  // Rules tab — trust note
  "wc.rules.trustNote",
  // Home tab — main card
  "wc.home.title",
  "wc.home.copyInvite",
  "wc.home.invitePanel",
  // Home tab — stat cards
  "wc.home.stat.participants",
  "wc.home.stat.entries",
  "wc.home.stat.finalized",
  "wc.home.stat.fixtureStatus",
  "wc.home.stat.ready",
  "wc.home.stat.notReady",
  // Home tab — entries section
  "wc.home.entries.title",
  "wc.home.entries.loading",
  // Home tab — AI features teaser
  "wc.home.ai.title",
  "wc.home.ai.chimmyHint",
  "wc.home.ai.explainHint",
  "wc.home.ai.unlockHint",
  // v2 command center — hero
  "wc.publicHub.commandEyebrow",
  "wc.publicHub.commandTitle",
  "wc.publicHub.commandSubtitle",
  "wc.publicHub.trustNote",
  // v2 command center — stats strip
  "wc.publicHub.stat.teams",
  "wc.publicHub.stat.groups",
  "wc.publicHub.stat.matches",
  "wc.publicHub.stat.format",
  // v2 command center — action cards
  "wc.publicHub.actionsTitle",
  "wc.publicHub.action.create.title",
  "wc.publicHub.action.create.desc",
  "wc.publicHub.action.join.title",
  "wc.publicHub.action.join.desc",
  "wc.publicHub.action.discover.title",
  "wc.publicHub.action.discover.desc",
  // v2 command center — how it works
  "wc.publicHub.how.title",
  "wc.publicHub.how.step1Title",
  "wc.publicHub.how.step1Body",
  "wc.publicHub.how.step2Title",
  "wc.publicHub.how.step2Body",
  "wc.publicHub.how.step3Title",
  "wc.publicHub.how.step3Body",
  "wc.publicHub.how.step4Title",
  "wc.publicHub.how.step4Body",
  // v2 command center — AI advantage
  "wc.publicHub.ai.title",
  "wc.publicHub.ai.subtitle",
  "wc.publicHub.ai.explain.title",
  "wc.publicHub.ai.explain.desc",
  "wc.publicHub.ai.danger.title",
  "wc.publicHub.ai.danger.desc",
  "wc.publicHub.ai.chat.title",
  "wc.publicHub.ai.chat.desc",
  "wc.publicHub.ai.commissioner.title",
  "wc.publicHub.ai.commissioner.desc",
  "wc.publicHub.ai.gating",
  // v2 command center — social / invite
  "wc.publicHub.social.title",
  "wc.publicHub.social.desc",
  "wc.publicHub.social.cta",
  // v2 command center — trust banner
  "wc.publicHub.trust.note",
  // Pool dashboard — command hero
  "wc.pool.eyebrow",
  "wc.pool.privateBadge",
  "wc.pool.publicBadge",
  // Pool dashboard — what to do next card
  "wc.pool.next.title",
  "wc.pool.next.create.title",
  "wc.pool.next.create.body",
  "wc.pool.next.picks.title",
  "wc.pool.next.picks.body",
  "wc.pool.next.review.title",
  "wc.pool.next.review.body",
  "wc.pool.next.done.title",
  "wc.pool.next.done.body",
  "wc.pool.next.waiting.title",
  "wc.pool.next.waiting.body",
  // Pool dashboard — progress strip
  "wc.pool.progress.title",
  "wc.pool.progress.created",
  "wc.pool.progress.picks",
  "wc.pool.progress.finalized",
  // Pool dashboard — commissioner panel
  "wc.pool.commissioner.title",
  // Pool dashboard — leaderboard preview
  "wc.pool.leaderboard.title",
  "wc.pool.leaderboard.empty",
  "wc.pool.leaderboard.emptyNote",
  "wc.pool.leaderboard.viewFull",
  // Review tab — hero section
  "wc.review.heroTitle",
  "wc.review.heroSubtitle",
  "wc.review.groupChangeWarning",
  "wc.review.statusIncomplete",
  "wc.review.statusReady",
  "wc.review.statusFinalized",
  "wc.review.statusLocked",
  "wc.review.checking",
  "wc.review.refreshReview",
  "wc.review.loadingReview",
  // Review tab — stat cards
  "wc.review.stat.groups",
  "wc.review.stat.thirdPlace",
  "wc.review.stat.knockouts",
  // Review tab — scoring note
  "wc.review.scoringNoteTitle",
  "wc.review.scoringNoteBody",
  // Review tab — AF Pro banner
  "wc.review.afProUnlocks",
  "wc.review.afProUnlocksDetails",
  // Review tab — saved picks
  "wc.review.savedGroupTitle",
  "wc.review.savedGroupNote",
  "wc.review.groupPicksSaved",
  "wc.review.noGroupPicksYet",
  "wc.review.loadingGroupPicks",
  // Review tab — finalize area
  "wc.review.finalizeLockWarning",
  // Finalize success block
  "wc.finalize.viewLeaderboard",
  "wc.finalize.openChat",
  "wc.finalize.challengeTitle",
  "wc.finalize.challengeDesc",
  "wc.finalize.trustNote",
  // Leaderboard tab visual upgrade
  "wc.lb.eyebrow",
  "wc.lb.title",
  "wc.lb.heroSubtitle",
  "wc.lb.statusPreTournament",
  "wc.lb.statusLive",
  "wc.lb.statusWaiting",
  "wc.lb.subtitleBase",
  "wc.lb.lastUpdated",
  "wc.lb.notYetSynced",
  "wc.lb.testMode",
  "wc.lb.recalculate",
  "wc.lb.autoUpdate",
  "wc.lb.scoresNotSynced",
  "wc.lb.fixturesNotReady",
  "wc.lb.podiumTitle",
  "wc.lb.yourRank",
  "wc.lb.yourRankTagline",
  "wc.lb.gapToFirst",
  "wc.lb.isLeader",
  "wc.lb.tied",
  "wc.lb.viewMyBracket",
  "wc.lb.noEntryTitle",
  "wc.lb.noEntryBody",
  "wc.lb.startMyBracket",
  "wc.lb.emptyTitle",
  "wc.lb.emptyBody",
  "wc.lb.emptyInvite",
  "wc.lb.emptyReview",
  "wc.lb.scoringTitle",
  "wc.lb.scoringBody",
  "wc.lb.scoringUpdates",
  "wc.lb.shareMyRank",
  "wc.lb.challengePool",
  "wc.lb.noChampionPick",
  "wc.lb.alive",
  "wc.lb.busted",
  "wc.lb.aiProUnlocks",
  "wc.lb.ptsLabel",
  "wc.lb.trustNote",
  // Share card UI chrome
  "wc.share.eyebrow",
  "wc.share.titleInvite",
  "wc.share.titleLeaderboard",
  "wc.share.titleBracket",
  "wc.share.titleRecap",
  "wc.share.description",
  "wc.share.publicSafe",
  "wc.share.copy",
  "wc.share.copied",
  "wc.share.share",
  // Goal 8: Invite tab new UX sections
  "wc.inviteTab.hero.title",
  "wc.inviteTab.hero.subtitle",
  "wc.inviteTab.hero.participants",
  "wc.inviteTab.hero.spotsLeft",
  "wc.inviteTab.hero.poolFull",
  "wc.inviteTab.hero.lockDeadline",
  "wc.inviteTab.growth.title",
  "wc.inviteTab.growth.body",
  "wc.inviteTab.growth.cta",
  "wc.inviteTab.social.title",
  "wc.inviteTab.social.copy1",
  "wc.inviteTab.social.copy2",
  "wc.inviteTab.social.copy3",
  "wc.inviteTab.social.copyBtn",
  "wc.inviteTab.social.copiedBtn",
  "wc.inviteTab.actions.viewLeaderboard",
  "wc.inviteTab.actions.openChat",
  "wc.inviteTab.actions.shareLink",
  "wc.inviteTab.trustNote",
  // Goal 9: Pool Chat community panel
  "wc.chat.hero.title",
  "wc.chat.hero.subtitle",
  "wc.chat.hero.badge",
  "wc.chat.empty.headline",
  "wc.chat.empty.body",
  "wc.chat.chip.explainBracket",
  "wc.chat.chip.dangerZone",
  "wc.chat.chip.poolFavorite",
  "wc.chat.chip.keyMatchup",
  "wc.chat.chip.trashTalk",
  "wc.chat.composer.placeholder",
  "wc.chat.composer.send",
  "wc.chat.privateLabel",
  "wc.chat.aiHint.unlocked",
  "wc.chat.aiHint.locked",
  "wc.chat.trustNote",
  "wc.chat.loading",
  "wc.chat.refresh",
  // Goal 12 — deferred i18n: entry list, commissioner panel, fixture readiness, pick help, AI lock, premium panel
  // Home tab: entry list card
  "wc.entryList.subtitle",
  "wc.entryList.complete",
  "wc.entryList.notComplete",
  "wc.entryList.rank",
  "wc.entryList.unranked",
  "wc.entryList.openBracket",
  "wc.entryList.noBracketsTitle",
  "wc.entryList.noBracketsBody",
  // Home tab: commissioner quick panel
  "wc.home.commissioner.syncing",
  "wc.home.commissioner.syncBtn",
  "wc.home.commissioner.settingsBtn",
  "wc.home.commissioner.inviteBtn",
  // Home tab: fixture readiness card
  "wc.home.fixtureReady.cardTitle",
  "wc.home.fixtureReady.descReady",
  "wc.home.fixtureReady.descBlocked",
  "wc.home.fixtureReady.knockoutLocked",
  "wc.home.fixtureReady.readySingle",
  "wc.home.fixtureReady.readyPlural",
  "wc.home.fixtureReady.notSynced",
  "wc.home.fixtureReady.notReady",
  "wc.home.fixtureReady.commissionerSettings",
  // Picks tab: guided pick help banners
  "wc.pickHelp.fixturesNotSynced",
  "wc.pickHelp.seedBtn",
  "wc.pickHelp.seeding",
  "wc.pickHelp.knockoutFromGroups",
  "wc.pickHelp.title",
  "wc.pickHelp.body",
  "wc.pickHelp.knockoutLocked",
  "wc.pickHelp.continueGuided",
  "wc.pickHelp.reviewGuided",
  "wc.pickHelp.picksBlocked",
  // AI Simulation lock panel
  "wc.aiLock.badge",
  "wc.aiLock.title",
  "wc.aiLock.body",
  "wc.aiLock.tier",
  "wc.aiLock.commissionerNote",
  // Premium access panel + PremiumFeatureCard
  "wc.premium.eyebrow",
  "wc.premium.title",
  "wc.premium.body",
  "wc.premium.entryCap",
  "wc.premium.freeLimitSingle",
  "wc.premium.freeLimitPlural",
  "wc.premium.commissionerSection",
  "wc.premium.aiSection",
  "wc.premium.unlocked",
  "wc.premium.card.commissioner.title",
  "wc.premium.card.commissioner.descOwner",
  "wc.premium.card.commissioner.descOther",
  "wc.premium.card.chat.title",
  "wc.premium.card.chat.desc",
  "wc.premium.card.export.title",
  "wc.premium.card.export.desc",
  "wc.premium.card.multiEntry.title",
  "wc.premium.card.multiEntry.desc",
  "wc.premium.card.bracketBuilder.title",
  "wc.premium.card.bracketBuilder.desc",
  "wc.premium.card.matchupPreview.title",
  "wc.premium.card.matchupPreview.desc",
  "wc.premium.card.whatIf.title",
  "wc.premium.card.whatIf.desc",
  "wc.premium.card.alerts.title",
  "wc.premium.card.alerts.desc",
  // Group stage navigation (Issue 5 fix)
  "wc.groupStage.continueToKnockouts",
] as const

describe("worldCupI18n — new keys present and non-empty in all locales", () => {
  for (const locale of LOCALES) {
    const t = makeWcT(locale)
    describe(`locale "${locale}"`, () => {
      for (const key of NEW_KEYS) {
        it(`"${key}" resolves to a non-empty translated string`, () => {
          const result = t(key)
          expect(typeof result).toBe("string")
          expect(result.trim().length).toBeGreaterThan(0)
        })
      }
    })
  }
})
