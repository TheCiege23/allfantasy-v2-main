import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { executeAIAction } from '@/lib/chimmy-actions/AIActionBindingService'
import { resolveActionLeagueWrite } from '@/lib/chimmy-actions/AIActionLeagueWriteContext'
import { getAIActionWriteScope } from '@/lib/chimmy-actions/AIActionWriteScope'
import { AI_ACTION_REGISTRY } from '@/lib/chimmy-actions/AIActionRegistry'
import { validateActionExecutionServerSide } from '@/lib/chimmy-actions/AIActionServerValidation'
import type { AIAction, AIActionContext, AIActionType } from '@/lib/chimmy-actions/AIActionModel'
import { recordUnifiedMemoryInteraction } from '@/lib/ai-memory/unified-memory-system'

const ActionTypeSchema = z.string().refine(
  (value): value is AIActionType => value in AI_ACTION_REGISTRY,
  'Unsupported AI action type.',
)

const RoleSchema = z.enum(['member', 'co-owner', 'commissioner', 'admin']).nullable()

const ActionSchema = z.object({
  id: z.string().min(1),
  type: ActionTypeSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  surface: z.string().min(1),
  leagueId: z.string().optional().nullable(),
  teamId: z.string().optional().nullable(),
  sport: z.string().optional().nullable(),
  leagueType: z.string().optional().nullable(),
  safetyClass: z.enum(['instant', 'confirmed', 'restricted']),
  requiresConfirmation: z.boolean(),
  requiresCommissioner: z.boolean(),
  requiresPremium: z.boolean(),
  requiredPermissions: z.array(z.enum(['member', 'co_owner', 'commissioner', 'admin', 'premium', 'commissioner_subscription'])),
  isAvailable: z.boolean(),
  disabledReason: z.string().nullable(),
  payload: z.record(z.unknown()),
  prefillTarget: z.string().nullable().optional(),
  prefillData: z.record(z.unknown()).optional(),
  workflowPrefill: z
    .object({
      workflowType: z.string().min(1),
      sport: z.string().nullable().optional(),
      leagueId: z.string().nullable().optional(),
      teamId: z.string().nullable().optional(),
      values: z.record(z.unknown()),
    })
    .nullable()
    .optional(),
  deepDiveHref: z.string().nullable().optional(),
  isDestructive: z.boolean().optional(),
  premiumBadgeLabel: z.string().optional(),
})

const ContextSchema = z.object({
  role: RoleSchema,
  sport: z.string().min(1),
  leagueType: z.string().min(1),
  leagueId: z.string().optional().nullable(),
  teamId: z.string().optional().nullable(),
  subscriptionState: z.object({
    hasPremium: z.boolean(),
    hasCommissioner: z.boolean(),
    hasAdmin: z.boolean(),
  }),
  leagueState: z.object({
    isLocked: z.boolean(),
    isWaiverOpen: z.boolean(),
    isLineupLocked: z.boolean(),
    isDraftActive: z.boolean(),
    isDraftComplete: z.boolean(),
    isTradeDeadlinePast: z.boolean(),
    isInPlayoffs: z.boolean(),
    currentWeek: z.number().optional(),
  }),
  rosterState: z
    .object({
      hasIR: z.boolean(),
      hasIL: z.boolean(),
      hasTaxi: z.boolean(),
      hasDevy: z.boolean(),
    })
    .optional(),
})

const RequestSchema = z.object({
  action: ActionSchema,
  context: ContextSchema,
})

export async function POST(request: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request payload.',
        details: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  const action = parsed.data.action as AIAction
  const context = {
    ...parsed.data.context,
    userId,
  } as AIActionContext

  const precheck = await validateActionExecutionServerSide(action, context, userId)
  if (!precheck.allowed) {
    return NextResponse.json(
      {
        ok: false,
        message: precheck.message,
        issues: precheck.issues,
      },
      { status: precheck.status },
    )
  }

  // From the AUTHORIZED context, never the client's action.leagueId.
  const writeScope = getAIActionWriteScope(action.type)
  const leagueWrite = await resolveActionLeagueWrite(precheck.context.leagueId, writeScope)
  const result = await executeAIAction(action, precheck.context, leagueWrite)
  if (!result.success) {
    return NextResponse.json(
      {
        ok: false,
        ...result,
      },
      { status: 400 },
    )
  }

  await recordUnifiedMemoryInteraction({
    userId,
    leagueId: precheck.context.leagueId ?? null,
    teamId: precheck.context.teamId ?? null,
    source: precheck.context.role === 'commissioner' ? 'commissioner' : 'actions',
    eventType: 'action_staged',
    content: `${action.type} on ${action.surface}`,
    sport: precheck.context.sport,
    metadata: {
      actionId: action.id,
      requiresConfirmation: action.requiresConfirmation,
      success: true,
      executed: false,
      writeScope,
    },
  })

  return NextResponse.json({
    ok: true,
    ...result,
  })
}
