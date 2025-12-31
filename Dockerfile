# AI Trading Agent - Production Dockerfile
# Multi-stage build for security and minimal image size

#==============================================================================
# Stage 1: Build
#==============================================================================
FROM node:20-bookworm-slim AS builder

# Install build dependencies for native modules (better-sqlite3, opus)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first (cache layer)
COPY package.json package-lock.json* ./

# Install all dependencies (including dev for build)
RUN npm ci --include=dev

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Prune dev dependencies for smaller image
RUN npm prune --production

#==============================================================================
# Stage 2: Production Runtime
#==============================================================================
FROM node:20-bookworm-slim AS runtime

# Security: Create non-root user
RUN groupadd --gid 1001 botuser \
    && useradd --uid 1001 --gid 1001 -m botuser

# Install runtime dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    # For Opus (Discord voice)
    libopus0 \
    # For better-sqlite3
    libsqlite3-0 \
    # For HTTPS/TLS
    ca-certificates \
    # For health checks
    curl \
    # For timezone support
    tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

WORKDIR /app

# Copy built application from builder (includes pruned node_modules)
COPY --from=builder --chown=botuser:botuser /app/dist ./dist
COPY --from=builder --chown=botuser:botuser /app/node_modules ./node_modules
COPY --from=builder --chown=botuser:botuser /app/package.json ./

# Create data directories with correct permissions
RUN mkdir -p /opt/discord-bot-data \
    && chown -R botuser:botuser /opt/discord-bot-data \
    && mkdir -p /app/data \
    && chown -R botuser:botuser /app/data

# Copy expertise templates if they exist
COPY --chown=botuser:botuser src/agents/expertise/ ./dist/agents/expertise/ 2>/dev/null || true
COPY --chown=botuser:botuser src/trading/expertise/ ./dist/trading/expertise/ 2>/dev/null || true

# Switch to non-root user
USER botuser

# Environment defaults (override via docker-compose or -e flags)
ENV NODE_ENV=production \
    DB_PATH=/opt/discord-bot-data/bot.db \
    WEBHOOK_PORT=3001 \
    DASHBOARD_PORT=9090 \
    TZ=UTC

# Expose ports
EXPOSE 3001 9090

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${WEBHOOK_PORT}/health || exit 1

# Volumes for persistent data
VOLUME ["/opt/discord-bot-data"]

# Start the bot
CMD ["node", "dist/main.js"]

#==============================================================================
# Labels (OCI standard)
#==============================================================================
LABEL org.opencontainers.image.title="AI Trading Agent" \
      org.opencontainers.image.description="Self-improving AI trading agent with Discord integration, learning loops, and expertise memory" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.vendor="arosstale" \
      org.opencontainers.image.source="https://github.com/arosstale/ai-trading-agent" \
      org.opencontainers.image.licenses="MIT"
