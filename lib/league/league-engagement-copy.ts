/** Central copy for Phase 6C engagement surfaces (i18n: swap for `t()` later). */
export const LEAGUE_ENGAGEMENT_COPY = {
  predraftStripTitle: 'Bring the league to life',
  predraftStripDismiss: 'Dismiss tips',
  predraftManagers: (joined: number, cap: number) => `${joined} / ${cap} managers joined`,
  predraftInvite: 'Invite managers',
  predraftScheduleDraft: 'Schedule draft',
  predraftOpenChat: 'Open league chat',
  predraftWelcome: 'Post a welcome',
  predraftListing: 'Publish listing',
  predraftPayment: 'Finish payment setup',
  predraftScoring: 'Review scoring',
  predraftLogo: 'Add league logo',
  chatEmptyTitle: 'No messages yet',
  chatEmptySubtitle: 'Quiet leagues feel empty — a short note goes a long way.',
  chatEmptyCommissionerBullets: [
    'Drop a welcome so managers know you’re here.',
    'Point people to draft time and house rules.',
    'Use League Settings for invites, scoring, and visibility.',
  ],
  chatEmptyMemberBullets: [
    'Say hi and ask when the draft is planned.',
    'Check League Settings (read-only) for scoring and format.',
    'Invite questions here so everyone stays aligned.',
  ],
  chatCtaLeagueHub: 'Open league hub',
  chatCtaInviteSettings: 'Invite settings',
  chatCtaDraftTab: 'Draft tab',
  memberJoinedLine: (joined: number, cap: number) => `${joined} of ${cap} managers have joined so far.`,
  memberWhatNext:
    "What's next: your commissioner will lock draft details and you'll get picks when the room opens.",
} as const
