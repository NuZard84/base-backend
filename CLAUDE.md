# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev        # Start with watch mode
npm run start:debug      # Debug mode with watch

# Build
npm run build            # Compile TypeScript to dist/

# Code quality
npm run lint             # ESLint with auto-fix
npm run format           # Prettier formatting

# Testing
npm run test             # Run unit tests
npm run test:watch       # Watch mode
npm run test:cov         # Coverage report
npm run test:e2e         # End-to-end tests

# Database
npm run prisma:generate  # Regenerate Prisma client after schema changes
npm run prisma:migrate   # Deploy migrations
npm run prisma:seed      # Seed initial data
```

## Architecture

NestJS backend for a collaborative canvas/whiteboard SaaS platform. Core capabilities: real-time collaboration via WebSockets, AI-powered content generation (Google Gemini), JWT + Google OAuth auth, and role-based canvas sharing.

### Module Structure

```
src/
├── main.ts                    # Bootstrap: env validation, Swagger, CORS, global pipes
├── app.module.ts              # Root module wiring all feature modules
├── auth/                      # JWT + Google OAuth 2.0 strategies and guards
├── modules/
│   ├── canvases/             # Primary feature module
│   │   ├── canvases.service.ts    # Canvas CRUD + delta sync logic
│   │   ├── canvases.controller.ts # HTTP endpoints
│   │   ├── canvases.gateway.ts    # Socket.IO WebSocket gateway (/canvases ns)
│   │   └── canvas-shares/        # RBAC sharing (OWNER/EDITOR/COMMENTOR/VIEWER)
│   ├── ai-model-api/gemini/  # Google Gemini API wrapper
│   ├── pre-prompts/          # AI prompt template library
│   └── user/                 # User profile management
├── prisma/                   # Global PrismaModule + PrismaService (injected everywhere)
├── redis/                    # RedisModule via ioredis (used in auth for refresh tokens)
└── common/filters/           # GlobalExceptionFilter
```

### Key Architectural Patterns

**Delta Sync**: `canvases.service.ts` implements an optimized sync that only transmits changed nodes/edges using `clientId` for idempotency and `updatedAt` timestamps for comparison. The `SyncNodeDto` carries the full node state; the service diffs against DB state before writing.

**Spatial Indexing**: Nodes use Figma-style tile grid indexing (`tileIds`, `bboxMin/Max`) for viewport-based queries. The `viewport-query.dto.ts` and `getNodesInViewport` method in CanvasesService handle spatial filtering.

**WebSocket Auth**: The `CanvasesGateway` uses JWT token extracted from Socket.IO handshake `auth.token` or query params, validated via the same `JwtStrategy` as HTTP routes.

**Canvas Sharing Access Control**: `CanvasSharesService.validateAccess()` is called throughout `CanvasesService` before any operation. Roles gate read/write/admin capabilities.

### Database (Prisma + PostgreSQL)

Key models and relationships:
- `Canvas` → `Node[]` + `Edge[]` (canvas elements)
- `Canvas` → `CanvasShare[]` (collaboration with roles)
- `Node` has `parentNodeId` (self-referential for groups)
- `Edge` has unique constraint on `(canvasId, sourceNodeId, targetNodeId, edgeType)`
- `AIConversation` logs every Gemini call with token counts and cost tracking
- `UsageLog` tracks resource consumption per user

After any schema change in `prisma/schema.prisma`, run `npm run prisma:generate`.

### Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing secret |
| `EXPIRE_ACCESS_TOKEN` | Access token TTL in seconds |
| `EXPIRE_REFRESH_TOKEN` | Refresh token TTL in seconds |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret |
| `GOOGLE_CALLBACK_URL` | OAuth callback (default: `http://localhost:3000/api/auth/callback/google`) |
| `REDIS_HOST` | Redis hostname |
| `REDIS_PORT` | Redis port |
| `REDIS_PASSWORD` | Redis auth password |
| `FRONTEND_URL` | Comma-separated allowed CORS origins |
| `GEMINI_API_KEY` | Google Gemini API key (optional; logs warning if absent) |

### API Documentation

Swagger UI is served at `/api` when running. The app binds to `0.0.0.0:PORT` (default 8080) for Cloud Run compatibility.

### Deployment

CI/CD via GitHub Actions (`.github/workflows/deploy-production.yml`) deploys to Google Cloud Run on pushes to `main`. Uses GCP Artifact Registry + Workload Identity Federation (no service account keys in secrets).
