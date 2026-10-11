-- Pages fonctionnalites du site vitrine, redigees depuis la console admin.
CREATE TABLE IF NOT EXISTS "feature_pages" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "slugFr" TEXT NOT NULL,
    "slugEn" TEXT NOT NULL,
    "modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content" JSONB NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "feature_pages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "feature_pages_key_key" ON "feature_pages"("key");
CREATE UNIQUE INDEX IF NOT EXISTS "feature_pages_slugFr_key" ON "feature_pages"("slugFr");
CREATE UNIQUE INDEX IF NOT EXISTS "feature_pages_slugEn_key" ON "feature_pages"("slugEn");
CREATE INDEX IF NOT EXISTS "feature_pages_published_position_idx" ON "feature_pages"("published", "position");
