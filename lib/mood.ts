import { prisma } from "@/lib/prisma";
import { getDateKey } from "@/lib/usage";
import { MOOD_OPTIONS } from "@/lib/mood-options";

export { MOOD_OPTIONS, getMoodRecommendation } from "@/lib/mood-options";

type MoodEntry = {
  id: string;
  mood: string;
  note: string | null;
  dateKey: string;
  createdAt: string;
};

type MoodTrend = {
  dateKey: string;
  mood: string;
  emoji: string;
};

type MoodRow = {
  id: string;
  mood: string;
  note: string | null;
  date_key: string;
  created_at: Date;
};

let moodTablesReady: Promise<void> | null = null;

async function ensureMoodTables() {
  if (!moodTablesReady) {
    moodTablesReady = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "wellness_mood_entries" (
          "id" TEXT PRIMARY KEY,
          "user_id" TEXT NOT NULL,
          "mood" TEXT NOT NULL,
          "note" TEXT,
          "date_key" TEXT NOT NULL,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE ("user_id", "date_key")
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "wellness_mood_entries_user_id_idx"
        ON "wellness_mood_entries" ("user_id")
      `);
    })();
  }

  await moodTablesReady;
}

function toMoodEntry(row: MoodRow): MoodEntry {
  return {
    id: row.id,
    mood: row.mood,
    note: row.note,
    dateKey: row.date_key,
    createdAt: row.created_at.toISOString(),
  };
}

export async function logMoodEntry(userId: string, mood: string, note?: string): Promise<MoodEntry> {
  await ensureMoodTables();

  const dateKey = getDateKey();
  const entryId = crypto.randomUUID();
  const rows = await prisma.$queryRawUnsafe<MoodRow[]>(
    `
      INSERT INTO "wellness_mood_entries" ("id", "user_id", "mood", "note", "date_key")
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT ("user_id", "date_key")
      DO UPDATE SET
        "mood" = EXCLUDED."mood",
        "note" = EXCLUDED."note",
        "updated_at" = NOW()
      RETURNING "id", "mood", "note", "date_key", "created_at"
    `,
    entryId,
    userId,
    mood,
    note ?? null,
    dateKey
  );

  return toMoodEntry(rows[0]);
}

export async function getTodayMood(userId: string): Promise<MoodEntry | null> {
  await ensureMoodTables();

  const dateKey = getDateKey();
  const rows = await prisma.$queryRawUnsafe<MoodRow[]>(
    `
      SELECT "id", "mood", "note", "date_key", "created_at"
      FROM "wellness_mood_entries"
      WHERE "user_id" = $1 AND "date_key" = $2
      LIMIT 1
    `,
    userId,
    dateKey
  );

  return rows[0] ? toMoodEntry(rows[0]) : null;
}

export async function getMoodHistory(userId: string, days = 30): Promise<MoodTrend[]> {
  await ensureMoodTables();

  const rows = await prisma.$queryRawUnsafe<MoodRow[]>(
    `
      SELECT "id", "mood", "note", "date_key", "created_at"
      FROM "wellness_mood_entries"
      WHERE "user_id" = $1
      ORDER BY "created_at" DESC
      LIMIT $2
    `,
    userId,
    days
  );

  return rows.map((entry) => ({
    dateKey: entry.date_key,
    mood: entry.mood,
    emoji: MOOD_OPTIONS.find((item) => item.value === entry.mood)?.emoji ?? "🙂",
  }));
}
