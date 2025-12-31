/**
 * Class 3.54: Circuit Breaker System
 * TAC Pattern: Fault tolerance and resilience for service calls
 *
 * Features:
 * - Circuit states: CLOSED, OPEN, HALF_OPEN
 * - Failure threshold configuration
 * - Success threshold for recovery
 * - Timeout/cooldown periods
 * - Per-service circuit tracking
 * - Sliding window failure counting
 * - Health check probes
 * - Manual override (force open/close)
 * - Fallback function support
 * - Event emission for state changes
 * - SQLite persistence for circuit state
 * - Metrics collection (failures, successes, state changes)
 * - Circuit groups/namespaces
 * - Configurable error classification
 */

import { EventEmitter } from "events";

import Database = require("better-sqlite3");

import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export type CircuitState = "closed" | "open" | "half_open";
export type ErrorClassification = "transient" | "permanent" | "timeout" | "unknown";
export type CircuitEventType =
	| "state_change"
	| "call_success"
	| "call_failure"
	| "fallback_executed"
	| "probe_executed"
	| "manual_override";

export interface CircuitConfig {
	id: string;
	name: string;
	namespace?: string;
	description?: string;
	// Failure thresholds
	failureThreshold: number; // Number of failures to trip circuit
	failureRateThreshold?: number; // Percentage (0-100) of failures to trip
	// Recovery settings
	successThreshold: number; // Successes in half-open to close circuit
	halfOpenMaxCalls: number; // Max concurrent calls in half-open state
	// Timing
	resetTimeoutMs: number; // Time to wait before half-open
	callTimeoutMs: number; // Individual call timeout
	// Sliding window
	slidingWindowSize: number; // Number of calls in window
	slidingWindowType: "count" | "time";
	slidingWindowTimeMs?: number; // Window duration if type is 'time'
	// Error classification
	errorClassifiers?: ErrorClassifier[];
	tripOnlyOnTransient?: boolean; // Only trip on transient errors
	// Health probes
	enableHealthProbes?: boolean;
	healthProbeIntervalMs?: number;
	healthProbeFn?: () => Promise<boolean>;
	// Fallback
	fallbackFn?: <T>(error: Error, args: unknown[]) => Promise<T> | T;
	// Metadata
	metadata?: Record<string, unknown>;
	enabled: boolean;
	createdAt: Date;
}

export interface ErrorClassifier {
	name: string;
	pattern?: RegExp;
	errorTypes?: string[];
	classification: ErrorClassification;
	shouldTrip: boolean;
}

export interface Circuit {
	id: string;
	config: CircuitConfig;
	state: CircuitState;
	failureCount: number;
	successCount: number;
	halfOpenCallsInProgress: number;
	lastFailureAt?: Date;
	lastSuccessAt?: Date;
	lastStateChangeAt: Date;
	openedAt?: Date;
	slidingWindow: SlidingWindowEntry[];
	metrics: CircuitMetrics;
	isHealthy: boolean;
	lastHealthCheckAt?: Date;
}

export interface SlidingWindowEntry {
	timestamp: number;
	success: boolean;
	duration: number;
	errorType?: string;
	classification?: ErrorClassification;
}

export interface CircuitMetrics {
	totalCalls: number;
	successfulCalls: number;
	failedCalls: number;
	fallbackExecutions: number;
	rejectedCalls: number;
	timeouts: number;
	avgResponseTimeMs: number;
	totalResponseTimeMs: number;
	stateChanges: number;
	lastResetAt?: Date;
	openDurationTotalMs: number;
	halfOpenDurationTotalMs: number;
}

export interface CircuitCallResult<T> {
	success: boolean;
	result?: T;
	error?: Error;
	duration: number;
	wasRejected: boolean;
	usedFallback: boolean;
	circuitState: CircuitState;
}

export interface CircuitEvent {
	id: string;
	circuitId: string;
	circuitName: string;
	eventType: CircuitEventType;
	previousState?: CircuitState;
	newState?: CircuitState;
	error?: string;
	duration?: number;
	timestamp: Date;
	metadata?: Record<string, unknown>;
}

export interface CircuitGroup {
	namespace: string;
	circuits: string[];
	aggregateState: CircuitState;
	healthyCount: number;
	unhealthyCount: number;
	openCount: number;
}

export interface CircuitStats {
	totalCircuits: number;
	enabledCircuits: number;
	closedCount: number;
	openCount: number;
	halfOpenCount: number;
	totalCalls: number;
	successRate: number;
	avgResponseTimeMs: number;
	byNamespace: Record<
		string,
		{
			total: number;
			closed: number;
			open: number;
			halfOpen: number;
		}
	>;
}

export interface CircuitBreakerConfig {
	dataDir: string;
	defaultFailureThreshold: number;
	defaultSuccessThreshold: number;
	defaultResetTimeoutMs: number;
	defaultCallTimeoutMs: number;
	defaultSlidingWindowSize: number;
	defaultHalfOpenMaxCalls: number;
	metricsRetentionDays: number;
	eventRetentionDays: number;
	enablePersistence: boolean;
	cleanupIntervalMs: number;
}

export interface CircuitHealthProbe {
	circuitId: string;
	intervalHandle?: NodeJS.Timeout;
	lastProbeAt?: Date;
	lastProbeSuccess?: boolean;
	consecutiveSuccesses: number;
	consecutiveFailures: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: CircuitBreakerConfig = {
	dataDir: "./data",
	defaultFailureThreshold: 5,
	defaultSuccessThreshold: 3,
	defaultResetTimeoutMs: 30000, // 30 seconds
	defaultCallTimeoutMs: 10000, // 10 seconds
	defaultSlidingWindowSize: 10,
	defaultHalfOpenMaxCalls: 3,
	metricsRetentionDays: 7,
	eventRetentionDays: 30,
	enablePersistence: true,
	cleanupIntervalMs: 3600000, // 1 hour
};

const DEFAULT_ERROR_CLASSIFIERS: ErrorClassifier[] = [
	{
		name: "timeout",
		pattern: /timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i,
		classification: "timeout",
		shouldTrip: true,
	},
	{
		name: "connection",
		pattern: /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH/i,
		classification: "transient",
		shouldTrip: true,
	},
	{
		name: "rate_limit",
		pattern: /rate limit|too many requests|429/i,
		classification: "transient",
		shouldTrip: true,
	},
	{
		name: "server_error",
		pattern: /5\d{2}|internal server error|service unavailable/i,
		classification: "transient",
		shouldTrip: true,
	},
	{
		name: "bad_request",
		pattern: /400|bad request|invalid/i,
		classification: "permanent",
		shouldTrip: false,
	},
	{
		name: "unauthorized",
		pattern: /401|403|unauthorized|forbidden/i,
		classification: "permanent",
		shouldTrip: false,
	},
	{
		name: "not_found",
		pattern: /404|not found/i,
		classification: "permanent",
		shouldTrip: false,
	},
];

// ============================================================================
// Circuit Breaker System
// ============================================================================

export class CircuitBreakerSystem extends EventEmitter {
	private db: Database.Database;
	private config: CircuitBreakerConfig;
	private circuits: Map<string, Circuit> = new Map();
	private healthProbes: Map<string, CircuitHealthProbe> = new Map();
	private resetTimeouts: Map<string, NodeJS.Timeout> = new Map();
	private cleanupInterval: NodeJS.Timeout | null = null;
	private globalErrorClassifiers: ErrorClassifier[] = [...DEFAULT_ERROR_CLASSIFIERS];

