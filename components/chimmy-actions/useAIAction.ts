'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { AIAction, AIActionContext } from '@/lib/chimmy-actions'
import { trackAIActionEvent } from '@/lib/chimmy-actions'

interface UseAIActionCallbacks {
  onSuccess?: (action: AIAction) => void
  onError?: (error: string) => void
}

interface UseAIActionReturn {
  /** Execute an action through the full Chimmy lifecycle */
  execute: (
    action: AIAction,
    context: AIActionContext,
    callbacks?: UseAIActionCallbacks,
  ) => Promise<void>
  /** True while any action is being processed */
  isExecuting: boolean
  /** The ID of the action currently being executed, or null */
  executingActionId: string | null
}

type ExecuteRouteResponse = {
  ok: boolean
  message?: string
  error?: string
  outcome?: 'staged' | 'failed'
  executed?: false
  writeScope?: string | null
  sourceLink?: { href: string; label: string } | null
  data?: {
    prefillTarget?: string | null
    prefillData?: Record<string, unknown>
    workflowPrefill?: {
      workflowType: string
      sport?: string | null
      leagueId?: string | null
      teamId?: string | null
      values: Record<string, unknown>
    } | null
  }
}

const EDITABLE_WORKFLOW_TYPES = new Set([
  'draft_queue',
  'draft_pick',
  'auction_bid',
  'waiver_claim',
  'watchlist',
  'lineup_edit',
  'trade_compose',
  'trade_analysis',
  'chat_compose',
  'roster_move',
  'league_discovery',
  'simulation',
  'announcement',
])

function isEditableWorkflowType(type?: string | null): boolean {
  return Boolean(type && EDITABLE_WORKFLOW_TYPES.has(type))
}

/**
 * useAIAction — React hook for executing Chimmy AI actions from UI components.
 *
 * Wraps executeAIAction() from the service layer, adds toast feedback,
 * and tracks loading state per-action so individual buttons can show spinners.
 *
 * Usage:
 *   const { execute, isExecuting, executingActionId } = useAIAction()
 *   execute(action, context, { onSuccess: () => ... })
 */
export function useAIAction(): UseAIActionReturn {
  const [executingActionId, setExecutingActionId] = useState<string | null>(null)

  const execute = useCallback(
    async (
      action: AIAction,
      context: AIActionContext,
      callbacks?: UseAIActionCallbacks,
    ): Promise<void> => {
      if (!action.isAvailable) {
        toast.error(action.disabledReason ?? 'This action is not available right now.')
        return
      }

      setExecutingActionId(action.id)

      // Log the clicked event
      await trackAIActionEvent({
        action,
        context,
        event: 'clicked',
        metadata: { source: 'use_ai_action' },
      })

      try {
        const validateRes = await fetch('/api/ai/actions/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, context }),
        })

        if (!validateRes.ok) {
          const failed = (await validateRes.json().catch(() => null)) as
            | { message?: string; error?: string; issues?: Array<{ message?: string }> }
            | null
          const issueMessage = failed?.issues?.[0]?.message
          const message = issueMessage ?? failed?.message ?? failed?.error ?? 'Action validation failed.'
          toast.error(`${action.label} blocked`, { description: message })
          callbacks?.onError?.(message)
          return
        }

        const executeRes = await fetch('/api/ai/actions/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, context }),
        })

        const result = (await executeRes.json().catch(() => null)) as ExecuteRouteResponse | null
        if (!result) {
          const message = 'Action execution returned an invalid response.'
          toast.error(`${action.label} failed`, { description: message })
          callbacks?.onError?.(message)
          return
        }

        if (executeRes.ok && result.ok) {
          if (action.type === 'save_recommendation' || action.type === 'save_waiver_plan') {
            await trackAIActionEvent({
              action,
              context,
              event: 'saved',
              metadata: {
                source: 'use_ai_action',
                followedSuggestion: false,
              },
            })
          }

          // Staged, not completed: the route validated and prefilled, and the manager still has
          // to submit. Logging 'completed' here is what made every staged action a "completion".
          await trackAIActionEvent({
            action,
            context,
            event: 'staged',
            metadata: {
              source: 'use_ai_action',
              followedSuggestion: true,
            },
          })

          const sourceLink = result.sourceLink ?? null
          toast.success(`${action.label} — ${result.writeScope ? 'staged' : 'ready!'}`, {
            description: result.message ?? 'Workflow prefill is ready.',
            ...(sourceLink
              ? {
                  action: {
                    label: sourceLink.label,
                    onClick: () => window.open(sourceLink.href, '_blank', 'noopener,noreferrer'),
                  },
                }
              : {}),
          })

          const workflowType = result.data?.workflowPrefill?.workflowType ?? null
          if (isEditableWorkflowType(workflowType)) {
            window.dispatchEvent(
              new CustomEvent('chimmy:workflow-prefill', {
                detail: {
                  actionId: action.id,
                  actionType: action.type,
                  prefillTarget: result.data?.prefillTarget ?? null,
                  prefillData: result.data?.prefillData ?? {},
                  workflowPrefill: result.data?.workflowPrefill ?? null,
                },
              }),
            )
          }

          callbacks?.onSuccess?.(action)
        } else {
          toast.error(`${action.label} failed`, {
            description: result.error ?? result.message ?? 'Something went wrong.',
          })
          callbacks?.onError?.(result.error ?? result.message ?? 'Unknown error')
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unexpected error'

        toast.error(`${action.label} failed`, { description: message })

        await trackAIActionEvent({
          action,
          context,
          event: 'failed',
          metadata: { reason: message, source: 'use_ai_action' },
        })

        callbacks?.onError?.(message)
      } finally {
        setExecutingActionId(null)
      }
    },
    [],
  )

  return {
    execute,
    isExecuting: executingActionId !== null,
    executingActionId,
  }
}
