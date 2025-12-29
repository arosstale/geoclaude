/**
 * Class 3.11: Session Isolation System
 * TAC Pattern: Per-conversation state isolation
 *
 * Provides clean boundaries between agent sessions:
 * - Isolated state per session (no cross-contamination)
 * - Session lifecycle management (create, suspend, resume, destroy)
 * - State snapshots for checkpointing
 * - Session inheritance for forking
 * - TTL-based automatic cleanup
 * - Session tagging and grouping
 */

import { EventEmitter } from "events";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

export type SessionStatus =
  | "active"
  | "suspended"
  | "completed"
  | "expired"
  | "error";

export interface SessionMetadata {
  id: string;
  parentId?: string; // For forked sessions
  agentId: string;
  userId: string;
  channelId: string;
  status: SessionStatus;
  createdAt: number;
  lastActivityAt: number;
  expiresAt?: number;
  tags: string[];
  context: Record<string, unknown>; // Initial context
}

export interface SessionState {
  sessionId: string;
  key: string;
  value: unknown;
  version: number;
  updatedAt: number;
}

export interface SessionSnapshot {
  id: string;
  sessionId: string;
  name: string;
  state: Record<string, unknown>;
  metadata: SessionMetadata;
  createdAt: number;
}

export interface SessionConfig {
  defaultTtlMs: number; // Default session TTL (30 minutes)
  maxStateSize: number; // Max state size per session (1MB)
  maxSnapshots: number; // Max snapshots per session
  cleanupIntervalMs: number; // How often to run cleanup (5 minutes)
  enableAutoCleanup: boolean;
}

export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  suspendedSessions: number;
  completedSessions: number;
  expiredSessions: number;
  errorSessions: number;
  totalSnapshots: number;
  avgStateSize: number;
  sessionsByAgent: Record<string, number>;
}

export interface IsolatedSession {
  metadata: SessionMetadata;
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  delete(key: string): boolean;
  getAll(): Record<string, unknown>;
  clear(): void;
  fork(newAgentId?: string): IsolatedSession;
  snapshot(name: string): SessionSnapshot;
  suspend(): void;
  resume(): void;
  complete(): void;
  touch(): void; // Update last activity
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: SessionConfig = {
  defaultTtlMs: 30 * 60 * 1000, // 30 minutes
  maxStateSize: 1024 * 1024, // 1MB
  maxSnapshots: 10,
  cleanupIntervalMs: 5 * 60 * 1000, // 5 minutes
  enableAutoCleanup: true,
};

// ============================================================================
// Session Isolation System
// ============================================================================

export class SessionIsolationSystem extends EventEmitter {
  private db: Database.Database;
  private config: SessionConfig;
  private cleanupTimer?: NodeJS.Timeout;
  private activeSessions: Map<string, IsolatedSession> = new Map();

