/**
 * Central English copy for post-create first-run (Phase 6B).
 *
 * i18n: `LanguageProviderClient` / `t()` are not wired here yet — keep strings in one
 * place so a future pass can swap to `t('league.firstRun.*')` without hunting components.
 */
export const FIRST_RUN_COPY = {
  heroEyebrow: 'League created',
  heroDismissAria: 'Dismiss league created banner',
  checklistFootnote: 'Must-haves gate launch; nice-to-haves polish the experience.',
  inviteCardTitle: 'Invite managers',
  inviteCardBodyHasToken: 'Copy your invite link or open invite settings to regenerate.',
  inviteCardBodyNoToken: 'Generate an invite link in league settings.',
  inviteOpenSettings: 'Invite settings',
  inviteCopyLink: 'Copy link',
  invitePreviewJoin: 'Preview join',
  draftCardTitle: 'Draft',
  draftCardScheduledFallback: 'Not scheduled yet',
  draftCardHint: 'Schedule from draft settings or jump to the draft tab.',
  draftOpenTab: 'Open draft tab',
  draftOpenSettings: 'Draft settings',
  chatCardTitle: 'League chat',
  chatCardBody: 'Drop a welcome message so managers know where to say hello.',
  chatOpen: 'Open league chat',
  settingsCardTitle: 'League settings',
  settingsCardBody: 'Scoring, waivers, rosters, and visibility live in league settings.',
  settingsOpen: 'Open settings',
  readinessTitle: 'Readiness',
  quickLinksTitle: 'More quick links',
  quickPlayers: 'Players / waivers',
  quickTrades: 'Trades',
  memberWaitTitle: 'Your commissioner is setting up the league',
  memberWaitDraftPending: 'Draft details will appear here once your commissioner finishes setup.',
  memberChatCta: 'League chat is open',
  memberDismissAria: 'Dismiss',
} as const
