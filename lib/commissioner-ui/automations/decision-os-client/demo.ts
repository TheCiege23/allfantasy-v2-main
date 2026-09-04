import type { AutomationClient, AutomationExecutionEntry } from './types'

function ts() {
  return new Date().toISOString()
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Five automations for "Iron Horse Dynasty," each a repetitive, low-
 * stakes task — never a trade approval, member removal, or rule
 * ratification, per the Commissioner OS Canon's automation boundary.
 * Several link back to the exact same recommendations/tasks/managers
 * used across this program's other demo fixtures: the trade-deadline
 * reminder this automation sends is the one Recommendations Center
 * flagged and Workspace has a task to confirm went out; the duplicate-
 * waiver-claim automation is what resolved Workspace's now-archived
 * task. One automation (`demo-auto-2`) is deliberately `enabled` but
 * `health: 'elevated'` — status and health are different axes, and a
 * running automation having a recent failure is the whole reason health
 * indicators exist separately from the on/off switch.
 */
const EXECUTION_HISTORY: Record<string, AutomationExecutionEntry[]> = {
  'demo-auto-1': [
    {
      id: 'demo-auto-1-exec-1',
      automationId: 'demo-auto-1',
      startedAt: ts(),
      durationMs: 410,
      result: 'success',
      summary: 'Reminder sent to all 12 managers',
      detail: 'The trade-deadline reminder was broadcast to all 12 managers via their preferred notification channel with no delivery failures.',
    },
    {
      id: 'demo-auto-1-exec-2',
      automationId: 'demo-auto-1',
      startedAt: daysFromNow(-1),
      durationMs: 390,
      result: 'success',
      summary: 'Reminder sent to all 12 managers',
      detail: 'The trade-deadline reminder was broadcast to all 12 managers via their preferred notification channel with no delivery failures.',
    },
  ],
  'demo-auto-2': [
    {
      id: 'demo-auto-2-exec-1',
      automationId: 'demo-auto-2',
      startedAt: daysFromNow(-1),
      durationMs: 850,
      result: 'failure',
      summary: 'Failed to reach 2 of 12 managers',
      detail: 'Push notification delivery failed for 2 managers due to an expired device token. No email fallback is configured for this automation yet.',
    },
    {
      id: 'demo-auto-2-exec-2',
      automationId: 'demo-auto-2',
      startedAt: daysFromNow(-8),
      durationMs: 620,
      result: 'success',
      summary: 'Reminded all 12 managers',
      detail: 'All 12 managers received their lineup lock reminder via push notification with no errors.',
    },
    {
      id: 'demo-auto-2-exec-3',
      automationId: 'demo-auto-2',
      startedAt: daysFromNow(-15),
      durationMs: 640,
      result: 'success',
      summary: 'Reminded all 12 managers',
      detail: 'All 12 managers received their lineup lock reminder via push notification with no errors.',
    },
  ],
  'demo-auto-3': [
    {
      id: 'demo-auto-3-exec-1',
      automationId: 'demo-auto-3',
      startedAt: daysFromNow(-4),
      durationMs: 210,
      result: 'success',
      summary: 'Welcome message sent to Devon Okafor',
      detail: 'A welcome message with co-commissioner permissions and orientation links was sent to Devon Okafor upon joining.',
    },
  ],
  'demo-auto-4': [
    {
      id: 'demo-auto-4-exec-1',
      automationId: 'demo-auto-4',
      startedAt: daysFromNow(-9),
      durationMs: 1200,
      result: 'success',
      summary: 'Standings recap generated and posted',
      detail: 'A standings recap graphic was generated and posted to the league chat at the commissioner\'s request.',
    },
  ],
  'demo-auto-5': [
    {
      id: 'demo-auto-5-exec-1',
      automationId: 'demo-auto-5',
      startedAt: daysFromNow(-2),
      durationMs: 180,
      result: 'success',
      summary: 'Voided 1 duplicate waiver claim',
      detail: 'A duplicate waiver claim for the same player from the same team was detected and automatically voided, keeping the original claim active.',
    },
  ],
}

export const demoAutomationClient: AutomationClient = {
  async getCatalog() {
    return {
      data: [
        {
          id: 'demo-auto-1',
          name: 'Trade-deadline reminder broadcast',
          description: 'Sends a reminder to all managers who have not made a roster move as the trade deadline approaches.',
          category: 'communications',
          status: 'enabled',
          health: 'positive',
          schedule: { triggerType: 'schedule', description: 'Daily at 9:00 AM during the trade window', nextRunAt: daysFromNow(1) },
          lastRunAt: ts(),
          lastRunResult: 'success',
          totalRunsCount: 42,
          successRatePercent: 100,
          relatedLinks: [{ moduleId: 'recommendations', label: 'Trade deadline approaching', href: '/commissioner-os/recommendations' }],
        },
        {
          id: 'demo-auto-2',
          name: 'Lineup lock reminder',
          description: 'Notifies any manager with an incomplete lineup shortly before each week\'s lock.',
          category: 'compliance_reminders',
          status: 'enabled',
          health: 'elevated',
          schedule: { triggerType: 'event', description: "90 minutes before each week's lineup lock" },
          lastRunAt: daysFromNow(-1),
          lastRunResult: 'failure',
          totalRunsCount: 168,
          successRatePercent: 93,
          relatedLinks: [{ moduleId: 'league-health', label: 'League Health — Risk Analysis', href: '/commissioner-os/league-health' }],
        },
        {
          id: 'demo-auto-3',
          name: 'New co-commissioner welcome message',
          description: 'Sends orientation information and permission details when a new co-commissioner is added.',
          category: 'communications',
          status: 'enabled',
          health: 'positive',
          schedule: { triggerType: 'event', description: 'When a new co-commissioner is added' },
          lastRunAt: daysFromNow(-4),
          lastRunResult: 'success',
          totalRunsCount: 3,
          successRatePercent: 100,
          relatedLinks: [{ moduleId: 'managers', label: 'Devon Okafor — Manager Intelligence', href: '/commissioner-os/managers' }],
        },
        {
          id: 'demo-auto-4',
          name: 'Standings recap graphic',
          description: 'Generates a shareable standings recap graphic for the league chat, on request.',
          category: 'communications',
          status: 'disabled',
          health: 'standard',
          schedule: { triggerType: 'manual', description: 'Manual only — commissioner-triggered' },
          lastRunAt: daysFromNow(-9),
          lastRunResult: 'success',
          totalRunsCount: 8,
          successRatePercent: 100,
          relatedLinks: [],
        },
        {
          id: 'demo-auto-5',
          name: 'Duplicate waiver claim auto-void',
          description: 'Detects and voids a duplicate waiver claim for the same player from the same team, keeping the original active.',
          category: 'waiver_management',
          status: 'enabled',
          health: 'positive',
          schedule: { triggerType: 'event', description: 'When two identical waiver claims are detected' },
          lastRunAt: daysFromNow(-2),
          lastRunResult: 'success',
          totalRunsCount: 6,
          successRatePercent: 100,
          relatedLinks: [{ moduleId: 'workspace', label: 'Resolve a duplicate waiver claim from Week 6', href: '/commissioner-os/workspace' }],
        },
      ],
      error: null,
      source: 'demo',
      timestamp: ts(),
    }
  },

  async getExecutionHistory(automationId) {
    return {
      data: EXECUTION_HISTORY[automationId] ?? [],
      error: null,
      source: 'demo',
      timestamp: ts(),
    }
  },

  async getSummary() {
    return {
      data: {
        totalCount: 5,
        activeCount: 4,
        needsAttentionCount: 1,
        headline: '4 of 5 automations active — 1 needs attention',
      },
      error: null,
      source: 'demo',
      timestamp: ts(),
    }
  },
}
