import { prisma } from "@/lib/prisma"

type AutomationHealthSummary = {
  pendingJobs: number
  runningJobs: number
  failedJobsLast24h: number
  completedJobsLast24h: number
  pendingNotifications: number
  failedNotifications: number
  latestRunsByJobType: Record<string, { runId: string; status: string; createdAt: string } | null>
}

const dayAgo = () => new Date(Date.now() - 24 * 60 * 60 * 1000)

/**
 * Lightweight observability for admin dashboards & uptime probes (no secrets).
 */
export async function getAutomationHealthSummary(): Promise<AutomationHealthSummary> {
  const since = dayAgo()

  const [
    pendingJobs,
    runningJobs,
    failedJobsLast24h,
    completedJobsLast24h,
    pendingNotifications,
    failedNotifications,
    recentRuns,
  ] = await Promise.all([
    prisma.automationJob.count({ where: { status: "pending" } }),
    prisma.automationJob.count({ where: { status: "running" } }),
    prisma.automationJob.count({
      where: {
        status: "failed",
        updatedAt: { gte: since },
      },
    }),
    prisma.automationJob.count({
      where: {
        status: "completed",
        updatedAt: { gte: since },
      },
    }),
    prisma.notificationOutbox.count({ where: { status: "pending" } }),
    prisma.notificationOutbox.count({ where: { status: "failed" } }),
    prisma.automationRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 150,
      select: {
        id: true,
        jobType: true,
        status: true,
        createdAt: true,
      },
    }),
  ])

  const latestRunsByJobType: AutomationHealthSummary["latestRunsByJobType"] = {}
  for (const run of recentRuns) {
    if (latestRunsByJobType[run.jobType]) continue
    latestRunsByJobType[run.jobType] = {
      runId: run.id,
      status: run.status,
      createdAt: run.createdAt.toISOString(),
    }
  }

  return {
    pendingJobs,
    runningJobs,
    failedJobsLast24h,
    completedJobsLast24h,
    pendingNotifications,
    failedNotifications,
    latestRunsByJobType,
  }
}
