import type { ReportsClient } from './types'

function ts() {
  return new Date().toISOString()
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Four templates spanning the modules already built for "Iron Horse
 * Dynasty," and five history entries deliberately covering every status
 * (ready/generating/failed) — a failed report here is the same real
 * signal Automation Center's `elevated`-health entry was: status and
 * outcome are different axes, and packaging can fail even though
 * nothing about the underlying intelligence is wrong.
 */
export const demoReportsClient: ReportsClient = {
  async getTemplates() {
    return {
      data: [
        {
          id: 'template-weekly-digest',
          name: 'Weekly Commissioner Digest',
          description: 'A one-page recap of what happened this week and what needs attention.',
          category: 'commissioner_digest',
          sourceModuleIds: ['mission-control', 'recommendations'],
          schedule: { frequency: 'weekly', nextRunAt: daysFromNow(3) },
        },
        {
          id: 'template-season-recap',
          name: 'Season Recap',
          description: 'A comprehensive look back at the season: health trends, standings, and key moments.',
          category: 'season_recap',
          sourceModuleIds: ['league-health', 'analytics'],
          schedule: { frequency: 'manual' },
        },
        {
          id: 'template-engagement',
          name: 'Manager Engagement Report',
          description: 'Participation, reliability, and engagement trends by manager.',
          category: 'engagement',
          sourceModuleIds: ['managers', 'analytics'],
          schedule: { frequency: 'manual' },
        },
        {
          id: 'template-transactions',
          name: 'Trade & Transaction Summary',
          description: 'Every trade and waiver claim this season, with transaction-volume trends.',
          category: 'transactions',
          sourceModuleIds: ['analytics', 'workspace'],
          schedule: { frequency: 'monthly', nextRunAt: daysFromNow(12) },
        },
      ],
      error: null,
      source: 'demo',
      timestamp: ts(),
    }
  },

  async getHistory() {
    return {
      data: [
        {
          id: 'report-1',
          templateId: 'template-weekly-digest',
          templateName: 'Weekly Commissioner Digest',
          status: 'ready',
          format: 'pdf',
          generatedAt: ts(),
          generatedByLabel: 'Automated schedule',
          summary: 'Week 11 recap — engagement up 4 points, 1 automation needs attention, trade deadline in 9 days.',
          sizeLabel: '184 KB',
          shareStatus: 'shared',
          shareLink: 'https://allfantasy.ai/r/report-1',
          relatedLinks: [{ moduleId: 'mission-control', label: 'Mission Control', href: '/commissioner-os' }],
        },
        {
          id: 'report-2',
          templateId: 'template-season-recap',
          templateName: 'Season Recap',
          status: 'ready',
          format: 'pdf',
          generatedAt: daysFromNow(-2),
          generatedByLabel: 'Devon Okafor',
          summary: 'Mid-season recap through Week 11 — league health at 91, the closest playoff race in 3 seasons.',
          sizeLabel: '512 KB',
          shareStatus: 'private',
          relatedLinks: [
            { moduleId: 'analytics', label: 'League Analytics', href: '/commissioner-os/analytics' },
            { moduleId: 'league-health', label: 'League Health', href: '/commissioner-os/league-health' },
          ],
        },
        {
          id: 'report-3',
          templateId: 'template-transactions',
          templateName: 'Trade & Transaction Summary',
          status: 'generating',
          format: 'csv',
          generatedAt: ts(),
          generatedByLabel: 'Priya Natarajan',
          summary: 'Transaction summary through Week 11 — currently generating.',
          sizeLabel: '—',
          shareStatus: 'private',
          relatedLinks: [],
        },
        {
          id: 'report-4',
          templateId: 'template-engagement',
          templateName: 'Manager Engagement Report',
          status: 'failed',
          format: 'pdf',
          generatedAt: daysFromNow(-1),
          generatedByLabel: 'Sam Rivera',
          summary: 'Manager engagement report generation did not complete.',
          sizeLabel: '—',
          shareStatus: 'private',
          relatedLinks: [{ moduleId: 'managers', label: 'Manager Intelligence', href: '/commissioner-os/managers' }],
          failureReason: 'Timed out while aggregating manager engagement data. No partial file was produced.',
        },
        {
          id: 'report-5',
          templateId: 'template-weekly-digest',
          templateName: 'Weekly Commissioner Digest',
          status: 'ready',
          format: 'pdf',
          generatedAt: daysFromNow(-7),
          generatedByLabel: 'Automated schedule',
          summary: 'Week 10 recap — engagement steady, no automations needed attention.',
          sizeLabel: '179 KB',
          shareStatus: 'private',
          relatedLinks: [{ moduleId: 'mission-control', label: 'Mission Control', href: '/commissioner-os' }],
        },
      ],
      error: null,
      source: 'demo',
      timestamp: ts(),
    }
  },

  async getSummary() {
    return {
      data: { headline: '3 reports ready — 2 scheduled', scheduledCount: 2, readyCount: 3 },
      error: null,
      source: 'demo',
      timestamp: ts(),
    }
  },
}
