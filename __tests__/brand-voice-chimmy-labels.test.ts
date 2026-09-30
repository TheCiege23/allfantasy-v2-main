/**
 * Brand-voice guard for the surfaces fixed in the "bare AI label" pass.
 *
 * The assistant is Chimmy. Customer copy that names the assistant must say Chimmy — "Ask Chimmy",
 * "Chat with Chimmy", "Chimmy's waiver picks" — never a bare "AI" label ("Ask AI", "AI Chat",
 * "Open AI Coach", "Chimmy AI").
 *
 * This complements, and deliberately does not change, __tests__/no-ai-customer-copy.test.ts (the
 * CI check "No bare \"AI\" labels in dashboard customer copy"). That guard scans only
 * app/dashboard plus two named files. The files below live outside that scope, so without this
 * test nothing would stop the fixed labels drifting back.
 *
 * Three tiers, because not every touched file could be cleaned completely in one pass:
 *
 *   STRICT_FILES          — no bare \bAI\b anywhere in customer-facing strings (same line
 *                            classifier as the dashboard guard), apart from the reviewed
 *                            STRICT_ALLOWLIST entries.
 *   ASSISTANT_LABEL_FILES — files that still carry reviewed, deliberately-kept "AI" copy (feature
 *                            names such as "Waiver AI", AI-managed bot teams, AI-generated
 *                            disclosure pills, SEO/marketing positioning). Here only the phrases
 *                            that NAME THE ASSISTANT are forbidden.
 *   I18N key pins         — the specific en/es (and World Cup) keys rewritten in this pass.
 *
 * Every forbidding check has a positive control proving it actually fires.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { translations } from '@/lib/i18n/translations'
import { WORLD_CUP_TRANSLATIONS } from '@/lib/world-cup/worldCupI18n'
import { LANDING_COPY } from '@/components/landing/journey/copy'

const ROOT = process.cwd()

// ---------------------------------------------------------------------------------------------
// Line classifier — mirrors __tests__/no-ai-customer-copy.test.ts so the two guards agree on what
// "customer-facing string" means (quoted literals, same-line JSX text, bare JSX text lines;
// comments, imports and console.* calls excluded).
// ---------------------------------------------------------------------------------------------

function isCommentOrImport(line: string): boolean {
  const t = line.trim()
  return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*') || t.startsWith('import ')
}

function isConsoleCall(line: string): boolean {
  return /console\.(log|error|warn|info|debug)\s*\(/.test(line)
}

function isBareTextLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  return !/[<>{}"'`]/.test(t)
}

/** Every customer-facing string fragment on every non-comment line of `src`. */
function customerStrings(src: string): string[] {
  const out: string[] = []
  for (const raw of src.split(/\r?\n/)) {
    if (isCommentOrImport(raw) || isConsoleCall(raw)) continue
    for (const q of raw.match(/["'`]([^"'`]*)["'`]/g) ?? []) out.push(q.slice(1, -1))
    for (const m of raw.matchAll(/>([^<>{}\n]+)</g)) out.push(m[1]!.trim())
    if (isBareTextLine(raw)) out.push(raw.trim())
  }
  return out.filter((s) => s.length > 0)
}

/** Same token rule as the dashboard guard: case-sensitive \bAI\b plus its known phrases. */
const BARE_AI = /\bAI\b/
const KNOWN_AI_PHRASES = /(AI Grade|AI insight|AI Import|AI-powered|AI recommendations?)/i
const hasBareAi = (s: string) => BARE_AI.test(s) || KNOWN_AI_PHRASES.test(s)

/**
 * Phrases that name the ASSISTANT as "AI". Chimmy is the assistant, so each of these has a Chimmy
 * rewrite. Spanish "IA" variants are included for the translated labels.
 */
const ASSISTANT_AS_AI =
  /\b(Ask AI|Open AI Chat|AI Chat(bot)?|AI [Cc]oach(ing)?|Chimmy (AI|IA)|AI assistant|Messages AI|AI Quick Ask|AI Hub|AI Status|Run AI(?!-)|AI explain|Explain (with )?AI|Your AI|AI co-?pilot|AI Chimmy|coach IA|Coaching IA)\b/

function offendersIn(rel: string, forbid: (s: string) => boolean, allow: string[] = []): string[] {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  return customerStrings(src).filter((s) => forbid(s) && !allow.some((a) => s.includes(a)))
}

// ---------------------------------------------------------------------------------------------
// Tier 1 — fully clean files.
// ---------------------------------------------------------------------------------------------

const STRICT_FILES = [
  'components/ai-hub/UnifiedAIWorkbench.tsx',
  'app/ai/tools/AIToolsPageClient.tsx',
  'app/ai/tools/page.tsx',
  'app/bracket/[tournamentId]/entries/new/ui.tsx',
  'app/chimmy/ChimmyLandingClient.tsx',
  'app/league/[leagueId]/LeagueShell.tsx',
  'app/league/[leagueId]/tabs/AICoachingTab.tsx',
  'app/messages/MessagesContent.tsx',
  'app/messages/page.tsx',
  'app/paid-restricted/page.tsx',
  'app/tools-hub/ToolsHubClient.tsx',
  'components/ai/coaching/AICoachingPage.tsx',
  'components/ai-tools/modals/LongTermCoachingModal.tsx',
  'components/ai-tools/modals/WaiverWireModal.tsx',
  'components/app/draft-room/DraftHelperPanel.tsx',
  'components/app/draft-room/DraftHelperRedraftLayout.tsx',
  'components/app/league-intelligence/GraphInsightDrawer.tsx',
  'components/app/league-intelligence/LeagueIntelligenceGraphPanel.tsx',
  'components/app/league-intelligence/UnifiedRelationshipInsightsPanel.tsx',
  'components/app/settings/ReputationPanel.tsx',
  'components/app/tabs/CareerTab.tsx',
  'components/app/tabs/LegacyTab.tsx',
  'components/bracket/BracketAICoachTab.tsx',
  'components/bracket/BracketHomeTabs.tsx',
  'components/bracket/BracketTopNav.tsx',
  'components/brackets/BracketsAuthCTA.tsx',
  'components/brackets/world-cup/chat/WorldCupChatModeTabs.tsx',
  'components/chat/ChatThreadList.tsx',
  'components/core-app/comms/ChimmyPanel.tsx',
  'components/core-app/comms/CommsDrawer.tsx',
  'components/dashboard/FinalDashboardClient.tsx',
  'components/draft/ChimmyDraftNarration.tsx',
  'components/dynasty/DynastyProjectionPanel.tsx',
  'components/dynasty-intelligence/DynastyInsightsPage.tsx',
  'components/home/HomeChatDock.tsx',
  'components/idp/IDPWaiverSection.tsx',
  'components/league/tabs/PlayersTab.tsx',
  'components/LeagueRankingsV2Panel.tsx',
  'components/legacy-score/PlatformLegacyLeaderboardPanel.tsx',
  'components/matchup-center/MatchupAiAnalysisPanel.tsx',
  'components/meta-insights/AIExplainTrendButton.tsx',
  'components/mock-draft/AIDraftAssistantPanel.tsx',
  'components/mock-draft/MockDraftSetup.tsx',
  'components/navigation/AppShellNav.tsx',
  'components/navigation/SettingsModal.tsx',
  'components/navigation/SharedRightRail.tsx',
  'components/negotiation/NegotiationSheet.tsx',
  'components/onboarding-retention/WelcomeFlow.tsx',
  'components/player-comparison-lab/AIExplanationPanel.tsx',
  'components/player-trend/TrendFeedPage.tsx',
  'components/referral/ReferralShareBar.tsx',
  'components/simulation/LeagueForecastSection.tsx',
  'components/survivor/SurvivorLeagueDeepLinkPanel.tsx',
  'components/TradeFinderV2.tsx',
  'components/waivers/AIWaiverRecommendationsPanel.tsx',
]

/**
 * REVIEWED keeps inside STRICT files. Each says why "AI" is the right word there.
 */
const STRICT_ALLOWLIST: Record<string, string[]> = {
  // The trust block is an AI disclosure that links to /ai-transparency ("AI Transparency" is that
  // page's legal title). Disclosing that recommendations are machine-generated is exactly where
  // the word must stay.
  'app/ai/tools/AIToolsPageClient.tsx': [
    'AI Transparency',
    'league management, AI analysis, and',
    'AI recommendations are designed to support your decisions',
  ],
}

// ---------------------------------------------------------------------------------------------
// Tier 2 — files with reviewed, deliberately-kept "AI" copy. Only assistant-naming is forbidden.
// ---------------------------------------------------------------------------------------------

const ASSISTANT_LABEL_FILES = [
  'app/components/LegacyTutorial.tsx',
  'app/draft/components/DraftRightPanel.tsx',
  'app/league/[leagueId]/tabs/LeagueSettingsTab.tsx',
  'app/legacy/page.tsx',
  'app/onboarding/funnel/OnboardingFunnelClient.tsx',
  'app/sports/[sport]/SportLandingClient.tsx',
  'app/world-cup/layout.tsx',
  'app/world-cup/page.tsx',
  'components/DynastyTradeForm.tsx',
  'components/ai-tools/modals/AFWarRoomModal.tsx',
  'components/ai-tools/modals/StartSitModal.tsx',
  'components/app/settings/AISettingsPanel.tsx',
  'components/bracket-brain/BracketBrainLockedCard.tsx',
  'components/brackets/world-cup/WorldCupMatchupIntelligencePanel.tsx',
  'components/landing/journey/copy.ts',
  'components/mock-draft/MockDraftSleeperRoomClient.tsx',
  'components/player-comparison-ui/PlayerComparisonPremiumView.tsx',
  'components/survivor/SurvivorAIPanel.tsx',
  'components/waiver-wire/WaiverWirePage.tsx',
]

describe('brand voice — the assistant is Chimmy, never a bare "AI" label', () => {
  describe('positive controls (the checks can fail)', () => {
    it('the classifier flags a bare-AI label in each string shape it reads', () => {
      const src = [
        `const a = { label: 'Ask AI' }`,
        `        <span className="x">AI Chat</span>`,
        `          Open AI Chat`,
        `  toast.success(\`AI result saved\`)`,
      ].join('\n')
      const hits = customerStrings(src).filter(hasBareAi)
      expect(hits).toEqual(['Ask AI', 'AI Chat', 'Open AI Chat', 'AI result saved'])
    })

    it('the classifier ignores comments, imports, console calls and non-token substrings', () => {
      const src = [
        `// Ask AI used to live here`,
        `import { AIProductLayer } from '@/lib/ai-product-layer'`,
        `console.error('AI request failed')`,
        `const a = { label: 'Ask Chimmy', email: 'OpenAI maintain detail again' }`,
      ].join('\n')
      expect(customerStrings(src).filter(hasBareAi)).toEqual([])
    })

    it('the assistant-naming pattern fires on every retired label and passes the rewrites', () => {
      for (const bad of [
        'Ask AI',
        'Open AI Chat',
        'AI Chatbot',
        'Open AI Coach',
        'AI Coaching',
        'Chimmy AI',
        'Chimmy IA',
        'Chimmy - Your AI Coach',
        'AI assistant is disabled.',
        'Open in Messages AI',
        'AI Quick Ask',
        'Run AI',
        'AI explain',
        'Explain with AI',
        'Your AI World Cup co-pilot',
        'Coaching IA',
      ]) {
        expect(ASSISTANT_AS_AI.test(bad), bad).toBe(true)
      }
      for (const good of [
        'Ask Chimmy',
        'Open Chat with Chimmy',
        "Chimmy's Waiver Picks",
        'Chimmy Coaching',
        'Explain with Chimmy',
        'Waiver AI', // a kept feature name — not the assistant
        'AI Manager', // an AI-managed bot team — not the assistant
        'Run AI-powered mock drafts', // kept marketing descriptor, not "Run AI" the button
      ]) {
        expect(ASSISTANT_AS_AI.test(good), good).toBe(false)
      }
    })

    it('a real guarded file goes red when a bare-AI label is injected into it', () => {
      // Mutation on an in-memory copy — proves the file-level check reads this file's strings.
      const rel = 'components/ai-hub/UnifiedAIWorkbench.tsx'
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      expect(customerStrings(src).filter(hasBareAi)).toEqual([])
      const mutated = src.replace('Open Chat with Chimmy', 'Open AI Chat')
      expect(mutated).not.toBe(src) // the mutation applied
      expect(customerStrings(mutated).filter(hasBareAi)).toContain('Open AI Chat')
    })
  })

  describe('strict files: no bare "AI" in customer-facing strings', () => {
    it('covers a non-trivial set that all exist', () => {
      expect(STRICT_FILES.length).toBeGreaterThan(40)
      for (const rel of STRICT_FILES) expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true)
    })

    for (const rel of STRICT_FILES) {
      it(`${rel}`, () => {
        const offenders = offendersIn(rel, hasBareAi, STRICT_ALLOWLIST[rel] ?? [])
        expect(offenders, offenders.join('\n')).toEqual([])
      })
    }

    it('every STRICT_ALLOWLIST entry still matches something (no stale exemptions)', () => {
      for (const [rel, entries] of Object.entries(STRICT_ALLOWLIST)) {
        const strings = customerStrings(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
        for (const entry of entries) {
          expect(strings.some((s) => s.includes(entry)), `${rel}: ${entry}`).toBe(true)
        }
      }
    })
  })

  describe('partially-cleaned files: nothing names the assistant "AI"', () => {
    for (const rel of ASSISTANT_LABEL_FILES) {
      it(`${rel}`, () => {
        const offenders = offendersIn(rel, (s) => ASSISTANT_AS_AI.test(s))
        expect(offenders, offenders.join('\n')).toEqual([])
      })
    }
  })

  describe('named offenders', () => {
    const workbench = fs.readFileSync(path.join(ROOT, 'components/ai-hub/UnifiedAIWorkbench.tsx'), 'utf8')

    it('the Unified workbench entry buttons and chat link speak as Chimmy', () => {
      expect(workbench).toContain("label: 'Ask Chimmy'")
      expect(workbench).toContain('label: "Chimmy\'s Waiver Picks"')
      expect(workbench).toContain('label: "Chimmy\'s Draft Help"')
      expect(workbench).toContain('Open Chat with Chimmy')
      for (const retired of ["'Ask AI'", "'AI Waiver'", "'AI Draft Helper'", 'Open AI Chat', 'Run AI']) {
        expect(workbench).not.toContain(retired)
      }
    })

    it('the Legacy & Rankings card describes facts, not a manager label (Milestone 32)', () => {
      const client = fs.readFileSync(path.join(ROOT, 'app/ai/tools/AIToolsPageClient.tsx'), 'utf8')
      expect(client).toContain("'Your AF rank, tier, career record, and championship history.'")
      expect(client).not.toMatch(/archetype/i)
    })
  })

  describe('i18n: rewritten keys stay Chimmy in every locale they were fixed in', () => {
    const APP_KEYS = [
      'landing.features.6.title',
      'landing.ai.4.title',
      'landing.ai.subheading',
      'landing.tools.fantasyCoach.description',
      'home.chimmy.body',
      'bracket.intel.actions.openCoach',
      'app.landing.title',
      'toolsHub.subtitle',
      'toolsHub.chimmy.title',
      'toolsHub.chimmy.subtitle',
      'toolsHub.tool.ai-draft-assistant.description',
      'league.tab.aiCoaching',
      'dashboard.ai.title',
    ]
    const AI_OR_IA = /\b(AI|IA)\b/

    it('the en/es app keys exist and carry no bare AI/IA', () => {
      for (const locale of ['en', 'es'] as const) {
        for (const key of APP_KEYS) {
          const value = translations[locale]?.[key]
          expect(value, `${locale}:${key} missing`).toBeTypeOf('string')
          expect(AI_OR_IA.test(value!), `${locale}:${key} = ${value}`).toBe(false)
        }
      }
    })

    it('control: the retired values would have failed this check', () => {
      for (const old of ['Chimmy AI Coach', 'Chimmy, coach IA', 'Open AI Coach', 'Coaching IA', 'Tu co‑GM con IA para cada liga.']) {
        expect(AI_OR_IA.test(old), old).toBe(true)
      }
    })

    it('World Cup chat labels and unlock hint name Chimmy, not "Chimmy AI"', () => {
      for (const [locale, dict] of Object.entries(WORLD_CUP_TRANSLATIONS)) {
        for (const key of ['wc.chat.mode.ai', 'wc.chat.drawer.aiTitle', 'wc.home.ai.unlockHint']) {
          const value = (dict as Record<string, string>)[key]
          if (value === undefined) continue // locales that fall back to en for this key
          expect(ASSISTANT_AS_AI.test(value), `${locale}:${key} = ${value}`).toBe(false)
          expect(/\bAI\b|\bIA\b/.test(value), `${locale}:${key} = ${value}`).toBe(false)
        }
      }
    })

    it('landing journey copy never titles the coach "Chimmy AI"', () => {
      const all = JSON.stringify(LANDING_COPY)
      expect(all).not.toMatch(/Chimmy AI/)
      expect(all).toContain('Chimmy, Your Coach')
      expect(all).toContain('Chimmy, tu coach')
    })
  })
})
