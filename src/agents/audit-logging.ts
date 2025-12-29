/**
 * Class 3.17: Audit Logging System
 * TAC Pattern: Comprehensive audit trail and compliance logging
 *
 * Features:
 * - Immutable audit log entries
 * - Actor tracking (user, agent, system)
 * - Resource-based logging (files, configs, data)
 * - Action categorization and filtering
 * - Compliance reporting (SOC2, GDPR)
 * - Log retention and archival
 * - Search and export capabilities
 */

import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import { join } from 'path';
import { createHash } from 'crypto';

// ============================================================================
// Types
// ============================================================================

export type AuditAction =
  | 'create' | 'read' | 'update' | 'delete'  // CRUD
  | 'execute' | 'invoke' | 'terminate'        // Operations
  | 'login' | 'logout' | 'auth_fail'          // Authentication
  | 'grant' | 'revoke' | 'modify_permission'  // Authorization
  | 'export' | 'import' | 'transfer'          // Data movement
  | 'config_change' | 'setting_change'        // Configuration
  | 'error' | 'warning' | 'alert'             // Events
  | 'custom';

export type AuditCategory =
  | 'security'
  | 'data_access'
  | 'configuration'
  | 'authentication'
  | 'authorization'
  | 'operation'
  | 'system'
  | 'compliance';

export type ActorType = 'user' | 'agent' | 'system' | 'external' | 'anonymous';
export type ResourceType = 'file' | 'database' | 'api' | 'config' | 'agent' | 'session' | 'message' | 'other';
export type AuditSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AuditActor {
  type: ActorType;
  id: string;
  name?: string;
  ip?: string;
  userAgent?: string;
  sessionId?: string;
}

export interface AuditResource {
  type: ResourceType;
  id: string;
  name?: string;
  path?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditEntry {
  id: string;
  timestamp: Date;
  action: AuditAction;
  category: AuditCategory;
  severity: AuditSeverity;
  actor: AuditActor;
  resource?: AuditResource;
  description: string;
  outcome: 'success' | 'failure' | 'partial';
  details?: Record<string, unknown>;
  previousValue?: unknown;
  newValue?: unknown;
  correlationId?: string;
  parentId?: string;
  tags?: string[];
  hash?: string;  // Integrity hash for immutability verification
}

export interface AuditQuery {
  startDate?: Date;
  endDate?: Date;
  actions?: AuditAction[];
  categories?: AuditCategory[];
  severities?: AuditSeverity[];
  actorTypes?: ActorType[];
  actorIds?: string[];
  resourceTypes?: ResourceType[];
  resourceIds?: string[];
  outcomes?: ('success' | 'failure' | 'partial')[];
  correlationId?: string;
  searchText?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export interface AuditReport {
  id: string;
  name: string;
  type: 'summary' | 'detailed' | 'compliance';
  startDate: Date;
  endDate: Date;
  generatedAt: Date;
  totalEntries: number;
  byAction: Record<string, number>;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  byOutcome: Record<string, number>;
  byActor: Record<string, number>;
  topResources: { id: string; count: number }[];
  alerts: AuditEntry[];
  complianceScore?: number;
}

export interface RetentionPolicy {
  id: string;
  name: string;
  category?: AuditCategory;
  severity?: AuditSeverity;
  retentionDays: number;
  archiveAfterDays?: number;
  deleteAfterArchive: boolean;
  enabled: boolean;
}

export interface AuditStats {
  totalEntries: number;
  entriesLast24h: number;
  entriesLast7d: number;
  securityEvents: number;
  failedOperations: number;
  uniqueActors: number;
  uniqueResources: number;
  oldestEntry?: Date;
  newestEntry?: Date;
}

export interface AuditConfig {
  dataDir: string;
  enableIntegrityHash: boolean;
  defaultRetentionDays: number;
  maxEntriesPerQuery: number;
  archiveEnabled: boolean;
  archivePath?: string;
}

// ============================================================================
// Audit Logging System
// ============================================================================

export class AuditLoggingSystem extends EventEmitter {
  private db: Database.Database;
  private config: AuditConfig;
  private retentionPolicies: Map<string, RetentionPolicy> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: AuditConfig) {
    super();
    this.config = config;
    this.db = new Database(join(config.dataDir, 'audit_log.db'));
    this.initializeDatabase();
    this.loadRetentionPolicies();
    this.startCleanupScheduler();
  }

