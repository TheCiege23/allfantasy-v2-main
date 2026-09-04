import type { WorkspaceClient } from './types'

function ts() {
  return new Date().toISOString()
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * The same "Iron Horse Dynasty" scenario every other module's demo data
 * uses — several tasks here deliberately link back to recommendations and
 * managers already established in Recommendations Center's and Manager
 * Intelligence's own demo fixtures (Sam Rivera's engagement decline, the
 * trade deadline, the waiver-automation candidate), so the related-links
 * requirement demonstrates a real cross-module thread, not an arbitrary
 * placeholder href.
 */
export const demoWorkspaceClient: WorkspaceClient = {
  async getTasks() {
    return {
      data: [
        {
          id: 'demo-task-1',
          title: 'Send a check-in message to Sam Rivera',
          description: 'Two missed lineup deadlines in a row after a strong first half — a short personal note has resolved this pattern before in this league.',
          status: 'open',
          priority: 'elevated',
          createdAt: ts(),
          updatedAt: ts(),
          dueAt: daysFromNow(2),
          automationCandidate: false,
          relatedLinks: [
            { moduleId: 'recommendations', label: 'Manager engagement declining', href: '/commissioner-os/recommendations' },
            { moduleId: 'managers', label: 'Sam Rivera — Manager Intelligence', href: '/commissioner-os/managers' },
          ],
        },
        {
          id: 'demo-task-2',
          title: 'Confirm the trade-deadline reminder went out to all managers',
          description: 'Four teams have not made a roster move in over three weeks, with the deadline approaching.',
          status: 'in_progress',
          priority: 'advisory',
          createdAt: ts(),
          updatedAt: ts(),
          dueAt: daysFromNow(6),
          automationCandidate: false,
          relatedLinks: [{ moduleId: 'recommendations', label: 'Trade deadline approaching', href: '/commissioner-os/recommendations' }],
        },
        {
          id: 'demo-task-3',
          title: 'Set up automation for routine waiver approvals',
          description: 'The same low-stakes waiver claim pattern has repeated for 4 consecutive weeks — a strong automation candidate.',
          status: 'open',
          priority: 'standard',
          createdAt: ts(),
          updatedAt: ts(),
          automationCandidate: true,
          relatedLinks: [{ moduleId: 'recommendations', label: 'Routine waiver approvals recurring weekly', href: '/commissioner-os/recommendations' }],
        },
        {
          id: 'demo-task-4',
          title: "Rule on Marcus Webb's trade-veto challenge",
          description: 'A contested veto request needs a commissioner ruling before the trade window reopens.',
          status: 'waiting_on_league_vote',
          priority: 'critical',
          createdAt: ts(),
          updatedAt: ts(),
          dueAt: daysFromNow(1),
          automationCandidate: false,
          relatedLinks: [{ moduleId: 'league-health', label: 'League Health — Risk Analysis', href: '/commissioner-os/league-health' }],
        },
        {
          id: 'demo-task-5',
          title: "Confirm Devon Okafor's co-commissioner permissions",
          description: 'Recently added as co-commissioner — permissions need a final confirmation from Devon.',
          status: 'waiting_on_manager',
          priority: 'standard',
          createdAt: ts(),
          updatedAt: ts(),
          automationCandidate: false,
          relatedLinks: [{ moduleId: 'managers', label: 'Devon Okafor — Manager Intelligence', href: '/commissioner-os/managers' }],
        },
        {
          id: 'demo-task-6',
          title: 'Review a three-team trade for competitive-balance impact',
          description: 'The proposed trade would concentrate top-tier talent on one roster — worth a second look before it processes.',
          status: 'open',
          priority: 'elevated',
          createdAt: ts(),
          updatedAt: ts(),
          dueAt: daysFromNow(4),
          automationCandidate: false,
          relatedLinks: [{ moduleId: 'league-health', label: 'League Health — Risk Analysis', href: '/commissioner-os/league-health' }],
        },
        {
          id: 'demo-task-7',
          title: 'Share the season-midpoint league digest',
          description: 'Standings have tightened to the closest gap all season — worth highlighting to the league.',
          status: 'completed',
          priority: 'standard',
          createdAt: daysFromNow(-3),
          updatedAt: daysFromNow(-1),
          automationCandidate: false,
          relatedLinks: [{ moduleId: 'mission-control', label: 'Mission Control — Quick Actions', href: '/commissioner-os' }],
        },
        {
          id: 'demo-task-8',
          title: 'Resolve a duplicate waiver claim from Week 6',
          description: 'Two identical claims were submitted for the same player — the duplicate was voided.',
          status: 'archived',
          priority: 'standard',
          createdAt: daysFromNow(-10),
          updatedAt: daysFromNow(-2),
          automationCandidate: false,
          relatedLinks: [],
        },
        {
          id: 'demo-task-9',
          title: 'Investigate a missed lineup submission for Team 7',
          description: 'One team fielded an incomplete lineup last week — worth a quick check on whether it was a notification issue.',
          status: 'open',
          priority: 'advisory',
          createdAt: ts(),
          updatedAt: ts(),
          automationCandidate: false,
          relatedLinks: [{ moduleId: 'league-health', label: 'League Health — Risk Analysis', href: '/commissioner-os/league-health' }],
        },
        {
          id: 'demo-task-10',
          title: 'Document playoff-seeding tiebreaker rules for next season',
          description: 'A standing housekeeping item with no immediate deadline.',
          status: 'open',
          priority: 'standard',
          createdAt: ts(),
          updatedAt: ts(),
          dueAt: daysFromNow(45),
          automationCandidate: false,
          relatedLinks: [],
        },
      ],
      error: null,
      source: 'demo',
      timestamp: ts(),
    }
  },
}
