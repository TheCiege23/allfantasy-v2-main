-- Passkeys: sign in with Face ID, Touch ID, a fingerprint or Windows Hello (lib/auth/passkeys.ts).
-- A new, empty table: no existing row is read or rewritten.
CREATE TABLE "auth_passkeys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "auth_passkeys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_passkeys_credentialId_key" ON "auth_passkeys"("credentialId");

CREATE INDEX "auth_passkeys_userId_idx" ON "auth_passkeys"("userId");

ALTER TABLE "auth_passkeys" ADD CONSTRAINT "auth_passkeys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
