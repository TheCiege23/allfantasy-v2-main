/**
 * DashboardAlertResolver — setup and notification alerts for dashboard.
 */

type AlertSeverity = "info" | "warning" | "success"

interface DashboardAlertConfig {
  id: string
  severity: AlertSeverity
  title: string
  message: string
  actionLabel?: string
  actionHref?: string
}

interface DashboardAlertsInput {
  isVerified?: boolean
  isAgeConfirmed?: boolean
  profileComplete?: boolean
}

/** Resolve setup alerts (verify email, age confirm, profile complete). */
export function getDashboardSetupAlerts(input: DashboardAlertsInput): DashboardAlertConfig[] {
  const alerts: DashboardAlertConfig[] = []
  if (!input.isVerified) {
    alerts.push({
      id: "verify_email",
      severity: "warning",
      title: "Complete your setup",
      message: "Verify your email to unlock all features.",
      actionLabel: "Verify",
      actionHref: "/verify",
    })
  }
  if (!input.isAgeConfirmed) {
    alerts.push({
      id: "age_confirm",
      severity: "warning",
      title: "Complete your setup",
      message: "Confirm your age (18+) to access leagues and brackets.",
      actionLabel: "Complete",
      actionHref: "/onboarding",
    })
  }
  if (input.isVerified && input.isAgeConfirmed && !input.profileComplete) {
    alerts.push({
      id: "profile_complete",
      severity: "warning",
      title: "Complete your setup",
      message: "Complete your profile to get started.",
      actionLabel: "Complete",
      actionHref: "/onboarding",
    })
  }
  return alerts
}

/** Whether user needs any setup action. */
export function needsSetupAction(input: DashboardAlertsInput): boolean {
  return !input.isVerified || !input.isAgeConfirmed || !input.profileComplete
}
