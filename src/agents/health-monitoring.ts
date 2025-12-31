/**
 * Class 3.14: Health Monitoring System
 * TAC Pattern: Comprehensive agent health checks and metrics
 *
 * Provides health monitoring for the orchestrator:
 * - Periodic health checks for all components
 * - Metrics collection and aggregation
 * - Alert thresholds and notifications
 * - Health history and trends
 * - System-wide health dashboard
 * - Auto-recovery triggers
 */

import Database from "better-sqlite3";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export type ComponentType = "agent" | "database" | "api" | "queue" | "cache" | "external" | "system";

export interface HealthCheck {
	id: string;
	componentId: string;
	componentType: ComponentType;
	name: string;
	status: HealthStatus;
	message: string;
	latencyMs: number;
	metadata: Record<string, unknown>;
	checkedAt: number;
}

export interface ComponentHealth {
	id: string;
	type: ComponentType;
	name: string;
	status: HealthStatus;
	lastCheck: HealthCheck | null;
	consecutiveFailures: number;
	uptimePercent: number;
	avgLatencyMs: number;
	checkCount: number;
	lastHealthyAt: number;
	registeredAt: number;
}

export interface HealthMetric {
	id: string;
	componentId: string;
	metricName: string;
	value: number;
	unit: string;
	timestamp: number;
}

export interface AlertThreshold {
	id: string;
	componentId: string;
	metricName: string;
	operator: ">" | "<" | ">=" | "<=" | "==" | "!=";
	threshold: number;
	severity: "info" | "warning" | "critical";
	cooldownMs: number;
	lastTriggeredAt?: number;
}

export interface HealthAlert {
	id: string;
	componentId: string;
	thresholdId: string;
	severity: "info" | "warning" | "critical";
	message: string;
	value: number;
	threshold: number;
	acknowledged: boolean;
	triggeredAt: number;
	acknowledgedAt?: number;
	acknowledgedBy?: string;
}

export interface SystemHealth {
	status: HealthStatus;
	components: ComponentHealth[];
	activeAlerts: HealthAlert[];
	metrics: {
		totalComponents: number;
		healthyComponents: number;
		degradedComponents: number;
		unhealthyComponents: number;
		avgUptimePercent: number;
		avgLatencyMs: number;
	};
	lastUpdated: number;
}

export interface MonitoringConfig {
	defaultCheckIntervalMs: number;
	healthHistoryRetentionDays: number;
	metricsRetentionDays: number;
	alertRetentionDays: number;
	consecutiveFailuresForUnhealthy: number;
	consecutiveFailuresForDegraded: number;
}

export interface HealthChecker {
	componentId: string;
	check: () => Promise<{ healthy: boolean; message: string; latencyMs?: number; metadata?: Record<string, unknown> }>;
	intervalMs: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: MonitoringConfig = {
	defaultCheckIntervalMs: 60000, // 1 minute
	healthHistoryRetentionDays: 7,
	metricsRetentionDays: 30,
	alertRetentionDays: 90,
	consecutiveFailuresForUnhealthy: 3,
	consecutiveFailuresForDegraded: 1,
};

// ============================================================================
// Health Monitoring System
// ============================================================================

export class HealthMonitoringSystem extends EventEmitter {
	private db: Database.Database;
	private config: MonitoringConfig;
	private checkers: Map<string, { checker: HealthChecker; timer: NodeJS.Timeout }> = new Map();
	private cleanupTimer?: NodeJS.Timeout;

	constructor(dataDir: string, config: Partial<MonitoringConfig> = {}) {
		super();
		this.config = { ...DEFAULT_CONFIG, ...config };

		const dbPath = path.join(dataDir, "health-monitoring.db");
		fs.mkdirSync(dataDir, { recursive: true });

		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL");
		this.initSchema();

		// Start cleanup timer (daily)
		this.cleanupTimer = setInterval(
			() => {
				this.cleanupOldData();
			},
			24 * 60 * 60 * 1000,
		);
	}

