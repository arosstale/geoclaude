/**
 * Class 3.55: Load Balancer System
 * TAC Pattern: Intelligent request distribution across backend endpoints
 *
 * Features:
 * - Multiple balancing strategies: round-robin, weighted, least-connections, random, consistent-hash
 * - Backend/endpoint registration with health status
 * - Weight-based distribution
 * - Sticky sessions support
 * - Health check integration
 * - Automatic failover on unhealthy backends
 * - Connection tracking per backend
 * - Request queuing when all backends busy
 * - Warm-up period for new backends
 * - Drain mode for graceful removal
 * - Metrics per backend (latency, success rate, active connections)
 * - Backend groups/pools
 * - Priority-based routing
 * - SQLite persistence for backend state
 */

import Database from "better-sqlite3";
import { createHash } from "crypto";
import { EventEmitter } from "events";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export type BalancingStrategy =
	| "round-robin"
	| "weighted"
	| "least-connections"
	| "random"
	| "consistent-hash"
	| "priority";

export type BackendStatus = "healthy" | "degraded" | "unhealthy" | "draining" | "warming" | "offline";

export interface Backend {
	id: string;
	name: string;
	address: string;
	port: number;
	weight: number;
	priority: number;
	status: BackendStatus;
	poolId?: string;
	maxConnections: number;
	activeConnections: number;
	warmupEndTime?: number;
	drainStartTime?: number;
	metadata?: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface BackendMetrics {
	backendId: string;
	totalRequests: number;
	successfulRequests: number;
	failedRequests: number;
	activeConnections: number;
	avgLatencyMs: number;
	p95LatencyMs: number;
	p99LatencyMs: number;
	successRate: number;
	lastRequestAt?: Date;
	lastHealthCheckAt?: Date;
	consecutiveFailures: number;
	consecutiveSuccesses: number;
}

export interface BackendPool {
	id: string;
	name: string;
	strategy: BalancingStrategy;
	healthCheckIntervalMs: number;
	healthCheckTimeoutMs: number;
	healthCheckPath?: string;
	failoverThreshold: number;
	warmupDurationMs: number;
	drainTimeoutMs: number;
	stickySessionsEnabled: boolean;
	stickySessionTtlMs: number;
	maxQueueSize: number;
	queueTimeoutMs: number;
	enabled: boolean;
	createdAt: Date;
	metadata?: Record<string, unknown>;
}

export interface StickySession {
	sessionId: string;
	poolId: string;
	backendId: string;
	createdAt: Date;
	expiresAt: Date;
	requestCount: number;
}

export interface QueuedRequest {
	id: string;
	poolId: string;
	sessionKey?: string;
	hashKey?: string;
	priority: number;
	queuedAt: Date;
	timeoutAt: Date;
	callback: () => Promise<unknown>;
	resolve: (result: RouteResult) => void;
	reject: (error: Error) => void;
}

export interface RouteResult {
	backend: Backend;
	connectionId: string;
	queueWaitMs?: number;
	warmupPenalty?: boolean;
}

export interface HealthCheckResult {
	backendId: string;
	healthy: boolean;
	latencyMs: number;
	statusCode?: number;
	message?: string;
	checkedAt: Date;
}

export interface LoadBalancerStats {
	totalPools: number;
	totalBackends: number;
	healthyBackends: number;
	unhealthyBackends: number;
	drainingBackends: number;
	warmingBackends: number;
	totalActiveConnections: number;
	totalQueuedRequests: number;
	totalSessions: number;
	requestsPerSecond: number;
	avgLatencyMs: number;
}

export interface LoadBalancerConfig {
	dataDir: string;
	defaultStrategy: BalancingStrategy;
	defaultHealthCheckIntervalMs: number;
	defaultHealthCheckTimeoutMs: number;
	defaultFailoverThreshold: number;
	defaultWarmupDurationMs: number;
	defaultDrainTimeoutMs: number;
	defaultMaxConnections: number;
	metricsRetentionDays: number;
	cleanupIntervalMs: number;
}

// ============================================================================
// Load Balancer System
// ============================================================================

export class LoadBalancerSystem extends EventEmitter {
	private db: Database.Database;
	private config: LoadBalancerConfig;
	private pools: Map<string, BackendPool> = new Map();
	private backends: Map<string, Backend> = new Map();
	private metrics: Map<string, BackendMetrics> = new Map();
	private sessions: Map<string, StickySession> = new Map();
	private queues: Map<string, QueuedRequest[]> = new Map();
	private roundRobinIndex: Map<string, number> = new Map();
	private healthCheckTimers: Map<string, NodeJS.Timeout> = new Map();
	private cleanupInterval: NodeJS.Timeout | null = null;
	private queueProcessorInterval: NodeJS.Timeout | null = null;
	private latencyHistory: Map<string, number[]> = new Map();
	private requestCounter = 0;
	private lastRequestCounterReset = Date.now();

	constructor(config: LoadBalancerConfig) {
		super();
		this.config = config;
		this.db = new Database(join(config.dataDir, "load_balancer.db"));
		this.initializeDatabase();
		this.loadState();
		this.startCleanupScheduler();
		this.startQueueProcessor();
	}