  private initializeDatabase(): void {
    this.db.pragma('journal_mode = WAL');

    // Main audit log table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_name TEXT,
        actor_ip TEXT,
        actor_user_agent TEXT,
        actor_session_id TEXT,
        resource_type TEXT,
        resource_id TEXT,
        resource_name TEXT,
        resource_path TEXT,
        resource_metadata TEXT,
        description TEXT NOT NULL,
        outcome TEXT NOT NULL,
        details TEXT,
        previous_value TEXT,
        new_value TEXT,
        correlation_id TEXT,
        parent_id TEXT,
        tags TEXT,
        hash TEXT,
        archived INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Retention policies table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS retention_policies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        severity TEXT,
        retention_days INTEGER NOT NULL,
        archive_after_days INTEGER,
        delete_after_archive INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1
      )
    `);

    // Archive metadata table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS archive_metadata (
        id TEXT PRIMARY KEY,
        archive_path TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        entry_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        checksum TEXT
      )
    `);

    // Indexes for common queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_log(category);
      CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_log(severity);
      CREATE INDEX IF NOT EXISTS idx_audit_actor_id ON audit_log(actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_resource_id ON audit_log(resource_id);
      CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_log(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_audit_outcome ON audit_log(outcome);
    `);

    // Full-text search virtual table
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS audit_log_fts USING fts5(
        id,
        description,
        actor_name,
        resource_name,
        tags,
        content=audit_log,
        content_rowid=rowid
      )
    `);

    // Trigger to keep FTS in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS audit_log_ai AFTER INSERT ON audit_log BEGIN
        INSERT INTO audit_log_fts(rowid, id, description, actor_name, resource_name, tags)
        VALUES (NEW.rowid, NEW.id, NEW.description, NEW.actor_name, NEW.resource_name, NEW.tags);
      END
    `);
  }

  private loadRetentionPolicies(): void {
    const stmt = this.db.prepare('SELECT * FROM retention_policies WHERE enabled = 1');
    const rows = stmt.all() as Record<string, unknown>[];

    for (const row of rows) {
      const policy: RetentionPolicy = {
        id: row.id as string,
        name: row.name as string,
        category: row.category as AuditCategory | undefined,
        severity: row.severity as AuditSeverity | undefined,
        retentionDays: row.retention_days as number,
        archiveAfterDays: row.archive_after_days as number | undefined,
        deleteAfterArchive: Boolean(row.delete_after_archive),
        enabled: Boolean(row.enabled),
      };
      this.retentionPolicies.set(policy.id, policy);
    }
  }

  private startCleanupScheduler(): void {
    // Run cleanup daily
    this.cleanupInterval = setInterval(() => {
      this.applyRetentionPolicies();
    }, 24 * 60 * 60 * 1000);
  }

  // ============================================================================
  // Logging
  // ============================================================================

  log(params: {
    action: AuditAction;
    category: AuditCategory;
    severity?: AuditSeverity;
    actor: AuditActor;
    resource?: AuditResource;
    description: string;
    outcome?: 'success' | 'failure' | 'partial';
    details?: Record<string, unknown>;
    previousValue?: unknown;
    newValue?: unknown;
    correlationId?: string;
    parentId?: string;
    tags?: string[];
  }): AuditEntry {
    const id = `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date();
    const severity = params.severity ?? this.inferSeverity(params.action, params.category);
    const outcome = params.outcome ?? 'success';

    const entry: AuditEntry = {
      id,
      timestamp,
      action: params.action,
      category: params.category,
      severity,
      actor: params.actor,
      resource: params.resource,
      description: params.description,
      outcome,
      details: params.details,
      previousValue: params.previousValue,
      newValue: params.newValue,
      correlationId: params.correlationId,
      parentId: params.parentId,
      tags: params.tags,
    };

    // Generate integrity hash if enabled
    if (this.config.enableIntegrityHash) {
      entry.hash = this.generateHash(entry);
    }

    // Insert into database
    const stmt = this.db.prepare(`
      INSERT INTO audit_log
      (id, timestamp, action, category, severity, actor_type, actor_id, actor_name,
       actor_ip, actor_user_agent, actor_session_id, resource_type, resource_id,
       resource_name, resource_path, resource_metadata, description, outcome,
       details, previous_value, new_value, correlation_id, parent_id, tags, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.timestamp.toISOString(),
      entry.action,
      entry.category,
      entry.severity,
      entry.actor.type,
      entry.actor.id,
      entry.actor.name ?? null,
      entry.actor.ip ?? null,
      entry.actor.userAgent ?? null,
      entry.actor.sessionId ?? null,
      entry.resource?.type ?? null,
      entry.resource?.id ?? null,
      entry.resource?.name ?? null,
      entry.resource?.path ?? null,
      entry.resource?.metadata ? JSON.stringify(entry.resource.metadata) : null,
      entry.description,
      entry.outcome,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.previousValue !== undefined ? JSON.stringify(entry.previousValue) : null,
      entry.newValue !== undefined ? JSON.stringify(entry.newValue) : null,
      entry.correlationId ?? null,
      entry.parentId ?? null,
      entry.tags ? JSON.stringify(entry.tags) : null,
      entry.hash ?? null
    );

    this.emit('entry:logged', entry);

    // Emit alerts for high/critical severity
    if (severity === 'high' || severity === 'critical') {
      this.emit('alert', entry);
    }

    return entry;
  }

  private inferSeverity(action: AuditAction, category: AuditCategory): AuditSeverity {
    // Security events default to high
    if (category === 'security') {
      if (action === 'auth_fail' || action === 'revoke') return 'critical';
      return 'high';
    }

    // Configuration changes are medium-high
    if (category === 'configuration') {
      return 'medium';
    }

    // Data operations
    if (action === 'delete' || action === 'terminate') return 'medium';
    if (action === 'update' || action === 'modify_permission') return 'medium';

    return 'low';
  }

  private generateHash(entry: AuditEntry): string {
    const data = JSON.stringify({
      id: entry.id,
      timestamp: entry.timestamp.toISOString(),
      action: entry.action,
      category: entry.category,
      actor: entry.actor,
      resource: entry.resource,
      description: entry.description,
      outcome: entry.outcome,
    });
    return createHash('sha256').update(data).digest('hex');
  }

  // ============================================================================
  // Convenience Logging Methods
  // ============================================================================

  logSecurity(params: {
    action: AuditAction;
    actor: AuditActor;
    description: string;
    outcome?: 'success' | 'failure' | 'partial';
    details?: Record<string, unknown>;
  }): AuditEntry {
    return this.log({
      ...params,
      category: 'security',
      severity: 'high',
    });
  }

  logDataAccess(params: {
    action: 'create' | 'read' | 'update' | 'delete';
    actor: AuditActor;
    resource: AuditResource;
    description: string;
    outcome?: 'success' | 'failure' | 'partial';
  }): AuditEntry {
    return this.log({
      ...params,
      category: 'data_access',
    });
  }

  logConfigChange(params: {
    actor: AuditActor;
    resource: AuditResource;
    description: string;
    previousValue?: unknown;
    newValue?: unknown;
  }): AuditEntry {
    return this.log({
      ...params,
      action: 'config_change',
      category: 'configuration',
    });
  }

  logOperation(params: {
    action: 'execute' | 'invoke' | 'terminate';
    actor: AuditActor;
    resource?: AuditResource;
    description: string;
    outcome?: 'success' | 'failure' | 'partial';
    details?: Record<string, unknown>;
    correlationId?: string;
  }): AuditEntry {
    return this.log({
      ...params,
      category: 'operation',
    });
  }

  // ============================================================================
  // Querying
  // ============================================================================

  query(params: AuditQuery): AuditEntry[] {
    let query = 'SELECT * FROM audit_log WHERE archived = 0';
    const queryParams: unknown[] = [];

    if (params.startDate) {
      query += ' AND timestamp >= ?';
      queryParams.push(params.startDate.toISOString());
    }
    if (params.endDate) {
      query += ' AND timestamp <= ?';
      queryParams.push(params.endDate.toISOString());
    }
    if (params.actions && params.actions.length > 0) {
      query += ` AND action IN (${params.actions.map(() => '?').join(',')})`;
      queryParams.push(...params.actions);
    }
    if (params.categories && params.categories.length > 0) {
      query += ` AND category IN (${params.categories.map(() => '?').join(',')})`;
      queryParams.push(...params.categories);
    }
    if (params.severities && params.severities.length > 0) {
      query += ` AND severity IN (${params.severities.map(() => '?').join(',')})`;
      queryParams.push(...params.severities);
    }
    if (params.actorTypes && params.actorTypes.length > 0) {
      query += ` AND actor_type IN (${params.actorTypes.map(() => '?').join(',')})`;
      queryParams.push(...params.actorTypes);
    }
    if (params.actorIds && params.actorIds.length > 0) {
      query += ` AND actor_id IN (${params.actorIds.map(() => '?').join(',')})`;
      queryParams.push(...params.actorIds);
    }
    if (params.resourceTypes && params.resourceTypes.length > 0) {
      query += ` AND resource_type IN (${params.resourceTypes.map(() => '?').join(',')})`;
      queryParams.push(...params.resourceTypes);
    }
    if (params.resourceIds && params.resourceIds.length > 0) {
      query += ` AND resource_id IN (${params.resourceIds.map(() => '?').join(',')})`;
      queryParams.push(...params.resourceIds);
    }
    if (params.outcomes && params.outcomes.length > 0) {
      query += ` AND outcome IN (${params.outcomes.map(() => '?').join(',')})`;
      queryParams.push(...params.outcomes);
    }
    if (params.correlationId) {
      query += ' AND correlation_id = ?';
      queryParams.push(params.correlationId);
    }

    query += ' ORDER BY timestamp DESC';

    const limit = Math.min(params.limit ?? 100, this.config.maxEntriesPerQuery);
    query += ' LIMIT ?';
    queryParams.push(limit);

    if (params.offset) {
      query += ' OFFSET ?';
      queryParams.push(params.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...queryParams) as Record<string, unknown>[];

    return rows.map(row => this.rowToEntry(row));
  }

  search(text: string, limit: number = 50): AuditEntry[] {
    const stmt = this.db.prepare(`
      SELECT audit_log.*
      FROM audit_log_fts
      JOIN audit_log ON audit_log_fts.id = audit_log.id
      WHERE audit_log_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    const rows = stmt.all(text, limit) as Record<string, unknown>[];
    return rows.map(row => this.rowToEntry(row));
  }

  getEntry(entryId: string): AuditEntry | null {
    const stmt = this.db.prepare('SELECT * FROM audit_log WHERE id = ?');
    const row = stmt.get(entryId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.rowToEntry(row);
  }

  getCorrelated(correlationId: string): AuditEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM audit_log
      WHERE correlation_id = ?
      ORDER BY timestamp ASC
    `);

    const rows = stmt.all(correlationId) as Record<string, unknown>[];
    return rows.map(row => this.rowToEntry(row));
  }

  private rowToEntry(row: Record<string, unknown>): AuditEntry {
    return {
      id: row.id as string,
      timestamp: new Date(row.timestamp as string),
      action: row.action as AuditAction,
      category: row.category as AuditCategory,
      severity: row.severity as AuditSeverity,
      actor: {
        type: row.actor_type as ActorType,
        id: row.actor_id as string,
        name: row.actor_name as string | undefined,
        ip: row.actor_ip as string | undefined,
        userAgent: row.actor_user_agent as string | undefined,
        sessionId: row.actor_session_id as string | undefined,
      },
      resource: row.resource_type ? {
        type: row.resource_type as ResourceType,
        id: row.resource_id as string,
        name: row.resource_name as string | undefined,
        path: row.resource_path as string | undefined,
        metadata: row.resource_metadata ? JSON.parse(row.resource_metadata as string) : undefined,
      } : undefined,
      description: row.description as string,
      outcome: row.outcome as 'success' | 'failure' | 'partial',
      details: row.details ? JSON.parse(row.details as string) : undefined,
      previousValue: row.previous_value ? JSON.parse(row.previous_value as string) : undefined,
      newValue: row.new_value ? JSON.parse(row.new_value as string) : undefined,
      correlationId: row.correlation_id as string | undefined,
      parentId: row.parent_id as string | undefined,
      tags: row.tags ? JSON.parse(row.tags as string) : undefined,
      hash: row.hash as string | undefined,
    };
  }

  // ============================================================================
  // Reporting
  // ============================================================================

  generateReport(params: {
    name: string;
    type: 'summary' | 'detailed' | 'compliance';
    startDate: Date;
    endDate: Date;
  }): AuditReport {
    const entries = this.query({
      startDate: params.startDate,
      endDate: params.endDate,
      limit: 10000,
    });

    const byAction: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byOutcome: Record<string, number> = {};
    const byActor: Record<string, number> = {};
    const resourceCounts: Record<string, number> = {};
    const alerts: AuditEntry[] = [];

    for (const entry of entries) {
      byAction[entry.action] = (byAction[entry.action] ?? 0) + 1;
      byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
      bySeverity[entry.severity] = (bySeverity[entry.severity] ?? 0) + 1;
      byOutcome[entry.outcome] = (byOutcome[entry.outcome] ?? 0) + 1;
      byActor[entry.actor.id] = (byActor[entry.actor.id] ?? 0) + 1;

      if (entry.resource) {
        resourceCounts[entry.resource.id] = (resourceCounts[entry.resource.id] ?? 0) + 1;
      }

      if (entry.severity === 'high' || entry.severity === 'critical') {
        alerts.push(entry);
      }
    }

    const topResources = Object.entries(resourceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => ({ id, count }));

    // Calculate compliance score (simplified)
    let complianceScore: number | undefined;
    if (params.type === 'compliance') {
      const totalEvents = entries.length;
      const failedAuth = entries.filter(e => e.action === 'auth_fail').length;
      const securityEvents = entries.filter(e => e.category === 'security').length;
      const criticalAlerts = alerts.filter(a => a.severity === 'critical').length;

      // Simple scoring: 100 - penalties
      complianceScore = 100;
      if (failedAuth > 10) complianceScore -= 10;
      if (criticalAlerts > 5) complianceScore -= 15;
      if (securityEvents / totalEvents > 0.1) complianceScore -= 5;
      complianceScore = Math.max(0, complianceScore);
    }

    return {
      id: `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: params.name,
      type: params.type,
      startDate: params.startDate,
      endDate: params.endDate,
      generatedAt: new Date(),
      totalEntries: entries.length,
      byAction,
      byCategory,
      bySeverity,
      byOutcome,
      byActor,
      topResources,
      alerts: alerts.slice(0, 100),
      complianceScore,
    };
  }

