# Multi-stage Dockerfile for NestJS application optimized for Google Cloud Run
# Build for linux/amd64 so the image runs on Cloud Run (Apple Silicon builds arm64 by default)
ARG TARGETPLATFORM=linux/amd64

# Stage 1: Dependencies
FROM --platform=$TARGETPLATFORM node:20-alpine AS dependencies
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies (including dev dependencies for Prisma generation)
RUN npm ci

# Stage 2: Build
ARG TARGETPLATFORM=linux/amd64
FROM --platform=$TARGETPLATFORM node:20-alpine AS build
WORKDIR /app

# Copy dependencies from previous stage
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/package*.json ./

# Copy source code and config files
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the application
RUN npm run build

# Stage 3: Production
ARG TARGETPLATFORM=linux/amd64
FROM --platform=$TARGETPLATFORM node:20-alpine AS production
WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy Prisma schema and generated client
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma

# Copy built application
COPY --from=build /app/dist ./dist

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Change ownership
RUN chown -R nestjs:nodejs /app
USER nestjs

# Expose port (Cloud Run will set PORT env var)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application (NestJS outputs to dist/src/ when rootDir is src)
CMD ["node", "dist/src/main.js"]
