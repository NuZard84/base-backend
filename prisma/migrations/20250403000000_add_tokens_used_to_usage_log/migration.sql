-- Add tokensUsed column to usage_logs for token-based quota tracking
ALTER TABLE "usage_logs" ADD COLUMN "tokensUsed" INTEGER;

-- Rename any existing PlanLimitOverride rows that used the old key name
UPDATE "plan_limit_overrides"
SET "limitKey" = 'maxAiTokensPerMonth'
WHERE "limitKey" = 'maxAiRequestsPerMonth';