  constructor(dataDir: string, config: Partial<SessionConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    const dbPath = path.join(dataDir, "session-isolation.db");
    fs.mkdirSync(dataDir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();

    if (this.config.enableAutoCleanup) {
      this.startCleanupTimer();
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        agent_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        expires_at INTEGER,
        tags TEXT NOT NULL DEFAULT '[]',
        context TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS session_state (
        session_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, key),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS session_snapshots (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        state TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_channel ON sessions(channel_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_state_session ON session_state(session_id);
      CREATE INDEX IF NOT EXISTS idx_snapshots_session ON session_snapshots(session_id);
    `);
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, this.config.cleanupIntervalMs);
  }

  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Create a new isolated session
   */
  createSession(params: {
    agentId: string;
    userId: string;
    channelId: string;
    parentId?: string;
    ttlMs?: number;
    tags?: string[];
    context?: Record<string, unknown>;
  }): IsolatedSession {
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const ttl = params.ttlMs ?? this.config.defaultTtlMs;

    const metadata: SessionMetadata = {
      id,
      parentId: params.parentId,
      agentId: params.agentId,
      userId: params.userId,
      channelId: params.channelId,
      status: "active",
      createdAt: now,
      lastActivityAt: now,
      expiresAt: ttl > 0 ? now + ttl : undefined,
      tags: params.tags ?? [],
      context: params.context ?? {},
    };

    // Save to database
    this.db
      .prepare(
        `
      INSERT INTO sessions (id, parent_id, agent_id, user_id, channel_id, status, created_at, last_activity_at, expires_at, tags, context)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        metadata.id,
        metadata.parentId ?? null,
        metadata.agentId,
        metadata.userId,
        metadata.channelId,
        metadata.status,
        metadata.createdAt,
        metadata.lastActivityAt,
        metadata.expiresAt ?? null,
        JSON.stringify(metadata.tags),
        JSON.stringify(metadata.context)
      );

    // If this is a fork, copy parent state
    if (params.parentId) {
      this.copyParentState(params.parentId, id);
    }

    const session = this.createSessionProxy(metadata);
    this.activeSessions.set(id, session);

    this.emit("session:created", { session: metadata });
    return session;
  }

  private copyParentState(parentId: string, childId: string): void {
    const states = this.db
      .prepare(`SELECT key, value, version FROM session_state WHERE session_id = ?`)
      .all(parentId) as Array<{ key: string; value: string; version: number }>;

    const now = Date.now();
    const insert = this.db.prepare(`
      INSERT INTO session_state (session_id, key, value, version, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const state of states) {
      insert.run(childId, state.key, state.value, 1, now);
    }
  }

  private createSessionProxy(metadata: SessionMetadata): IsolatedSession {
    const self = this;

    return {
      metadata,

      get<T = unknown>(key: string): T | undefined {
        const row = self.db
          .prepare(`SELECT value FROM session_state WHERE session_id = ? AND key = ?`)
          .get(metadata.id, key) as { value: string } | undefined;

        if (!row) return undefined;
        return JSON.parse(row.value) as T;
      },

      set<T = unknown>(key: string, value: T): void {
        const serialized = JSON.stringify(value);
        if (serialized.length > self.config.maxStateSize) {
          throw new Error(
            `State value exceeds max size (${serialized.length} > ${self.config.maxStateSize})`
          );
        }

        const now = Date.now();
        self.db
          .prepare(
            `
          INSERT INTO session_state (session_id, key, value, version, updated_at)
          VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(session_id, key) DO UPDATE SET
            value = excluded.value,
            version = version + 1,
            updated_at = excluded.updated_at
        `
          )
          .run(metadata.id, key, serialized, now);

        this.touch();
        self.emit("session:state-changed", {
          sessionId: metadata.id,
          key,
          value,
        });
      },

      delete(key: string): boolean {
        const result = self.db
          .prepare(`DELETE FROM session_state WHERE session_id = ? AND key = ?`)
          .run(metadata.id, key);

        this.touch();
        return result.changes > 0;
      },

      getAll(): Record<string, unknown> {
        const rows = self.db
          .prepare(`SELECT key, value FROM session_state WHERE session_id = ?`)
          .all(metadata.id) as Array<{ key: string; value: string }>;

        const state: Record<string, unknown> = {};
        for (const row of rows) {
          state[row.key] = JSON.parse(row.value);
        }
        return state;
      },

      clear(): void {
        self.db
          .prepare(`DELETE FROM session_state WHERE session_id = ?`)
          .run(metadata.id);
        this.touch();
      },

      fork(newAgentId?: string): IsolatedSession {
        return self.createSession({
          agentId: newAgentId ?? metadata.agentId,
          userId: metadata.userId,
          channelId: metadata.channelId,
          parentId: metadata.id,
          tags: [...metadata.tags],
          context: { ...metadata.context },
        });
      },

      snapshot(name: string): SessionSnapshot {
        // Check snapshot limit
        const count = self.db
          .prepare(
            `SELECT COUNT(*) as cnt FROM session_snapshots WHERE session_id = ?`
          )
          .get(metadata.id) as { cnt: number };

        if (count.cnt >= self.config.maxSnapshots) {
          // Delete oldest snapshot
          self.db
            .prepare(
              `
            DELETE FROM session_snapshots
            WHERE id = (
              SELECT id FROM session_snapshots
              WHERE session_id = ?
              ORDER BY created_at ASC
              LIMIT 1
            )
          `
            )
            .run(metadata.id);
        }

        const snapshot: SessionSnapshot = {
          id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sessionId: metadata.id,
          name,
          state: this.getAll(),
          metadata: { ...metadata },
          createdAt: Date.now(),
        };

        self.db
          .prepare(
            `
          INSERT INTO session_snapshots (id, session_id, name, state, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
          )
          .run(
            snapshot.id,
            snapshot.sessionId,
            snapshot.name,
            JSON.stringify(snapshot.state),
            JSON.stringify(snapshot.metadata),
            snapshot.createdAt
          );

        self.emit("session:snapshot", { snapshot });
        return snapshot;
      },

      suspend(): void {
        metadata.status = "suspended";
        self.updateSessionStatus(metadata.id, "suspended");
        self.emit("session:suspended", { sessionId: metadata.id });
      },

      resume(): void {
        metadata.status = "active";
        self.updateSessionStatus(metadata.id, "active");
        this.touch();
        self.emit("session:resumed", { sessionId: metadata.id });
      },

      complete(): void {
        metadata.status = "completed";
        self.updateSessionStatus(metadata.id, "completed");
        self.activeSessions.delete(metadata.id);
        self.emit("session:completed", { sessionId: metadata.id });
      },

      touch(): void {
        const now = Date.now();
        metadata.lastActivityAt = now;
        self.db
          .prepare(`UPDATE sessions SET last_activity_at = ? WHERE id = ?`)
          .run(now, metadata.id);
      },
    };
  }

  private updateSessionStatus(sessionId: string, status: SessionStatus): void {
    this.db
      .prepare(`UPDATE sessions SET status = ? WHERE id = ?`)
      .run(status, sessionId);
  }

  /**
   * Get an existing session by ID
   */
  getSession(sessionId: string): IsolatedSession | null {
    // Check cache first
    const cached = this.activeSessions.get(sessionId);
    if (cached) return cached;

    // Load from database
    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(sessionId) as
      | {
          id: string;
          parent_id: string | null;
          agent_id: string;
          user_id: string;
          channel_id: string;
          status: SessionStatus;
          created_at: number;
          last_activity_at: number;
          expires_at: number | null;
          tags: string;
          context: string;
        }
      | undefined;

    if (!row) return null;

    const metadata: SessionMetadata = {
      id: row.id,
      parentId: row.parent_id ?? undefined,
      agentId: row.agent_id,
      userId: row.user_id,
      channelId: row.channel_id,
      status: row.status,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      expiresAt: row.expires_at ?? undefined,
      tags: JSON.parse(row.tags),
      context: JSON.parse(row.context),
    };

    const session = this.createSessionProxy(metadata);

    if (metadata.status === "active") {
      this.activeSessions.set(sessionId, session);
    }

    return session;
  }

  /**
   * Get all sessions for a user
   */
  getUserSessions(
    userId: string,
    status?: SessionStatus
  ): SessionMetadata[] {
    let query = `SELECT * FROM sessions WHERE user_id = ?`;
    const params: unknown[] = [userId];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY last_activity_at DESC`;

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string;
      parent_id: string | null;
      agent_id: string;
      user_id: string;
      channel_id: string;
      status: SessionStatus;
      created_at: number;
      last_activity_at: number;
      expires_at: number | null;
      tags: string;
      context: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      parentId: row.parent_id ?? undefined,
      agentId: row.agent_id,
      userId: row.user_id,
      channelId: row.channel_id,
      status: row.status,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      expiresAt: row.expires_at ?? undefined,
      tags: JSON.parse(row.tags),
      context: JSON.parse(row.context),
    }));
  }

  /**
   * Get sessions by tag
   */
  getSessionsByTag(tag: string): SessionMetadata[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM sessions
      WHERE tags LIKE ?
      ORDER BY last_activity_at DESC
    `
      )
      .all(`%"${tag}"%`) as Array<{
      id: string;
      parent_id: string | null;
      agent_id: string;
      user_id: string;
      channel_id: string;
      status: SessionStatus;
      created_at: number;
      last_activity_at: number;
      expires_at: number | null;
      tags: string;
      context: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      parentId: row.parent_id ?? undefined,
      agentId: row.agent_id,
      userId: row.user_id,
      channelId: row.channel_id,
      status: row.status,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      expiresAt: row.expires_at ?? undefined,
      tags: JSON.parse(row.tags),
      context: JSON.parse(row.context),
    }));
  }

