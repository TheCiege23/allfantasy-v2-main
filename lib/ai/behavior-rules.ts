import { prisma } from '@/lib/prisma'

type RuleSeverity = 'hard' | 'soft'

type BehaviorRuleViolation = {
  ruleId: string
  severity: RuleSeverity
  reason: string
}

type BehaviorCheckContext = {
  input?: string
  featureName?: string
  contextBlock?: string | null
}

type CustomBehaviorRule = {
  id: string
  description: string
  prompt: string
  severity: string
  category: string
  blockedPattern: string | null
  requiredPattern: string | null
  enabled?: boolean
}

type BuiltInRule = {
  ruleId: string
  severity: RuleSeverity
  title: string
  prompt: string
}

export const BEHAVIOR_RULES: BuiltInRule[] = [
  {
    ruleId: 'no-break-existing',
    severity: 'hard',
    title: 'Protect working code',
    prompt:
      'Do not suggest deleting stable behavior, removing exports, replacing whole files, or rewriting large working sections unless explicitly requested.',
  },
  {
    ruleId: 'verify-before-answer',
    severity: 'hard',
    title: 'Verify referenced files',
    prompt:
      'Do not mention many file paths or code locations as facts unless they were actually inspected or verified.',
  },
  {
    ruleId: 'minimal-changes',
    severity: 'hard',
    title: 'Prefer minimal scope',
    prompt:
      'For simple code tasks, keep the touched-file scope small instead of sprawling across many files.',
  },
  {
    ruleId: 'no-hallucinated-apis',
    severity: 'hard',
    title: 'Avoid invented APIs',
    prompt:
      'Do not invent helper names, APIs, or symbols near real paths as if they already exist.',
  },
  {
    ruleId: 'stay-on-task',
    severity: 'soft',
    title: 'Avoid scope creep',
    prompt:
      'Stay on the requested task. Do not tack on side quests like extra refactors or unrelated cleanups.',
  },
  {
    ruleId: 'senior-engineer',
    severity: 'soft',
    title: 'Keep senior code quality',
    prompt:
      'Avoid weak code patterns like as any, empty catch blocks, bare TODO markers, or stray debug logs.',
  },
  {
    ruleId: 'use-context',
    severity: 'soft',
    title: 'Use existing context',
    prompt:
      'Do not ask for information that is already present in the current context, request payload, or supplied file references.',
  },
]

const PATH_PATTERN =
  /\b(?:[A-Za-z]:\\|\/)?[\w.-]+(?:[\\/][\w.-]+)+\.[A-Za-z0-9]+\b/g
