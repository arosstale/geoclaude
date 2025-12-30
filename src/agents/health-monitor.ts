/**
 * Class 3.53: Health Monitor System
 * TAC Pattern: System health aggregation and alerting
 *
 * Features:
 * - Health check registration and execution
 * - Dependency graph for component relationships
 * - Aggregated system status
 * - Alerting thresholds with configurable severity
 * - Recovery detection and tracking
 * - Status history with trend analysis
 * - Dashboard endpoint data
 * - Degraded mode support
 */

import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import { join } from 'path';

// ============================================================================
// Types
// ============================================================================

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
export type ComponentType = 'service' | 'database' | 'api' | 'cache' | 'queue' | 'external' | 'agent' | 'custom';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type CheckInterval = 'realtime' | 'fast' | 'normal' | 'slow';

export interface HealthCheck {
  id: string;
  name: string;
  componentType: ComponentType;
  description?: string;
  checkFn: () => Promise<HealthCheckResult>;
  interval: CheckInterval;
  timeout: number;  // Milliseconds
  retries: number;
  enabled: boolean;
  dependencies?: string[];  // IDs of dependent health checks
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface HealthCheckResult {
  status: HealthStatus;
  message?: string;
  latency?: number;  // Milliseconds
  details?: Record<string, unknown>;
  timestamp: Date;
}

export interface ComponentHealth {
  checkId: string;
  name: string;
  componentType: ComponentType;
  status: HealthStatus;
  lastCheck: Date;
  lastHealthy?: Date;
  lastUnhealthy?: Date;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  latency?: number;
  message?: string;
  details?: Record<string, unknown>;
  dependencies: string[];
  dependents: string[];
  isRecovering: boolean;
  recoveryStarted?: Date;
}

export interface SystemHealth {
  overallStatus: HealthStatus;
  timestamp: Date;
  totalChecks: number;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  unknownCount: number;
  components: ComponentHealth[];
  criticalComponents: string[];
  degradedComponents: string[];
  inDegradedMode: boolean;
  degradedModeReason?: string;
}

export interface HealthAlert {
  id: string;
  checkId: string;
  componentName: string;
  severity: AlertSeverity;
  status: HealthStatus;
  previousStatus: HealthStatus;
  message: string;
  timestamp: Date;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface AlertThreshold {
  id: string;
  checkId?: string;  // If null, applies globally
  componentType?: ComponentType;
  consecutiveFailures: number;
  severity: AlertSeverity;
  enabled: boolean;
}

export interface HealthHistoryEntry {
  id: string;
  checkId: string;
  status: HealthStatus;
  latency?: number;
  message?: string;
  timestamp: Date;
}

export interface DependencyNode {
  checkId: string;
  name: string;
  status: HealthStatus;
  dependencies: DependencyNode[];
  dependents: DependencyNode[];
}

export interface DashboardData {
  systemHealth: SystemHealth;
  recentAlerts: HealthAlert[];
  statusHistory: {
    checkId: string;
    name: string;
    history: HealthHistoryEntry[];
  }[];
  dependencyGraph: DependencyNode[];
  uptimeStats: {
    checkId: string;
    name: string;
    uptimePercent: number;
    avgLatency: number;
    lastDowntime?: Date;
    totalDowntimeMinutes: number;
  }[];
}

export interface RecoveryInfo {
  checkId: string;
  componentName: string;
  recoveryStarted: Date;
  previousStatus: HealthStatus;
  recoveryDuration?: number;  // Milliseconds
  isComplete: boolean;
}

export interface HealthMonitorConfig {
  dataDir: string;
  defaultTimeout: number;
  defaultRetries: number;
  historyRetentionDays: number;
  enableDegradedMode: boolean;
  degradedModeThreshold: number;  // Percentage of unhealthy components to trigger degraded mode
  intervals: {
    realtime: number;
    fast: number;
    normal: number;
    slow: number;
  };
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_INTERVALS = {
  realtime: 5000,      // 5 seconds
  fast: 15000,         // 15 seconds
  normal: 60000,       // 1 minute
  slow: 300000,        // 5 minutes
};

// ============================================================================
// Health Monitor System
// ============================================================================

export class HealthMonitorSystem extends EventEmitter {
  private db: Database.Database;
  private config: HealthMonitorConfig;
  private checks: Map<string, HealthCheck> = new Map();
  private componentHealth: Map<string, ComponentHealth> = new Map();
  private checkIntervals: Map<string, NodeJS.Timeout> = new Map();
  private alertThresholds: Map<string, AlertThreshold> = new Map();
  private recoveries: Map<string, RecoveryInfo> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private inDegradedMode: boolean = false;
  private degradedModeReason?: string;

