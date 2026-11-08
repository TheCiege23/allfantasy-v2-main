CREATE TABLE "sleeper_career_survival" (
    "user_id" TEXT NOT NULL,
    "platform_league_id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sleeper_career_survival_pkey" PRIMARY KEY ("user_id", "platform_league_id", "season"),
    CONSTRAINT "sleeper_career_survival_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
