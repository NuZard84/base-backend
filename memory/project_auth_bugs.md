---
name: project-auth-bugs
description: Auth bug fixes — random logout causes, bfcache stale state, refresh token race conditions, and token chain auto-recovery
metadata:
  type: project
---

# Auth Bug Fixes

## Token Rotation & Stale-Tab Recovery

**Problem:** Legitimate users were getting logged out with "Refresh token reuse detected" when a tab was backgrounded for >20s (bfcache, tab switching, slow network) and came back with the old cookie.

**Root cause:** `CONCURRENT_GRACE_MS = 20_000` only handled sub-20s concurrent tab races. Tabs backgrounded longer than 20s triggered full session revocation.

**Fix (auth.service.ts):** Token successor chain via Redis (atomic GETDEL):
- On rotation A→B: store `token-chain:{sessionId_A} = sessionId_B` in Redis (5-min TTL)
- On revoked token presentation:
  1. `GETDEL token-chain:{sessionId}` — atomic one-time consumption
  2. If chain found & successor valid → auto-recover stale tab (transparent rotation, no logout)
  3. If chain found but successor already revoked → real theft → revoke all sessions
  4. If no chain (TTL expired or Redis down) → fall back to 20s grace-period behavior

**Also added:** `rotateSession` now uses `updateMany(where: {isRevoked: false})` atomic guard to prevent double-rotation races where two concurrent requests both pass `findUnique` before either revokes.

## Why: grace period mismatch
The original 20s window was designed for same-millisecond concurrent tab races but fails for any meaningful background/bfcache scenario. The chain-based approach is time-independent — stale tabs auto-recover for up to 5 minutes.

## bfcache stale state
Frontend `api.ts` has `pageshow` handler that resets `isRefreshing`, releases lock, and calls `doTokenRefresh()` on bfcache restore. Backend now handles the resulting stale token gracefully via chain auto-recovery.

## Retry-on-rotation
Frontend retries once on "Session rotated — please retry" (500ms delay) — handles concurrent tab race where losing tab should retry with new cookie.

## Proactive tab-focus refresh
`visibilitychange` handler calls `doTokenRefresh()` when tab becomes visible and access token is expired/missing.

**How to apply:** Never re-add per-feature `@CheckLimit` quotas (credit-gated only). Never revert the chain-based auto-recovery to a simple grace-period check.