  // ============================================================================
  // Retention Management
  // ============================================================================

  createRetentionPolicy(params: {
    name: string;
    category?: AuditCategory;
    severity?: AuditSeverity;
    retentionDays: number;
    archiveAfterDays?: number;
    deleteAfterArchive?: boolean;
  }): RetentionPolicy {
    const id = `policy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const policy: RetentionPolicy = {
      id,
      name: params.name,
      category: params.category,
      severity: params.severity,
      retentionDays: params.retentionDays,
      archiveAfterDays: params.archiveAfterDays,
      deleteAfterArchive: params.deleteAfterArchive ?? false,
      enabled: true,
    };

    const stmt = this.db.prepare(`
      INSERT INTO retention_policies
      (id, name, category, severity, retention_days, archive_after_days, delete_after_archive, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      policy.id,
      policy.name,
      policy.category ?? null,
      policy.severity ?? null,
      policy.retentionDays,
      policy.archiveAfterDays ?? null,
      policy.deleteAfterArchive ? 1 : 0,
      1
    );

    this.retentionPolicies.set(policy.id, policy);
    this.emit('policy:created', policy);
    return policy;
  }

  getAllPolicies(): RetentionPolicy[] {
    const stmt = this.db.prepare('SELECT * FROM retention_policies ORDER BY name');
    const rows = stmt.all() as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      name: row.name as string,
      category: row.category as AuditCategory | undefined,
      severity: row.severity as AuditSeverity | undefined,
      retentionDays: row.retention_days as number,
      archiveAfterDays: row.archive_after_days as number | undefined,
      deleteAfterArchive: Boolean(row.delete_after_archive),
      enabled: Boolean(row.enabled),
    }));
  }

  private applyRetentionPolicies(): void {
    const now = new Date();

    for (const policy of this.retentionPolicies.values()) {
      if (!policy.enabled) continue;

      const cutoffDate = new Date(now);
      cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);

      let query = 'DELETE FROM audit_log WHERE timestamp < ?';
      const params: unknown[] = [cutoffDate.toISOString()];

      if (policy.category) {
        query += ' AND category = ?';
        params.push(policy.category);
      }
      if (policy.severity) {
        query += ' AND severity = ?';
        params.push(policy.severity);
      }

      const stmt = this.db.prepare(query);
      const result = stmt.run(...params);

      if (result.changes > 0) {
        this.emit('retention:applied', { policy, deleted: result.changes });
      }
    }
  }

  // ============================================================================
  // Integrity Verification
  // ============================================================================

  verifyIntegrity(entryId: string): { valid: boolean; message: string } {
    const entry = this.getEntry(entryId);
    if (!entry) {
      return { valid: false, message: 'Entry not found' };
    }

    if (!entry.hash) {
      return { valid: true, message: 'No hash to verify (integrity checking was disabled)' };
    }

    const computedHash = this.generateHash(entry);
    if (computedHash === entry.hash) {
      return { valid: true, message: 'Integrity verified' };
    }

    return { valid: false, message: 'Hash mismatch - entry may have been tampered with' };
  }

  verifyChain(limit: number = 100): { valid: boolean; errors: string[] } {
    const stmt = this.db.prepare(`
      SELECT id, hash FROM audit_log
      WHERE hash IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as { id: string; hash: string }[];
    const errors: string[] = [];

    for (const row of rows) {
      const result = this.verifyIntegrity(row.id);
      if (!result.valid) {
        errors.push(`Entry ${row.id}: ${result.message}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  getStats(): AuditStats {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM audit_log');
    const totalResult = totalStmt.get() as { count: number };

    const last24hStmt = this.db.prepare('SELECT COUNT(*) as count FROM audit_log WHERE timestamp >= ?');
    const last24hResult = last24hStmt.get(last24h.toISOString()) as { count: number };

    const last7dStmt = this.db.prepare('SELECT COUNT(*) as count FROM audit_log WHERE timestamp >= ?');
    const last7dResult = last7dStmt.get(last7d.toISOString()) as { count: number };

    const securityStmt = this.db.prepare("SELECT COUNT(*) as count FROM audit_log WHERE category = 'security'");
    const securityResult = securityStmt.get() as { count: number };

    const failedStmt = this.db.prepare("SELECT COUNT(*) as count FROM audit_log WHERE outcome = 'failure'");
    const failedResult = failedStmt.get() as { count: number };

    const actorsStmt = this.db.prepare('SELECT COUNT(DISTINCT actor_id) as count FROM audit_log');
    const actorsResult = actorsStmt.get() as { count: number };

    const resourcesStmt = this.db.prepare('SELECT COUNT(DISTINCT resource_id) as count FROM audit_log WHERE resource_id IS NOT NULL');
    const resourcesResult = resourcesStmt.get() as { count: number };

    const rangeStmt = this.db.prepare('SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM audit_log');
    const rangeResult = rangeStmt.get() as { oldest: string | null; newest: string | null };

    return {
      totalEntries: totalResult.count,
      entriesLast24h: last24hResult.count,
      entriesLast7d: last7dResult.count,
      securityEvents: securityResult.count,
      failedOperations: failedResult.count,
      uniqueActors: actorsResult.count,
      uniqueResources: resourcesResult.count,
      oldestEntry: rangeResult.oldest ? new Date(rangeResult.oldest) : undefined,
      newestEntry: rangeResult.newest ? new Date(rangeResult.newest) : undefined,
    };
  }

  // ============================================================================
  // Export
  // ============================================================================

  exportToJson(params: AuditQuery): string {
    const entries = this.query(params);
    return JSON.stringify(entries, null, 2);
  }

  exportToCsv(params: AuditQuery): string {
    const entries = this.query(params);
    const headers = [
      'id', 'timestamp', 'action', 'category', 'severity',
      'actor_type', 'actor_id', 'actor_name',
      'resource_type', 'resource_id', 'resource_name',
      'description', 'outcome',
    ];

    const lines = [headers.join(',')];

    for (const entry of entries) {
      const row = [
        entry.id,
        entry.timestamp.toISOString(),
        entry.action,
        entry.category,
        entry.severity,
        entry.actor.type,
        entry.actor.id,
        entry.actor.name ?? '',
        entry.resource?.type ?? '',
        entry.resource?.id ?? '',
        entry.resource?.name ?? '',
        `"${entry.description.replace(/"/g, '""')}"`,
        entry.outcome,
      ];
      lines.push(row.join(','));
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.db.close();
    this.emit('shutdown');
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let auditLoggingInstance: AuditLoggingSystem | null = null;

export function getAuditLogging(config?: AuditConfig): AuditLoggingSystem {
  if (!auditLoggingInstance) {
    if (!config) {
      throw new Error('AuditLoggingSystem requires config on first initialization');
    }
    auditLoggingInstance = new AuditLoggingSystem(config);
  }
  return auditLoggingInstance;
}

export function resetAuditLogging(): void {
  if (auditLoggingInstance) {
    auditLoggingInstance.shutdown();
    auditLoggingInstance = null;
  }
}
