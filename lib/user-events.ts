import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

type UserEventType =
  | "trade_analysis_completed"
  | "trade_analysis_started"
  | "ai_report_generated"
  | "league_imported"
  | "user_login"
  | "waiver_analysis_completed"
  | "waiver_analysis_started"
  | "rankings_analysis_completed"
  | "rankings_analysis_started"
  | "trade_proposal_generated"
  | "trade_finder_used"
  | "ai_chat_used"
  | "social_post_generated"
  | "manager_compare_used"
  | "trade_hub_report_generated";

export function logUserEvent(
  userId: string,
  eventType: UserEventType,
  metadata?: Record<string, unknown>
) {
  prisma.userEvent.create({
    data: {
      userId,
      eventType,
      metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  }).catch(() => {});
}

export function logUserEventByUsername(
  sleeperUsername: string,
  eventType: UserEventType,
  metadata?: Record<string, unknown>
) {
  const normalized = sleeperUsername.toLowerCase().trim();
  if (!normalized) return;
  prisma.legacyUser.findUnique({
    where: { sleeperUsername: normalized },
    select: { id: true },
  }).then((user) => {
    if (!user) return;
    logUserEvent(user.id, eventType, metadata);
  }).catch(() => {});
}
