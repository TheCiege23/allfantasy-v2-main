/** Add immutable native ADP observations. Default is dry-run; --apply is explicit.
 * node --env-file=.env --require ./scripts/_audit-preload.cjs --import tsx scripts/capture-draft-hq-adp.ts [--apply --production]
 */
import { prisma } from "../lib/prisma";
import { createRequire } from "node:module";
import { getDatabaseUrlOrThrow } from "../lib/env/database-url";
const { identifyTarget } = createRequire(import.meta.url)(
  "./db-target-identity.cjs",
);
import {
  preparationSnapshotGroups,
  persistPreparationSnapshotHistory,
} from "../lib/adp/preparationSnapshotWriter";
async function main() {
  const target = identifyTarget(getDatabaseUrlOrThrow());
  if (
    process.argv.includes("--apply") &&
    (target.kind === "production"
      ? !process.argv.includes("--production")
      : target.kind !== "safe")
  )
    throw new Error("Explicit verified database target is required");
  const rows = await prisma.draftPick.findMany({
    where: { session: { sessionKind: "live", sleeperDraftId: null } },
    take: 200000,
    orderBy: { id: "asc" },
    select: {
      team: true,
      playerId: true,
      playerName: true,
      position: true,
      overall: true,
      source: true,
      assetType: true,
      pickMetadata: true,
      session: {
        select: {
          id: true,
          sessionKind: true,
          sleeperDraftId: true,
          draftType: true,
          teamCount: true,
          playerPool: true,
          draftModeLabel: true,
          league: {
            select: {
              sport: true,
              season: true,
              scoring: true,
              isDynasty: true,
              leagueVariant: true,
              settings: true,
            },
          },
        },
      },
    },
  });
  const at = new Date(),
    groups = preparationSnapshotGroups(rows, at);
  const errors = process.argv.includes("--apply")
    ? await persistPreparationSnapshotHistory(rows, at)
    : [];
  console.log(
    JSON.stringify({
      target: target.kind,
      mode: process.argv.includes("--apply") ? "apply" : "dry-run",
      rowsScanned: rows.length,
      contexts: groups.length,
      players: groups.reduce((sum, g) => sum + g.entries.length, 0),
      observedAt: at.toISOString(),
      errors: errors.length,
    }),
  );
  if (errors.length) process.exitCode = 1;
}
main()
  .catch(() => {
    console.error("Draft HQ ADP capture failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
