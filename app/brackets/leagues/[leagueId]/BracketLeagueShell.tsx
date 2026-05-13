import Link from "next/link"
import { prisma } from "@/lib/prisma"

interface BracketLeagueShellProps {
  leagueId: string
  userId: string | null | undefined
}

const SPORT_LABELS: Record<string, string> = {
  NFL: "NFL",
  NHL: "NHL",
  NBA: "NBA",
  MLB: "MLB",
  NCAAF: "NCAA Football",
  NCAAB: "NCAA Basketball",
  SOCCER: "Soccer",
}

export async function BracketLeagueShell({ leagueId, userId }: BracketLeagueShellProps) {
  const league = await prisma.bracketLeague.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      name: true,
      joinCode: true,
      isPrivate: true,
      ownerId: true,
      scoringRules: true,
      deadline: true,
      tournamentId: true,
      tournament: {
        select: { name: true, sport: true },
      },
      _count: { select: { members: true, entries: true } },
      entries: {
        where: { status: { notIn: ["DRAFT", "INVALIDATED"] } },
        select: {
          id: true,
          name: true,
          user: { select: { displayName: true, email: true } },
        },
        take: 50,
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!league) return null

  const isOwner = userId === league.ownerId
  const rules = (league.scoringRules ?? {}) as Record<string, unknown>
  const sportKey = String(rules.sport ?? league.tournament?.sport ?? "")
  const sportLabel = SPORT_LABELS[sportKey] ?? sportKey
  const bracketType = String(rules.bracketType ?? rules.challengeType ?? "playoff_challenge")
  const bracketTypeLabel =
    bracketType === "mens_ncaa" ? "Classic NCAA" : "Playoff Challenge"
  const subhead = [sportLabel, bracketTypeLabel].filter(Boolean).join(" · ")

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          {subhead && (
            <div
              className="text-xs font-semibold uppercase tracking-wide mb-1"
              style={{ color: "var(--accent)" }}
            >
              {subhead}
            </div>
          )}
          <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>
            {league.name}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {league._count.members}{" "}
            {league._count.members === 1 ? "member" : "members"} ·{" "}
            {league._count.entries}{" "}
            {league._count.entries === 1 ? "entry" : "entries"}
          </p>
        </div>
        <Link
          href="/brackets"
          className="shrink-0 text-sm transition hover:opacity-70"
          style={{ color: "var(--muted)" }}
        >
          ← Brackets
        </Link>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/brackets/leagues/${leagueId}/entries/new`}
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-black transition"
          style={{ background: "var(--accent)" }}
        >
          + Create Entry
        </Link>

        {/* Join code */}
        <div
          className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm"
          style={{ borderColor: "var(--border)" }}
        >
          <span style={{ color: "var(--muted)" }}>
            {league.isPrivate ? "Invite code:" : "Code:"}
          </span>
          <span className="font-mono font-semibold" style={{ color: "var(--text)" }}>
            {league.joinCode}
          </span>
        </div>

        {/* Standings button */}
        <Link
          href={`/brackets/leagues/${leagueId}/standings`}
          className="inline-flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm transition"
          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
        >
          Standings
        </Link>

        {isOwner && (
          <Link
            href={`/brackets/leagues/${leagueId}/manage`}
            className="inline-flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm transition"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            Manage
          </Link>
        )}
      </div>

      {/* Entries table */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Entries
        </h2>

        {league.entries.length === 0 ? (
          <div
            className="rounded-xl border p-8 text-center"
            style={{ borderColor: "var(--border)" }}
          >
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              No entries yet. Be the first to fill a bracket!
            </p>
            <Link
              href={`/brackets/leagues/${leagueId}/entries/new`}
              className="mt-4 inline-block rounded-xl px-4 py-2.5 text-sm font-semibold text-black"
              style={{ background: "var(--accent)" }}
            >
              Create Entry
            </Link>
          </div>
        ) : (
          <div
            className="overflow-hidden rounded-xl border"
            style={{ borderColor: "var(--border)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="border-b"
                  style={{
                    borderColor: "var(--border)",
                    background: "color-mix(in srgb, var(--panel2) 80%, transparent)",
                  }}
                >
                  <th
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: "var(--muted)" }}
                  >
                    #
                  </th>
                  <th
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: "var(--muted)" }}
                  >
                    Entry Name
                  </th>
                  <th
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: "var(--muted)" }}
                  >
                    Submitted By
                  </th>
                  <th
                    className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide"
                    style={{ color: "var(--muted)" }}
                  >
                    View
                  </th>
                </tr>
              </thead>
              <tbody>
                {league.entries.map((entry, i) => (
                  <tr
                    key={entry.id}
                    className="border-b last:border-0 transition"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td
                      className="px-4 py-3 font-mono text-xs"
                      style={{ color: "var(--muted)" }}
                    >
                      {i + 1}
                    </td>
                    <td
                      className="px-4 py-3 font-semibold"
                      style={{ color: "var(--text)" }}
                    >
                      {entry.name}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--muted)" }}>
                      {entry.user?.displayName ?? entry.user?.email ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/bracket/${league.tournamentId}/entry/${entry.id}`}
                        className="text-xs font-semibold transition hover:opacity-70"
                        style={{ color: "var(--accent)" }}
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Pool chat shortcut */}
      <div
        className="flex items-center justify-between rounded-xl border p-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            Pool Chat
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
            Trash-talk and analysis with pool members
          </p>
        </div>
        <Link
          href={`/brackets?pool=${leagueId}&tab=chat`}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold transition"
          style={{
            background: "color-mix(in srgb, var(--accent) 14%, transparent)",
            color: "var(--accent)",
            border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)",
          }}
        >
          Open Chat
        </Link>
      </div>
    </main>
  )
}