  constructor(config: HealthMonitorConfig) {
    super();
    this.config = {
      ...config,
      intervals: { ...DEFAULT_INTERVALS, ...config.intervals },
    };
    this.db = new Database(join(config.dataDir, 'health_monitor.db'));
    this.initializeDatabase();
    this.loadPersistedState();
    this.startCleanupScheduler();
  }

  private initializeDatabase(): void {
    this.db.pragma('journal_mode = WAL');

    // Health checks registration table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS health_checks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        component_type TEXT NOT NULL,
        description TEXT,
        interval_type TEXT NOT NULL DEFAULT 'normal',
        timeout INTEGER NOT NULL,
        retries INTEGER NOT NULL DEFAULT 3,
        enabled INTEGER NOT NULL DEFAULT 1,
        dependencies TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL
      )
    `);

    // Component health state table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS component_health (
        check_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'unknown',
        last_check TEXT,
        last_healthy TEXT,
        last_unhealthy TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        consecutive_successes INTEGER NOT NULL DEFAULT 0,
        latency INTEGER,
        message TEXT,
        details TEXT,
        is_recovering INTEGER NOT NULL DEFAULT 0,
        recovery_started TEXT,
        FOREIGN KEY (check_id) REFERENCES health_checks(id)
      )
    `);

    // Health history table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS health_history (
        id TEXT PRIMARY KEY,
        check_id TEXT NOT NULL,
        status TEXT NOT NULL,
        latency INTEGER,
        message TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (check_id) REFERENCES health_checks(id)
      )
    `);

    // Alerts table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS health_alerts (
        id TEXT PRIMARY KEY,
        check_id TEXT NOT NULL,
        component_name TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        previous_status TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0,
        acknowledged_by TEXT,
        acknowledged_at TEXT,
        resolved_at TEXT,
        metadata TEXT,
        FOREIGN KEY (check_id) REFERENCES health_checks(id)
      )
    `);

