import type { HelpClient } from './types'
import type { CommissionerHelpArticleContract, CommissionerGlossaryTermContract } from '../../contracts'

function ts() {
  return new Date().toISOString()
}

/**
 * Real, authored content describing the eleven modules/services that
 * existed going into this phase — per the approved blueprint §3/§5, this
 * is the tier that actually
 * matters for Help Center (there's no separate "richer fictional
 * scenario" the way League Health's demo score differs from its stub
 * score; Demo *is* the realistic catalog here).
 *
 * Every article links out to its subject module via `relatedModuleIds`/
 * `relatedLinks` — it never embeds that module's own data. Search and
 * Notifications are platform services with no `CommissionerModuleId` of
 * their own, so the two articles about them (below) have no formal
 * `relatedLinks` entry — that field requires a real module id, which
 * neither has. Their routes are still named in prose; they just aren't a
 * structurally typed link, the same structural reality Search's and
 * Notifications' own adapter methods live with (routed through
 * `CommissionerErrorAttributableId` rather than `CommissionerModuleId`).
 */
const ARTICLES: CommissionerHelpArticleContract[] = [
  {
    id: 'help-welcome',
    slug: 'welcome-to-commissioner-os',
    title: 'Welcome to Commissioner OS',
    category: 'getting-started',
    summary: 'A quick orientation to Mission Control and how the sidebar is organized.',
    body:
      'Mission Control is your daily starting point — a KPI strip, today\'s priorities, and short previews of League Health, Manager Intelligence, Workspace, and Recent Activity, each linking to its own full module. ' +
      'The sidebar\'s primary section (League Health, Recommendations, Manager Intelligence, Workspace, Automations, League Analytics, Reports, Settings) holds daily-decision modules; Activity Stream and Help & Knowledge Center sit below as secondary, always-available destinations. ' +
      'The header\'s Search button (or Ctrl/⌘K) is the fastest way to jump to any page, recommendation, task, report, automation, or help article by name.',
    relatedModuleIds: ['mission-control'],
    relatedLinks: [{ moduleId: 'mission-control', label: 'Go to Mission Control', href: '/commissioner-os' }],
    updatedAt: ts(),
  },
  {
    id: 'help-demo-mode',
    slug: 'understanding-demo-mode',
    title: 'Understanding Demo Mode',
    category: 'getting-started',
    summary: 'What the "Preview data" banner means, and the difference between stub, demo, and live data.',
    body:
      'Every Commissioner OS page can run in one of three data modes, shown by the small indicator in the header and, whenever the data isn\'t live, an unmissable "Preview data" banner at the top of the page. ' +
      '"Stub" is a minimal fixture that proves a page\'s shape works at all. "Demo" is a fuller, realistic scenario meant to show what the module looks like with real content in it. "Live" means the page is reading from the real Decision OS backend for your actual league — until a given module\'s live connection is built, it shows an honest error instead of fake success, never invented numbers dressed up as real ones.',
    updatedAt: ts(),
  },
  {
    id: 'help-search-guide',
    slug: 'finding-anything-with-search',
    title: 'Finding Anything with Search',
    category: 'getting-started',
    summary: 'How the command palette indexes pages, recommendations, tasks, reports, automations, settings, and help articles.',
    body:
      'Search is reachable from any Commissioner OS page via the header button or the Ctrl/⌘K shortcut. ' +
      'It indexes every module\'s pages plus a preview of their real entities — recommendations, tasks, reports, automations, settings areas, and help articles among them — so typing a few letters of what you\'re looking for gets you there directly, without needing to know which module owns it first. ' +
      'Search never duplicates what it finds; every result is a title and a link back to the module that actually owns the real detail.',
    updatedAt: ts(),
  },
  {
    id: 'help-league-health-workflow',
    slug: 'how-league-health-scoring-works',
    title: 'How League Health Scoring Works',
    category: 'workflows',
    summary: 'What the League Health score measures and how its tiers are derived.',
    body:
      'League Health rolls up into a single score and tier (from "positive" through "critical"), with a driver explaining the biggest factor behind it and a trend showing which direction things are moving. ' +
      'Underneath the score sits a list of specific detected risks, each with its own severity and supporting evidence — engagement drop-off, missed lineup deadlines, and similar league-operations signals. ' +
      'A risk detected here is often exactly what surfaces later as a suggested action in Recommendations Center, or as an entry in the Activity Stream — League Health is where the underlying condition is actually measured.',
    relatedModuleIds: ['league-health'],
    relatedLinks: [{ moduleId: 'league-health', label: 'View League Health', href: '/commissioner-os/league-health' }],
    updatedAt: ts(),
  },
  {
    id: 'help-acting-on-recommendation',
    slug: 'acting-on-a-recommendation',
    title: 'Acting on a Recommendation',
    category: 'workflows',
    summary: 'How Recommendations Center surfaces suggested actions and what happens when you act on one.',
    body:
      'Every recommendation states what was detected, why it matters, the expected impact of acting, and a single primary action — never just a number without a next step. ' +
      'Recommendations carry a confidence level and a status (new, viewed, in progress, completed, dismissed, and a few others) so you can track where each one stands. ' +
      'Mission Control\'s "Today\'s Priorities" always shows the same live queue from here, filtered to what\'s still open — it never keeps its own separate copy.',
    relatedModuleIds: ['recommendations'],
    relatedLinks: [{ moduleId: 'recommendations', label: 'View Recommendations', href: '/commissioner-os/recommendations' }],
    updatedAt: ts(),
  },
  {
    id: 'help-workspace-queue',
    slug: 'managing-your-workspace-queue',
    title: 'Managing Your Workspace Queue',
    category: 'workflows',
    summary: 'How commissioner tasks are prioritized and tracked to completion in Workspace.',
    body:
      'Workspace is where day-to-day commissioner to-dos live — each task has a priority, a status, and often a related link back to whatever module it concerns (a trade to review, a report to send). ' +
      'Tasks move through a queue rather than disappearing once read, so nothing gets lost between when it\'s noticed and when it\'s actually done.',
    relatedModuleIds: ['workspace'],
    relatedLinks: [{ moduleId: 'workspace', label: 'View Workspace', href: '/commissioner-os/workspace' }],
    updatedAt: ts(),
  },
  {
    id: 'help-building-automation',
    slug: 'building-an-automation',
    title: 'Building an Automation',
    category: 'workflows',
    summary: 'What an automation is, how its health is measured, and how to read its execution history.',
    body:
      'An automation is a scheduled or triggered action — a lineup lock reminder, a trade deadline notice — that runs without you having to remember to send it yourself. ' +
      'Each automation shows a health indicator reflecting how its recent runs went, and a full execution history you can drill into when something needs a closer look.',
    relatedModuleIds: ['automations'],
    relatedLinks: [{ moduleId: 'automations', label: 'View Automation Center', href: '/commissioner-os/automations' }],
    updatedAt: ts(),
  },
  {
    id: 'help-reports-generate-share',
    slug: 'generating-and-sharing-reports',
    title: 'Generating and Sharing Reports',
    category: 'workflows',
    summary: 'How to generate a report from a template, and the difference between sharing and downloading one.',
    body:
      'Reports start from a template (a manager engagement summary, a season-midpoint digest, and similar) and generate into a real, dated entry in your report history. ' +
      'Sharing makes a report reachable by a link you can send to your league; downloading exports it as a PDF or CSV for your own records. Both are available from the same generated report, and neither duplicates the other.',
    relatedModuleIds: ['reports'],
    relatedLinks: [{ moduleId: 'reports', label: 'View Reports', href: '/commissioner-os/reports' }],
    updatedAt: ts(),
  },
  {
    id: 'help-manager-intelligence-guide',
    slug: 'manager-intelligence-explained',
    title: 'Manager Intelligence, Explained',
    category: 'module-guide',
    summary: 'What Manager Intelligence tracks about each manager in your league, and what it deliberately does not track.',
    body:
      'Manager Intelligence is a directory of engagement and behavior signals per manager — the kind of thing that helps you notice who might need a nudge before a lineup deadline, not a performance leaderboard. ' +
      'It does not compute league standings or scoring outcomes — that\'s League Analytics\' job, and the two modules deliberately don\'t overlap.',
    relatedModuleIds: ['managers'],
    relatedLinks: [{ moduleId: 'managers', label: 'View Manager Intelligence', href: '/commissioner-os/managers' }],
    updatedAt: ts(),
  },
  {
    id: 'help-league-analytics-guide',
    slug: 'league-analytics-explained',
    title: 'League Analytics, Explained',
    category: 'module-guide',
    summary: 'The league-wide trends and distributions League Analytics surfaces, and how they relate to League Health.',
    body:
      'League Analytics shows league-wide trends and distributions — scoring spread, competitive balance, and similar season-level patterns — as charts you can scan at a glance from its own summary on Mission Control. ' +
      'League Health asks "is anything wrong right now"; League Analytics asks "what does the season look like as a whole." They\'re related but answer different questions, and neither recomputes the other\'s numbers.',
    relatedModuleIds: ['analytics'],
    relatedLinks: [{ moduleId: 'analytics', label: 'View League Analytics', href: '/commissioner-os/analytics' }],
    updatedAt: ts(),
  },
  {
    id: 'help-activity-stream-guide',
    slug: 'reading-the-activity-stream',
    title: 'Reading the Activity Stream',
    category: 'module-guide',
    summary: 'How the Activity Stream differs from Notifications, and how to filter it by source module.',
    body:
      'The Activity Stream is the permanent, chronological record of meaningful events across every module — a risk detected, a task completed, an automation run — never dismissed or marked read. ' +
      'That\'s the key difference from Notifications: Notifications are an actionable inbox you triage and clear, while the Activity Stream is the standing history you can always look back through. ' +
      'Use the tabs at the top of the page to filter down to just one source module\'s events.',
    relatedModuleIds: ['activity'],
    relatedLinks: [{ moduleId: 'activity', label: 'View Activity Stream', href: '/commissioner-os/activity' }],
    updatedAt: ts(),
  },
  {
    id: 'help-notifications-guide',
    slug: 'working-with-notifications',
    title: 'Working with Notifications',
    category: 'module-guide',
    summary: 'What generates a notification, and how read state and priority work.',
    body:
      'Notifications are actionable, dismissible inbox items — reachable from the bell icon in the header — each carrying a severity, a source module, and often a related link straight to whatever needs your attention. ' +
      'Once you\'ve read or acted on one, it\'s marked read; unlike the Activity Stream, nothing here is meant to be a permanent record, only a current to-do list of things worth noticing.',
    updatedAt: ts(),
  },
  {
    id: 'help-report-failed',
    slug: 'why-a-report-failed-to-generate',
    title: 'Why a Report Failed to Generate',
    category: 'troubleshooting',
    summary: 'Common reasons a scheduled or on-demand report shows a failed status, and what to check first.',
    body:
      'A failed report almost always means the underlying data it needed wasn\'t available at generation time — check Reports\' own history entry for that run\'s specific failure reason before trying again. ' +
      'A failed report also automatically appears in both Notifications and the Activity Stream, so you don\'t have to be watching the Reports page itself to notice.',
    relatedModuleIds: ['reports'],
    relatedLinks: [{ moduleId: 'reports', label: 'View Reports', href: '/commissioner-os/reports' }],
    updatedAt: ts(),
  },
  {
    id: 'help-automation-failed',
    slug: 'what-to-do-when-an-automation-fails',
    title: 'What To Do When an Automation Fails',
    category: 'troubleshooting',
    summary: 'How to read an automation health indicator and where to find its execution history.',
    body:
      'An automation\'s health indicator reflects its recent runs, not just its most recent one — a single failure surrounded by successes reads differently than a run of consecutive failures. ' +
      'Open the automation\'s own execution history for the specific error from its last run before deciding whether to re-run it or adjust its configuration.',
    relatedModuleIds: ['automations'],
    relatedLinks: [{ moduleId: 'automations', label: 'View Automation Center', href: '/commissioner-os/automations' }],
    updatedAt: ts(),
  },
  {
    id: 'help-terminology-overview',
    slug: 'commissioner-os-terminology-overview',
    title: 'Commissioner OS Terminology Overview',
    category: 'glossary',
    summary: 'A short orientation to the recurring terms used across Commissioner OS — see the Glossary below for full definitions.',
    body:
      'A few words show up across almost every module: severity (how serious a condition is), confidence (how sure the system is), and source module (which module a piece of evidence or a link actually belongs to). ' +
      'The Glossary section on this page defines each of these, along with the handful of Commissioner-OS-specific terms — Decision OS Adapter, Demo Mode, Recommendation, Risk, Automation, Activity Event, and Notification — in one place.',
    updatedAt: ts(),
  },
]

