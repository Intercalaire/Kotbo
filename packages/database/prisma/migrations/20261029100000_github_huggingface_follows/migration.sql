-- Réseaux sociaux : suivi de dépôts GitHub et de dépôts ou auteurs Hugging Face.
CREATE TABLE IF NOT EXISTS "github_repo_follows" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "branch" TEXT,
    "discordChannelId" TEXT,
    "mention" TEXT,
    "notifyCommits" BOOLEAN NOT NULL DEFAULT true,
    "notifyReleases" BOOLEAN NOT NULL DEFAULT true,
    "notifyPullRequests" BOOLEAN NOT NULL DEFAULT false,
    "notifyIssues" BOOLEAN NOT NULL DEFAULT false,
    "commitMessage" TEXT,
    "releaseMessage" TEXT,
    "pullRequestMessage" TEXT,
    "issueMessage" TEXT,
    "lastCommitSha" TEXT,
    "lastReleaseId" TEXT,
    "lastPullNumber" INTEGER,
    "lastIssueNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "github_repo_follows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "github_repo_follows_guildId_repo_key"
    ON "github_repo_follows"("guildId", "repo");
CREATE INDEX IF NOT EXISTS "github_repo_follows_repo_idx"
    ON "github_repo_follows"("repo");

DO $$ BEGIN
    ALTER TABLE "github_repo_follows" ADD CONSTRAINT "github_repo_follows_guildId_fkey"
        FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "huggingface_follows" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "discordChannelId" TEXT,
    "mention" TEXT,
    "message" TEXT,
    "lastCommitId" TEXT,
    "lastCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "huggingface_follows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "huggingface_follows_guildId_kind_target_key"
    ON "huggingface_follows"("guildId", "kind", "target");
CREATE INDEX IF NOT EXISTS "huggingface_follows_kind_target_idx"
    ON "huggingface_follows"("kind", "target");

DO $$ BEGIN
    ALTER TABLE "huggingface_follows" ADD CONSTRAINT "huggingface_follows_guildId_fkey"
        FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