    // Alert thresholds table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alert_thresholds (
        id TEXT PRIMARY KEY,
        check_id TEXT,
        component_type TEXT,
        consecutive_failures INTEGER NOT NULL,
        severity TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1
      )
    `);

    // Indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_health_history_check ON health_history(check_id);
      CREATE INDEX IF NOT EXISTS idx_health_history_timestamp ON health_history(timestamp);
      CREATE INDEX IF NOT EXISTS idx_alerts_check ON health_alerts(check_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON health_alerts(timestamp);
      CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON health_alerts(acknowledged);
    `);
  }

  private loadPersistedState(): void {
    // Load alert thresholds
    const thresholdsStmt = this.db.prepare('SELECT * FROM alert_thresholds WHERE enabled = 1');
    const thresholds = thresholdsStmt.all() as Record<string, unknown>[];

    for (const row of thresholds) {
      const threshold: AlertThreshold = {
        id: row.id as string,
        checkId: row.check_id as string | undefined,
        componentType: row.component_type as ComponentType | undefined,
        consecutiveFailures: row.consecutive_failures as number,
        severity: row.severity as AlertSeverity,
        enabled: Boolean(row.enabled),
      };
      this.alertThresholds.set(threshold.id, threshold);
    }

    // Load default thresholds if none exist
    if (this.alertThresholds.size === 0) {
      this.createDefaultThresholds();
    }
  }

  private createDefaultThresholds(): void {
    // Default: 3 failures = warning, 5 failures = critical
    this.createAlertThreshold({
      consecutiveFailures: 3,
      severity: 'warning',
    });
    this.createAlertThreshold({
      consecutiveFailures: 5,
      severity: 'critical',
    });
  }

  private startCleanupScheduler(): void {
    // Run cleanup daily
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldHistory();
    }, 24 * 60 * 60 * 1000);
  }

  private cleanupOldHistory(): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.historyRetentionDays);

    const stmt = this.db.prepare('DELETE FROM health_history WHERE timestamp < ?');
    const result = stmt.run(cutoffDate.toISOString());

    if (result.changes > 0) {
      this.emit('history:cleaned', { deletedEntries: result.changes });
    }
  }

  // ============================================================================
  // Health Check Registration
  // ============================================================================

  registerCheck(params: {
    name: string;
    componentType: ComponentType;
    description?: string;
    checkFn: () => Promise<HealthCheckResult>;
    interval?: CheckInterval;
    timeout?: number;
    retries?: number;
    dependencies?: string[];
    metadata?: Record<string, unknown>;
  }): HealthCheck {
    const id = `check_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const check: HealthCheck = {
      id,
      name: params.name,
      componentType: params.componentType,
      description: params.description,
      checkFn: params.checkFn,
      interval: params.interval ?? 'normal',
      timeout: params.timeout ?? this.config.defaultTimeout,
      retries: params.retries ?? this.config.defaultRetries,
      enabled: true,
      dependencies: params.dependencies ?? [],
      metadata: params.metadata,
      createdAt: new Date(),
    };

    // Persist check configuration (without checkFn)
    const stmt = this.db.prepare(`
      INSERT INTO health_checks
      (id, name, component_type, description, interval_type, timeout, retries, enabled, dependencies, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      check.id,
      check.name,
      check.componentType,
      check.description ?? null,
      check.interval,
      check.timeout,
      check.retries,
      1,
      JSON.stringify(check.dependencies),
      check.metadata ? JSON.stringify(check.metadata) : null,
      check.createdAt.toISOString()
    );

    // Initialize component health state
    const healthState: ComponentHealth = {
      checkId: check.id,
      name: check.name,
      componentType: check.componentType,
      status: 'unknown',
      lastCheck: new Date(),
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      dependencies: check.dependencies ?? [],
      dependents: [],
      isRecovering: false,
    };

    this.checks.set(check.id, check);
    this.componentHealth.set(check.id, healthState);
    this.updateDependentsList();

    // Start periodic check
    this.startCheckInterval(check);

    this.emit('check:registered', check);
    return check;
  }

  unregisterCheck(checkId: string): boolean {
    const check = this.checks.get(checkId);
    if (!check) return false;

    // Stop interval
    const interval = this.checkIntervals.get(checkId);
    if (interval) {
      clearInterval(interval);
      this.checkIntervals.delete(checkId);
    }

    // Remove from database
    this.db.prepare('DELETE FROM health_checks WHERE id = ?').run(checkId);
    this.db.prepare('DELETE FROM component_health WHERE check_id = ?').run(checkId);

    this.checks.delete(checkId);
    this.componentHealth.delete(checkId);
    this.updateDependentsList();

    this.emit('check:unregistered', { checkId });
    return true;
  }

  getCheck(checkId: string): HealthCheck | null {
    return this.checks.get(checkId) ?? null;
  }

  getAllChecks(): HealthCheck[] {
    return Array.from(this.checks.values());
  }

  enableCheck(checkId: string): boolean {
    const check = this.checks.get(checkId);
    if (!check) return false;

    check.enabled = true;
    this.db.prepare('UPDATE health_checks SET enabled = 1 WHERE id = ?').run(checkId);
    this.startCheckInterval(check);

    this.emit('check:enabled', { checkId });
    return true;
  }

  disableCheck(checkId: string): boolean {
    const check = this.checks.get(checkId);
    if (!check) return false;

    check.enabled = false;
    this.db.prepare('UPDATE health_checks SET enabled = 0 WHERE id = ?').run(checkId);

    const interval = this.checkIntervals.get(checkId);
    if (interval) {
      clearInterval(interval);
      this.checkIntervals.delete(checkId);
    }

    this.emit('check:disabled', { checkId });
    return true;
  }

  private startCheckInterval(check: HealthCheck): void {
    if (!check.enabled) return;

    // Clear existing interval if any
    const existingInterval = this.checkIntervals.get(check.id);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    const intervalMs = this.config.intervals[check.interval];
    const interval = setInterval(() => {
      this.executeCheck(check.id);
    }, intervalMs);

    this.checkIntervals.set(check.id, interval);

    // Execute immediately
    this.executeCheck(check.id);
  }

  private updateDependentsList(): void {
    // Reset all dependents
    for (const health of this.componentHealth.values()) {
      health.dependents = [];
    }

    // Build dependents list
    for (const check of this.checks.values()) {
      for (const depId of check.dependencies ?? []) {
        const depHealth = this.componentHealth.get(depId);
        if (depHealth) {
          depHealth.dependents.push(check.id);
        }
      }
    }
  }

  // ============================================================================
  // Health Check Execution
  // ============================================================================

  async executeCheck(checkId: string): Promise<HealthCheckResult> {
    const check = this.checks.get(checkId);
    if (!check || !check.enabled) {
      return {
        status: 'unknown',
        message: 'Check not found or disabled',
        timestamp: new Date(),
      };
    }

    const health = this.componentHealth.get(checkId);
    if (!health) {
      return {
        status: 'unknown',
        message: 'Component health state not found',
        timestamp: new Date(),
      };
    }

    const previousStatus = health.status;
    let result: HealthCheckResult;
    let retriesLeft = check.retries;
    const startTime = Date.now();

    // Retry loop
    while (retriesLeft >= 0) {
      try {
        result = await Promise.race([
          check.checkFn(),
          new Promise<HealthCheckResult>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), check.timeout)
          ),
        ]);

        // Add latency
        result.latency = Date.now() - startTime;
        break;
      } catch (error) {
        retriesLeft--;
        if (retriesLeft < 0) {
          result = {
            status: 'unhealthy',
            message: error instanceof Error ? error.message : 'Health check failed',
            latency: Date.now() - startTime,
            timestamp: new Date(),
          };
        }
      }
    }

    // Update component health
    health.status = result!.status;
    health.lastCheck = result!.timestamp;
    health.latency = result!.latency;
    health.message = result!.message;
    health.details = result!.details;

    if (result!.status === 'healthy') {
      health.lastHealthy = result!.timestamp;
      health.consecutiveSuccesses++;
      health.consecutiveFailures = 0;

      // Check for recovery completion
      if (health.isRecovering) {
        this.completeRecovery(checkId, health);
      }
    } else if (result!.status === 'unhealthy') {
      health.lastUnhealthy = result!.timestamp;
      health.consecutiveFailures++;
      health.consecutiveSuccesses = 0;

      // Start recovery tracking if transitioning to unhealthy
      if (previousStatus === 'healthy' || previousStatus === 'degraded') {
        this.startRecoveryTracking(checkId, health, previousStatus);
      }
    } else if (result!.status === 'degraded') {
      health.consecutiveFailures = 0;
      health.consecutiveSuccesses = 0;
    }

    // Persist state
    this.persistComponentHealth(health);

    // Record history
    this.recordHistory(checkId, result!);

    // Check for status transitions and alerts
    if (previousStatus !== result!.status) {
      this.handleStatusTransition(checkId, health, previousStatus, result!.status);
    }

    // Check alert thresholds
    this.checkAlertThresholds(checkId, health);

    // Update degraded mode
    this.updateDegradedMode();

    this.emit('check:executed', { checkId, result: result! });
    return result!;
  }

  async executeAllChecks(): Promise<Map<string, HealthCheckResult>> {
    const results = new Map<string, HealthCheckResult>();

    const checkPromises = Array.from(this.checks.keys()).map(async (checkId) => {
      const result = await this.executeCheck(checkId);
      results.set(checkId, result);
    });

    await Promise.all(checkPromises);
    return results;
  }

  private persistComponentHealth(health: ComponentHealth): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO component_health
      (check_id, status, last_check, last_healthy, last_unhealthy, consecutive_failures,
       consecutive_successes, latency, message, details, is_recovering, recovery_started)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      health.checkId,
      health.status,
      health.lastCheck.toISOString(),
      health.lastHealthy?.toISOString() ?? null,
      health.lastUnhealthy?.toISOString() ?? null,
      health.consecutiveFailures,
      health.consecutiveSuccesses,
      health.latency ?? null,
      health.message ?? null,
      health.details ? JSON.stringify(health.details) : null,
      health.isRecovering ? 1 : 0,
      health.recoveryStarted?.toISOString() ?? null
    );
  }

  private recordHistory(checkId: string, result: HealthCheckResult): void {
    const id = `hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const stmt = this.db.prepare(`
      INSERT INTO health_history (id, check_id, status, latency, message, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      checkId,
      result.status,
      result.latency ?? null,
      result.message ?? null,
      result.timestamp.toISOString()
    );
  }

  // ============================================================================
  // Status and Alerts
  // ============================================================================

  private handleStatusTransition(
    checkId: string,
    health: ComponentHealth,
    previousStatus: HealthStatus,
    newStatus: HealthStatus
  ): void {
    this.emit('status:changed', {
      checkId,
      componentName: health.name,
      previousStatus,
      newStatus,
      timestamp: new Date(),
    });

    // Resolve alerts if recovering to healthy
    if (newStatus === 'healthy' && previousStatus === 'unhealthy') {
      this.resolveAlerts(checkId);
    }
  }

  private checkAlertThresholds(checkId: string, health: ComponentHealth): void {
    // Get applicable thresholds
    const thresholds = Array.from(this.alertThresholds.values())
      .filter(t => {
        if (!t.enabled) return false;
        if (t.checkId && t.checkId !== checkId) return false;
        if (t.componentType && t.componentType !== health.componentType) return false;
        return true;
      })
      .sort((a, b) => b.consecutiveFailures - a.consecutiveFailures);

    for (const threshold of thresholds) {
      if (health.consecutiveFailures >= threshold.consecutiveFailures) {
        // Check if alert already exists
        const existingAlert = this.getUnacknowledgedAlert(checkId, threshold.severity);
        if (!existingAlert) {
          this.createAlert({
            checkId,
            componentName: health.name,
            severity: threshold.severity,
            status: health.status,
            previousStatus: health.consecutiveFailures === threshold.consecutiveFailures
              ? 'healthy'
              : health.status,
            message: `${health.name} has failed ${health.consecutiveFailures} consecutive health checks`,
          });
        }
        break;  // Only create highest severity alert
      }
    }
  }

  private getUnacknowledgedAlert(checkId: string, severity: AlertSeverity): HealthAlert | null {
    const stmt = this.db.prepare(`
      SELECT * FROM health_alerts
      WHERE check_id = ? AND severity = ? AND acknowledged = 0 AND resolved_at IS NULL
    `);
    const row = stmt.get(checkId, severity) as Record<string, unknown> | undefined;

    if (!row) return null;

    return this.rowToAlert(row);
  }

  createAlert(params: {
    checkId: string;
    componentName: string;
    severity: AlertSeverity;
    status: HealthStatus;
    previousStatus: HealthStatus;
    message: string;
    metadata?: Record<string, unknown>;
  }): HealthAlert {
    const id = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const alert: HealthAlert = {
      id,
      checkId: params.checkId,
      componentName: params.componentName,
      severity: params.severity,
      status: params.status,
      previousStatus: params.previousStatus,
      message: params.message,
      timestamp: new Date(),
      acknowledged: false,
      metadata: params.metadata,
    };

    const stmt = this.db.prepare(`
      INSERT INTO health_alerts
      (id, check_id, component_name, severity, status, previous_status, message, timestamp, acknowledged, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      alert.id,
      alert.checkId,
      alert.componentName,
      alert.severity,
      alert.status,
      alert.previousStatus,
      alert.message,
      alert.timestamp.toISOString(),
      0,
      alert.metadata ? JSON.stringify(alert.metadata) : null
    );

    this.emit('alert:created', alert);
    return alert;
  }

  acknowledgeAlert(alertId: string, userId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE health_alerts
      SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = ?
      WHERE id = ?
    `);
    const result = stmt.run(userId, new Date().toISOString(), alertId);

    if (result.changes > 0) {
      this.emit('alert:acknowledged', { alertId, userId });
      return true;
    }
    return false;
  }

  private resolveAlerts(checkId: string): void {
    const stmt = this.db.prepare(`
      UPDATE health_alerts
      SET resolved_at = ?
      WHERE check_id = ? AND resolved_at IS NULL
    `);
    const result = stmt.run(new Date().toISOString(), checkId);

    if (result.changes > 0) {
      this.emit('alerts:resolved', { checkId, count: result.changes });
    }
  }

  getAlerts(params: {
    checkId?: string;
    severity?: AlertSeverity;
    acknowledged?: boolean;
    resolved?: boolean;
    limit?: number;
  } = {}): HealthAlert[] {
    let query = 'SELECT * FROM health_alerts WHERE 1=1';
    const queryParams: unknown[] = [];

    if (params.checkId) {
      query += ' AND check_id = ?';
      queryParams.push(params.checkId);
    }
    if (params.severity) {
      query += ' AND severity = ?';
      queryParams.push(params.severity);
    }
    if (params.acknowledged !== undefined) {
      query += ' AND acknowledged = ?';
      queryParams.push(params.acknowledged ? 1 : 0);
    }
    if (params.resolved !== undefined) {
      if (params.resolved) {
        query += ' AND resolved_at IS NOT NULL';
      } else {
        query += ' AND resolved_at IS NULL';
      }
    }

    query += ' ORDER BY timestamp DESC';

    if (params.limit) {
      query += ' LIMIT ?';
      queryParams.push(params.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...queryParams) as Record<string, unknown>[];

    return rows.map(row => this.rowToAlert(row));
  }

  private rowToAlert(row: Record<string, unknown>): HealthAlert {
    return {
      id: row.id as string,
      checkId: row.check_id as string,
      componentName: row.component_name as string,
      severity: row.severity as AlertSeverity,
      status: row.status as HealthStatus,
      previousStatus: row.previous_status as HealthStatus,
      message: row.message as string,
      timestamp: new Date(row.timestamp as string),
      acknowledged: Boolean(row.acknowledged),
      acknowledgedBy: row.acknowledged_by as string | undefined,
      acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at as string) : undefined,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    };
  }

  // ============================================================================
  // Alert Thresholds
  // ============================================================================

  createAlertThreshold(params: {
    checkId?: string;
    componentType?: ComponentType;
    consecutiveFailures: number;
    severity: AlertSeverity;
  }): AlertThreshold {
    const id = `threshold_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const threshold: AlertThreshold = {
      id,
      checkId: params.checkId,
      componentType: params.componentType,
      consecutiveFailures: params.consecutiveFailures,
      severity: params.severity,
      enabled: true,
    };

    const stmt = this.db.prepare(`
      INSERT INTO alert_thresholds
      (id, check_id, component_type, consecutive_failures, severity, enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      threshold.id,
      threshold.checkId ?? null,
      threshold.componentType ?? null,
      threshold.consecutiveFailures,
      threshold.severity,
      1
    );

    this.alertThresholds.set(threshold.id, threshold);
    this.emit('threshold:created', threshold);
    return threshold;
  }

  getAllThresholds(): AlertThreshold[] {
    return Array.from(this.alertThresholds.values());
  }

  removeThreshold(thresholdId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM alert_thresholds WHERE id = ?');
    const result = stmt.run(thresholdId);

    if (result.changes > 0) {
      this.alertThresholds.delete(thresholdId);
      this.emit('threshold:removed', { thresholdId });
      return true;
    }
    return false;
  }

  // ============================================================================
  // Recovery Detection
  // ============================================================================

  private startRecoveryTracking(checkId: string, health: ComponentHealth, previousStatus: HealthStatus): void {
    health.isRecovering = false;  // Not recovering yet - just started failing
    const recovery: RecoveryInfo = {
      checkId,
      componentName: health.name,
      recoveryStarted: new Date(),
      previousStatus,
      isComplete: false,
    };

    this.recoveries.set(checkId, recovery);
    this.emit('recovery:started', recovery);
  }

  private completeRecovery(checkId: string, health: ComponentHealth): void {
    const recovery = this.recoveries.get(checkId);
    if (!recovery) return;

    recovery.isComplete = true;
    recovery.recoveryDuration = Date.now() - recovery.recoveryStarted.getTime();
    health.isRecovering = false;
    health.recoveryStarted = undefined;

    this.recoveries.delete(checkId);
    this.emit('recovery:completed', recovery);
  }

  getRecoveries(): RecoveryInfo[] {
    return Array.from(this.recoveries.values());
  }

  // ============================================================================
  // Degraded Mode
  // ============================================================================

  private updateDegradedMode(): void {
    if (!this.config.enableDegradedMode) return;

    const totalChecks = this.componentHealth.size;
    if (totalChecks === 0) return;

    const unhealthyCount = Array.from(this.componentHealth.values())
      .filter(h => h.status === 'unhealthy').length;
    const unhealthyPercent = (unhealthyCount / totalChecks) * 100;

    const shouldBeDegraded = unhealthyPercent >= this.config.degradedModeThreshold;

    if (shouldBeDegraded && !this.inDegradedMode) {
      this.enterDegradedMode(`${unhealthyPercent.toFixed(1)}% of components unhealthy (threshold: ${this.config.degradedModeThreshold}%)`);
    } else if (!shouldBeDegraded && this.inDegradedMode) {
      this.exitDegradedMode();
    }
  }

  enterDegradedMode(reason: string): void {
    this.inDegradedMode = true;
    this.degradedModeReason = reason;

    this.emit('degradedMode:entered', { reason, timestamp: new Date() });

    this.createAlert({
      checkId: 'system',
      componentName: 'System',
      severity: 'critical',
      status: 'degraded',
      previousStatus: 'healthy',
      message: `System entered degraded mode: ${reason}`,
    });
  }

  exitDegradedMode(): void {
    const previousReason = this.degradedModeReason;
    this.inDegradedMode = false;
    this.degradedModeReason = undefined;

    this.emit('degradedMode:exited', { previousReason, timestamp: new Date() });
  }

  isInDegradedMode(): boolean {
    return this.inDegradedMode;
  }

  getDegradedModeReason(): string | undefined {
    return this.degradedModeReason;
  }

  // ============================================================================
  // Dependency Graph
  // ============================================================================

  getDependencyGraph(): DependencyNode[] {
    const buildNode = (checkId: string, visited: Set<string>): DependencyNode | null => {
      if (visited.has(checkId)) return null;
      visited.add(checkId);

      const check = this.checks.get(checkId);
      const health = this.componentHealth.get(checkId);
      if (!check || !health) return null;

      const dependencies: DependencyNode[] = [];
      for (const depId of check.dependencies ?? []) {
        const depNode = buildNode(depId, new Set(visited));
        if (depNode) dependencies.push(depNode);
      }

      const dependents: DependencyNode[] = [];
      for (const depId of health.dependents) {
        const depNode = buildNode(depId, new Set(visited));
        if (depNode) dependents.push(depNode);
      }

      return {
        checkId,
        name: check.name,
        status: health.status,
        dependencies,
        dependents,
      };
    };

    // Build from root nodes (nodes with no dependencies)
    const rootNodes: DependencyNode[] = [];
    for (const check of this.checks.values()) {
      if (!check.dependencies || check.dependencies.length === 0) {
        const node = buildNode(check.id, new Set());
        if (node) rootNodes.push(node);
      }
    }

    return rootNodes;
  }

  getDownstreamImpact(checkId: string): string[] {
    const impacted: Set<string> = new Set();

    const traverse = (id: string) => {
      const health = this.componentHealth.get(id);
      if (!health) return;

      for (const depId of health.dependents) {
        if (!impacted.has(depId)) {
          impacted.add(depId);
          traverse(depId);
        }
      }
    };

    traverse(checkId);
    return Array.from(impacted);
  }

  // ============================================================================
  // System Health
  // ============================================================================

  getSystemHealth(): SystemHealth {
    const components = Array.from(this.componentHealth.values());

    let healthyCount = 0;
    let degradedCount = 0;
    let unhealthyCount = 0;
    let unknownCount = 0;
    const criticalComponents: string[] = [];
    const degradedComponents: string[] = [];

    for (const health of components) {
      switch (health.status) {
        case 'healthy':
          healthyCount++;
          break;
        case 'degraded':
          degradedCount++;
          degradedComponents.push(health.checkId);
          break;
        case 'unhealthy':
          unhealthyCount++;
          criticalComponents.push(health.checkId);
          break;
        default:
          unknownCount++;
      }
    }

    // Determine overall status
    let overallStatus: HealthStatus;
    if (unhealthyCount > 0) {
      overallStatus = 'unhealthy';
    } else if (degradedCount > 0) {
      overallStatus = 'degraded';
    } else if (unknownCount === components.length) {
      overallStatus = 'unknown';
    } else {
      overallStatus = 'healthy';
    }

    return {
      overallStatus,
      timestamp: new Date(),
      totalChecks: components.length,
      healthyCount,
      degradedCount,
      unhealthyCount,
      unknownCount,
      components,
      criticalComponents,
      degradedComponents,
      inDegradedMode: this.inDegradedMode,
      degradedModeReason: this.degradedModeReason,
    };
  }

  getComponentHealth(checkId: string): ComponentHealth | null {
    return this.componentHealth.get(checkId) ?? null;
  }

  // ============================================================================
  // History
  // ============================================================================

  getHistory(params: {
    checkId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  } = {}): HealthHistoryEntry[] {
    let query = 'SELECT * FROM health_history WHERE 1=1';
    const queryParams: unknown[] = [];

    if (params.checkId) {
      query += ' AND check_id = ?';
      queryParams.push(params.checkId);
    }
    if (params.startDate) {
      query += ' AND timestamp >= ?';
      queryParams.push(params.startDate.toISOString());
    }
    if (params.endDate) {
      query += ' AND timestamp <= ?';
      queryParams.push(params.endDate.toISOString());
    }

    query += ' ORDER BY timestamp DESC';

    if (params.limit) {
      query += ' LIMIT ?';
      queryParams.push(params.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...queryParams) as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      checkId: row.check_id as string,
      status: row.status as HealthStatus,
      latency: row.latency as number | undefined,
      message: row.message as string | undefined,
      timestamp: new Date(row.timestamp as string),
    }));
  }

  // ============================================================================
  // Dashboard Data
  // ============================================================================

  getDashboardData(historyLimit: number = 50): DashboardData {
    const systemHealth = this.getSystemHealth();
    const recentAlerts = this.getAlerts({ limit: 20 });

    // Get status history for each check
    const statusHistory = Array.from(this.checks.values()).map(check => ({
      checkId: check.id,
      name: check.name,
      history: this.getHistory({ checkId: check.id, limit: historyLimit }),
    }));

    // Calculate uptime stats
    const uptimeStats = Array.from(this.checks.keys()).map(checkId => {
      const stats = this.calculateUptimeStats(checkId);
      const check = this.checks.get(checkId)!;
      return {
        checkId,
        name: check.name,
        ...stats,
      };
    });

    return {
      systemHealth,
      recentAlerts,
      statusHistory,
      dependencyGraph: this.getDependencyGraph(),
      uptimeStats,
    };
  }

  private calculateUptimeStats(checkId: string): {
    uptimePercent: number;
    avgLatency: number;
    lastDowntime?: Date;
    totalDowntimeMinutes: number;
  } {
    const history = this.getHistory({ checkId, limit: 1000 });
    if (history.length === 0) {
      return { uptimePercent: 100, avgLatency: 0, totalDowntimeMinutes: 0 };
    }

    let healthyCount = 0;
    let totalLatency = 0;
    let latencyCount = 0;
    let lastDowntime: Date | undefined;
    let downtimeMinutes = 0;
    let lastUnhealthyTime: Date | undefined;

    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];

      if (entry.status === 'healthy') {
        healthyCount++;

        // Calculate downtime if coming from unhealthy
        if (lastUnhealthyTime) {
          const duration = entry.timestamp.getTime() - lastUnhealthyTime.getTime();
          downtimeMinutes += duration / (1000 * 60);
          lastUnhealthyTime = undefined;
        }
      } else if (entry.status === 'unhealthy') {
        if (!lastUnhealthyTime) {
          lastUnhealthyTime = entry.timestamp;
          lastDowntime = entry.timestamp;
        }
      }

      if (entry.latency !== undefined) {
        totalLatency += entry.latency;
        latencyCount++;
      }
    }

    return {
      uptimePercent: (healthyCount / history.length) * 100,
      avgLatency: latencyCount > 0 ? totalLatency / latencyCount : 0,
      lastDowntime,
      totalDowntimeMinutes: downtimeMinutes,
    };
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  getStats(): {
    totalChecks: number;
    enabledChecks: number;
    healthyComponents: number;
    unhealthyComponents: number;
    activeAlerts: number;
    activeRecoveries: number;
    inDegradedMode: boolean;
    avgLatency: number;
  } {
    const components = Array.from(this.componentHealth.values());
    const enabledChecks = Array.from(this.checks.values()).filter(c => c.enabled).length;
    const healthyCount = components.filter(c => c.status === 'healthy').length;
    const unhealthyCount = components.filter(c => c.status === 'unhealthy').length;

    const alertsStmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM health_alerts WHERE acknowledged = 0 AND resolved_at IS NULL'
    );
    const alertsResult = alertsStmt.get() as { count: number };

    // Calculate average latency
    let totalLatency = 0;
    let latencyCount = 0;
    for (const health of components) {
      if (health.latency !== undefined) {
        totalLatency += health.latency;
        latencyCount++;
      }
    }

    return {
      totalChecks: this.checks.size,
      enabledChecks,
      healthyComponents: healthyCount,
      unhealthyComponents: unhealthyCount,
      activeAlerts: alertsResult.count,
      activeRecoveries: this.recoveries.size,
      inDegradedMode: this.inDegradedMode,
      avgLatency: latencyCount > 0 ? totalLatency / latencyCount : 0,
    };
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  shutdown(): void {
    // Stop all check intervals
    for (const interval of this.checkIntervals.values()) {
      clearInterval(interval);
    }
    this.checkIntervals.clear();

    // Stop cleanup scheduler
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

let healthMonitorInstance: HealthMonitorSystem | null = null;

export function getHealthMonitor(config?: HealthMonitorConfig): HealthMonitorSystem {
  if (!healthMonitorInstance) {
    if (!config) {
      throw new Error('HealthMonitorSystem requires config on first initialization');
    }
    healthMonitorInstance = new HealthMonitorSystem(config);
  }
  return healthMonitorInstance;
}

export function resetHealthMonitor(): void {
  if (healthMonitorInstance) {
    healthMonitorInstance.shutdown();
    healthMonitorInstance = null;
  }
}