	constructor(config: Partial<CircuitBreakerConfig> = {}) {
		super();
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.db = new Database(join(this.config.dataDir, "circuit_breaker.db"));
		this.initializeDatabase();
		this.loadPersistedState();
		this.startCleanupScheduler();
	}

	private initializeDatabase(): void {
		this.db.pragma("journal_mode = WAL");

		// Circuit configurations table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS circuit_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        namespace TEXT,
        description TEXT,
        failure_threshold INTEGER NOT NULL,
        failure_rate_threshold REAL,
        success_threshold INTEGER NOT NULL,
        half_open_max_calls INTEGER NOT NULL,
        reset_timeout_ms INTEGER NOT NULL,
        call_timeout_ms INTEGER NOT NULL,
        sliding_window_size INTEGER NOT NULL,
        sliding_window_type TEXT NOT NULL DEFAULT 'count',
        sliding_window_time_ms INTEGER,
        trip_only_on_transient INTEGER NOT NULL DEFAULT 0,
        enable_health_probes INTEGER NOT NULL DEFAULT 0,
        health_probe_interval_ms INTEGER,
        metadata TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      )
    `);

		// Circuit state table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS circuit_states (
        circuit_id TEXT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT 'closed',
        failure_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        last_failure_at TEXT,
        last_success_at TEXT,
        last_state_change_at TEXT NOT NULL,
        opened_at TEXT,
        is_healthy INTEGER NOT NULL DEFAULT 1,
        last_health_check_at TEXT,
        FOREIGN KEY (circuit_id) REFERENCES circuit_configs(id)
      )
    `);