  /**
   * Get snapshots for a session
   */
  getSnapshots(sessionId: string): SessionSnapshot[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM session_snapshots WHERE session_id = ? ORDER BY created_at DESC`
      )
      .all(sessionId) as Array<{
      id: string;
      session_id: string;
      name: string;
      state: string;
      metadata: string;
      created_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      name: row.name,
      state: JSON.parse(row.state),
      metadata: JSON.parse(row.metadata),
      createdAt: row.created_at,
    }));
  }

  /**
   * Restore session from snapshot
   */
  restoreFromSnapshot(snapshotId: string): IsolatedSession | null {
    const row = this.db
      .prepare(`SELECT * FROM session_snapshots WHERE id = ?`)
      .get(snapshotId) as
      | {
          id: string;
          session_id: string;
          name: string;
          state: string;
          metadata: string;
          created_at: number;
        }
      | undefined;

    if (!row) return null;

    const snapshotMetadata = JSON.parse(row.metadata) as SessionMetadata;
    const snapshotState = JSON.parse(row.state) as Record<string, unknown>;

    // Create new session with snapshot's context
    const session = this.createSession({
      agentId: snapshotMetadata.agentId,
      userId: snapshotMetadata.userId,
      channelId: snapshotMetadata.channelId,
      tags: [...snapshotMetadata.tags, `restored-from:${snapshotId}`],
      context: snapshotMetadata.context,
    });

    // Restore state
    for (const [key, value] of Object.entries(snapshotState)) {
      session.set(key, value);
    }

    this.emit("session:restored", {
      sessionId: session.metadata.id,
      snapshotId,
    });

    return session;
  }

  /**
   * Cleanup expired sessions
   */
  cleanupExpiredSessions(): number {
    const now = Date.now();

    // Mark expired sessions
    const expiredResult = this.db
      .prepare(
        `
      UPDATE sessions SET status = 'expired'
      WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?
    `
      )
      .run(now);

    // Remove very old sessions (completed/expired/error older than 7 days)
    const cleanupThreshold = now - 7 * 24 * 60 * 60 * 1000;
    const cleanedResult = this.db
      .prepare(
        `
      DELETE FROM sessions
      WHERE status IN ('completed', 'expired', 'error')
      AND last_activity_at < ?
    `
      )
      .run(cleanupThreshold);

    // Clear from cache
    for (const [id, session] of this.activeSessions) {
      if (
        session.metadata.expiresAt &&
        session.metadata.expiresAt < now
      ) {
        this.activeSessions.delete(id);
      }
    }

    const total = expiredResult.changes + cleanedResult.changes;
    if (total > 0) {
      this.emit("sessions:cleaned", {
        expired: expiredResult.changes,
        deleted: cleanedResult.changes,
      });
    }

    return total;
  }

  /**
   * Get session statistics
   */
  getStats(): SessionStats {
    const statusCounts = this.db
      .prepare(
        `
      SELECT status, COUNT(*) as cnt FROM sessions GROUP BY status
    `
      )
      .all() as Array<{ status: SessionStatus; cnt: number }>;

    const agentCounts = this.db
      .prepare(
        `
      SELECT agent_id, COUNT(*) as cnt FROM sessions WHERE status = 'active' GROUP BY agent_id
    `
      )
      .all() as Array<{ agent_id: string; cnt: number }>;

    const snapshotCount = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM session_snapshots`)
      .get() as { cnt: number };

