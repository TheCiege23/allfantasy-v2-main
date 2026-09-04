import type { AutomationCategory, AutomationExecutionResult, AutomationStatus } from '@/lib/commissioner-ui/automations/decision-os-client'

/** Workflow-neutral — status is never severity-colored, the same rule every other module's status vocabulary follows. */
export const AUTOMATION_STATUS_LABELS: Record<AutomationStatus, string> = {
  enabled: 'Enabled',
  disabled: 'Disabled',
}

export const AUTOMATION_CATEGORY_LABELS: Record<AutomationCategory, string> = {
  waiver_management: 'Waiver Management',
  communications: 'Communications',
  compliance_reminders: 'Compliance Reminders',
  scheduling: 'Scheduling',
}

export const AUTOMATION_RESULT_LABELS: Record<AutomationExecutionResult, string> = {
  success: 'Success',
  failure: 'Failure',
  skipped: 'Skipped',
}
