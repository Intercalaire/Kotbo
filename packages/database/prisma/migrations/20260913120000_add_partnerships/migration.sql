-- Module Partenariats : fiches partenaires, dossiers, accords versionnes,
-- avantages, publicites croisees, mesure des retombees, annuaire inter-serveurs
-- et reputation partagee. Voir packages/database/prisma/partnerships.prisma.
--
-- Aucune table existante n'est touchee : le module s'ajoute a cote. Les
-- colonnes `guildId` de `partners`, `partnerships` et `partner_applications`
-- sont nullables parce qu'un dossier de portee PLATFORM (partenariats de Kotbo
-- lui-meme) n'appartient a aucun serveur.

-- CreateEnum
CREATE TYPE "PartnershipScope" AS ENUM ('GUILD', 'PLATFORM');

-- CreateEnum
CREATE TYPE "PartnershipParty" AS ENUM ('US', 'PARTNER', 'BOTH');

-- CreateEnum
CREATE TYPE "PartnershipDirection" AS ENUM ('GRANTED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "PartnershipBenefitState" AS ENUM ('PLANNED', 'APPLIED', 'REVOKED', 'FAILED');

-- CreateEnum
CREATE TYPE "PartnershipCommitmentState" AS ENUM ('PENDING', 'ON_TRACK', 'AT_RISK', 'BREACHED', 'FULFILLED', 'WAIVED');

-- CreateEnum
CREATE TYPE "PartnershipPaymentStatus" AS ENUM ('SCHEDULED', 'DUE', 'RECEIVED', 'LATE', 'WAIVED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PartnershipProposalStatus" AS ENUM ('SENT', 'SEEN', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PartnerApplicationStatus" AS ENUM ('PENDING', 'REVIEWING', 'ACCEPTED', 'REJECTED', 'SPAM');

-- CreateEnum
CREATE TYPE "PartnershipReciprocityResult" AS ENUM ('OK', 'MISSING', 'ALTERED', 'UNREACHABLE');

-- CreateEnum
CREATE TYPE "PartnershipAgreementState" AS ENUM ('DRAFT', 'PROPOSED', 'ACCEPTED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "partnership_settings" (
    "guildId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultTier" TEXT NOT NULL DEFAULT 'PIPELINE',
    "requireDualApproval" BOOLEAN NOT NULL DEFAULT false,
    "staffChannelId" TEXT,
    "showcaseChannelId" TEXT,
    "adsChannelId" TEXT,
    "dedicatedCategoryId" TEXT,
    "partnerRoleId" TEXT,
    "referredRoleId" TEXT,
    "applicationsOpen" BOOLEAN NOT NULL DEFAULT false,
    "applicationFormId" TEXT,
    "applicationTicketTypeId" TEXT,
    "minMemberCount" INTEGER NOT NULL DEFAULT 0,
    "minServerAgeDays" INTEGER NOT NULL DEFAULT 0,
    "autoRejectBelowThreshold" BOOLEAN NOT NULL DEFAULT false,
    "autoPublishAds" BOOLEAN NOT NULL DEFAULT false,
    "adRotationHours" INTEGER NOT NULL DEFAULT 0,
    "reciprocityChecks" BOOLEAN NOT NULL DEFAULT false,
    "reciprocityIntervalHours" INTEGER NOT NULL DEFAULT 24,
    "reciprocityGraceCount" INTEGER NOT NULL DEFAULT 2,
    "autoApplyBenefits" BOOLEAN NOT NULL DEFAULT true,
    "autoBreachOnFailure" BOOLEAN NOT NULL DEFAULT false,
    "renewalNoticeDays" INTEGER NOT NULL DEFAULT 14,
    "autoArchiveAfterDays" INTEGER NOT NULL DEFAULT 0,
    "trackInvites" BOOLEAN NOT NULL DEFAULT true,
    "trackReferredActivity" BOOLEAN NOT NULL DEFAULT true,
    "retentionWindowDays" INTEGER NOT NULL DEFAULT 30,
    "notifyStaffChannel" BOOLEAN NOT NULL DEFAULT true,
    "notifyDashboard" BOOLEAN NOT NULL DEFAULT true,
    "notifyOwnerDm" BOOLEAN NOT NULL DEFAULT false,
    "digestFrequency" TEXT NOT NULL DEFAULT 'weekly',
    "digestChannelId" TEXT,
    "alertRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "directoryOptIn" BOOLEAN NOT NULL DEFAULT false,
    "directoryAcceptProposals" BOOLEAN NOT NULL DEFAULT true,
    "matchmakingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reputationShare" BOOLEAN NOT NULL DEFAULT false,
    "reputationConsume" BOOLEAN NOT NULL DEFAULT false,
    "financeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "paymentReminderDays" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partnership_settings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "scope" "PartnershipScope" NOT NULL DEFAULT 'GUILD',
    "guildId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'SERVER',
    "displayName" TEXT NOT NULL,
    "shortName" TEXT,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locale" TEXT,
    "timezone" TEXT,
    "partnerGuildId" TEXT,
    "inviteUrl" TEXT,
    "inviteCheckedAt" TIMESTAMP(3),
    "inviteState" TEXT,
    "iconUrl" TEXT,
    "bannerUrl" TEXT,
    "accentColor" TEXT,
    "memberCount" INTEGER,
    "memberCountAt" TIMESTAMP(3),
    "externalAudience" INTEGER,
    "links" JSONB,
    "trustScore" INTEGER NOT NULL DEFAULT 50,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    "blockedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_contacts" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'manager',
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "externalContact" TEXT,
    "notes" TEXT,
    "representative" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnerships" (
    "id" TEXT NOT NULL,
    "scope" "PartnershipScope" NOT NULL DEFAULT 'GUILD',
    "guildId" TEXT,
    "partnerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'PIPELINE',
    "stage" TEXT NOT NULL DEFAULT 'LEAD',
    "title" TEXT,
    "summary" TEXT,
    "terms" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "renewDays" INTEGER,
    "ownerUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "secondApprovedByUserId" TEXT,
    "secondApprovedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedByUserId" TEXT,
    "endReason" TEXT,
    "dedicatedChannelId" TEXT,
    "ticketId" TEXT,
    "showcaseMessageId" TEXT,
    "inviteCode" TEXT,
    "referredJoins" INTEGER NOT NULL DEFAULT 0,
    "referredLeaves" INTEGER NOT NULL DEFAULT 0,
    "referredActive" INTEGER NOT NULL DEFAULT 0,
    "healthScore" INTEGER NOT NULL DEFAULT 50,
    "healthComputedAt" TIMESTAMP(3),
    "amountCents" INTEGER,
    "amountPeriod" TEXT,
    "customFields" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partnerships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_bridges" (
    "id" TEXT NOT NULL,
    "localPartnershipId" TEXT NOT NULL,
    "remotePartnershipId" TEXT NOT NULL,
    "localGuildId" TEXT NOT NULL,
    "remoteGuildId" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "syncedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partnership_bridges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_agreements" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" "PartnershipAgreementState" NOT NULL DEFAULT 'DRAFT',
    "body" TEXT NOT NULL,
    "commitmentsSnapshot" JSONB,
    "proposedByUserId" TEXT,
    "proposedAt" TIMESTAMP(3),
    "acceptedByUs" BOOLEAN NOT NULL DEFAULT false,
    "acceptedByUsAt" TIMESTAMP(3),
    "acceptedByUsUserId" TEXT,
    "acceptedByPartner" BOOLEAN NOT NULL DEFAULT false,
    "acceptedByPartnerAt" TIMESTAMP(3),
    "acceptedByPartnerRef" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partnership_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_commitments" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "party" "PartnershipParty" NOT NULL DEFAULT 'PARTNER',
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "targetCount" INTEGER,
    "targetPeriod" TEXT,
    "targetRef" TEXT,
    "state" "PartnershipCommitmentState" NOT NULL DEFAULT 'PENDING',
    "failureStreak" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),
    "manualState" "PartnershipCommitmentState",
    "manualByUserId" TEXT,
    "manualAt" TIMESTAMP(3),
    "manualNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partnership_commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_commitment_periods" (
    "id" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "expected" INTEGER NOT NULL DEFAULT 0,
    "achieved" INTEGER NOT NULL DEFAULT 0,
    "state" "PartnershipCommitmentState" NOT NULL DEFAULT 'PENDING',
    "evidence" JSONB,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "partnership_commitment_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_benefits" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "direction" "PartnershipDirection" NOT NULL DEFAULT 'GRANTED',
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "targetRef" TEXT,
    "params" JSONB,
    "state" "PartnershipBenefitState" NOT NULL DEFAULT 'PLANNED',
    "lastError" TEXT,
    "appliedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partnership_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_benefit_grants" (
    "id" TEXT NOT NULL,
    "benefitId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL DEFAULT 'member',
    "preExisting" BOOLEAN NOT NULL DEFAULT false,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,

    CONSTRAINT "partnership_benefit_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_promotions" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "direction" "PartnershipDirection" NOT NULL DEFAULT 'GRANTED',
    "title" TEXT,
    "content" TEXT,
    "embed" JSONB,
    "imageUrl" TEXT,
    "inviteUrl" TEXT,
    "channelId" TEXT,
    "remoteChannelId" TEXT,
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "repeatHours" INTEGER NOT NULL DEFAULT 0,
    "replacePrevious" BOOLEAN NOT NULL DEFAULT true,
    "lastPostedAt" TIMESTAMP(3),
    "nextPostAt" TIMESTAMP(3),
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partnership_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_promotion_posts" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "reactionCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "partnership_promotion_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_reciprocity_checks" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" "PartnershipReciprocityResult" NOT NULL,
    "remoteChannelId" TEXT,
    "remoteMessageId" TEXT,
    "method" TEXT NOT NULL DEFAULT 'bridge',
    "detail" TEXT,

    CONSTRAINT "partnership_reciprocity_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_tracked_links" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "label" TEXT,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueCount" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partnership_tracked_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_referrals" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "retained" BOOLEAN NOT NULL DEFAULT false,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "voiceMinutes" INTEGER NOT NULL DEFAULT 0,
    "levelReached" INTEGER NOT NULL DEFAULT 0,
    "sanctionCount" INTEGER NOT NULL DEFAULT 0,
    "attribution" TEXT NOT NULL DEFAULT 'invite',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partnership_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_metric_daily" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "joins" INTEGER NOT NULL DEFAULT 0,
    "leaves" INTEGER NOT NULL DEFAULT 0,
    "retained" INTEGER NOT NULL DEFAULT 0,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "adPosts" INTEGER NOT NULL DEFAULT 0,
    "amountCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "partnership_metric_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_events" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB,
    "actorUserId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'bot',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partnership_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_notes" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorUserId" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partnership_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_documents" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "sharedWithPartner" BOOLEAN NOT NULL DEFAULT false,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partnership_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_payments" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "direction" "PartnershipDirection" NOT NULL DEFAULT 'RECEIVED',
    "label" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "PartnershipPaymentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "settledAt" TIMESTAMP(3),
    "method" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partnership_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_applications" (
    "id" TEXT NOT NULL,
    "scope" "PartnershipScope" NOT NULL DEFAULT 'GUILD',
    "guildId" TEXT,
    "partnerId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'form',
    "applicantUserId" TEXT,
    "applicantTag" TEXT,
    "projectName" TEXT NOT NULL,
    "projectKind" TEXT NOT NULL DEFAULT 'SERVER',
    "projectGuildId" TEXT,
    "inviteUrl" TEXT,
    "memberCount" INTEGER,
    "description" TEXT,
    "requestedType" TEXT,
    "answers" JSONB,
    "status" "PartnerApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "decisionReason" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "ticketId" TEXT,
    "partnershipId" TEXT,
    "screening" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_guest_access" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "capability" TEXT NOT NULL DEFAULT 'view',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partnership_guest_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_directory_listings" (
    "guildId" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT NOT NULL,
    "headline" TEXT,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "sizeBucket" TEXT,
    "iconUrl" TEXT,
    "bannerUrl" TEXT,
    "inviteUrl" TEXT,
    "seekingTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minPartnerSize" INTEGER NOT NULL DEFAULT 0,
    "openToProposals" BOOLEAN NOT NULL DEFAULT true,
    "reliabilityScore" INTEGER NOT NULL DEFAULT 50,
    "partnershipsDone" INTEGER NOT NULL DEFAULT 0,
    "lastPublishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partnership_directory_listings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "partnership_proposals" (
    "id" TEXT NOT NULL,
    "fromGuildId" TEXT NOT NULL,
    "toGuildId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT,
    "status" "PartnershipProposalStatus" NOT NULL DEFAULT 'SENT',
    "fromPartnershipId" TEXT,
    "toPartnershipId" TEXT,
    "sentByUserId" TEXT,
    "seenAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "responseNote" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partnership_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_match_suggestions" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "suggestedGuildId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" JSONB,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "dismissedAt" TIMESTAMP(3),
    "dismissedByUserId" TEXT,
    "proposalId" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partnership_match_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_reputation_reports" (
    "id" TEXT NOT NULL,
    "reporterGuildId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "subjectGuildId" TEXT,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "severity" INTEGER NOT NULL DEFAULT 1,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "withdrawnAt" TIMESTAMP(3),
    "reportedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_reputation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_reputation_signals" (
    "subjectGuildId" TEXT NOT NULL,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "reporterCount" INTEGER NOT NULL DEFAULT 0,
    "severityScore" INTEGER NOT NULL DEFAULT 0,
    "reasonBreakdown" JSONB,
    "firstReportedAt" TIMESTAMP(3),
    "lastReportedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_reputation_signals_pkey" PRIMARY KEY ("subjectGuildId")
);

-- CreateTable
CREATE TABLE "partner_blocklist_entries" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectRef" TEXT NOT NULL,
    "reason" TEXT,
    "sourcePartnershipId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_blocklist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnership_alert_states" (
    "key" TEXT NOT NULL,
    "lastFiredAt" TIMESTAMP(3) NOT NULL,
    "lastValue" DOUBLE PRECISION,

    CONSTRAINT "partnership_alert_states_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "partners_guildId_kind_idx" ON "partners"("guildId", "kind");

-- CreateIndex
CREATE INDEX "partners_guildId_displayName_idx" ON "partners"("guildId", "displayName");

-- CreateIndex
CREATE INDEX "partners_partnerGuildId_idx" ON "partners"("partnerGuildId");

-- CreateIndex
CREATE INDEX "partners_scope_blocked_idx" ON "partners"("scope", "blocked");

-- CreateIndex
CREATE INDEX "partner_contacts_partnerId_idx" ON "partner_contacts"("partnerId");

-- CreateIndex
CREATE INDEX "partner_contacts_userId_idx" ON "partner_contacts"("userId");

-- CreateIndex
CREATE INDEX "partnerships_guildId_stage_idx" ON "partnerships"("guildId", "stage");

-- CreateIndex
CREATE INDEX "partnerships_guildId_type_idx" ON "partnerships"("guildId", "type");

-- CreateIndex
CREATE INDEX "partnerships_partnerId_idx" ON "partnerships"("partnerId");

-- CreateIndex
CREATE INDEX "partnerships_stage_endAt_idx" ON "partnerships"("stage", "endAt");

-- CreateIndex
CREATE INDEX "partnerships_ownerUserId_idx" ON "partnerships"("ownerUserId");

-- CreateIndex
CREATE INDEX "partnerships_inviteCode_idx" ON "partnerships"("inviteCode");

-- CreateIndex
CREATE INDEX "partnership_bridges_remoteGuildId_idx" ON "partnership_bridges"("remoteGuildId");

-- CreateIndex
CREATE UNIQUE INDEX "partnership_bridges_localPartnershipId_remotePartnershipId_key" ON "partnership_bridges"("localPartnershipId", "remotePartnershipId");

-- CreateIndex
CREATE INDEX "partnership_agreements_partnershipId_state_idx" ON "partnership_agreements"("partnershipId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "partnership_agreements_partnershipId_version_key" ON "partnership_agreements"("partnershipId", "version");

-- CreateIndex
CREATE INDEX "partnership_commitments_partnershipId_state_idx" ON "partnership_commitments"("partnershipId", "state");

-- CreateIndex
CREATE INDEX "partnership_commitments_state_lastCheckedAt_idx" ON "partnership_commitments"("state", "lastCheckedAt");

-- CreateIndex
CREATE INDEX "partnership_commitment_periods_commitmentId_state_idx" ON "partnership_commitment_periods"("commitmentId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "partnership_commitment_periods_commitmentId_periodStart_key" ON "partnership_commitment_periods"("commitmentId", "periodStart");

-- CreateIndex
CREATE INDEX "partnership_benefits_partnershipId_state_idx" ON "partnership_benefits"("partnershipId", "state");

-- CreateIndex
CREATE INDEX "partnership_benefit_grants_subjectId_revokedAt_idx" ON "partnership_benefit_grants"("subjectId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "partnership_benefit_grants_benefitId_subjectId_key" ON "partnership_benefit_grants"("benefitId", "subjectId");

-- CreateIndex
CREATE INDEX "partnership_promotions_partnershipId_active_idx" ON "partnership_promotions"("partnershipId", "active");

-- CreateIndex
CREATE INDEX "partnership_promotions_active_nextPostAt_idx" ON "partnership_promotions"("active", "nextPostAt");

-- CreateIndex
CREATE INDEX "partnership_promotion_posts_promotionId_postedAt_idx" ON "partnership_promotion_posts"("promotionId", "postedAt");

-- CreateIndex
CREATE INDEX "partnership_promotion_posts_messageId_idx" ON "partnership_promotion_posts"("messageId");

-- CreateIndex
CREATE INDEX "partnership_reciprocity_checks_partnershipId_checkedAt_idx" ON "partnership_reciprocity_checks"("partnershipId", "checkedAt");

-- CreateIndex
CREATE INDEX "partnership_tracked_links_partnershipId_active_idx" ON "partnership_tracked_links"("partnershipId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "partnership_tracked_links_slug_key" ON "partnership_tracked_links"("slug");

-- CreateIndex
CREATE INDEX "partnership_referrals_guildId_joinedAt_idx" ON "partnership_referrals"("guildId", "joinedAt");

-- CreateIndex
CREATE INDEX "partnership_referrals_partnershipId_retained_idx" ON "partnership_referrals"("partnershipId", "retained");

-- CreateIndex
CREATE UNIQUE INDEX "partnership_referrals_partnershipId_userId_key" ON "partnership_referrals"("partnershipId", "userId");

-- CreateIndex
CREATE INDEX "partnership_metric_daily_dateKey_idx" ON "partnership_metric_daily"("dateKey");

-- CreateIndex
CREATE UNIQUE INDEX "partnership_metric_daily_partnershipId_dateKey_key" ON "partnership_metric_daily"("partnershipId", "dateKey");

-- CreateIndex
CREATE INDEX "partnership_events_partnershipId_createdAt_idx" ON "partnership_events"("partnershipId", "createdAt");

-- CreateIndex
CREATE INDEX "partnership_events_kind_createdAt_idx" ON "partnership_events"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "partnership_notes_partnershipId_createdAt_idx" ON "partnership_notes"("partnershipId", "createdAt");

-- CreateIndex
CREATE INDEX "partnership_documents_partnershipId_category_idx" ON "partnership_documents"("partnershipId", "category");

-- CreateIndex
CREATE INDEX "partnership_payments_partnershipId_status_idx" ON "partnership_payments"("partnershipId", "status");

-- CreateIndex
CREATE INDEX "partnership_payments_status_dueAt_idx" ON "partnership_payments"("status", "dueAt");

-- CreateIndex
CREATE INDEX "partner_applications_guildId_status_idx" ON "partner_applications"("guildId", "status");

-- CreateIndex
CREATE INDEX "partner_applications_applicantUserId_idx" ON "partner_applications"("applicantUserId");

-- CreateIndex
CREATE INDEX "partner_applications_status_createdAt_idx" ON "partner_applications"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "partnership_guest_access_tokenHash_key" ON "partnership_guest_access"("tokenHash");

-- CreateIndex
CREATE INDEX "partnership_guest_access_partnershipId_revokedAt_idx" ON "partnership_guest_access"("partnershipId", "revokedAt");

-- CreateIndex
CREATE INDEX "partnership_directory_listings_published_locale_idx" ON "partnership_directory_listings"("published", "locale");

-- CreateIndex
CREATE INDEX "partnership_proposals_toGuildId_status_idx" ON "partnership_proposals"("toGuildId", "status");

-- CreateIndex
CREATE INDEX "partnership_proposals_fromGuildId_status_idx" ON "partnership_proposals"("fromGuildId", "status");

-- CreateIndex
CREATE INDEX "partnership_proposals_status_expiresAt_idx" ON "partnership_proposals"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "partnership_match_suggestions_guildId_dismissed_score_idx" ON "partnership_match_suggestions"("guildId", "dismissed", "score");

-- CreateIndex
CREATE UNIQUE INDEX "partnership_match_suggestions_guildId_suggestedGuildId_key" ON "partnership_match_suggestions"("guildId", "suggestedGuildId");

-- CreateIndex
CREATE INDEX "partner_reputation_reports_subjectGuildId_shared_idx" ON "partner_reputation_reports"("subjectGuildId", "shared");

-- CreateIndex
CREATE INDEX "partner_reputation_reports_reporterGuildId_createdAt_idx" ON "partner_reputation_reports"("reporterGuildId", "createdAt");

-- CreateIndex
CREATE INDEX "partner_reputation_signals_severityScore_idx" ON "partner_reputation_signals"("severityScore");

-- CreateIndex
CREATE INDEX "partner_blocklist_entries_guildId_idx" ON "partner_blocklist_entries"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_blocklist_entries_guildId_subjectType_subjectRef_key" ON "partner_blocklist_entries"("guildId", "subjectType", "subjectRef");

-- AddForeignKey
ALTER TABLE "partnership_settings" ADD CONSTRAINT "partnership_settings_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_contacts" ADD CONSTRAINT "partner_contacts_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_bridges" ADD CONSTRAINT "partnership_bridges_localPartnershipId_fkey" FOREIGN KEY ("localPartnershipId") REFERENCES "partnerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_bridges" ADD CONSTRAINT "partnership_bridges_remotePartnershipId_fkey" FOREIGN KEY ("remotePartnershipId") REFERENCES "partnerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_agreements" ADD CONSTRAINT "partnership_agreements_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "partnerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_commitments" ADD CONSTRAINT "partnership_commitments_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "partnerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_commitment_periods" ADD CONSTRAINT "partnership_commitment_periods_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "partnership_commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_benefits" ADD CONSTRAINT "partnership_benefits_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "partnerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_benefit_grants" ADD CONSTRAINT "partnership_benefit_grants_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "partnership_benefits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_promotions" ADD CONSTRAINT "partnership_promotions_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "partnerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_promotion_posts" ADD CONSTRAINT "partnership_promotion_posts_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "partnership_promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_reciprocity_checks" ADD CONSTRAINT "partnership_reciprocity_checks_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "partnerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_tracked_links" ADD CONSTRAINT "partnership_tracked_links_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "partnerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_referrals" ADD CONSTRAINT "partnership_referrals_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "partnerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_metric_daily" ADD CONSTRAINT "partnership_metric_daily_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "partnerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_events" ADD CONSTRAINT "partnership_events_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "partnerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_notes" ADD CONSTRAINT "partnership_notes_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "partnerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_documents" ADD CONSTRAINT "partnership_documents_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "partnerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_payments" ADD CONSTRAINT "partnership_payments_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "partnerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_guest_access" ADD CONSTRAINT "partnership_guest_access_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "partnerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_directory_listings" ADD CONSTRAINT "partnership_directory_listings_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_proposals" ADD CONSTRAINT "partnership_proposals_fromGuildId_fkey" FOREIGN KEY ("fromGuildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_proposals" ADD CONSTRAINT "partnership_proposals_toGuildId_fkey" FOREIGN KEY ("toGuildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnership_match_suggestions" ADD CONSTRAINT "partnership_match_suggestions_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_reputation_reports" ADD CONSTRAINT "partner_reputation_reports_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_reputation_reports" ADD CONSTRAINT "partner_reputation_reports_reporterGuildId_fkey" FOREIGN KEY ("reporterGuildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_blocklist_entries" ADD CONSTRAINT "partner_blocklist_entries_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