    const stateStats = this.db
      .prepare(
        `
      SELECT AVG(LENGTH(value)) as avg_size FROM session_state
    `
      )
      .get() as { avg_size: number | null };

    const stats: SessionStats = {
      totalSessions: 0,
      activeSessions: 0,
      suspendedSessions: 0,
      completedSessions: 0,
      expiredSessions: 0,
      errorSessions: 0,
      totalSnapshots: snapshotCount.cnt,
      avgStateSize: stateStats.avg_size ?? 0,
      sessionsByAgent: {},
    };

    for (const { status, cnt } of statusCounts) {
      stats.totalSessions += cnt;
      switch (status) {
        case "active":
          stats.activeSessions = cnt;
          break;
        case "suspended":
          stats.suspendedSessions = cnt;
          break;
        case "completed":
          stats.completedSessions = cnt;
          break;
        case "expired":
          stats.expiredSessions = cnt;
          break;
        case "error":
          stats.errorSessions = cnt;
          break;
      }
    }

    for (const { agent_id, cnt } of agentCounts) {
      stats.sessionsByAgent[agent_id] = cnt;
    }

    return stats;
  }

  /**
   * Destroy a session and all its state
   */
  destroySession(sessionId: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM sessions WHERE id = ?`)
      .run(sessionId);

    this.activeSessions.delete(sessionId);

    if (result.changes > 0) {
      this.emit("session:destroyed", { sessionId });
    }

    return result.changes > 0;
  }

  /**
   * Close the system
   */
  close(): void {
    this.stopCleanupTimer();
    this.activeSessions.clear();
    this.db.close();
    this.emit("system:closed");
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let instance: SessionIsolationSystem | null = null;

export function getSessionIsolation(
  dataDir: string,
  config?: Partial<SessionConfig>
): SessionIsolationSystem {
  if (!instance) {
    instance = new SessionIsolationSystem(dataDir, config);
  }
  return instance;
}

export function resetSessionIsolation(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