	private initSchema(): void {
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS components (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unknown',
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        check_count INTEGER NOT NULL DEFAULT 0,
        last_healthy_at INTEGER,
        registered_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS health_checks (
        id TEXT PRIMARY KEY,
        component_id TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        latency_ms INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        checked_at INTEGER NOT NULL,
        FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS metrics (
        id TEXT PRIMARY KEY,
        component_id TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT NOT NULL DEFAULT '',
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS alert_thresholds (
        id TEXT PRIMARY KEY,
        component_id TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        operator TEXT NOT NULL,
        threshold REAL NOT NULL,
        severity TEXT NOT NULL DEFAULT 'warning',
        cooldown_ms INTEGER NOT NULL DEFAULT 300000,
        last_triggered_at INTEGER,
        FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        component_id TEXT NOT NULL,
        threshold_id TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        value REAL NOT NULL,
        threshold REAL NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0,
        triggered_at INTEGER NOT NULL,
        acknowledged_at INTEGER,
        acknowledged_by TEXT,
        FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE,
        FOREIGN KEY (threshold_id) REFERENCES alert_thresholds(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_checks_component ON health_checks(component_id);
      CREATE INDEX IF NOT EXISTS idx_checks_time ON health_checks(checked_at DESC);
      CREATE INDEX IF NOT EXISTS idx_metrics_component ON metrics(component_id);
      CREATE INDEX IF NOT EXISTS idx_metrics_time ON metrics(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_alerts_component ON alerts(component_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_ack ON alerts(acknowledged);
    `);
	}

	/**
	 * Register a component for monitoring
	 */
	registerComponent(params: { id: string; type: ComponentType; name: string }): ComponentHealth {
		const now = Date.now();

		this.db
			.prepare(
				`
      INSERT INTO components (id, type, name, status, registered_at, last_healthy_at)
      VALUES (?, ?, ?, 'unknown', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        name = excluded.name
    `,
			)
			.run(params.id, params.type, params.name, now, now);

		this.emit("component:registered", { componentId: params.id });

		return this.getComponentHealth(params.id)!;
	}

	/**
	 * Unregister a component
	 */
	unregisterComponent(componentId: string): boolean {
		// Stop any active checker
		this.stopChecker(componentId);

		const result = this.db.prepare(`DELETE FROM components WHERE id = ?`).run(componentId);

		if (result.changes > 0) {
			this.emit("component:unregistered", { componentId });
		}

		return result.changes > 0;
	}

	/**
	 * Record a health check result
	 */
	recordHealthCheck(params: {
		componentId: string;
		healthy: boolean;
		message?: string;
		latencyMs?: number;
		metadata?: Record<string, unknown>;
	}): HealthCheck {
		const id = `hc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const now = Date.now();
		const status: HealthStatus = params.healthy ? "healthy" : "unhealthy";

		const check: HealthCheck = {
			id,
			componentId: params.componentId,
			componentType: "agent", // Will be updated from component
			name: "",
			status,
			message: params.message ?? "",
			latencyMs: params.latencyMs ?? 0,
			metadata: params.metadata ?? {},
			checkedAt: now,
		};

		// Save check
		this.db
			.prepare(
				`
      INSERT INTO health_checks (id, component_id, status, message, latency_ms, metadata, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
			)
			.run(
				check.id,
				check.componentId,
				check.status,
				check.message,
				check.latencyMs,
				JSON.stringify(check.metadata),
				check.checkedAt,
			);

		// Update component status
		this.updateComponentStatus(params.componentId, params.healthy);

		this.emit("health:checked", { check });
		return check;
	}

	/**
	 * Update component status based on check result
	 */
	private updateComponentStatus(componentId: string, healthy: boolean): void {
		const component = this.db.prepare(`SELECT * FROM components WHERE id = ?`).get(componentId) as
			| DbComponentRow
			| undefined;

		if (!component) return;

		let newStatus: HealthStatus;
		const consecutiveFailures = healthy ? 0 : component.consecutive_failures + 1;

		if (healthy) {
			newStatus = "healthy";
		} else if (consecutiveFailures >= this.config.consecutiveFailuresForUnhealthy) {
			newStatus = "unhealthy";
		} else if (consecutiveFailures >= this.config.consecutiveFailuresForDegraded) {
			newStatus = "degraded";
		} else {
			newStatus = component.status as HealthStatus;
		}

		const updates: string[] = ["status = ?", "consecutive_failures = ?", "check_count = check_count + 1"];
		const params: unknown[] = [newStatus, consecutiveFailures];

		if (healthy) {
			updates.push("last_healthy_at = ?");
			params.push(Date.now());
		}

		params.push(componentId);

		this.db.prepare(`UPDATE components SET ${updates.join(", ")} WHERE id = ?`).run(...params);

		// Emit status change event
		if (newStatus !== component.status) {
			this.emit("status:changed", {
				componentId,
				oldStatus: component.status,
				newStatus,
			});
		}
	}

	/**
	 * Record a metric value
	 */
	recordMetric(params: { componentId: string; metricName: string; value: number; unit?: string }): HealthMetric {
		const id = `met-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const now = Date.now();

		const metric: HealthMetric = {
			id,
			componentId: params.componentId,
			metricName: params.metricName,
			value: params.value,
			unit: params.unit ?? "",
			timestamp: now,
		};

		this.db
			.prepare(
				`
      INSERT INTO metrics (id, component_id, metric_name, value, unit, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
			)
			.run(metric.id, metric.componentId, metric.metricName, metric.value, metric.unit, metric.timestamp);

		// Check thresholds
		this.checkThresholds(params.componentId, params.metricName, params.value);

		this.emit("metric:recorded", { metric });
		return metric;
	}

	/**
	 * Check if metric value triggers any alerts
	 */
	private checkThresholds(componentId: string, metricName: string, value: number): void {
		const thresholds = this.db
			.prepare(
				`
      SELECT * FROM alert_thresholds
      WHERE component_id = ? AND metric_name = ?
    `,
			)
			.all(componentId, metricName) as DbThresholdRow[];

		const now = Date.now();

		for (const threshold of thresholds) {
			// Check cooldown
			if (threshold.last_triggered_at && now - threshold.last_triggered_at < threshold.cooldown_ms) {
				continue;
			}

			let triggered = false;
			switch (threshold.operator) {
				case ">":
					triggered = value > threshold.threshold;
					break;
				case "<":
					triggered = value < threshold.threshold;
					break;
				case ">=":
					triggered = value >= threshold.threshold;
					break;
				case "<=":
					triggered = value <= threshold.threshold;
					break;
				case "==":
					triggered = value === threshold.threshold;
					break;
				case "!=":
					triggered = value !== threshold.threshold;
					break;
			}

			if (triggered) {
				this.createAlert({
					componentId,
					thresholdId: threshold.id,
					severity: threshold.severity as "info" | "warning" | "critical",
					message: `${metricName} ${threshold.operator} ${threshold.threshold} (actual: ${value})`,
					value,
					threshold: threshold.threshold,
				});

				// Update last triggered
				this.db.prepare(`UPDATE alert_thresholds SET last_triggered_at = ? WHERE id = ?`).run(now, threshold.id);
			}
		}
	}

	/**
	 * Create an alert
	 */
	private createAlert(params: {
		componentId: string;
		thresholdId: string;
		severity: "info" | "warning" | "critical";
		message: string;
		value: number;
		threshold: number;
	}): HealthAlert {
		const id = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const now = Date.now();

		const alert: HealthAlert = {
			id,
			componentId: params.componentId,
			thresholdId: params.thresholdId,
			severity: params.severity,
			message: params.message,
			value: params.value,
			threshold: params.threshold,
			acknowledged: false,
			triggeredAt: now,
		};

		this.db
			.prepare(
				`
      INSERT INTO alerts (id, component_id, threshold_id, severity, message, value, threshold, triggered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
			)
			.run(
				alert.id,
				alert.componentId,
				alert.thresholdId,
				alert.severity,
				alert.message,
				alert.value,
				alert.threshold,
				alert.triggeredAt,
			);

		this.emit("alert:triggered", { alert });
		return alert;
	}

	/**
	 * Set an alert threshold
	 */
	setThreshold(params: {
		componentId: string;
		metricName: string;
		operator: ">" | "<" | ">=" | "<=" | "==" | "!=";
		threshold: number;
		severity?: "info" | "warning" | "critical";
		cooldownMs?: number;
	}): AlertThreshold {
		const id = `thr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

		const threshold: AlertThreshold = {
			id,
			componentId: params.componentId,
			metricName: params.metricName,
			operator: params.operator,
			threshold: params.threshold,
			severity: params.severity ?? "warning",
			cooldownMs: params.cooldownMs ?? 300000,
		};

		this.db
			.prepare(
				`
      INSERT INTO alert_thresholds (id, component_id, metric_name, operator, threshold, severity, cooldown_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
			)
			.run(
				threshold.id,
				threshold.componentId,
				threshold.metricName,
				threshold.operator,
				threshold.threshold,
				threshold.severity,
				threshold.cooldownMs,
			);

		return threshold;
	}

	/**
	 * Acknowledge an alert
	 */
	acknowledgeAlert(alertId: string, userId: string): boolean {
		const now = Date.now();
		const result = this.db
			.prepare(
				`
      UPDATE alerts SET acknowledged = 1, acknowledged_at = ?, acknowledged_by = ?
      WHERE id = ? AND acknowledged = 0
    `,
			)
			.run(now, userId, alertId);

		if (result.changes > 0) {
			this.emit("alert:acknowledged", { alertId, userId });
		}

		return result.changes > 0;
	}

	/**
	 * Start a periodic health checker
	 */
	startChecker(checker: HealthChecker): void {
		// Stop existing checker if any
		this.stopChecker(checker.componentId);

		const runCheck = async () => {
			try {
				const result = await checker.check();
				this.recordHealthCheck({
					componentId: checker.componentId,
					healthy: result.healthy,
					message: result.message,
					latencyMs: result.latencyMs,
					metadata: result.metadata,
				});
			} catch (error) {
				this.recordHealthCheck({
					componentId: checker.componentId,
					healthy: false,
					message: error instanceof Error ? error.message : String(error),
				});
			}
		};

		// Run immediately
		runCheck();

		// Schedule periodic checks
		const timer = setInterval(runCheck, checker.intervalMs);
		this.checkers.set(checker.componentId, { checker, timer });
	}

	/**
	 * Stop a health checker
	 */
	stopChecker(componentId: string): void {
		const entry = this.checkers.get(componentId);
		if (entry) {
			clearInterval(entry.timer);
			this.checkers.delete(componentId);
		}
	}

	/**
	 * Get component health
	 */
	getComponentHealth(componentId: string): ComponentHealth | null {
		const row = this.db.prepare(`SELECT * FROM components WHERE id = ?`).get(componentId) as
			| DbComponentRow
			| undefined;

		if (!row) return null;

		// Get last check
		const lastCheck = this.db
			.prepare(
				`
      SELECT * FROM health_checks
      WHERE component_id = ?
      ORDER BY checked_at DESC
      LIMIT 1
    `,
			)
			.get(componentId) as DbCheckRow | undefined;

		// Calculate uptime and avg latency
		const stats = this.db
			.prepare(
				`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'healthy' THEN 1 ELSE 0 END) as healthy,
        AVG(latency_ms) as avg_latency
      FROM health_checks
      WHERE component_id = ?
      AND checked_at > ?
    `,
			)
			.get(componentId, Date.now() - 24 * 60 * 60 * 1000) as {
			total: number;
			healthy: number;
			avg_latency: number | null;
		};

		const uptimePercent = stats.total > 0 ? (stats.healthy / stats.total) * 100 : 100;

		return {
			id: row.id,
			type: row.type as ComponentType,
			name: row.name,
			status: row.status as HealthStatus,
			lastCheck: lastCheck ? this.rowToCheck(lastCheck) : null,
			consecutiveFailures: row.consecutive_failures,
			uptimePercent: Math.round(uptimePercent * 10) / 10,
			avgLatencyMs: Math.round(stats.avg_latency ?? 0),
			checkCount: row.check_count,
			lastHealthyAt: row.last_healthy_at ?? row.registered_at,
			registeredAt: row.registered_at,
		};
	}

	/**
	 * Get system-wide health status
	 */
	getSystemHealth(): SystemHealth {
		const components = this.db.prepare(`SELECT * FROM components`).all() as DbComponentRow[];

		const componentHealths = components.map((c) => this.getComponentHealth(c.id)!);

		const activeAlerts = this.db
			.prepare(`SELECT * FROM alerts WHERE acknowledged = 0 ORDER BY triggered_at DESC`)
			.all() as DbAlertRow[];

		// Calculate overall status
		const unhealthyCount = componentHealths.filter((c) => c.status === "unhealthy").length;
		const degradedCount = componentHealths.filter((c) => c.status === "degraded").length;

		let status: HealthStatus;
		if (unhealthyCount > 0) {
			status = "unhealthy";
		} else if (degradedCount > 0) {
			status = "degraded";
		} else if (componentHealths.length === 0) {
			status = "unknown";
		} else {
			status = "healthy";
		}

		const avgUptime =
			componentHealths.length > 0
				? componentHealths.reduce((sum, c) => sum + c.uptimePercent, 0) / componentHealths.length
				: 100;

		const avgLatency =
			componentHealths.length > 0
				? componentHealths.reduce((sum, c) => sum + c.avgLatencyMs, 0) / componentHealths.length
				: 0;

		return {
			status,
			components: componentHealths,
			activeAlerts: activeAlerts.map((a) => this.rowToAlert(a)),
			metrics: {
				totalComponents: componentHealths.length,
				healthyComponents: componentHealths.filter((c) => c.status === "healthy").length,
				degradedComponents: degradedCount,
				unhealthyComponents: unhealthyCount,
				avgUptimePercent: Math.round(avgUptime * 10) / 10,
				avgLatencyMs: Math.round(avgLatency),
			},
			lastUpdated: Date.now(),
		};
	}

	/**
	 * Get health history for a component
	 */
	getHealthHistory(componentId: string, limit = 100): HealthCheck[] {
		const rows = this.db
			.prepare(
				`
      SELECT * FROM health_checks
      WHERE component_id = ?
      ORDER BY checked_at DESC
      LIMIT ?
    `,
			)
			.all(componentId, limit) as DbCheckRow[];

		return rows.map((r) => this.rowToCheck(r));
	}

	/**
	 * Get metrics for a component
	 */
	getMetrics(componentId: string, metricName?: string, limit = 100): HealthMetric[] {
		let sql = `SELECT * FROM metrics WHERE component_id = ?`;
		const params: unknown[] = [componentId];

		if (metricName) {
			sql += ` AND metric_name = ?`;
			params.push(metricName);
		}

		sql += ` ORDER BY timestamp DESC LIMIT ?`;
		params.push(limit);

		const rows = this.db.prepare(sql).all(...params) as DbMetricRow[];

		return rows.map((r) => ({
			id: r.id,
			componentId: r.component_id,
			metricName: r.metric_name,
			value: r.value,
			unit: r.unit,
			timestamp: r.timestamp,
		}));
	}

	/**
	 * Get alerts
	 */
	getAlerts(
		params: {
			componentId?: string;
			acknowledged?: boolean;
			severity?: "info" | "warning" | "critical";
			limit?: number;
		} = {},
	): HealthAlert[] {
		let sql = `SELECT * FROM alerts WHERE 1=1`;
		const sqlParams: unknown[] = [];

		if (params.componentId) {
			sql += ` AND component_id = ?`;
			sqlParams.push(params.componentId);
		}

		if (params.acknowledged !== undefined) {
			sql += ` AND acknowledged = ?`;
			sqlParams.push(params.acknowledged ? 1 : 0);
		}

		if (params.severity) {
			sql += ` AND severity = ?`;
			sqlParams.push(params.severity);
		}

		sql += ` ORDER BY triggered_at DESC LIMIT ?`;
		sqlParams.push(params.limit ?? 50);

		const rows = this.db.prepare(sql).all(...sqlParams) as DbAlertRow[];

		return rows.map((r) => this.rowToAlert(r));
	}

	/**
	 * Clean up old data
	 */
	private cleanupOldData(): void {
		const now = Date.now();
		const checkCutoff = now - this.config.healthHistoryRetentionDays * 24 * 60 * 60 * 1000;
		const metricCutoff = now - this.config.metricsRetentionDays * 24 * 60 * 60 * 1000;
		const alertCutoff = now - this.config.alertRetentionDays * 24 * 60 * 60 * 1000;

		this.db.prepare(`DELETE FROM health_checks WHERE checked_at < ?`).run(checkCutoff);
		this.db.prepare(`DELETE FROM metrics WHERE timestamp < ?`).run(metricCutoff);
		this.db.prepare(`DELETE FROM alerts WHERE triggered_at < ? AND acknowledged = 1`).run(alertCutoff);

		this.emit("cleanup:completed");
	}

	private rowToCheck(row: DbCheckRow): HealthCheck {
		return {
			id: row.id,
			componentId: row.component_id,
			componentType: "agent",
			name: "",
			status: row.status as HealthStatus,
			message: row.message,
			latencyMs: row.latency_ms,
			metadata: JSON.parse(row.metadata),
			checkedAt: row.checked_at,
		};
	}

	private rowToAlert(row: DbAlertRow): HealthAlert {
		return {
			id: row.id,
			componentId: row.component_id,
			thresholdId: row.threshold_id,
			severity: row.severity as "info" | "warning" | "critical",
			message: row.message,
			value: row.value,
			threshold: row.threshold,
			acknowledged: row.acknowledged === 1,
			triggeredAt: row.triggered_at,
			acknowledgedAt: row.acknowledged_at ?? undefined,
			acknowledgedBy: row.acknowledged_by ?? undefined,
		};
	}

	/**
	 * Close the system
	 */
	close(): void {
		// Stop all checkers
		for (const [componentId] of this.checkers) {
			this.stopChecker(componentId);
		}

		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
		}

		this.db.close();
		this.emit("system:closed");
	}
}

// ============================================================================
// Internal Types
// ============================================================================

interface DbComponentRow {
	id: string;
	type: string;
	name: string;
	status: string;
	consecutive_failures: number;
	check_count: number;
	last_healthy_at: number | null;
	registered_at: number;
}

interface DbCheckRow {
	id: string;
	component_id: string;
	status: string;
	message: string;
	latency_ms: number;
	metadata: string;
	checked_at: number;
}

interface DbMetricRow {
	id: string;
	component_id: string;
	metric_name: string;
	value: number;
	unit: string;
	timestamp: number;
}

interface DbThresholdRow {
	id: string;
	component_id: string;
	metric_name: string;
	operator: string;
	threshold: number;
	severity: string;
	cooldown_ms: number;
	last_triggered_at: number | null;
}

interface DbAlertRow {
	id: string;
	component_id: string;
	threshold_id: string;
	severity: string;
	message: string;
	value: number;
	threshold: number;
	acknowledged: number;
	triggered_at: number;
	acknowledged_at: number | null;
	acknowledged_by: string | null;
}

// ============================================================================
// Singleton Factory
// ============================================================================

let instance: HealthMonitoringSystem | null = null;

export function getHealthMonitoring(dataDir: string, config?: Partial<MonitoringConfig>): HealthMonitoringSystem {
	if (!instance) {
		instance = new HealthMonitoringSystem(dataDir, config);
	}
	return instance;
}

export function resetHealthMonitoring(): void {
	if (instance) {
		instance.close();
		instance = null;
	}
}