	private initializeDatabase(): void {
		this.db.pragma("journal_mode = WAL");

		// Backend pools table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS backend_pools (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        strategy TEXT NOT NULL,
        health_check_interval_ms INTEGER NOT NULL,
        health_check_timeout_ms INTEGER NOT NULL,
        health_check_path TEXT,
        failover_threshold INTEGER NOT NULL,
        warmup_duration_ms INTEGER NOT NULL,
        drain_timeout_ms INTEGER NOT NULL,
        sticky_sessions_enabled INTEGER NOT NULL DEFAULT 0,
        sticky_session_ttl_ms INTEGER NOT NULL DEFAULT 3600000,
        max_queue_size INTEGER NOT NULL DEFAULT 100,
        queue_timeout_ms INTEGER NOT NULL DEFAULT 30000,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        metadata TEXT
      )
    `);

		// Backends table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS backends (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        port INTEGER NOT NULL,
        weight INTEGER NOT NULL DEFAULT 100,
        priority INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'healthy',
        pool_id TEXT,
        max_connections INTEGER NOT NULL DEFAULT 100,
        active_connections INTEGER NOT NULL DEFAULT 0,
        warmup_end_time INTEGER,
        drain_start_time INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT,
        FOREIGN KEY (pool_id) REFERENCES backend_pools(id)
      )
    `);

