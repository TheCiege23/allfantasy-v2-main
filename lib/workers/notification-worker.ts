import "server-only";
import { Worker, Job, type ConnectionOptions } from "bullmq";
import { getRedisConnection, isRedisConfigured } from "@/lib/queues/bullmq";
import { QUEUE_NAMES } from "@/lib/jobs/types";
import type { NotificationJobPayload } from "@/lib/jobs/types";
import type { NotificationCategoryId } from "@/lib/notification-settings/types";
import { dispatchNotification } from "@/lib/notifications/NotificationDispatcher";
import { ENGINE } from "@/lib/analytics/eventNames";
import { recordEngineTelemetrySample } from "@/lib/analytics/recordAnalyticsEvent";
import { createTimer, logStructured } from "@/lib/logging/structured";

export type NotificationJobResult = {
  ok: boolean;
  jobId: string | undefined;
  processedAt: string;
  dispatched: number;
  error?: string;
};

let notificationWorker: Worker<NotificationJobPayload, NotificationJobResult> | null = null;

function getConnection(): ConnectionOptions {
  const connection = getRedisConnection();
  if (!connection) {
    throw new Error(
      "Redis is not configured. Notification worker requires REDIS_URL or REDIS_HOST/REDIS_PORT."
    );
  }
  return connection;
}

async function processNotificationJob(
  job: Job<NotificationJobPayload, NotificationJobResult>
): Promise<NotificationJobResult> {
  const timer = createTimer();
  const data = job.data;

  try {
    if (!data?.userIds?.length || !data?.category || !data?.type || !data?.title) {
      return {
        ok: false,
        jobId: job.id,
        processedAt: new Date().toISOString(),
        dispatched: 0,
        error: "Missing required fields: userIds, category, type, title",
      };
    }

    await dispatchNotification({
      userIds: data.userIds,
      category: data.category as NotificationCategoryId,
      productType: data.productType,
      type: data.type,
      title: data.title,
      body: data.body,
      actionHref: data.actionHref,
      actionLabel: data.actionLabel,
      meta: data.meta,
      severity: data.severity,
    });

    recordEngineTelemetrySample(ENGINE.NOTIFICATION_DISPATCH, {
      meta: {
        ok: true,
        category: data.category,
        type: data.type,
        recipientCount: data.userIds.length,
      },
    });

    return {
      ok: true,
      jobId: job.id,
      processedAt: new Date().toISOString(),
      dispatched: data.userIds.length,
    };
  } finally {
    const durationMs = Math.round(timer.elapsedMs());
    recordEngineTelemetrySample(ENGINE.JOB, {
      meta: {
        queue: QUEUE_NAMES.NOTIFICATIONS,
        jobType: data?.type ?? "unknown",
        jobId: job.id,
        durationMs,
      },
    });
  }
}

export function startNotificationWorker(): Worker<
  NotificationJobPayload,
  NotificationJobResult
> | null {
  if (!isRedisConfigured()) {
    logStructured("warn", "notification_worker", "redis_not_configured");
    return null;
  }

  if (notificationWorker) {
    return notificationWorker;
  }

  notificationWorker = new Worker<NotificationJobPayload, NotificationJobResult>(
    QUEUE_NAMES.NOTIFICATIONS,
    processNotificationJob,
    {
      connection: getConnection(),
      concurrency: 5,
    }
  );

  notificationWorker.on("completed", (job) => {
    logStructured("info", "notification_worker", "job_completed", { jobId: job.id });
  });

  notificationWorker.on("failed", (job, err) => {
    logStructured("error", "notification_worker", "job_failed", {
      jobId: job?.id,
      error: err?.message,
    });
  });

  notificationWorker.on("error", (err) => {
    logStructured("error", "notification_worker", "worker_error", { error: err?.message });
  });

  return notificationWorker;
}

export async function stopNotificationWorker(): Promise<void> {
  if (!notificationWorker) return;
  await notificationWorker.close();
  notificationWorker = null;
}

