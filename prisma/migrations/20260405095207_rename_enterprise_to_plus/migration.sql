-- Create new enum type with PLUS instead of ENTERPRISE
CREATE TYPE "PlanTier_new" AS ENUM ('FREE', 'STARTER', 'PRO', 'PLUS');

-- Migrate users.plan (convert enum -> text -> new enum)
ALTER TABLE "users" ALTER COLUMN "plan" TYPE text;
UPDATE "users" SET "plan" = 'PLUS' WHERE "plan" = 'ENTERPRISE';
ALTER TABLE "users" ALTER COLUMN "plan" TYPE "PlanTier_new" USING "plan"::"PlanTier_new";
ALTER TABLE "users" ALTER COLUMN "plan" SET DEFAULT 'FREE'::"PlanTier_new";

-- Migrate users.trialTier (nullable, enum -> text -> new enum)
ALTER TABLE "users" ALTER COLUMN "trialTier" TYPE text;
UPDATE "users" SET "trialTier" = 'PLUS' WHERE "trialTier" = 'ENTERPRISE';
ALTER TABLE "users" ALTER COLUMN "trialTier" TYPE "PlanTier_new" USING "trialTier"::"PlanTier_new";

-- Migrate plan_feature_overrides.tier
ALTER TABLE "plan_feature_overrides" ALTER COLUMN "tier" TYPE text;
UPDATE "plan_feature_overrides" SET "tier" = 'PLUS' WHERE "tier" = 'ENTERPRISE';
ALTER TABLE "plan_feature_overrides" ALTER COLUMN "tier" TYPE "PlanTier_new" USING "tier"::"PlanTier_new";

-- Migrate plan_limit_overrides.tier
ALTER TABLE "plan_limit_overrides" ALTER COLUMN "tier" TYPE text;
UPDATE "plan_limit_overrides" SET "tier" = 'PLUS' WHERE "tier" = 'ENTERPRISE';
ALTER TABLE "plan_limit_overrides" ALTER COLUMN "tier" TYPE "PlanTier_new" USING "tier"::"PlanTier_new";

-- Drop old enum and rename new one
DROP TYPE "PlanTier";
ALTER TYPE "PlanTier_new" RENAME TO "PlanTier";