		// Backend metrics table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS backend_metrics (
        backend_id TEXT PRIMARY KEY,
        total_requests INTEGER NOT NULL DEFAULT 0,
        successful_requests INTEGER NOT NULL DEFAULT 0,
        failed_requests INTEGER NOT NULL DEFAULT 0,
        active_connections INTEGER NOT NULL DEFAULT 0,
        avg_latency_ms REAL NOT NULL DEFAULT 0,
        p95_latency_ms REAL NOT NULL DEFAULT 0,
        p99_latency_ms REAL NOT NULL DEFAULT 0,
        success_rate REAL NOT NULL DEFAULT 1.0,
        last_request_at TEXT,
        last_health_check_at TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        consecutive_successes INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (backend_id) REFERENCES backends(id)
      )
    `);

		// Sticky sessions table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS sticky_sessions (
        session_id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        backend_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (pool_id) REFERENCES backend_pools(id),
        FOREIGN KEY (backend_id) REFERENCES backends(id)
      )
    `);

		// Health check history table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS health_check_history (
        id TEXT PRIMARY KEY,
        backend_id TEXT NOT NULL,
        healthy INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        status_code INTEGER,
        message TEXT,
        checked_at TEXT NOT NULL,
        FOREIGN KEY (backend_id) REFERENCES backends(id)
      )
    `);

		// Request history table (for analytics)
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS request_history (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        backend_id TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        success INTEGER NOT NULL,
        queue_wait_ms INTEGER,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (pool_id) REFERENCES backend_pools(id),
        FOREIGN KEY (backend_id) REFERENCES backends(id)
      )
    `);

		// Indexes
		this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_backends_pool ON backends(pool_id);
      CREATE INDEX IF NOT EXISTS idx_backends_status ON backends(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_pool ON sticky_sessions(pool_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sticky_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_health_backend ON health_check_history(backend_id);
      CREATE INDEX IF NOT EXISTS idx_health_time ON health_check_history(checked_at);
      CREATE INDEX IF NOT EXISTS idx_requests_time ON request_history(timestamp);
    `);
	}

	private loadState(): void {
		// Load pools
		const poolRows = this.db.prepare("SELECT * FROM backend_pools").all() as DbPoolRow[];
		for (const row of poolRows) {
			const pool = this.rowToPool(row);
			this.pools.set(pool.id, pool);
			this.queues.set(pool.id, []);
			this.roundRobinIndex.set(pool.id, 0);
		}

		// Load backends
		const backendRows = this.db.prepare("SELECT * FROM backends").all() as DbBackendRow[];
		for (const row of backendRows) {
			const backend = this.rowToBackend(row);
			this.backends.set(backend.id, backend);
			this.latencyHistory.set(backend.id, []);
		}

		// Load metrics
		const metricRows = this.db.prepare("SELECT * FROM backend_metrics").all() as DbMetricsRow[];
		for (const row of metricRows) {
			this.metrics.set(row.backend_id, this.rowToMetrics(row));
		}

		// Load sessions
		const sessionRows = this.db
			.prepare("SELECT * FROM sticky_sessions WHERE expires_at > ?")
			.all(new Date().toISOString()) as DbSessionRow[];
		for (const row of sessionRows) {
			this.sessions.set(row.session_id, this.rowToSession(row));
		}

		// Start health checks for enabled pools
		for (const pool of this.pools.values()) {
			if (pool.enabled) {
				this.startHealthChecks(pool.id);
			}
		}
	}

	private startCleanupScheduler(): void {
		this.cleanupInterval = setInterval(() => {
			this.cleanupExpiredData();
		}, this.config.cleanupIntervalMs);
	}

	private startQueueProcessor(): void {
		this.queueProcessorInterval = setInterval(() => {
			this.processQueues();
		}, 100);
	}

	private cleanupExpiredData(): void {
		const now = new Date();

		// Clean up expired sessions
		const expiredSessions = Array.from(this.sessions.entries())
			.filter(([, session]) => session.expiresAt < now)
			.map(([id]) => id);

		for (const sessionId of expiredSessions) {
			this.sessions.delete(sessionId);
		}

		this.db.prepare("DELETE FROM sticky_sessions WHERE expires_at < ?").run(now.toISOString());

		// Clean up old health check history
		const healthCutoff = new Date(now.getTime() - this.config.metricsRetentionDays * 24 * 60 * 60 * 1000);
		this.db.prepare("DELETE FROM health_check_history WHERE checked_at < ?").run(healthCutoff.toISOString());

		// Clean up old request history
		this.db.prepare("DELETE FROM request_history WHERE timestamp < ?").run(healthCutoff.toISOString());

		// Check and complete draining backends
		for (const backend of this.backends.values()) {
			if (backend.status === "draining" && backend.drainStartTime) {
				const pool = this.pools.get(backend.poolId ?? "");
				const drainTimeout = pool?.drainTimeoutMs ?? this.config.defaultDrainTimeoutMs;
				if (Date.now() - backend.drainStartTime > drainTimeout) {
					this.updateBackendStatus(backend.id, "offline");
				}
			}
		}

		// Complete warmup for warming backends
		for (const backend of this.backends.values()) {
			if (backend.status === "warming" && backend.warmupEndTime) {
				if (Date.now() >= backend.warmupEndTime) {
					this.updateBackendStatus(backend.id, "healthy");
				}
			}
		}

		this.emit("cleanup:completed");
	}

	private processQueues(): void {
		for (const [poolId, queue] of this.queues) {
			if (queue.length === 0) continue;

			const now = Date.now();
			const pool = this.pools.get(poolId);
			if (!pool) continue;

			// Process timed out requests
			const timedOut = queue.filter((req) => req.timeoutAt.getTime() < now);
			for (const req of timedOut) {
				req.reject(new Error("Queue timeout exceeded"));
				this.emit("request:timeout", { requestId: req.id, poolId });
			}

			// Remove timed out requests
			this.queues.set(
				poolId,
				queue.filter((req) => req.timeoutAt.getTime() >= now),
			);

			// Try to process remaining requests
			const remaining = this.queues.get(poolId)!;
			const toProcess: QueuedRequest[] = [];

			for (const req of remaining) {
				const backend = this.selectBackend(poolId, req.sessionKey, req.hashKey);
				if (backend) {
					toProcess.push(req);
				}
			}

			// Remove processed requests from queue
			const processedIds = new Set(toProcess.map((r) => r.id));
			this.queues.set(
				poolId,
				remaining.filter((r) => !processedIds.has(r.id)),
			);

			// Execute callbacks
			for (const req of toProcess) {
				const backend = this.selectBackend(poolId, req.sessionKey, req.hashKey);
				if (backend) {
					const connectionId = this.acquireConnection(backend.id);
					const queueWaitMs = Date.now() - req.queuedAt.getTime();
					req.resolve({
						backend,
						connectionId,
						queueWaitMs,
					});
				}
			}
		}
	}

	// ============================================================================
	// Pool Management
	// ============================================================================

	createPool(params: {
		name: string;
		strategy?: BalancingStrategy;
		healthCheckIntervalMs?: number;
		healthCheckTimeoutMs?: number;
		healthCheckPath?: string;
		failoverThreshold?: number;
		warmupDurationMs?: number;
		drainTimeoutMs?: number;
		stickySessionsEnabled?: boolean;
		stickySessionTtlMs?: number;
		maxQueueSize?: number;
		queueTimeoutMs?: number;
		metadata?: Record<string, unknown>;
	}): BackendPool {
		const id = `pool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		const pool: BackendPool = {
			id,
			name: params.name,
			strategy: params.strategy ?? this.config.defaultStrategy,
			healthCheckIntervalMs: params.healthCheckIntervalMs ?? this.config.defaultHealthCheckIntervalMs,
			healthCheckTimeoutMs: params.healthCheckTimeoutMs ?? this.config.defaultHealthCheckTimeoutMs,
			healthCheckPath: params.healthCheckPath,
			failoverThreshold: params.failoverThreshold ?? this.config.defaultFailoverThreshold,
			warmupDurationMs: params.warmupDurationMs ?? this.config.defaultWarmupDurationMs,
			drainTimeoutMs: params.drainTimeoutMs ?? this.config.defaultDrainTimeoutMs,
			stickySessionsEnabled: params.stickySessionsEnabled ?? false,
			stickySessionTtlMs: params.stickySessionTtlMs ?? 3600000,
			maxQueueSize: params.maxQueueSize ?? 100,
			queueTimeoutMs: params.queueTimeoutMs ?? 30000,
			enabled: true,
			createdAt: new Date(),
			metadata: params.metadata,
		};

		const stmt = this.db.prepare(`
      INSERT INTO backend_pools
      (id, name, strategy, health_check_interval_ms, health_check_timeout_ms,
       health_check_path, failover_threshold, warmup_duration_ms, drain_timeout_ms,
       sticky_sessions_enabled, sticky_session_ttl_ms, max_queue_size, queue_timeout_ms,
       enabled, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			pool.id,
			pool.name,
			pool.strategy,
			pool.healthCheckIntervalMs,
			pool.healthCheckTimeoutMs,
			pool.healthCheckPath ?? null,
			pool.failoverThreshold,
			pool.warmupDurationMs,
			pool.drainTimeoutMs,
			pool.stickySessionsEnabled ? 1 : 0,
			pool.stickySessionTtlMs,
			pool.maxQueueSize,
			pool.queueTimeoutMs,
			1,
			pool.createdAt.toISOString(),
			pool.metadata ? JSON.stringify(pool.metadata) : null,
		);

		this.pools.set(pool.id, pool);
		this.queues.set(pool.id, []);
		this.roundRobinIndex.set(pool.id, 0);
		this.startHealthChecks(pool.id);

		this.emit("pool:created", pool);
		return pool;
	}

	getPool(poolId: string): BackendPool | null {
		return this.pools.get(poolId) ?? null;
	}

	getAllPools(): BackendPool[] {
		return Array.from(this.pools.values());
	}

	updatePool(poolId: string, updates: Partial<Omit<BackendPool, "id" | "createdAt">>): BackendPool | null {
		const pool = this.pools.get(poolId);
		if (!pool) return null;

		const updatedPool = { ...pool, ...updates };

		const stmt = this.db.prepare(`
      UPDATE backend_pools
      SET name = ?, strategy = ?, health_check_interval_ms = ?, health_check_timeout_ms = ?,
          health_check_path = ?, failover_threshold = ?, warmup_duration_ms = ?,
          drain_timeout_ms = ?, sticky_sessions_enabled = ?, sticky_session_ttl_ms = ?,
          max_queue_size = ?, queue_timeout_ms = ?, enabled = ?, metadata = ?
      WHERE id = ?
    `);

		stmt.run(
			updatedPool.name,
			updatedPool.strategy,
			updatedPool.healthCheckIntervalMs,
			updatedPool.healthCheckTimeoutMs,
			updatedPool.healthCheckPath ?? null,
			updatedPool.failoverThreshold,
			updatedPool.warmupDurationMs,
			updatedPool.drainTimeoutMs,
			updatedPool.stickySessionsEnabled ? 1 : 0,
			updatedPool.stickySessionTtlMs,
			updatedPool.maxQueueSize,
			updatedPool.queueTimeoutMs,
			updatedPool.enabled ? 1 : 0,
			updatedPool.metadata ? JSON.stringify(updatedPool.metadata) : null,
			poolId,
		);

		this.pools.set(poolId, updatedPool);

		// Restart health checks if interval changed
		if (updates.healthCheckIntervalMs !== undefined) {
			this.stopHealthChecks(poolId);
			if (updatedPool.enabled) {
				this.startHealthChecks(poolId);
			}
		}

		this.emit("pool:updated", updatedPool);
		return updatedPool;
	}

	deletePool(poolId: string): boolean {
		const pool = this.pools.get(poolId);
		if (!pool) return false;

		this.stopHealthChecks(poolId);

		// Remove all backends in this pool
		const poolBackends = Array.from(this.backends.values()).filter((b) => b.poolId === poolId);
		for (const backend of poolBackends) {
			this.removeBackend(backend.id);
		}

		this.db.prepare("DELETE FROM backend_pools WHERE id = ?").run(poolId);
		this.pools.delete(poolId);
		this.queues.delete(poolId);
		this.roundRobinIndex.delete(poolId);

		this.emit("pool:deleted", { poolId });
		return true;
	}

	// ============================================================================
	// Backend Management
	// ============================================================================

	addBackend(params: {
		name: string;
		address: string;
		port: number;
		poolId?: string;
		weight?: number;
		priority?: number;
		maxConnections?: number;
		warmup?: boolean;
		metadata?: Record<string, unknown>;
	}): Backend {
		const id = `backend_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const now = new Date();
		const pool = params.poolId ? this.pools.get(params.poolId) : null;

		let status: BackendStatus = "healthy";
		let warmupEndTime: number | undefined;

		if (params.warmup !== false && pool) {
			status = "warming";
			warmupEndTime = Date.now() + pool.warmupDurationMs;
		}

		const backend: Backend = {
			id,
			name: params.name,
			address: params.address,
			port: params.port,
			weight: params.weight ?? 100,
			priority: params.priority ?? 0,
			status,
			poolId: params.poolId,
			maxConnections: params.maxConnections ?? this.config.defaultMaxConnections,
			activeConnections: 0,
			warmupEndTime,
			createdAt: now,
			updatedAt: now,
			metadata: params.metadata,
		};

		const stmt = this.db.prepare(`
      INSERT INTO backends
      (id, name, address, port, weight, priority, status, pool_id, max_connections,
       active_connections, warmup_end_time, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			backend.id,
			backend.name,
			backend.address,
			backend.port,
			backend.weight,
			backend.priority,
			backend.status,
			backend.poolId ?? null,
			backend.maxConnections,
			backend.activeConnections,
			backend.warmupEndTime ?? null,
			backend.createdAt.toISOString(),
			backend.updatedAt.toISOString(),
			backend.metadata ? JSON.stringify(backend.metadata) : null,
		);

		// Initialize metrics
		const metrics: BackendMetrics = {
			backendId: backend.id,
			totalRequests: 0,
			successfulRequests: 0,
			failedRequests: 0,
			activeConnections: 0,
			avgLatencyMs: 0,
			p95LatencyMs: 0,
			p99LatencyMs: 0,
			successRate: 1.0,
			consecutiveFailures: 0,
			consecutiveSuccesses: 0,
		};

		this.db
			.prepare(`
      INSERT INTO backend_metrics (backend_id) VALUES (?)
    `)
			.run(backend.id);

		this.backends.set(backend.id, backend);
		this.metrics.set(backend.id, metrics);
		this.latencyHistory.set(backend.id, []);

		this.emit("backend:added", backend);
		return backend;
	}

	getBackend(backendId: string): Backend | null {
		return this.backends.get(backendId) ?? null;
	}

	getBackendsInPool(poolId: string): Backend[] {
		return Array.from(this.backends.values()).filter((b) => b.poolId === poolId);
	}

	getAllBackends(): Backend[] {
		return Array.from(this.backends.values());
	}

	updateBackend(backendId: string, updates: Partial<Omit<Backend, "id" | "createdAt">>): Backend | null {
		const backend = this.backends.get(backendId);
		if (!backend) return null;

		const updatedBackend = {
			...backend,
			...updates,
			updatedAt: new Date(),
		};

		const stmt = this.db.prepare(`
      UPDATE backends
      SET name = ?, address = ?, port = ?, weight = ?, priority = ?, status = ?,
          pool_id = ?, max_connections = ?, active_connections = ?, warmup_end_time = ?,
          drain_start_time = ?, updated_at = ?, metadata = ?
      WHERE id = ?
    `);

		stmt.run(
			updatedBackend.name,
			updatedBackend.address,
			updatedBackend.port,
			updatedBackend.weight,
			updatedBackend.priority,
			updatedBackend.status,
			updatedBackend.poolId ?? null,
			updatedBackend.maxConnections,
			updatedBackend.activeConnections,
			updatedBackend.warmupEndTime ?? null,
			updatedBackend.drainStartTime ?? null,
			updatedBackend.updatedAt.toISOString(),
			updatedBackend.metadata ? JSON.stringify(updatedBackend.metadata) : null,
			backendId,
		);

		this.backends.set(backendId, updatedBackend);
		this.emit("backend:updated", updatedBackend);
		return updatedBackend;
	}

	removeBackend(backendId: string): boolean {
		const backend = this.backends.get(backendId);
		if (!backend) return false;

		this.db.prepare("DELETE FROM backend_metrics WHERE backend_id = ?").run(backendId);
		this.db.prepare("DELETE FROM sticky_sessions WHERE backend_id = ?").run(backendId);
		this.db.prepare("DELETE FROM health_check_history WHERE backend_id = ?").run(backendId);
		this.db.prepare("DELETE FROM backends WHERE id = ?").run(backendId);

		this.backends.delete(backendId);
		this.metrics.delete(backendId);
		this.latencyHistory.delete(backendId);

		// Remove sessions pointing to this backend
		for (const [sessionId, session] of this.sessions) {
			if (session.backendId === backendId) {
				this.sessions.delete(sessionId);
			}
		}

		this.emit("backend:removed", { backendId });
		return true;
	}

	drainBackend(backendId: string): boolean {
		const backend = this.backends.get(backendId);
		if (!backend) return false;

		this.updateBackend(backendId, {
			status: "draining",
			drainStartTime: Date.now(),
		});

		this.emit("backend:draining", { backendId });
		return true;
	}

	private updateBackendStatus(backendId: string, status: BackendStatus): void {
		const backend = this.backends.get(backendId);
		if (!backend) return;

		const oldStatus = backend.status;
		if (oldStatus !== status) {
			this.updateBackend(backendId, { status });
			this.emit("backend:status_changed", { backendId, oldStatus, newStatus: status });
		}
	}

	// ============================================================================
	// Routing
	// ============================================================================

	async route(params: {
		poolId: string;
		sessionKey?: string;
		hashKey?: string;
		priority?: number;
		timeout?: number;
	}): Promise<RouteResult> {
		const pool = this.pools.get(params.poolId);
		if (!pool) {
			throw new Error(`Pool not found: ${params.poolId}`);
		}

		if (!pool.enabled) {
			throw new Error(`Pool is disabled: ${params.poolId}`);
		}

		// Check for sticky session
		if (pool.stickySessionsEnabled && params.sessionKey) {
			const session = this.sessions.get(params.sessionKey);
			if (session && session.expiresAt > new Date()) {
				const backend = this.backends.get(session.backendId);
				if (backend && this.isBackendAvailable(backend)) {
					const connectionId = this.acquireConnection(backend.id);
					session.requestCount++;
					return { backend, connectionId };
				}
			}
		}

		// Try to select a backend
		const backend = this.selectBackend(params.poolId, params.sessionKey, params.hashKey);

		if (backend) {
			const connectionId = this.acquireConnection(backend.id);

			// Create sticky session if enabled
			if (pool.stickySessionsEnabled && params.sessionKey) {
				this.createSession(params.sessionKey, params.poolId, backend.id);
			}

			return {
				backend,
				connectionId,
				warmupPenalty: backend.status === "warming",
			};
		}

		// Queue the request if no backend available
		const queue = this.queues.get(params.poolId)!;
		if (queue.length >= pool.maxQueueSize) {
			throw new Error("Request queue full");
		}

		return new Promise((resolve, reject) => {
			const request: QueuedRequest = {
				id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				poolId: params.poolId,
				sessionKey: params.sessionKey,
				hashKey: params.hashKey,
				priority: params.priority ?? 0,
				queuedAt: new Date(),
				timeoutAt: new Date(Date.now() + (params.timeout ?? pool.queueTimeoutMs)),
				callback: async () => {},
				resolve,
				reject,
			};

			// Insert in priority order
			const insertIndex = queue.findIndex((r) => r.priority < request.priority);
			if (insertIndex === -1) {
				queue.push(request);
			} else {
				queue.splice(insertIndex, 0, request);
			}

			this.emit("request:queued", { requestId: request.id, poolId: params.poolId });
		});
	}

	private selectBackend(poolId: string, sessionKey?: string, hashKey?: string): Backend | null {
		const pool = this.pools.get(poolId);
		if (!pool) return null;

		const availableBackends = Array.from(this.backends.values())
			.filter((b) => b.poolId === poolId && this.isBackendAvailable(b))
			.sort((a, b) => b.priority - a.priority);

		if (availableBackends.length === 0) return null;

		switch (pool.strategy) {
			case "round-robin":
				return this.selectRoundRobin(poolId, availableBackends);
			case "weighted":
				return this.selectWeighted(availableBackends);
			case "least-connections":
				return this.selectLeastConnections(availableBackends);
			case "random":
				return this.selectRandom(availableBackends);
			case "consistent-hash":
				return this.selectConsistentHash(availableBackends, hashKey ?? sessionKey ?? "");
			case "priority":
				return this.selectPriority(availableBackends);
			default:
				return this.selectRoundRobin(poolId, availableBackends);
		}
	}

	private isBackendAvailable(backend: Backend): boolean {
		if (backend.status === "unhealthy" || backend.status === "offline") {
			return false;
		}
		if (backend.status === "draining") {
			return false;
		}
		if (backend.activeConnections >= backend.maxConnections) {
			return false;
		}
		return true;
	}

	private selectRoundRobin(poolId: string, backends: Backend[]): Backend {
		const index = this.roundRobinIndex.get(poolId) ?? 0;
		const backend = backends[index % backends.length];
		this.roundRobinIndex.set(poolId, (index + 1) % backends.length);
		return backend;
	}

	private selectWeighted(backends: Backend[]): Backend {
		const totalWeight = backends.reduce((sum, b) => sum + b.weight, 0);
		let random = Math.random() * totalWeight;

		for (const backend of backends) {
			random -= backend.weight;
			if (random <= 0) {
				return backend;
			}
		}

		return backends[backends.length - 1];
	}

	private selectLeastConnections(backends: Backend[]): Backend {
		return backends.reduce((min, b) => (b.activeConnections < min.activeConnections ? b : min));
	}

	private selectRandom(backends: Backend[]): Backend {
		return backends[Math.floor(Math.random() * backends.length)];
	}

	private selectConsistentHash(backends: Backend[], key: string): Backend {
		const hash = createHash("md5").update(key).digest("hex");
		const hashValue = parseInt(hash.substring(0, 8), 16);
		const index = hashValue % backends.length;
		return backends[index];
	}

	private selectPriority(backends: Backend[]): Backend {
		// Already sorted by priority, so return first available
		return backends[0];
	}

	private acquireConnection(backendId: string): string {
		const backend = this.backends.get(backendId);
		if (!backend) {
			throw new Error(`Backend not found: ${backendId}`);
		}

		backend.activeConnections++;
		this.updateBackend(backendId, { activeConnections: backend.activeConnections });

		const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		this.requestCounter++;

		this.emit("connection:acquired", { backendId, connectionId });
		return connectionId;
	}

	releaseConnection(backendId: string, connectionId: string): void {
		const backend = this.backends.get(backendId);
		if (!backend) return;

		backend.activeConnections = Math.max(0, backend.activeConnections - 1);
		this.updateBackend(backendId, { activeConnections: backend.activeConnections });

		this.emit("connection:released", { backendId, connectionId });
	}

	recordRequestResult(params: {
		poolId: string;
		backendId: string;
		connectionId: string;
		latencyMs: number;
		success: boolean;
		queueWaitMs?: number;
	}): void {
		const metrics = this.metrics.get(params.backendId);
		if (!metrics) return;

		// Update metrics
		metrics.totalRequests++;
		if (params.success) {
			metrics.successfulRequests++;
			metrics.consecutiveSuccesses++;
			metrics.consecutiveFailures = 0;
		} else {
			metrics.failedRequests++;
			metrics.consecutiveFailures++;
			metrics.consecutiveSuccesses = 0;
		}
		metrics.lastRequestAt = new Date();
		metrics.successRate = metrics.successfulRequests / metrics.totalRequests;

		// Update latency history
		const history = this.latencyHistory.get(params.backendId) ?? [];
		history.push(params.latencyMs);
		if (history.length > 1000) {
			history.shift();
		}
		this.latencyHistory.set(params.backendId, history);

		// Calculate latency percentiles
		const sorted = [...history].sort((a, b) => a - b);
		metrics.avgLatencyMs = sorted.reduce((a, b) => a + b, 0) / sorted.length;
		metrics.p95LatencyMs = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
		metrics.p99LatencyMs = sorted[Math.floor(sorted.length * 0.99)] ?? 0;

		// Save to database
		this.db
			.prepare(`
      UPDATE backend_metrics
      SET total_requests = ?, successful_requests = ?, failed_requests = ?,
          avg_latency_ms = ?, p95_latency_ms = ?, p99_latency_ms = ?,
          success_rate = ?, last_request_at = ?, consecutive_failures = ?,
          consecutive_successes = ?
      WHERE backend_id = ?
    `)
			.run(
				metrics.totalRequests,
				metrics.successfulRequests,
				metrics.failedRequests,
				metrics.avgLatencyMs,
				metrics.p95LatencyMs,
				metrics.p99LatencyMs,
				metrics.successRate,
				metrics.lastRequestAt?.toISOString() ?? null,
				metrics.consecutiveFailures,
				metrics.consecutiveSuccesses,
				params.backendId,
			);

		// Record in history
		this.db
			.prepare(`
      INSERT INTO request_history (id, pool_id, backend_id, latency_ms, success, queue_wait_ms, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
			.run(
				`req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
				params.poolId,
				params.backendId,
				params.latencyMs,
				params.success ? 1 : 0,
				params.queueWaitMs ?? null,
				new Date().toISOString(),
			);

		// Check for failover
		const pool = this.pools.get(params.poolId);
		if (pool && metrics.consecutiveFailures >= pool.failoverThreshold) {
			this.updateBackendStatus(params.backendId, "unhealthy");
		}

		// Release connection
		this.releaseConnection(params.backendId, params.connectionId);

		this.emit("request:completed", {
			poolId: params.poolId,
			backendId: params.backendId,
			latencyMs: params.latencyMs,
			success: params.success,
		});
	}

	// ============================================================================
	// Sticky Sessions
	// ============================================================================

	private createSession(sessionId: string, poolId: string, backendId: string): StickySession {
		const pool = this.pools.get(poolId);
		const ttl = pool?.stickySessionTtlMs ?? 3600000;
		const now = new Date();

		const session: StickySession = {
			sessionId,
			poolId,
			backendId,
			createdAt: now,
			expiresAt: new Date(now.getTime() + ttl),
			requestCount: 1,
		};

		this.db
			.prepare(`
      INSERT OR REPLACE INTO sticky_sessions
      (session_id, pool_id, backend_id, created_at, expires_at, request_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
			.run(
				session.sessionId,
				session.poolId,
				session.backendId,
				session.createdAt.toISOString(),
				session.expiresAt.toISOString(),
				session.requestCount,
			);

		this.sessions.set(sessionId, session);
		this.emit("session:created", session);
		return session;
	}

	getSession(sessionId: string): StickySession | null {
		return this.sessions.get(sessionId) ?? null;
	}

	invalidateSession(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) return false;

		this.db.prepare("DELETE FROM sticky_sessions WHERE session_id = ?").run(sessionId);
		this.sessions.delete(sessionId);
		this.emit("session:invalidated", { sessionId });
		return true;
	}

	// ============================================================================
	// Health Checks
	// ============================================================================

	private startHealthChecks(poolId: string): void {
		const pool = this.pools.get(poolId);
		if (!pool) return;

		const timer = setInterval(() => {
			this.runHealthChecks(poolId);
		}, pool.healthCheckIntervalMs);

		this.healthCheckTimers.set(poolId, timer);

		// Run initial health check
		this.runHealthChecks(poolId);
	}

	private stopHealthChecks(poolId: string): void {
		const timer = this.healthCheckTimers.get(poolId);
		if (timer) {
			clearInterval(timer);
			this.healthCheckTimers.delete(poolId);
		}
	}

	private async runHealthChecks(poolId: string): Promise<void> {
		const backends = this.getBackendsInPool(poolId);
		const pool = this.pools.get(poolId);
		if (!pool) return;

		for (const backend of backends) {
			if (backend.status === "offline") continue;

			try {
				const result = await this.checkBackendHealth(backend, pool);
				this.recordHealthCheck(result);
			} catch (error) {
				this.recordHealthCheck({
					backendId: backend.id,
					healthy: false,
					latencyMs: 0,
					message: error instanceof Error ? error.message : String(error),
					checkedAt: new Date(),
				});
			}
		}
	}

	private async checkBackendHealth(backend: Backend, _pool: BackendPool): Promise<HealthCheckResult> {
		const startTime = Date.now();

		// Simple TCP health check simulation
		// In production, this would make an actual HTTP request to healthCheckPath
		const healthy = backend.status !== "unhealthy" && backend.status !== "offline";
		const latencyMs = Date.now() - startTime;

		return {
			backendId: backend.id,
			healthy,
			latencyMs,
			statusCode: healthy ? 200 : 503,
			message: healthy ? "OK" : "Health check failed",
			checkedAt: new Date(),
		};
	}

	private recordHealthCheck(result: HealthCheckResult): void {
		const metrics = this.metrics.get(result.backendId);
		if (metrics) {
			metrics.lastHealthCheckAt = result.checkedAt;
			if (result.healthy) {
				metrics.consecutiveSuccesses++;
				metrics.consecutiveFailures = 0;
			} else {
				metrics.consecutiveFailures++;
				metrics.consecutiveSuccesses = 0;
			}
		}

		// Save to history
		this.db
			.prepare(`
      INSERT INTO health_check_history
      (id, backend_id, healthy, latency_ms, status_code, message, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
			.run(
				`hc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
				result.backendId,
				result.healthy ? 1 : 0,
				result.latencyMs,
				result.statusCode ?? null,
				result.message ?? null,
				result.checkedAt.toISOString(),
			);

		// Update backend status
		const backend = this.backends.get(result.backendId);
		if (backend && backend.status !== "draining" && backend.status !== "offline") {
			const pool = backend.poolId ? this.pools.get(backend.poolId) : null;
			const threshold = pool?.failoverThreshold ?? this.config.defaultFailoverThreshold;

			if (!result.healthy && metrics && metrics.consecutiveFailures >= threshold) {
				this.updateBackendStatus(result.backendId, "unhealthy");
			} else if (result.healthy && backend.status === "unhealthy") {
				// Recover from unhealthy
				this.updateBackendStatus(result.backendId, "healthy");
			}
		}

		this.emit("health:checked", result);
	}

	// ============================================================================
	// Metrics
	// ============================================================================

	getBackendMetrics(backendId: string): BackendMetrics | null {
		return this.metrics.get(backendId) ?? null;
	}

	getPoolMetrics(poolId: string): {
		backends: BackendMetrics[];
		aggregate: {
			totalRequests: number;
			avgLatencyMs: number;
			successRate: number;
			activeConnections: number;
		};
	} {
		const backends = this.getBackendsInPool(poolId);
		const backendMetrics = backends
			.map((b) => this.metrics.get(b.id))
			.filter((m): m is BackendMetrics => m !== undefined);

		const aggregate = {
			totalRequests: backendMetrics.reduce((sum, m) => sum + m.totalRequests, 0),
			avgLatencyMs:
				backendMetrics.length > 0
					? backendMetrics.reduce((sum, m) => sum + m.avgLatencyMs, 0) / backendMetrics.length
					: 0,
			successRate:
				backendMetrics.length > 0
					? backendMetrics.reduce((sum, m) => sum + m.successRate, 0) / backendMetrics.length
					: 1.0,
			activeConnections: backendMetrics.reduce((sum, m) => sum + m.activeConnections, 0),
		};

		return { backends: backendMetrics, aggregate };
	}

	getStats(): LoadBalancerStats {
		const backends = Array.from(this.backends.values());
		const now = Date.now();
		const elapsed = (now - this.lastRequestCounterReset) / 1000;
		const rps = elapsed > 0 ? this.requestCounter / elapsed : 0;

		// Reset counter periodically
		if (elapsed > 60) {
			this.requestCounter = 0;
			this.lastRequestCounterReset = now;
		}

		const allMetrics = Array.from(this.metrics.values());
		const avgLatency =
			allMetrics.length > 0 ? allMetrics.reduce((sum, m) => sum + m.avgLatencyMs, 0) / allMetrics.length : 0;

		return {
			totalPools: this.pools.size,
			totalBackends: backends.length,
			healthyBackends: backends.filter((b) => b.status === "healthy").length,
			unhealthyBackends: backends.filter((b) => b.status === "unhealthy").length,
			drainingBackends: backends.filter((b) => b.status === "draining").length,
			warmingBackends: backends.filter((b) => b.status === "warming").length,
			totalActiveConnections: backends.reduce((sum, b) => sum + b.activeConnections, 0),
			totalQueuedRequests: Array.from(this.queues.values()).reduce((sum, q) => sum + q.length, 0),
			totalSessions: this.sessions.size,
			requestsPerSecond: Math.round(rps * 100) / 100,
			avgLatencyMs: Math.round(avgLatency * 100) / 100,
		};
	}

	// ============================================================================
	// Row Conversion Helpers
	// ============================================================================

	private rowToPool(row: DbPoolRow): BackendPool {
		return {
			id: row.id,
			name: row.name,
			strategy: row.strategy as BalancingStrategy,
			healthCheckIntervalMs: row.health_check_interval_ms,
			healthCheckTimeoutMs: row.health_check_timeout_ms,
			healthCheckPath: row.health_check_path ?? undefined,
			failoverThreshold: row.failover_threshold,
			warmupDurationMs: row.warmup_duration_ms,
			drainTimeoutMs: row.drain_timeout_ms,
			stickySessionsEnabled: Boolean(row.sticky_sessions_enabled),
			stickySessionTtlMs: row.sticky_session_ttl_ms,
			maxQueueSize: row.max_queue_size,
			queueTimeoutMs: row.queue_timeout_ms,
			enabled: Boolean(row.enabled),
			createdAt: new Date(row.created_at),
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		};
	}

	private rowToBackend(row: DbBackendRow): Backend {
		return {
			id: row.id,
			name: row.name,
			address: row.address,
			port: row.port,
			weight: row.weight,
			priority: row.priority,
			status: row.status as BackendStatus,
			poolId: row.pool_id ?? undefined,
			maxConnections: row.max_connections,
			activeConnections: row.active_connections,
			warmupEndTime: row.warmup_end_time ?? undefined,
			drainStartTime: row.drain_start_time ?? undefined,
			createdAt: new Date(row.created_at),
			updatedAt: new Date(row.updated_at),
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		};
	}

	private rowToMetrics(row: DbMetricsRow): BackendMetrics {
		return {
			backendId: row.backend_id,
			totalRequests: row.total_requests,
			successfulRequests: row.successful_requests,
			failedRequests: row.failed_requests,
			activeConnections: row.active_connections,
			avgLatencyMs: row.avg_latency_ms,
			p95LatencyMs: row.p95_latency_ms,
			p99LatencyMs: row.p99_latency_ms,
			successRate: row.success_rate,
			lastRequestAt: row.last_request_at ? new Date(row.last_request_at) : undefined,
			lastHealthCheckAt: row.last_health_check_at ? new Date(row.last_health_check_at) : undefined,
			consecutiveFailures: row.consecutive_failures,
			consecutiveSuccesses: row.consecutive_successes,
		};
	}

	private rowToSession(row: DbSessionRow): StickySession {
		return {
			sessionId: row.session_id,
			poolId: row.pool_id,
			backendId: row.backend_id,
			createdAt: new Date(row.created_at),
			expiresAt: new Date(row.expires_at),
			requestCount: row.request_count,
		};
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	shutdown(): void {
		// Stop all health check timers
		for (const timer of this.healthCheckTimers.values()) {
			clearInterval(timer);
		}
		this.healthCheckTimers.clear();

		// Stop cleanup and queue processors
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		if (this.queueProcessorInterval) {
			clearInterval(this.queueProcessorInterval);
			this.queueProcessorInterval = null;
		}

		// Reject all queued requests
		for (const queue of this.queues.values()) {
			for (const req of queue) {
				req.reject(new Error("Load balancer shutting down"));
			}
		}
		this.queues.clear();

		this.db.close();
		this.emit("shutdown");
	}
}

// ============================================================================
// Internal Database Row Types
// ============================================================================

interface DbPoolRow {
	id: string;
	name: string;
	strategy: string;
	health_check_interval_ms: number;
	health_check_timeout_ms: number;
	health_check_path: string | null;
	failover_threshold: number;
	warmup_duration_ms: number;
	drain_timeout_ms: number;
	sticky_sessions_enabled: number;
	sticky_session_ttl_ms: number;
	max_queue_size: number;
	queue_timeout_ms: number;
	enabled: number;
	created_at: string;
	metadata: string | null;
}

interface DbBackendRow {
	id: string;
	name: string;
	address: string;
	port: number;
	weight: number;
	priority: number;
	status: string;
	pool_id: string | null;
	max_connections: number;
	active_connections: number;
	warmup_end_time: number | null;
	drain_start_time: number | null;
	created_at: string;
	updated_at: string;
	metadata: string | null;
}

interface DbMetricsRow {
	backend_id: string;
	total_requests: number;
	successful_requests: number;
	failed_requests: number;
	active_connections: number;
	avg_latency_ms: number;
	p95_latency_ms: number;
	p99_latency_ms: number;
	success_rate: number;
	last_request_at: string | null;
	last_health_check_at: string | null;
	consecutive_failures: number;
	consecutive_successes: number;
}

interface DbSessionRow {
	session_id: string;
	pool_id: string;
	backend_id: string;
	created_at: string;
	expires_at: string;
	request_count: number;
}

// ============================================================================
// Factory Functions
// ============================================================================

let loadBalancerInstance: LoadBalancerSystem | null = null;

export function getLoadBalancer(config?: LoadBalancerConfig): LoadBalancerSystem {
	if (!loadBalancerInstance) {
		if (!config) {
			throw new Error("LoadBalancerSystem requires config on first initialization");
		}
		loadBalancerInstance = new LoadBalancerSystem(config);
	}
	return loadBalancerInstance;
}

export function resetLoadBalancer(): void {
	if (loadBalancerInstance) {
		loadBalancerInstance.shutdown();
		loadBalancerInstance = null;
	}
}