const SCOPE_CREEP_PATTERN =
  /\b(?:while we(?:'|’)re here|while i'm at it|while I(?:'|’)m at it|also refactor|also clean up|bonus cleanup|unrelated cleanup|as a follow-up, I'll also)\b/i
const DEBUG_LOG_PATTERN = /\b(?:console\.(?:log|debug)|debugger)\b/
const EMPTY_CATCH_PATTERN = /catch\s*\((?:[^)]*)\)\s*\{\s*\}/
const BARE_TODO_PATTERN = /\bTODO\b(?!:)/
const BREAK_EXISTING_PATTERN =
  /\b(?:delete function|delete the function|remove export|remove the export|rewrite the entire file|replace the entire file|delete this file|remove this file|start from scratch|rip out)\b/i
const GENERIC_SYMBOL_PATTERN =
  /\b(?:handle|process|manage|format|validate|fetch|load|save|get|set|build|create|update)(?:Data|Info|Thing|Stuff|Helper|Util|Manager|Handler|Service|Module|Api|Response|Request|State)\w*\(/g
const VERIFICATION_WORD_PATTERN =
  /\b(?:read|inspected|checked|verified|looked at|reviewed|opened|searched)\b/i
const ASK_FOR_CONTEXT_PATTERN =
  /\b(?:can you (?:share|provide|paste|send)|please (?:share|provide|paste|send)|what(?:'s| is) your|which file|which route|what file|what path)\b/i

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').trim()
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
  const matches = text.match(pattern) ?? []
  return [...new Set(matches)]
}

function isSimpleCodeTask(input: string): boolean {
  const normalized = input.toLowerCase()
  const simpleSignals = /\b(?:fix|update|change|rename|add|remove|wire|integrate|implement)\b/
  const largeSignals =
    /\b(?:architecture|system-wide|across the codebase|multi-step|migration|major refactor|full rewrite)\b/
  return simpleSignals.test(normalized) && !largeSignals.test(normalized)
}

function hasRelevantExistingContext(context: BehaviorCheckContext): boolean {
  const combined = `${normalizeText(context.input)}\n${normalizeText(context.contextBlock)}`.toLowerCase()
  if (!combined) return false

  return (
    PATH_PATTERN.test(combined) ||
    /\b(?:league|format|scoring|roster|trade|waiver|draft|lineup|session|conversation|userId|leagueId)\b/.test(
      combined
    )
  )
}

function normalizeSeverity(value: string): RuleSeverity {
  return value.toLowerCase() === 'hard' ? 'hard' : 'soft'
}

export function buildBehaviorRulesPrompt(): string {
  const hardRules = BEHAVIOR_RULES.filter((rule) => rule.severity === 'hard')
  const softRules = BEHAVIOR_RULES.filter((rule) => rule.severity === 'soft')

  const formatRule = (rule: BuiltInRule) => `- ${rule.ruleId}: ${rule.prompt}`

  return [
    '## AI Behavior Rules',
    'These instructions apply to every response.',
    '',
    'HARD RULES',
    ...hardRules.map(formatRule),
    '',
    'SOFT RULES',
    ...softRules.map(formatRule),
    '',
    'If a hard rule is at risk, revise the answer before sending it.',
    'If a soft rule is at risk, prefer the cleaner and narrower response.',
  ].join('\n')
}

export function checkBehaviorRules(
  output: string,
  context: BehaviorCheckContext = {}
): {
  passed: boolean
  hardFailed: boolean
  softFailed: boolean
  violations: BehaviorRuleViolation[]
} {
  const violations: BehaviorRuleViolation[] = []
  const normalizedOutput = normalizeText(output)
  const filePaths = uniqueMatches(normalizedOutput, PATH_PATTERN)

  if (BREAK_EXISTING_PATTERN.test(normalizedOutput)) {
    violations.push({
      ruleId: 'no-break-existing',
      severity: 'hard',
      reason: 'Output suggests deleting or rewriting working code without explicit approval.',
    })
  }

  if (filePaths.length > 5 && !VERIFICATION_WORD_PATTERN.test(normalizedOutput)) {
    violations.push({
      ruleId: 'verify-before-answer',
      severity: 'hard',
      reason: `Output references ${filePaths.length} file paths without saying they were verified or inspected.`,
    })
  }

  if (filePaths.length > 8 && isSimpleCodeTask(normalizeText(context.input))) {
    violations.push({
      ruleId: 'minimal-changes',
      severity: 'hard',
      reason: `Output spreads a simple code task across ${filePaths.length} files.`,
    })
  }

  if (filePaths.length > 0 && GENERIC_SYMBOL_PATTERN.test(normalizedOutput)) {
    violations.push({
      ruleId: 'no-hallucinated-apis',
      severity: 'hard',
      reason: 'Output pairs real file paths with generic invented-looking symbol names.',
    })
  }

  if (SCOPE_CREEP_PATTERN.test(normalizedOutput)) {
    violations.push({
      ruleId: 'stay-on-task',
      severity: 'soft',
      reason: 'Output introduces extra scope or side quests beyond the request.',
    })
  }

  if (
    /\bas any\b/.test(normalizedOutput) ||
    EMPTY_CATCH_PATTERN.test(normalizedOutput) ||
    BARE_TODO_PATTERN.test(normalizedOutput) ||
    DEBUG_LOG_PATTERN.test(normalizedOutput)
  ) {
    violations.push({
      ruleId: 'senior-engineer',
      severity: 'soft',
      reason: 'Output includes low-discipline code patterns like as any, empty catch, TODO, or debug logs.',
    })
  }

  if (ASK_FOR_CONTEXT_PATTERN.test(normalizedOutput) && hasRelevantExistingContext(context)) {
    violations.push({
      ruleId: 'use-context',
      severity: 'soft',
      reason: 'Output asks for context that appears to already exist in the current request or context block.',
    })
  }

  const hardFailed = violations.some((violation) => violation.severity === 'hard')
  const softFailed = violations.some((violation) => violation.severity === 'soft')

  return {
    passed: violations.length === 0,
    hardFailed,
    softFailed,
    violations,
  }
}

export async function loadCustomRules(): Promise<CustomBehaviorRule[]> {
  try {
    return await prisma.aICustomRule.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    })
  } catch (err) {
    console.error('[BehaviorRules] Error:', err)
    return []
  }
}

export function checkCustomRules(
  output: string,
  customRules: CustomBehaviorRule[]
): BehaviorRuleViolation[] {
  const violations: BehaviorRuleViolation[] = []

  for (const rule of customRules) {
    if (rule.blockedPattern) {
      try {
        const blockedRegex = new RegExp(rule.blockedPattern, 'i')
        if (blockedRegex.test(output)) {
          violations.push({
            ruleId: rule.id,
            severity: normalizeSeverity(rule.severity),
            reason: rule.description || `Blocked pattern matched for rule ${rule.id}.`,
          })
        }
      } catch {
        // Ignore malformed custom regex so one bad rule does not break checks.
      }
    }

    if (rule.requiredPattern) {
      try {
        const requiredRegex = new RegExp(rule.requiredPattern, 'i')
        if (!requiredRegex.test(output)) {
          violations.push({
            ruleId: rule.id,
            severity: normalizeSeverity(rule.severity),
            reason: rule.description || `Required pattern missing for rule ${rule.id}.`,
          })
        }
      } catch {
        // Ignore malformed custom regex so one bad rule does not break checks.
      }
    }
  }

  return violations
}

export async function logRuleViolations(
  userId: string | null,
  feature: string,
  violations: BehaviorRuleViolation[],
  iteration: number
): Promise<number | null> {
  if (violations.length === 0) {
    return 0
  }

  try {
    await Promise.all(
      violations.map((violation) =>
        prisma.aIRuleViolationLog.create({
          data: {
            userId,
            feature,
            ruleId: violation.ruleId,
            severity: violation.severity,
            reason: violation.reason,
            iteration,
          },
        })
      )
    )

    return violations.length
  } catch (err) {
    console.error('[BehaviorRules] Error:', err)
    return null
  }
}