		// Circuit metrics table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS circuit_metrics (
        circuit_id TEXT PRIMARY KEY,
        total_calls INTEGER NOT NULL DEFAULT 0,
        successful_calls INTEGER NOT NULL DEFAULT 0,
        failed_calls INTEGER NOT NULL DEFAULT 0,
        fallback_executions INTEGER NOT NULL DEFAULT 0,
        rejected_calls INTEGER NOT NULL DEFAULT 0,
        timeouts INTEGER NOT NULL DEFAULT 0,
        avg_response_time_ms REAL NOT NULL DEFAULT 0,
        total_response_time_ms REAL NOT NULL DEFAULT 0,
        state_changes INTEGER NOT NULL DEFAULT 0,
        last_reset_at TEXT,
        open_duration_total_ms INTEGER NOT NULL DEFAULT 0,
        half_open_duration_total_ms INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (circuit_id) REFERENCES circuit_configs(id)
      )
    `);

		// Circuit events table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS circuit_events (
        id TEXT PRIMARY KEY,
        circuit_id TEXT NOT NULL,
        circuit_name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        previous_state TEXT,
        new_state TEXT,
        error TEXT,
        duration INTEGER,
        timestamp TEXT NOT NULL,
        metadata TEXT,
        FOREIGN KEY (circuit_id) REFERENCES circuit_configs(id)
      )
    `);

		// Error classifiers table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS error_classifiers (
        id TEXT PRIMARY KEY,
        circuit_id TEXT,
        name TEXT NOT NULL,
        pattern TEXT,
        error_types TEXT,
        classification TEXT NOT NULL,
        should_trip INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (circuit_id) REFERENCES circuit_configs(id)
      )
    `);

		// Indexes
		this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_circuit ON circuit_events(circuit_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON circuit_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_type ON circuit_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_configs_namespace ON circuit_configs(namespace);
      CREATE INDEX IF NOT EXISTS idx_classifiers_circuit ON error_classifiers(circuit_id);
    `);
	}

	private loadPersistedState(): void {
		if (!this.config.enablePersistence) return;

		// Load circuit configurations and states
		const configsStmt = this.db.prepare("SELECT * FROM circuit_configs WHERE enabled = 1");
		const configs = configsStmt.all() as Record<string, unknown>[];

		for (const row of configs) {
			const circuitId = row.id as string;

			// Load state
			const stateStmt = this.db.prepare("SELECT * FROM circuit_states WHERE circuit_id = ?");
			const stateRow = stateStmt.get(circuitId) as Record<string, unknown> | undefined;

			// Load metrics
			const metricsStmt = this.db.prepare("SELECT * FROM circuit_metrics WHERE circuit_id = ?");
			const metricsRow = metricsStmt.get(circuitId) as Record<string, unknown> | undefined;

			// Load custom error classifiers
			const classifiersStmt = this.db.prepare("SELECT * FROM error_classifiers WHERE circuit_id = ?");
			const classifierRows = classifiersStmt.all(circuitId) as Record<string, unknown>[];
			const errorClassifiers = classifierRows.map((r) => this.rowToClassifier(r));

			const config = this.rowToConfig(row, errorClassifiers);
			const state = stateRow ? this.rowToState(stateRow) : this.createDefaultState(circuitId);
			const metrics = metricsRow ? this.rowToMetrics(metricsRow) : this.createDefaultMetrics();

			const circuit: Circuit = {
				id: circuitId,
				config,
				state: state.state,
				failureCount: state.failureCount,
				successCount: state.successCount,
				halfOpenCallsInProgress: 0,
				lastFailureAt: state.lastFailureAt,
				lastSuccessAt: state.lastSuccessAt,
				lastStateChangeAt: state.lastStateChangeAt,
				openedAt: state.openedAt,
				slidingWindow: [],
				metrics,
				isHealthy: state.isHealthy,
				lastHealthCheckAt: state.lastHealthCheckAt,
			};

			this.circuits.set(circuitId, circuit);

			// Start health probes if configured
			if (config.enableHealthProbes && config.healthProbeFn) {
				this.startHealthProbe(circuit);
			}

			// If circuit is open, schedule reset timeout
			if (circuit.state === "open") {
				this.scheduleResetTimeout(circuit);
			}
		}
	}

	private rowToConfig(row: Record<string, unknown>, errorClassifiers: ErrorClassifier[]): CircuitConfig {
		return {
			id: row.id as string,
			name: row.name as string,
			namespace: row.namespace as string | undefined,
			description: row.description as string | undefined,
			failureThreshold: row.failure_threshold as number,
			failureRateThreshold: row.failure_rate_threshold as number | undefined,
			successThreshold: row.success_threshold as number,
			halfOpenMaxCalls: row.half_open_max_calls as number,
			resetTimeoutMs: row.reset_timeout_ms as number,
			callTimeoutMs: row.call_timeout_ms as number,
			slidingWindowSize: row.sliding_window_size as number,
			slidingWindowType: row.sliding_window_type as "count" | "time",
			slidingWindowTimeMs: row.sliding_window_time_ms as number | undefined,
			tripOnlyOnTransient: Boolean(row.trip_only_on_transient),
			enableHealthProbes: Boolean(row.enable_health_probes),
			healthProbeIntervalMs: row.health_probe_interval_ms as number | undefined,
			errorClassifiers: errorClassifiers.length > 0 ? errorClassifiers : undefined,
			metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
			enabled: Boolean(row.enabled),
			createdAt: new Date(row.created_at as string),
		};
	}

	private rowToState(row: Record<string, unknown>): {
		state: CircuitState;
		failureCount: number;
		successCount: number;
		lastFailureAt?: Date;
		lastSuccessAt?: Date;
		lastStateChangeAt: Date;
		openedAt?: Date;
		isHealthy: boolean;
		lastHealthCheckAt?: Date;
	} {
		return {
			state: row.state as CircuitState,
			failureCount: row.failure_count as number,
			successCount: row.success_count as number,
			lastFailureAt: row.last_failure_at ? new Date(row.last_failure_at as string) : undefined,
			lastSuccessAt: row.last_success_at ? new Date(row.last_success_at as string) : undefined,
			lastStateChangeAt: new Date(row.last_state_change_at as string),
			openedAt: row.opened_at ? new Date(row.opened_at as string) : undefined,
			isHealthy: Boolean(row.is_healthy),
			lastHealthCheckAt: row.last_health_check_at ? new Date(row.last_health_check_at as string) : undefined,
		};
	}

	private rowToMetrics(row: Record<string, unknown>): CircuitMetrics {
		return {
			totalCalls: row.total_calls as number,
			successfulCalls: row.successful_calls as number,
			failedCalls: row.failed_calls as number,
			fallbackExecutions: row.fallback_executions as number,
			rejectedCalls: row.rejected_calls as number,
			timeouts: row.timeouts as number,
			avgResponseTimeMs: row.avg_response_time_ms as number,
			totalResponseTimeMs: row.total_response_time_ms as number,
			stateChanges: row.state_changes as number,
			lastResetAt: row.last_reset_at ? new Date(row.last_reset_at as string) : undefined,
			openDurationTotalMs: row.open_duration_total_ms as number,
			halfOpenDurationTotalMs: row.half_open_duration_total_ms as number,
		};
	}

	private rowToClassifier(row: Record<string, unknown>): ErrorClassifier {
		return {
			name: row.name as string,
			pattern: row.pattern ? new RegExp(row.pattern as string, "i") : undefined,
			errorTypes: row.error_types ? JSON.parse(row.error_types as string) : undefined,
			classification: row.classification as ErrorClassification,
			shouldTrip: Boolean(row.should_trip),
		};
	}

	private createDefaultState(_circuitId: string): {
		state: CircuitState;
		failureCount: number;
		successCount: number;
		lastFailureAt?: Date;
		lastSuccessAt?: Date;
		lastStateChangeAt: Date;
		openedAt?: Date;
		isHealthy: boolean;
		lastHealthCheckAt?: Date;
	} {
		return {
			state: "closed",
			failureCount: 0,
			successCount: 0,
			lastFailureAt: undefined,
			lastSuccessAt: undefined,
			lastStateChangeAt: new Date(),
			openedAt: undefined,
			isHealthy: true,
			lastHealthCheckAt: undefined,
		};
	}

	private createDefaultMetrics(): CircuitMetrics {
		return {
			totalCalls: 0,
			successfulCalls: 0,
			failedCalls: 0,
			fallbackExecutions: 0,
			rejectedCalls: 0,
			timeouts: 0,
			avgResponseTimeMs: 0,
			totalResponseTimeMs: 0,
			stateChanges: 0,
			openDurationTotalMs: 0,
			halfOpenDurationTotalMs: 0,
		};
	}

	private startCleanupScheduler(): void {
		this.cleanupInterval = setInterval(() => {
			this.cleanup();
		}, this.config.cleanupIntervalMs);
	}

	private cleanup(): void {
		// Clean old events
		const eventCutoff = new Date();
		eventCutoff.setDate(eventCutoff.getDate() - this.config.eventRetentionDays);
		const eventsStmt = this.db.prepare("DELETE FROM circuit_events WHERE timestamp < ?");
		eventsStmt.run(eventCutoff.toISOString());

		this.emit("cleanup:completed", { timestamp: new Date() });
	}

	// ============================================================================
	// Circuit Registration
	// ============================================================================

	registerCircuit(params: {
		name: string;
		namespace?: string;
		description?: string;
		failureThreshold?: number;
		failureRateThreshold?: number;
		successThreshold?: number;
		halfOpenMaxCalls?: number;
		resetTimeoutMs?: number;
		callTimeoutMs?: number;
		slidingWindowSize?: number;
		slidingWindowType?: "count" | "time";
		slidingWindowTimeMs?: number;
		errorClassifiers?: ErrorClassifier[];
		tripOnlyOnTransient?: boolean;
		enableHealthProbes?: boolean;
		healthProbeIntervalMs?: number;
		healthProbeFn?: () => Promise<boolean>;
		fallbackFn?: <T>(error: Error, args: unknown[]) => Promise<T> | T;
		metadata?: Record<string, unknown>;
	}): Circuit {
		const id = `circuit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const now = new Date();

		const config: CircuitConfig = {
			id,
			name: params.name,
			namespace: params.namespace,
			description: params.description,
			failureThreshold: params.failureThreshold ?? this.config.defaultFailureThreshold,
			failureRateThreshold: params.failureRateThreshold,
			successThreshold: params.successThreshold ?? this.config.defaultSuccessThreshold,
			halfOpenMaxCalls: params.halfOpenMaxCalls ?? this.config.defaultHalfOpenMaxCalls,
			resetTimeoutMs: params.resetTimeoutMs ?? this.config.defaultResetTimeoutMs,
			callTimeoutMs: params.callTimeoutMs ?? this.config.defaultCallTimeoutMs,
			slidingWindowSize: params.slidingWindowSize ?? this.config.defaultSlidingWindowSize,
			slidingWindowType: params.slidingWindowType ?? "count",
			slidingWindowTimeMs: params.slidingWindowTimeMs,
			errorClassifiers: params.errorClassifiers,
			tripOnlyOnTransient: params.tripOnlyOnTransient ?? false,
			enableHealthProbes: params.enableHealthProbes ?? false,
			healthProbeIntervalMs: params.healthProbeIntervalMs ?? 30000,
			healthProbeFn: params.healthProbeFn,
			fallbackFn: params.fallbackFn,
			metadata: params.metadata,
			enabled: true,
			createdAt: now,
		};

		// Persist configuration
		if (this.config.enablePersistence) {
			const stmt = this.db.prepare(`
        INSERT INTO circuit_configs
        (id, name, namespace, description, failure_threshold, failure_rate_threshold,
         success_threshold, half_open_max_calls, reset_timeout_ms, call_timeout_ms,
         sliding_window_size, sliding_window_type, sliding_window_time_ms,
         trip_only_on_transient, enable_health_probes, health_probe_interval_ms,
         metadata, enabled, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

			stmt.run(
				config.id,
				config.name,
				config.namespace ?? null,
				config.description ?? null,
				config.failureThreshold,
				config.failureRateThreshold ?? null,
				config.successThreshold,
				config.halfOpenMaxCalls,
				config.resetTimeoutMs,
				config.callTimeoutMs,
				config.slidingWindowSize,
				config.slidingWindowType,
				config.slidingWindowTimeMs ?? null,
				config.tripOnlyOnTransient ? 1 : 0,
				config.enableHealthProbes ? 1 : 0,
				config.healthProbeIntervalMs ?? null,
				config.metadata ? JSON.stringify(config.metadata) : null,
				1,
				now.toISOString(),
			);

			// Persist custom error classifiers
			if (params.errorClassifiers) {
				for (const classifier of params.errorClassifiers) {
					const classifierStmt = this.db.prepare(`
            INSERT INTO error_classifiers
            (id, circuit_id, name, pattern, error_types, classification, should_trip)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);

					classifierStmt.run(
						`classifier_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
						id,
						classifier.name,
						classifier.pattern?.source ?? null,
						classifier.errorTypes ? JSON.stringify(classifier.errorTypes) : null,
						classifier.classification,
						classifier.shouldTrip ? 1 : 0,
					);
				}
			}

			// Initialize state record
			const stateStmt = this.db.prepare(`
        INSERT INTO circuit_states
        (circuit_id, state, failure_count, success_count, last_state_change_at, is_healthy)
        VALUES (?, 'closed', 0, 0, ?, 1)
      `);
			stateStmt.run(id, now.toISOString());

			// Initialize metrics record
			const metricsStmt = this.db.prepare(`
        INSERT INTO circuit_metrics (circuit_id) VALUES (?)
      `);
			metricsStmt.run(id);
		}

		const circuit: Circuit = {
			id,
			config,
			state: "closed",
			failureCount: 0,
			successCount: 0,
			halfOpenCallsInProgress: 0,
			lastStateChangeAt: now,
			slidingWindow: [],
			metrics: this.createDefaultMetrics(),
			isHealthy: true,
		};

		this.circuits.set(id, circuit);

		// Start health probes if configured
		if (config.enableHealthProbes && config.healthProbeFn) {
			this.startHealthProbe(circuit);
		}

		this.emit("circuit:registered", circuit);
		return circuit;
	}

	unregisterCircuit(circuitId: string): boolean {
		const circuit = this.circuits.get(circuitId);
		if (!circuit) return false;

		// Stop health probes
		this.stopHealthProbe(circuitId);

		// Clear reset timeout
		const timeout = this.resetTimeouts.get(circuitId);
		if (timeout) {
			clearTimeout(timeout);
			this.resetTimeouts.delete(circuitId);
		}

		// Remove from database
		if (this.config.enablePersistence) {
			this.db.prepare("DELETE FROM error_classifiers WHERE circuit_id = ?").run(circuitId);
			this.db.prepare("DELETE FROM circuit_metrics WHERE circuit_id = ?").run(circuitId);
			this.db.prepare("DELETE FROM circuit_states WHERE circuit_id = ?").run(circuitId);
			this.db.prepare("DELETE FROM circuit_configs WHERE id = ?").run(circuitId);
		}

		this.circuits.delete(circuitId);
		this.emit("circuit:unregistered", { circuitId });
		return true;
	}

	getCircuit(circuitId: string): Circuit | null {
		return this.circuits.get(circuitId) ?? null;
	}

	getCircuitByName(name: string, namespace?: string): Circuit | null {
		for (const circuit of this.circuits.values()) {
			if (circuit.config.name === name) {
				if (namespace === undefined || circuit.config.namespace === namespace) {
					return circuit;
				}
			}
		}
		return null;
	}

	getAllCircuits(): Circuit[] {
		return Array.from(this.circuits.values());
	}

	getCircuitsByNamespace(namespace: string): Circuit[] {
		return Array.from(this.circuits.values()).filter((c) => c.config.namespace === namespace);
	}

	// ============================================================================
	// Circuit Execution
	// ============================================================================

	async execute<T>(
		circuitId: string,
		fn: () => Promise<T>,
		fallbackFn?: (error: Error) => Promise<T> | T,
	): Promise<CircuitCallResult<T>> {
		const circuit = this.circuits.get(circuitId);
		if (!circuit) {
			throw new Error(`Circuit not found: ${circuitId}`);
		}

		if (!circuit.config.enabled) {
			// Circuit disabled - execute directly
			const startTime = Date.now();
			try {
				const result = await fn();
				return {
					success: true,
					result,
					duration: Date.now() - startTime,
					wasRejected: false,
					usedFallback: false,
					circuitState: circuit.state,
				};
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error : new Error(String(error)),
					duration: Date.now() - startTime,
					wasRejected: false,
					usedFallback: false,
					circuitState: circuit.state,
				};
			}
		}

		// Check circuit state
		if (circuit.state === "open") {
			// Circuit is open - reject or use fallback
			circuit.metrics.rejectedCalls++;
			this.persistMetrics(circuit);

			const activeFallback = fallbackFn ?? circuit.config.fallbackFn;
			if (activeFallback) {
				try {
					const fallbackResult = await activeFallback(new Error("Circuit is open"), []);
					circuit.metrics.fallbackExecutions++;
					this.persistMetrics(circuit);
					this.recordEvent(circuit, "fallback_executed", { reason: "circuit_open" });

					return {
						success: true,
						result: fallbackResult as T,
						duration: 0,
						wasRejected: true,
						usedFallback: true,
						circuitState: circuit.state,
					};
				} catch (fallbackError) {
					return {
						success: false,
						error: fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)),
						duration: 0,
						wasRejected: true,
						usedFallback: true,
						circuitState: circuit.state,
					};
				}
			}

			return {
				success: false,
				error: new Error("Circuit is open"),
				duration: 0,
				wasRejected: true,
				usedFallback: false,
				circuitState: circuit.state,
			};
		}

		// Check half-open concurrency limit
		if (circuit.state === "half_open") {
			if (circuit.halfOpenCallsInProgress >= circuit.config.halfOpenMaxCalls) {
				circuit.metrics.rejectedCalls++;
				this.persistMetrics(circuit);

				const activeFallback = fallbackFn ?? circuit.config.fallbackFn;
				if (activeFallback) {
					try {
						const fallbackResult = await activeFallback(new Error("Circuit half-open limit reached"), []);
						circuit.metrics.fallbackExecutions++;
						this.persistMetrics(circuit);
						this.recordEvent(circuit, "fallback_executed", { reason: "half_open_limit" });

						return {
							success: true,
							result: fallbackResult as T,
							duration: 0,
							wasRejected: true,
							usedFallback: true,
							circuitState: circuit.state,
						};
					} catch (fallbackError) {
						return {
							success: false,
							error: fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)),
							duration: 0,
							wasRejected: true,
							usedFallback: true,
							circuitState: circuit.state,
						};
					}
				}

				return {
					success: false,
					error: new Error("Circuit half-open limit reached"),
					duration: 0,
					wasRejected: true,
					usedFallback: false,
					circuitState: circuit.state,
				};
			}
			circuit.halfOpenCallsInProgress++;
		}

		// Execute the function
		const startTime = Date.now();
		let result: T | undefined;
		let error: Error | undefined;
		let success = false;

		try {
			// Apply timeout
			result = await Promise.race([
				fn(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("Call timeout")), circuit.config.callTimeoutMs),
				),
			]);
			success = true;
		} catch (e) {
			error = e instanceof Error ? e : new Error(String(e));

			// Check for timeout
			if (error.message === "Call timeout") {
				circuit.metrics.timeouts++;
			}
		}

		const duration = Date.now() - startTime;

		// Update metrics
		circuit.metrics.totalCalls++;
		circuit.metrics.totalResponseTimeMs += duration;
		circuit.metrics.avgResponseTimeMs = circuit.metrics.totalResponseTimeMs / circuit.metrics.totalCalls;

		if (success) {
			this.handleSuccess(circuit, duration);
		} else {
			this.handleFailure(circuit, error!, duration);
		}

		// Decrease half-open counter
		if (circuit.state === "half_open" || (circuit.state === "closed" && !success)) {
			circuit.halfOpenCallsInProgress = Math.max(0, circuit.halfOpenCallsInProgress - 1);
		}

		// Try fallback on failure
		if (!success) {
			const activeFallback = fallbackFn ?? circuit.config.fallbackFn;
			if (activeFallback) {
				try {
					const fallbackResult = await activeFallback(error!, []);
					circuit.metrics.fallbackExecutions++;
					this.persistMetrics(circuit);
					this.recordEvent(circuit, "fallback_executed", { error: error!.message });

					return {
						success: true,
						result: fallbackResult as T,
						error,
						duration,
						wasRejected: false,
						usedFallback: true,
						circuitState: circuit.state,
					};
				} catch (_fallbackError) {
					// Fallback also failed
				}
			}
		}

		return {
			success,
			result,
			error,
			duration,
			wasRejected: false,
			usedFallback: false,
			circuitState: circuit.state,
		};
	}

	private handleSuccess(circuit: Circuit, duration: number): void {
		const now = new Date();
		circuit.lastSuccessAt = now;
		circuit.successCount++;
		circuit.metrics.successfulCalls++;

		// Add to sliding window
		this.addToSlidingWindow(circuit, {
			timestamp: Date.now(),
			success: true,
			duration,
		});

		// State transition logic
		if (circuit.state === "half_open") {
			if (circuit.successCount >= circuit.config.successThreshold) {
				this.transitionState(circuit, "closed");
			}
		} else if (circuit.state === "closed") {
			// Reset failure count on success
			circuit.failureCount = 0;
		}

		this.persistState(circuit);
		this.persistMetrics(circuit);
		this.recordEvent(circuit, "call_success", { duration });
	}

	private handleFailure(circuit: Circuit, error: Error, duration: number): void {
		const now = new Date();
		circuit.lastFailureAt = now;
		circuit.metrics.failedCalls++;

		// Classify the error
		const classification = this.classifyError(circuit, error);
		const shouldTrip = this.shouldTripOnError(circuit, error, classification);

		// Add to sliding window
		this.addToSlidingWindow(circuit, {
			timestamp: Date.now(),
			success: false,
			duration,
			errorType: error.name,
			classification,
		});

		if (!shouldTrip) {
			// Error doesn't count toward tripping
			this.persistState(circuit);
			this.persistMetrics(circuit);
			this.recordEvent(circuit, "call_failure", {
				error: error.message,
				duration,
				classification,
				tripped: false,
			});
			return;
		}

		circuit.failureCount++;
		circuit.successCount = 0;

		// State transition logic
		if (circuit.state === "half_open") {
			// Any failure in half-open trips the circuit
			this.transitionState(circuit, "open");
		} else if (circuit.state === "closed") {
			// Check if we should trip
			if (this.shouldTrip(circuit)) {
				this.transitionState(circuit, "open");
			}
		}

		this.persistState(circuit);
		this.persistMetrics(circuit);
		this.recordEvent(circuit, "call_failure", {
			error: error.message,
			duration,
			classification,
			tripped: circuit.state === "open",
		});
	}

	private addToSlidingWindow(circuit: Circuit, entry: SlidingWindowEntry): void {
		circuit.slidingWindow.push(entry);

		// Trim window based on type
		if (circuit.config.slidingWindowType === "count") {
			while (circuit.slidingWindow.length > circuit.config.slidingWindowSize) {
				circuit.slidingWindow.shift();
			}
		} else if (circuit.config.slidingWindowType === "time") {
			const cutoff = Date.now() - (circuit.config.slidingWindowTimeMs ?? 60000);
			circuit.slidingWindow = circuit.slidingWindow.filter((e) => e.timestamp >= cutoff);
		}
	}

	private classifyError(circuit: Circuit, error: Error): ErrorClassification {
		const classifiers = circuit.config.errorClassifiers ?? this.globalErrorClassifiers;
		const errorString = `${error.name}: ${error.message}`;

		for (const classifier of classifiers) {
			// Check pattern match
			if (classifier.pattern?.test(errorString)) {
				return classifier.classification;
			}

			// Check error type match
			if (classifier.errorTypes?.includes(error.name)) {
				return classifier.classification;
			}
		}

		return "unknown";
	}

	private shouldTripOnError(circuit: Circuit, error: Error, classification: ErrorClassification): boolean {
		// If only tripping on transient errors
		if (circuit.config.tripOnlyOnTransient) {
			return classification === "transient" || classification === "timeout";
		}

		// Check classifiers for shouldTrip flag
		const classifiers = circuit.config.errorClassifiers ?? this.globalErrorClassifiers;
		const errorString = `${error.name}: ${error.message}`;

		for (const classifier of classifiers) {
			if (classifier.pattern?.test(errorString)) {
				return classifier.shouldTrip;
			}
			if (classifier.errorTypes?.includes(error.name)) {
				return classifier.shouldTrip;
			}
		}

		// Default: trip on all errors
		return true;
	}

	private shouldTrip(circuit: Circuit): boolean {
		// Check absolute failure threshold
		if (circuit.failureCount >= circuit.config.failureThreshold) {
			return true;
		}

		// Check failure rate threshold if configured
		if (circuit.config.failureRateThreshold !== undefined) {
			const windowSize = circuit.slidingWindow.length;
			if (windowSize > 0) {
				const failures = circuit.slidingWindow.filter((e) => !e.success).length;
				const failureRate = (failures / windowSize) * 100;
				if (failureRate >= circuit.config.failureRateThreshold) {
					return true;
				}
			}
		}

		return false;
	}

	private transitionState(circuit: Circuit, newState: CircuitState): void {
		const previousState = circuit.state;
		const now = new Date();

		// Track duration in previous state
		const durationInPreviousState = now.getTime() - circuit.lastStateChangeAt.getTime();
		if (previousState === "open") {
			circuit.metrics.openDurationTotalMs += durationInPreviousState;
		} else if (previousState === "half_open") {
			circuit.metrics.halfOpenDurationTotalMs += durationInPreviousState;
		}

		circuit.state = newState;
		circuit.lastStateChangeAt = now;
		circuit.metrics.stateChanges++;

		// Reset counters on state change
		if (newState === "closed") {
			circuit.failureCount = 0;
			circuit.successCount = 0;
			circuit.isHealthy = true;
		} else if (newState === "open") {
			circuit.openedAt = now;
			circuit.successCount = 0;
			circuit.isHealthy = false;
			this.scheduleResetTimeout(circuit);
		} else if (newState === "half_open") {
			circuit.successCount = 0;
			circuit.halfOpenCallsInProgress = 0;
		}

		this.persistState(circuit);
		this.persistMetrics(circuit);
		this.recordEvent(circuit, "state_change", { previousState, newState });

		this.emit("circuit:state_change", {
			circuitId: circuit.id,
			circuitName: circuit.config.name,
			previousState,
			newState,
			timestamp: now,
		});
	}

	private scheduleResetTimeout(circuit: Circuit): void {
		// Clear existing timeout
		const existingTimeout = this.resetTimeouts.get(circuit.id);
		if (existingTimeout) {
			clearTimeout(existingTimeout);
		}

		const timeout = setTimeout(() => {
			if (circuit.state === "open") {
				this.transitionState(circuit, "half_open");
			}
			this.resetTimeouts.delete(circuit.id);
		}, circuit.config.resetTimeoutMs);

		this.resetTimeouts.set(circuit.id, timeout);
	}

	// ============================================================================
	// Manual Override
	// ============================================================================

	forceOpen(circuitId: string, reason?: string): boolean {
		const circuit = this.circuits.get(circuitId);
		if (!circuit) return false;

		const previousState = circuit.state;
		this.transitionState(circuit, "open");

		this.recordEvent(circuit, "manual_override", {
			action: "force_open",
			previousState,
			reason,
		});

		this.emit("circuit:manual_override", {
			circuitId,
			action: "force_open",
			reason,
		});

		return true;
	}

	forceClose(circuitId: string, reason?: string): boolean {
		const circuit = this.circuits.get(circuitId);
		if (!circuit) return false;

		const previousState = circuit.state;

		// Clear reset timeout if open
		const timeout = this.resetTimeouts.get(circuitId);
		if (timeout) {
			clearTimeout(timeout);
			this.resetTimeouts.delete(circuitId);
		}

		this.transitionState(circuit, "closed");
		circuit.slidingWindow = []; // Reset sliding window

		this.recordEvent(circuit, "manual_override", {
			action: "force_close",
			previousState,
			reason,
		});

		this.emit("circuit:manual_override", {
			circuitId,
			action: "force_close",
			reason,
		});

		return true;
	}

	forceHalfOpen(circuitId: string, reason?: string): boolean {
		const circuit = this.circuits.get(circuitId);
		if (!circuit) return false;

		const previousState = circuit.state;

		// Clear reset timeout if open
		const timeout = this.resetTimeouts.get(circuitId);
		if (timeout) {
			clearTimeout(timeout);
			this.resetTimeouts.delete(circuitId);
		}

		this.transitionState(circuit, "half_open");

		this.recordEvent(circuit, "manual_override", {
			action: "force_half_open",
			previousState,
			reason,
		});

		this.emit("circuit:manual_override", {
			circuitId,
			action: "force_half_open",
			reason,
		});

		return true;
	}

	resetCircuit(circuitId: string): boolean {
		const circuit = this.circuits.get(circuitId);
		if (!circuit) return false;

		// Clear reset timeout
		const timeout = this.resetTimeouts.get(circuitId);
		if (timeout) {
			clearTimeout(timeout);
			this.resetTimeouts.delete(circuitId);
		}

		// Reset all state
		circuit.state = "closed";
		circuit.failureCount = 0;
		circuit.successCount = 0;
		circuit.halfOpenCallsInProgress = 0;
		circuit.lastStateChangeAt = new Date();
		circuit.slidingWindow = [];
		circuit.isHealthy = true;

		// Reset metrics
		circuit.metrics = {
			...this.createDefaultMetrics(),
			lastResetAt: new Date(),
		};

		this.persistState(circuit);
		this.persistMetrics(circuit);

		this.emit("circuit:reset", { circuitId });
		return true;
	}

	enableCircuit(circuitId: string): boolean {
		const circuit = this.circuits.get(circuitId);
		if (!circuit) return false;

		circuit.config.enabled = true;

		if (this.config.enablePersistence) {
			this.db.prepare("UPDATE circuit_configs SET enabled = 1 WHERE id = ?").run(circuitId);
		}

		this.emit("circuit:enabled", { circuitId });
		return true;
	}

	disableCircuit(circuitId: string): boolean {
		const circuit = this.circuits.get(circuitId);
		if (!circuit) return false;

		circuit.config.enabled = false;

		if (this.config.enablePersistence) {
			this.db.prepare("UPDATE circuit_configs SET enabled = 0 WHERE id = ?").run(circuitId);
		}

		this.emit("circuit:disabled", { circuitId });
		return true;
	}

	// ============================================================================
	// Health Probes
	// ============================================================================

	private startHealthProbe(circuit: Circuit): void {
		if (!circuit.config.enableHealthProbes || !circuit.config.healthProbeFn) {
			return;
		}

		const probe: CircuitHealthProbe = {
			circuitId: circuit.id,
			consecutiveSuccesses: 0,
			consecutiveFailures: 0,
		};

		const intervalMs = circuit.config.healthProbeIntervalMs ?? 30000;
		probe.intervalHandle = setInterval(async () => {
			await this.executeHealthProbe(circuit, probe);
		}, intervalMs);

		this.healthProbes.set(circuit.id, probe);
	}

	private stopHealthProbe(circuitId: string): void {
		const probe = this.healthProbes.get(circuitId);
		if (probe?.intervalHandle) {
			clearInterval(probe.intervalHandle);
		}
		this.healthProbes.delete(circuitId);
	}

	private async executeHealthProbe(circuit: Circuit, probe: CircuitHealthProbe): Promise<void> {
		if (!circuit.config.healthProbeFn) return;

		probe.lastProbeAt = new Date();

		try {
			const healthy = await circuit.config.healthProbeFn();
			probe.lastProbeSuccess = healthy;

			if (healthy) {
				probe.consecutiveSuccesses++;
				probe.consecutiveFailures = 0;

				// If circuit is open and probe succeeds, consider transitioning
				if (circuit.state === "open" && probe.consecutiveSuccesses >= circuit.config.successThreshold) {
					this.transitionState(circuit, "half_open");
				}
			} else {
				probe.consecutiveFailures++;
				probe.consecutiveSuccesses = 0;
			}

			circuit.isHealthy = healthy;
			circuit.lastHealthCheckAt = probe.lastProbeAt;
			this.persistState(circuit);

			this.recordEvent(circuit, "probe_executed", {
				success: healthy,
				consecutiveSuccesses: probe.consecutiveSuccesses,
				consecutiveFailures: probe.consecutiveFailures,
			});
		} catch (error) {
			probe.lastProbeSuccess = false;
			probe.consecutiveFailures++;
			probe.consecutiveSuccesses = 0;
			circuit.isHealthy = false;
			circuit.lastHealthCheckAt = probe.lastProbeAt;
			this.persistState(circuit);

			this.recordEvent(circuit, "probe_executed", {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				consecutiveFailures: probe.consecutiveFailures,
			});
		}

		this.emit("circuit:probe_executed", {
			circuitId: circuit.id,
			success: probe.lastProbeSuccess,
			timestamp: probe.lastProbeAt,
		});
	}

	async runHealthProbe(circuitId: string): Promise<boolean | null> {
		const circuit = this.circuits.get(circuitId);
		if (!circuit || !circuit.config.healthProbeFn) {
			return null;
		}

		const probe = this.healthProbes.get(circuitId) ?? {
			circuitId,
			consecutiveSuccesses: 0,
			consecutiveFailures: 0,
		};

		await this.executeHealthProbe(circuit, probe);
		return probe.lastProbeSuccess ?? null;
	}

	// ============================================================================
	// Persistence
	// ============================================================================

	private persistState(circuit: Circuit): void {
		if (!this.config.enablePersistence) return;

		const stmt = this.db.prepare(`
      UPDATE circuit_states
      SET state = ?, failure_count = ?, success_count = ?,
          last_failure_at = ?, last_success_at = ?, last_state_change_at = ?,
          opened_at = ?, is_healthy = ?, last_health_check_at = ?
      WHERE circuit_id = ?
    `);

		stmt.run(
			circuit.state,
			circuit.failureCount,
			circuit.successCount,
			circuit.lastFailureAt?.toISOString() ?? null,
			circuit.lastSuccessAt?.toISOString() ?? null,
			circuit.lastStateChangeAt.toISOString(),
			circuit.openedAt?.toISOString() ?? null,
			circuit.isHealthy ? 1 : 0,
			circuit.lastHealthCheckAt?.toISOString() ?? null,
			circuit.id,
		);
	}

	private persistMetrics(circuit: Circuit): void {
		if (!this.config.enablePersistence) return;

		const stmt = this.db.prepare(`
      UPDATE circuit_metrics
      SET total_calls = ?, successful_calls = ?, failed_calls = ?,
          fallback_executions = ?, rejected_calls = ?, timeouts = ?,
          avg_response_time_ms = ?, total_response_time_ms = ?,
          state_changes = ?, last_reset_at = ?,
          open_duration_total_ms = ?, half_open_duration_total_ms = ?
      WHERE circuit_id = ?
    `);

		stmt.run(
			circuit.metrics.totalCalls,
			circuit.metrics.successfulCalls,
			circuit.metrics.failedCalls,
			circuit.metrics.fallbackExecutions,
			circuit.metrics.rejectedCalls,
			circuit.metrics.timeouts,
			circuit.metrics.avgResponseTimeMs,
			circuit.metrics.totalResponseTimeMs,
			circuit.metrics.stateChanges,
			circuit.metrics.lastResetAt?.toISOString() ?? null,
			circuit.metrics.openDurationTotalMs,
			circuit.metrics.halfOpenDurationTotalMs,
			circuit.id,
		);
	}

	private recordEvent(circuit: Circuit, eventType: CircuitEventType, metadata?: Record<string, unknown>): void {
		if (!this.config.enablePersistence) return;

		const id = `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const now = new Date();

		const stmt = this.db.prepare(`
      INSERT INTO circuit_events
      (id, circuit_id, circuit_name, event_type, previous_state, new_state,
       error, duration, timestamp, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			id,
			circuit.id,
			circuit.config.name,
			eventType,
			(metadata?.previousState as string) ?? null,
			(metadata?.newState as string) ?? null,
			(metadata?.error as string) ?? null,
			(metadata?.duration as number) ?? null,
			now.toISOString(),
			metadata ? JSON.stringify(metadata) : null,
		);

		this.emit("circuit:event", {
			id,
			circuitId: circuit.id,
			circuitName: circuit.config.name,
			eventType,
			timestamp: now,
			metadata,
		});
	}

	// ============================================================================
	// Groups and Namespaces
	// ============================================================================

	getCircuitGroups(): CircuitGroup[] {
		const groups: Map<string, CircuitGroup> = new Map();

		for (const circuit of this.circuits.values()) {
			const namespace = circuit.config.namespace ?? "default";

			let group = groups.get(namespace);
			if (!group) {
				group = {
					namespace,
					circuits: [],
					aggregateState: "closed",
					healthyCount: 0,
					unhealthyCount: 0,
					openCount: 0,
				};
				groups.set(namespace, group);
			}

			group.circuits.push(circuit.id);

			if (circuit.isHealthy) {
				group.healthyCount++;
			} else {
				group.unhealthyCount++;
			}

			if (circuit.state === "open") {
				group.openCount++;
			}
		}

		// Calculate aggregate state for each group
		for (const group of groups.values()) {
			if (group.openCount === group.circuits.length) {
				group.aggregateState = "open";
			} else if (group.openCount > 0) {
				group.aggregateState = "half_open"; // Some circuits open
			} else {
				group.aggregateState = "closed";
			}
		}

		return Array.from(groups.values());
	}

	forceOpenNamespace(namespace: string, reason?: string): number {
		let count = 0;
		for (const circuit of this.circuits.values()) {
			if (circuit.config.namespace === namespace) {
				if (this.forceOpen(circuit.id, reason)) {
					count++;
				}
			}
		}
		return count;
	}

	forceCloseNamespace(namespace: string, reason?: string): number {
		let count = 0;
		for (const circuit of this.circuits.values()) {
			if (circuit.config.namespace === namespace) {
				if (this.forceClose(circuit.id, reason)) {
					count++;
				}
			}
		}
		return count;
	}

	// ============================================================================
	// Error Classifiers
	// ============================================================================

	addGlobalErrorClassifier(classifier: ErrorClassifier): void {
		this.globalErrorClassifiers.push(classifier);
	}

	removeGlobalErrorClassifier(name: string): boolean {
		const index = this.globalErrorClassifiers.findIndex((c) => c.name === name);
		if (index !== -1) {
			this.globalErrorClassifiers.splice(index, 1);
			return true;
		}
		return false;
	}

	getGlobalErrorClassifiers(): ErrorClassifier[] {
		return [...this.globalErrorClassifiers];
	}

	addCircuitErrorClassifier(circuitId: string, classifier: ErrorClassifier): boolean {
		const circuit = this.circuits.get(circuitId);
		if (!circuit) return false;

		if (!circuit.config.errorClassifiers) {
			circuit.config.errorClassifiers = [];
		}
		circuit.config.errorClassifiers.push(classifier);

		if (this.config.enablePersistence) {
			const stmt = this.db.prepare(`
        INSERT INTO error_classifiers
        (id, circuit_id, name, pattern, error_types, classification, should_trip)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

			stmt.run(
				`classifier_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				circuitId,
				classifier.name,
				classifier.pattern?.source ?? null,
				classifier.errorTypes ? JSON.stringify(classifier.errorTypes) : null,
				classifier.classification,
				classifier.shouldTrip ? 1 : 0,
			);
		}

		return true;
	}

	// ============================================================================
	// Statistics and Events
	// ============================================================================

	getStats(): CircuitStats {
		const circuits = Array.from(this.circuits.values());
		const enabledCircuits = circuits.filter((c) => c.config.enabled);

		let closedCount = 0;
		let openCount = 0;
		let halfOpenCount = 0;
		let totalCalls = 0;
		let successfulCalls = 0;
		let totalResponseTime = 0;
		let responseTimeCount = 0;

		const byNamespace: Record<
			string,
			{
				total: number;
				closed: number;
				open: number;
				halfOpen: number;
			}
		> = {};

		for (const circuit of circuits) {
			// State counts
			switch (circuit.state) {
				case "closed":
					closedCount++;
					break;
				case "open":
					openCount++;
					break;
				case "half_open":
					halfOpenCount++;
					break;
			}

			// Metrics aggregation
			totalCalls += circuit.metrics.totalCalls;
			successfulCalls += circuit.metrics.successfulCalls;
			if (circuit.metrics.totalCalls > 0) {
				totalResponseTime += circuit.metrics.totalResponseTimeMs;
				responseTimeCount += circuit.metrics.totalCalls;
			}

			// By namespace
			const namespace = circuit.config.namespace ?? "default";
			if (!byNamespace[namespace]) {
				byNamespace[namespace] = { total: 0, closed: 0, open: 0, halfOpen: 0 };
			}
			byNamespace[namespace].total++;
			switch (circuit.state) {
				case "closed":
					byNamespace[namespace].closed++;
					break;
				case "open":
					byNamespace[namespace].open++;
					break;
				case "half_open":
					byNamespace[namespace].halfOpen++;
					break;
			}
		}

		return {
			totalCircuits: circuits.length,
			enabledCircuits: enabledCircuits.length,
			closedCount,
			openCount,
			halfOpenCount,
			totalCalls,
			successRate: totalCalls > 0 ? (successfulCalls / totalCalls) * 100 : 100,
			avgResponseTimeMs: responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0,
			byNamespace,
		};
	}

	getCircuitMetrics(circuitId: string): CircuitMetrics | null {
		const circuit = this.circuits.get(circuitId);
		return circuit?.metrics ?? null;
	}

	getEvents(
		params: {
			circuitId?: string;
			eventType?: CircuitEventType;
			startDate?: Date;
			endDate?: Date;
			limit?: number;
		} = {},
	): CircuitEvent[] {
		let query = "SELECT * FROM circuit_events WHERE 1=1";
		const queryParams: unknown[] = [];

		if (params.circuitId) {
			query += " AND circuit_id = ?";
			queryParams.push(params.circuitId);
		}
		if (params.eventType) {
			query += " AND event_type = ?";
			queryParams.push(params.eventType);
		}
		if (params.startDate) {
			query += " AND timestamp >= ?";
			queryParams.push(params.startDate.toISOString());
		}
		if (params.endDate) {
			query += " AND timestamp <= ?";
			queryParams.push(params.endDate.toISOString());
		}

		query += " ORDER BY timestamp DESC";

		if (params.limit) {
			query += " LIMIT ?";
			queryParams.push(params.limit);
		}

		const stmt = this.db.prepare(query);
		const rows = stmt.all(...queryParams) as Record<string, unknown>[];

		return rows.map((row) => ({
			id: row.id as string,
			circuitId: row.circuit_id as string,
			circuitName: row.circuit_name as string,
			eventType: row.event_type as CircuitEventType,
			previousState: row.previous_state as CircuitState | undefined,
			newState: row.new_state as CircuitState | undefined,
			error: row.error as string | undefined,
			duration: row.duration as number | undefined,
			timestamp: new Date(row.timestamp as string),
			metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
		}));
	}

	getSlidingWindow(circuitId: string): SlidingWindowEntry[] {
		const circuit = this.circuits.get(circuitId);
		return circuit?.slidingWindow ?? [];
	}

	getFailureRate(circuitId: string): number {
		const circuit = this.circuits.get(circuitId);
		if (!circuit || circuit.slidingWindow.length === 0) {
			return 0;
		}

		const failures = circuit.slidingWindow.filter((e) => !e.success).length;
		return (failures / circuit.slidingWindow.length) * 100;
	}

	// ============================================================================
	// Utility Methods
	// ============================================================================

	isOpen(circuitId: string): boolean {
		const circuit = this.circuits.get(circuitId);
		return circuit?.state === "open";
	}

	isClosed(circuitId: string): boolean {
		const circuit = this.circuits.get(circuitId);
		return circuit?.state === "closed";
	}

	isHalfOpen(circuitId: string): boolean {
		const circuit = this.circuits.get(circuitId);
		return circuit?.state === "half_open";
	}

	getState(circuitId: string): CircuitState | null {
		const circuit = this.circuits.get(circuitId);
		return circuit?.state ?? null;
	}

	canExecute(circuitId: string): boolean {
		const circuit = this.circuits.get(circuitId);
		if (!circuit) return false;
		if (!circuit.config.enabled) return true;

		if (circuit.state === "open") return false;
		if (circuit.state === "half_open") {
			return circuit.halfOpenCallsInProgress < circuit.config.halfOpenMaxCalls;
		}
		return true;
	}

	getTimeUntilReset(circuitId: string): number | null {
		const circuit = this.circuits.get(circuitId);
		if (!circuit || circuit.state !== "open" || !circuit.openedAt) {
			return null;
		}

		const elapsed = Date.now() - circuit.openedAt.getTime();
		const remaining = circuit.config.resetTimeoutMs - elapsed;
		return Math.max(0, remaining);
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	shutdown(): void {
		// Clear cleanup interval
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		// Stop all health probes
		for (const circuitId of this.healthProbes.keys()) {
			this.stopHealthProbe(circuitId);
		}

		// Clear all reset timeouts
		for (const timeout of this.resetTimeouts.values()) {
			clearTimeout(timeout);
		}
		this.resetTimeouts.clear();

		// Close database
		this.db.close();

		this.emit("shutdown");
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

let circuitBreakerInstance: CircuitBreakerSystem | null = null;

export function getCircuitBreaker(config?: Partial<CircuitBreakerConfig>): CircuitBreakerSystem {
	if (!circuitBreakerInstance) {
		circuitBreakerInstance = new CircuitBreakerSystem(config);
	}
	return circuitBreakerInstance;
}

export function resetCircuitBreaker(): void {
	if (circuitBreakerInstance) {
		circuitBreakerInstance.shutdown();
		circuitBreakerInstance = null;
	}
}

// ============================================================================
// Decorator Helper
// ============================================================================

/**
 * Creates a wrapped function that executes through a circuit breaker.
 * Useful for wrapping service calls with circuit breaker protection.
 */
export function withCircuitBreaker<T extends (...args: unknown[]) => Promise<unknown>>(
	circuitId: string,
	fn: T,
	fallbackFn?: (error: Error) => ReturnType<T>,
): T {
	const breaker = getCircuitBreaker();

	return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
		const result = await breaker.execute(
			circuitId,
			() => fn(...args) as Promise<unknown>,
			fallbackFn as ((error: Error) => unknown) | undefined,
		);

		if (result.success) {
			return result.result as ReturnType<T>;
		}

		throw result.error;
	}) as T;
}