const GLOSSARY: CommissionerGlossaryTermContract[] = [
  {
    id: 'glossary-decision-os-adapter',
    term: 'Decision OS Adapter',
    definition:
      'The single layer every Commissioner OS page fetches through — it normalizes, validates, and logs every module\'s data uniformly, but never computes or owns any of it itself.',
  },
  {
    id: 'glossary-demo-mode',
    term: 'Demo Mode',
    definition:
      'The stub / demo / live switch every page respects — see "Understanding Demo Mode" above for what each of the three means.',
  },
  {
    id: 'glossary-severity-tier',
    term: 'Severity Tier',
    definition:
      'The condition scale used by League Health, Workspace task priority, and Automation health: critical, elevated, standard, advisory, or positive.',
    relatedModuleIds: ['league-health', 'workspace', 'automations'],
  },
  {
    id: 'glossary-event-severity',
    term: 'Event Severity',
    definition:
      'The separate scale used by Notifications and the Activity Stream for individual events: informational, success, warning, or critical — deliberately distinct from Severity Tier, since an event and an ongoing condition are different kinds of things.',
    relatedModuleIds: ['activity'],
  },
  {
    id: 'glossary-recommendation',
    term: 'Recommendation',
    definition:
      'A suggested action surfaced by Recommendations Center — what was detected, why it matters, the expected impact, and one primary action.',
    relatedModuleIds: ['recommendations'],
  },
  {
    id: 'glossary-risk',
    term: 'Risk',
    definition:
      'A specific detected condition underlying League Health\'s overall score — engagement drop-off or missed deadlines are typical examples.',
    relatedModuleIds: ['league-health'],
  },
  {
    id: 'glossary-automation',
    term: 'Automation',
    definition:
      'A scheduled or triggered action managed by Automation Center, shown with a health indicator and a full execution history.',
    relatedModuleIds: ['automations'],
  },
  {
    id: 'glossary-activity-event',
    term: 'Activity Event',
    definition:
      'One entry in the Activity Stream\'s permanent chronological record — a summary, its source module, who or what triggered it, and a link back to the real detail.',
    relatedModuleIds: ['activity'],
  },
  {
    id: 'glossary-notification',
    term: 'Notification',
    definition:
      'An actionable, dismissible inbox item with a read/unread state — distinct from an Activity Event, which is never dismissed.',
  },
  {
    id: 'glossary-related-link',
    term: 'Related Link',
    definition:
      'A pointer back to whichever module actually owns something\'s real detail — the mechanism every module uses to reference another\'s data without ever copying it.',
  },
]

export const demoHelpClient: HelpClient = {
  async getArticles() {
    return { data: ARTICLES, error: null, source: 'demo', timestamp: ts() }
  },
  async getGlossary() {
    return { data: GLOSSARY, error: null, source: 'demo', timestamp: ts() }
  },
}
