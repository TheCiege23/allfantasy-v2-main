import type { RecommendationsClient } from './types'

function ts() {
  return new Date().toISOString()
}

/**
 * The canonical, cross-module queue for "Iron Horse Dynasty" — the same
 * underlying recommendations Mission Control and League Health preview
 * subsets of, now shown in full with lifecycle status and category. Mixed
 * statuses deliberately included so the queue's status handling is
 * genuinely exercised, not just the "new" happy path.
 */
export const demoRecommendationsClient: RecommendationsClient = {
  async getQueue() {
    return {
      data: [
        {
          id: 'demo-rec-1',
          title: 'Manager engagement declining',
          rationale: 'Sam Rivera has missed lineup deadlines two weeks running, after a strong first half.',
          severity: 'elevated',
          confidence: 'high',
          expectedImpact: 'A personal check-in has resolved similar patterns in this league before',
          primaryActionLabel: 'Send Check-In',
          status: 'new',
          category: 'health_and_risk',
          sourceModuleId: 'league-health',
          createdAt: ts(),
        },
        {
          id: 'demo-rec-2',
          title: 'Trade deadline approaching',
          rationale: 'Four teams have not made a roster move in over three weeks, with the deadline 9 days out.',
          severity: 'advisory',
          confidence: 'moderate',
          expectedImpact: 'A reminder typically increases pre-deadline trade volume by a third',
          primaryActionLabel: 'Send Reminder',
          status: 'in_progress',
          category: 'engagement',
          sourceModuleId: 'recommendations',
          createdAt: ts(),
        },
        {
          id: 'demo-rec-3',
          title: 'Standings have tightened',
          rationale: 'The gap between 1st and 8th place has narrowed to two games — the closest this league has been all season.',
          severity: 'positive',
          confidence: 'very_high',
          expectedImpact: 'Worth highlighting in the next league digest',
          primaryActionLabel: 'Include in Digest',
          status: 'automated',
          category: 'competitive_integrity',
          sourceModuleId: 'recommendations',
          createdAt: ts(),
        },
        {
          id: 'demo-rec-4',
          title: 'Routine waiver approvals recurring weekly',
          rationale: 'The same low-stakes waiver claim pattern has repeated for 4 consecutive weeks.',
          severity: 'standard',
          confidence: 'high',
          expectedImpact: 'A strong candidate for automation',
          primaryActionLabel: 'Set Up Automation',
          status: 'deferred',
          category: 'automation_opportunity',
          sourceModuleId: 'automations',
          createdAt: ts(),
        },
      ],
      error: null,
      source: 'demo',
      timestamp: ts(),
    }
  },
}
