/**
 * Class 3.56: Service Mesh System
 * TAC Pattern: Service-to-service communication with traffic management
 *
 * Features:
 * - Service registration and discovery
 * - Service-to-service communication routing
 * - Sidecar proxy pattern (virtual)
 * - Traffic management (routing rules, traffic splitting)
 * - Retry policies per service
 * - Timeout configuration
 * - mTLS simulation (trust levels)
 * - Service versioning (canary, blue-green)
 * - Traffic mirroring/shadowing
 * - Request tracing/correlation IDs
 * - Service dependencies tracking
 * - Fault injection for testing
 * - Rate limiting per service pair
 * - Circuit breaker integration points
 * - Observability hooks (metrics, logs, traces)
 * - SQLite persistence for service registry
 */

import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

export type ServiceStatus = "online" | "offline" | "degraded" | "draining" | "maintenance";
export type DeploymentStrategy = "rolling" | "canary" | "blue_green" | "shadow";
export type LoadBalanceStrategy = "round_robin" | "least_connections" | "weighted" | "random" | "ip_hash";
export type TrustLevel = "untrusted" | "basic" | "verified" | "trusted" | "system";
export type CircuitState = "closed" | "open" | "half_open";

export interface ServiceEndpoint {
	id: string;
	host: string;
	port: number;
	weight: number;
	version: string;
	metadata: Record<string, unknown>;
	healthCheckPath?: string;
	isHealthy: boolean;
	lastHealthCheck: number;
}

export interface ServiceDefinition {
	id: string;
	name: string;
	namespace: string;
	description: string;
	version: string;
	status: ServiceStatus;
	endpoints: ServiceEndpoint[];
	tags: string[];
	trustLevel: TrustLevel;
	dependencies: string[]; // Service IDs this depends on
	loadBalanceStrategy: LoadBalanceStrategy;
	healthCheckIntervalMs: number;
	registeredAt: number;
	updatedAt: number;
}

export interface RoutingRule {
	id: string;
	name: string;
	sourceService: string; // "*" for all
	destinationService: string;
	priority: number;
	conditions: RouteCondition[];
	actions: RouteAction;
	enabled: boolean;
	createdAt: number;
}

export interface RouteCondition {
	type: "header" | "path" | "method" | "weight" | "version" | "tag";
	key?: string;
	operator: "equals" | "contains" | "regex" | "exists" | "gt" | "lt";
	value: string;
}

export interface RouteAction {
	destinationVersion?: string;
	weightDistribution?: { version: string; weight: number }[];
	retryPolicy?: RetryPolicy;
	timeout?: TimeoutConfig;
	faultInjection?: FaultInjection;
	mirror?: MirrorConfig;
	headers?: { add?: Record<string, string>; remove?: string[] };
}

export interface RetryPolicy {
	maxRetries: number;
	retryOn: string[]; // e.g., ["5xx", "reset", "connect-failure"]
	backoffMs: number;
	maxBackoffMs: number;
	retryBackoffMultiplier: number;
}

export interface TimeoutConfig {
	requestTimeoutMs: number;
	idleTimeoutMs: number;
	connectTimeoutMs: number;
}

export interface FaultInjection {
	delay?: { percent: number; durationMs: number };
	abort?: { percent: number; httpStatus: number };
	enabled: boolean;
}

export interface MirrorConfig {
	destinationService: string;
	destinationVersion?: string;
	percent: number;
}

export interface TrafficSplit {
	id: string;
	name: string;
	service: string;
	splits: { version: string; weight: number }[];
	enabled: boolean;
	createdAt: number;
}

export interface ServiceRequest {
	id: string;
	correlationId: string;
	parentSpanId?: string;
	sourceService: string;
	destinationService: string;
	destinationVersion?: string;
	method: string;
	path: string;
	headers: Record<string, string>;
	startedAt: number;
	completedAt?: number;
	durationMs?: number;
	statusCode?: number;
	error?: string;
	retryCount: number;
	isMirrored: boolean;
}

export interface ServiceMetrics {
	serviceId: string;
	requestCount: number;
	successCount: number;
	failureCount: number;
	avgLatencyMs: number;
	p50LatencyMs: number;
	p95LatencyMs: number;
	p99LatencyMs: number;
	activeConnections: number;
	requestsPerSecond: number;
	errorRate: number;
	lastUpdated: number;
}

export interface CircuitBreakerConfig {
	serviceId: string;
	failureThreshold: number;
	successThreshold: number;
	timeoutMs: number;
	halfOpenMaxCalls: number;
}

export interface CircuitBreakerState {
	serviceId: string;
	state: CircuitState;
	failureCount: number;
	successCount: number;
	lastFailureAt?: number;
	lastStateChange: number;
	halfOpenCallCount: number;
}

export interface RateLimitConfig {
	sourceService: string;
	destinationService: string;
	requestsPerSecond: number;
	burstSize: number;
}

export interface RateLimitState {
	key: string;
	tokens: number;
	lastRefill: number;
}

export interface ServiceMeshConfig {
	defaultTimeoutMs: number;
	defaultRetryMaxAttempts: number;
	defaultRetryBackoffMs: number;
	healthCheckIntervalMs: number;
	metricsRetentionMs: number;
	traceRetentionMs: number;
	enableMtls: boolean;
	defaultTrustLevel: TrustLevel;
	cleanupIntervalMs: number;
}

export interface ServiceMeshStats {
	totalServices: number;
	onlineServices: number;
	offlineServices: number;
	degradedServices: number;
	totalEndpoints: number;
	healthyEndpoints: number;
	totalRoutingRules: number;
	enabledRoutingRules: number;
	totalTrafficSplits: number;
	openCircuits: number;
	avgRequestsPerSecond: number;
	avgErrorRate: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ServiceMeshConfig = {
	defaultTimeoutMs: 30000,
	defaultRetryMaxAttempts: 3,
	defaultRetryBackoffMs: 1000,
	healthCheckIntervalMs: 30000,
	metricsRetentionMs: 3600000, // 1 hour
	traceRetentionMs: 86400000, // 24 hours
	enableMtls: true,
	defaultTrustLevel: "basic",
	cleanupIntervalMs: 60000,
};

const _DEFAULT_RETRY_POLICY: RetryPolicy = {
	maxRetries: 3,
	retryOn: ["5xx", "reset", "connect-failure"],
	backoffMs: 1000,
	maxBackoffMs: 10000,
	retryBackoffMultiplier: 2,
};

const _DEFAULT_TIMEOUT: TimeoutConfig = {
	requestTimeoutMs: 30000,
	idleTimeoutMs: 60000,
	connectTimeoutMs: 5000,
};

// ============================================================================
// Service Mesh System
// ============================================================================

export class ServiceMeshSystem extends EventEmitter {
	private db: Database.Database;
	private config: ServiceMeshConfig;
	private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
	private rateLimitStates: Map<string, RateLimitState> = new Map();
	private endpointCounters: Map<string, number> = new Map(); // For round-robin
	private healthCheckTimers: Map<string, NodeJS.Timeout> = new Map();
	private cleanupTimer?: NodeJS.Timeout;
	private metricsCache: Map<string, ServiceMetrics> = new Map();
	private latencyHistograms: Map<string, number[]> = new Map();

	constructor(dataDir: string, config: Partial<ServiceMeshConfig> = {}) {
		super();
		this.config = { ...DEFAULT_CONFIG, ...config };

		const dbPath = path.join(dataDir, "service-mesh.db");
		fs.mkdirSync(dataDir, { recursive: true });

		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL");
		this.initSchema();

		this.startCleanupTimer();
		this.loadCircuitBreakerStates();
	}

	private initSchema(): void {
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        namespace TEXT NOT NULL DEFAULT 'default',
        description TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '1.0.0',
        status TEXT NOT NULL DEFAULT 'offline',
        endpoints TEXT NOT NULL DEFAULT '[]',
        tags TEXT NOT NULL DEFAULT '[]',
        trust_level TEXT NOT NULL DEFAULT 'basic',
        dependencies TEXT NOT NULL DEFAULT '[]',
        load_balance_strategy TEXT NOT NULL DEFAULT 'round_robin',
        health_check_interval_ms INTEGER NOT NULL DEFAULT 30000,
        registered_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS routing_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source_service TEXT NOT NULL DEFAULT '*',
        destination_service TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        conditions TEXT NOT NULL DEFAULT '[]',
        actions TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS traffic_splits (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        service TEXT NOT NULL,
        splits TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS service_requests (
        id TEXT PRIMARY KEY,
        correlation_id TEXT NOT NULL,
        parent_span_id TEXT,
        source_service TEXT NOT NULL,
        destination_service TEXT NOT NULL,
        destination_version TEXT,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        headers TEXT NOT NULL DEFAULT '{}',
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        duration_ms INTEGER,
        status_code INTEGER,
        error TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        is_mirrored INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS circuit_breakers (
        service_id TEXT PRIMARY KEY,
        failure_threshold INTEGER NOT NULL DEFAULT 5,
        success_threshold INTEGER NOT NULL DEFAULT 3,
        timeout_ms INTEGER NOT NULL DEFAULT 30000,
        half_open_max_calls INTEGER NOT NULL DEFAULT 3,
        state TEXT NOT NULL DEFAULT 'closed',
        failure_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        last_failure_at INTEGER,
        last_state_change INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rate_limits (
        id TEXT PRIMARY KEY,
        source_service TEXT NOT NULL,
        destination_service TEXT NOT NULL,
        requests_per_second REAL NOT NULL DEFAULT 100,
        burst_size INTEGER NOT NULL DEFAULT 10,
        UNIQUE(source_service, destination_service)
      );

      CREATE TABLE IF NOT EXISTS service_metrics (
        id TEXT PRIMARY KEY,
        service_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        total_latency_ms INTEGER NOT NULL DEFAULT 0,
        active_connections INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
      CREATE INDEX IF NOT EXISTS idx_services_namespace ON services(namespace);
      CREATE INDEX IF NOT EXISTS idx_routing_source ON routing_rules(source_service);
      CREATE INDEX IF NOT EXISTS idx_routing_dest ON routing_rules(destination_service);
      CREATE INDEX IF NOT EXISTS idx_routing_enabled ON routing_rules(enabled);
      CREATE INDEX IF NOT EXISTS idx_requests_correlation ON service_requests(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_requests_started ON service_requests(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_requests_source ON service_requests(source_service);
      CREATE INDEX IF NOT EXISTS idx_requests_dest ON service_requests(destination_service);
      CREATE INDEX IF NOT EXISTS idx_metrics_service ON service_metrics(service_id);
      CREATE INDEX IF NOT EXISTS idx_metrics_time ON service_metrics(timestamp DESC);
    `);
	}

	private startCleanupTimer(): void {
		this.cleanupTimer = setInterval(() => {
			this.cleanup();
		}, this.config.cleanupIntervalMs);
	}

	private loadCircuitBreakerStates(): void {
		const rows = this.db.prepare(`SELECT * FROM circuit_breakers`).all() as DbCircuitBreakerRow[];

		for (const row of rows) {
			this.circuitBreakers.set(row.service_id, {
				serviceId: row.service_id,
				state: row.state as CircuitState,
				failureCount: row.failure_count,
				successCount: row.success_count,
				lastFailureAt: row.last_failure_at ?? undefined,
				lastStateChange: row.last_state_change,
				halfOpenCallCount: 0,
			});
		}
	}

	// ============================================================================
	// Service Registration
	// ============================================================================

	registerService(params: {
		id?: string;
		name: string;
		namespace?: string;
		description?: string;
		version?: string;
		endpoints?: Omit<ServiceEndpoint, "id" | "isHealthy" | "lastHealthCheck">[];
		tags?: string[];
		trustLevel?: TrustLevel;
		dependencies?: string[];
		loadBalanceStrategy?: LoadBalanceStrategy;
		healthCheckIntervalMs?: number;
	}): ServiceDefinition {
		const now = Date.now();
		const id = params.id ?? `svc_${randomUUID().slice(0, 8)}`;

		const endpoints: ServiceEndpoint[] = (params.endpoints ?? []).map((ep, idx) => ({
			id: `ep_${id}_${idx}`,
			host: ep.host,
			port: ep.port,
			weight: ep.weight ?? 1,
			version: ep.version ?? params.version ?? "1.0.0",
			metadata: ep.metadata ?? {},
			healthCheckPath: ep.healthCheckPath,
			isHealthy: true,
			lastHealthCheck: now,
		}));

		const service: ServiceDefinition = {
			id,
			name: params.name,
			namespace: params.namespace ?? "default",
			description: params.description ?? "",
			version: params.version ?? "1.0.0",
			status: "online",
			endpoints,
			tags: params.tags ?? [],
			trustLevel: params.trustLevel ?? this.config.defaultTrustLevel,
			dependencies: params.dependencies ?? [],
			loadBalanceStrategy: params.loadBalanceStrategy ?? "round_robin",
			healthCheckIntervalMs: params.healthCheckIntervalMs ?? this.config.healthCheckIntervalMs,
			registeredAt: now,
			updatedAt: now,
		};

		this.db
			.prepare(
				`
      INSERT INTO services (id, name, namespace, description, version, status, endpoints, tags, trust_level, dependencies, load_balance_strategy, health_check_interval_ms, registered_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        namespace = excluded.namespace,
        description = excluded.description,
        version = excluded.version,
        status = excluded.status,
        endpoints = excluded.endpoints,
        tags = excluded.tags,
        trust_level = excluded.trust_level,
        dependencies = excluded.dependencies,
        load_balance_strategy = excluded.load_balance_strategy,
        health_check_interval_ms = excluded.health_check_interval_ms,
        updated_at = excluded.updated_at
    `,
			)
			.run(
				service.id,
				service.name,
				service.namespace,
				service.description,
				service.version,
				service.status,
				JSON.stringify(service.endpoints),
				JSON.stringify(service.tags),
				service.trustLevel,
				JSON.stringify(service.dependencies),
				service.loadBalanceStrategy,
				service.healthCheckIntervalMs,
				service.registeredAt,
				service.updatedAt,
			);

		// Initialize circuit breaker
		this.initCircuitBreaker(service.id);

		// Start health checks for endpoints
		this.startHealthChecks(service);

		this.emit("service:registered", { service });
		return service;
	}

	unregisterService(serviceId: string): boolean {
		// Stop health checks
		this.stopHealthChecks(serviceId);

		const result = this.db.prepare(`DELETE FROM services WHERE id = ?`).run(serviceId);

		if (result.changes > 0) {
			this.circuitBreakers.delete(serviceId);
			this.metricsCache.delete(serviceId);
			this.emit("service:unregistered", { serviceId });
		}

		return result.changes > 0;
	}

	getService(serviceId: string): ServiceDefinition | null {
		const row = this.db.prepare(`SELECT * FROM services WHERE id = ?`).get(serviceId) as DbServiceRow | undefined;

		if (!row) return null;
		return this.rowToService(row);
	}

	getServiceByName(name: string, namespace: string = "default"): ServiceDefinition | null {
		const row = this.db.prepare(`SELECT * FROM services WHERE name = ? AND namespace = ?`).get(name, namespace) as
			| DbServiceRow
			| undefined;

		if (!row) return null;
		return this.rowToService(row);
	}

	listServices(params: { namespace?: string; status?: ServiceStatus; tag?: string } = {}): ServiceDefinition[] {
		let sql = `SELECT * FROM services WHERE 1=1`;
		const sqlParams: unknown[] = [];

		if (params.namespace) {
			sql += ` AND namespace = ?`;
			sqlParams.push(params.namespace);
		}

		if (params.status) {
			sql += ` AND status = ?`;
			sqlParams.push(params.status);
		}

		if (params.tag) {
			sql += ` AND tags LIKE ?`;
			sqlParams.push(`%"${params.tag}"%`);
		}

		sql += ` ORDER BY namespace, name`;

		const rows = this.db.prepare(sql).all(...sqlParams) as DbServiceRow[];
		return rows.map((row) => this.rowToService(row));
	}

	updateServiceStatus(serviceId: string, status: ServiceStatus): boolean {
		const result = this.db
			.prepare(`UPDATE services SET status = ?, updated_at = ? WHERE id = ?`)
			.run(status, Date.now(), serviceId);

		if (result.changes > 0) {
			this.emit("service:status-changed", { serviceId, status });
		}

		return result.changes > 0;
	}

	addEndpoint(serviceId: string, endpoint: Omit<ServiceEndpoint, "id" | "isHealthy" | "lastHealthCheck">): boolean {
		const service = this.getService(serviceId);
		if (!service) return false;

		const now = Date.now();
		const newEndpoint: ServiceEndpoint = {
			id: `ep_${serviceId}_${service.endpoints.length}`,
			host: endpoint.host,
			port: endpoint.port,
			weight: endpoint.weight ?? 1,
			version: endpoint.version ?? service.version,
			metadata: endpoint.metadata ?? {},
			healthCheckPath: endpoint.healthCheckPath,
			isHealthy: true,
			lastHealthCheck: now,
		};

		service.endpoints.push(newEndpoint);

		this.db
			.prepare(`UPDATE services SET endpoints = ?, updated_at = ? WHERE id = ?`)
			.run(JSON.stringify(service.endpoints), now, serviceId);

		this.emit("endpoint:added", { serviceId, endpoint: newEndpoint });
		return true;
	}

	removeEndpoint(serviceId: string, endpointId: string): boolean {
		const service = this.getService(serviceId);
		if (!service) return false;

		const idx = service.endpoints.findIndex((ep) => ep.id === endpointId);
		if (idx === -1) return false;

		service.endpoints.splice(idx, 1);

		this.db
			.prepare(`UPDATE services SET endpoints = ?, updated_at = ? WHERE id = ?`)
			.run(JSON.stringify(service.endpoints), Date.now(), serviceId);

		this.emit("endpoint:removed", { serviceId, endpointId });
		return true;
	}

	updateEndpointHealth(serviceId: string, endpointId: string, isHealthy: boolean): void {
		const service = this.getService(serviceId);
		if (!service) return;

		const endpoint = service.endpoints.find((ep) => ep.id === endpointId);
		if (!endpoint) return;

		endpoint.isHealthy = isHealthy;
		endpoint.lastHealthCheck = Date.now();

		this.db
			.prepare(`UPDATE services SET endpoints = ?, updated_at = ? WHERE id = ?`)
			.run(JSON.stringify(service.endpoints), Date.now(), serviceId);

		this.emit("endpoint:health-changed", { serviceId, endpointId, isHealthy });

		// Update service status based on endpoint health
		const healthyCount = service.endpoints.filter((ep) => ep.isHealthy).length;
		if (healthyCount === 0 && service.endpoints.length > 0) {
			this.updateServiceStatus(serviceId, "offline");
		} else if (healthyCount < service.endpoints.length) {
			this.updateServiceStatus(serviceId, "degraded");
		} else if (service.status === "degraded" || service.status === "offline") {
			this.updateServiceStatus(serviceId, "online");
		}
	}

	// ============================================================================
	// Routing Rules
	// ============================================================================

	createRoutingRule(params: {
		name: string;
		sourceService?: string;
		destinationService: string;
		priority?: number;
		conditions?: RouteCondition[];
		actions?: RouteAction;
	}): RoutingRule {
		const id = `rule_${randomUUID().slice(0, 8)}`;
		const now = Date.now();

		const rule: RoutingRule = {
			id,
			name: params.name,
			sourceService: params.sourceService ?? "*",
			destinationService: params.destinationService,
			priority: params.priority ?? 0,
			conditions: params.conditions ?? [],
			actions: params.actions ?? {},
			enabled: true,
			createdAt: now,
		};

		this.db
			.prepare(
				`
      INSERT INTO routing_rules (id, name, source_service, destination_service, priority, conditions, actions, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
			)
			.run(
				rule.id,
				rule.name,
				rule.sourceService,
				rule.destinationService,
				rule.priority,
				JSON.stringify(rule.conditions),
				JSON.stringify(rule.actions),
				rule.enabled ? 1 : 0,
				rule.createdAt,
			);

		this.emit("routing-rule:created", { rule });
		return rule;
	}

	getRoutingRule(ruleId: string): RoutingRule | null {
		const row = this.db.prepare(`SELECT * FROM routing_rules WHERE id = ?`).get(ruleId) as
			| DbRoutingRuleRow
			| undefined;

		if (!row) return null;
		return this.rowToRoutingRule(row);
	}

	getRoutingRules(sourceService: string, destinationService: string): RoutingRule[] {
		const rows = this.db
			.prepare(
				`
      SELECT * FROM routing_rules
      WHERE enabled = 1 AND destination_service = ?
      AND (source_service = '*' OR source_service = ?)
      ORDER BY priority DESC
    `,
			)
			.all(destinationService, sourceService) as DbRoutingRuleRow[];

		return rows.map((row) => this.rowToRoutingRule(row));
	}

	updateRoutingRule(ruleId: string, updates: Partial<Omit<RoutingRule, "id" | "createdAt">>): boolean {
		const rule = this.getRoutingRule(ruleId);
		if (!rule) return false;

		const updated = { ...rule, ...updates };

		this.db
			.prepare(
				`
      UPDATE routing_rules SET
        name = ?,
        source_service = ?,
        destination_service = ?,
        priority = ?,
        conditions = ?,
        actions = ?,
        enabled = ?
      WHERE id = ?
    `,
			)
			.run(
				updated.name,
				updated.sourceService,
				updated.destinationService,
				updated.priority,
				JSON.stringify(updated.conditions),
				JSON.stringify(updated.actions),
				updated.enabled ? 1 : 0,
				ruleId,
			);

		this.emit("routing-rule:updated", { rule: updated });
		return true;
	}

	deleteRoutingRule(ruleId: string): boolean {
		const result = this.db.prepare(`DELETE FROM routing_rules WHERE id = ?`).run(ruleId);

		if (result.changes > 0) {
			this.emit("routing-rule:deleted", { ruleId });
		}

		return result.changes > 0;
	}

	enableRoutingRule(ruleId: string): boolean {
		return this.updateRoutingRule(ruleId, { enabled: true });
	}

	disableRoutingRule(ruleId: string): boolean {
		return this.updateRoutingRule(ruleId, { enabled: false });
	}

	// ============================================================================
	// Traffic Splitting
	// ============================================================================

	createTrafficSplit(params: {
		name: string;
		service: string;
		splits: { version: string; weight: number }[];
	}): TrafficSplit {
		const id = `split_${randomUUID().slice(0, 8)}`;
		const now = Date.now();

		// Normalize weights to sum to 100
		const totalWeight = params.splits.reduce((sum, s) => sum + s.weight, 0);
		const normalizedSplits = params.splits.map((s) => ({
			version: s.version,
			weight: Math.round((s.weight / totalWeight) * 100),
		}));

		const split: TrafficSplit = {
			id,
			name: params.name,
			service: params.service,
			splits: normalizedSplits,
			enabled: true,
			createdAt: now,
		};

		this.db
			.prepare(
				`
      INSERT INTO traffic_splits (id, name, service, splits, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
			)
			.run(split.id, split.name, split.service, JSON.stringify(split.splits), 1, split.createdAt);

		this.emit("traffic-split:created", { split });
		return split;
	}

	getTrafficSplit(service: string): TrafficSplit | null {
		const row = this.db.prepare(`SELECT * FROM traffic_splits WHERE service = ? AND enabled = 1`).get(service) as
			| DbTrafficSplitRow
			| undefined;

		if (!row) return null;
		return this.rowToTrafficSplit(row);
	}

	updateTrafficSplit(splitId: string, splits: { version: string; weight: number }[]): boolean {
		const totalWeight = splits.reduce((sum, s) => sum + s.weight, 0);
		const normalizedSplits = splits.map((s) => ({
			version: s.version,
			weight: Math.round((s.weight / totalWeight) * 100),
		}));

		const result = this.db
			.prepare(`UPDATE traffic_splits SET splits = ? WHERE id = ?`)
			.run(JSON.stringify(normalizedSplits), splitId);

		if (result.changes > 0) {
			this.emit("traffic-split:updated", { splitId, splits: normalizedSplits });
		}

		return result.changes > 0;
	}

	deleteTrafficSplit(splitId: string): boolean {
		const result = this.db.prepare(`DELETE FROM traffic_splits WHERE id = ?`).run(splitId);

		if (result.changes > 0) {
			this.emit("traffic-split:deleted", { splitId });
		}

		return result.changes > 0;
	}

	// ============================================================================
	// Service Communication
	// ============================================================================

	selectEndpoint(serviceId: string, sourceService?: string): ServiceEndpoint | null {
		const service = this.getService(serviceId);
		if (!service) return null;

		// Check circuit breaker
		const circuitState = this.circuitBreakers.get(serviceId);
		if (circuitState?.state === "open") {
			if (Date.now() - circuitState.lastStateChange < 30000) {
				this.emit("circuit:rejected", { serviceId });
				return null;
			}
			// Transition to half-open
			this.updateCircuitState(serviceId, "half_open");
		}

		// Check rate limit
		if (sourceService && !this.checkRateLimit(sourceService, serviceId)) {
			this.emit("rate-limit:exceeded", { sourceService, destinationService: serviceId });
			return null;
		}

		// Get healthy endpoints
		let healthyEndpoints = service.endpoints.filter((ep) => ep.isHealthy);
		if (healthyEndpoints.length === 0) {
			return null;
		}

		// Apply traffic split if exists
		const trafficSplit = this.getTrafficSplit(serviceId);
		if (trafficSplit) {
			const selectedVersion = this.selectVersionFromSplit(trafficSplit);
			if (selectedVersion) {
				const versionEndpoints = healthyEndpoints.filter((ep) => ep.version === selectedVersion);
				if (versionEndpoints.length > 0) {
					healthyEndpoints = versionEndpoints;
				}
			}
		}

		// Apply load balancing
		return this.applyLoadBalancing(service.loadBalanceStrategy, serviceId, healthyEndpoints);
	}

	private selectVersionFromSplit(split: TrafficSplit): string | null {
		const random = Math.random() * 100;
		let cumulative = 0;

		for (const s of split.splits) {
			cumulative += s.weight;
			if (random < cumulative) {
				return s.version;
			}
		}

		return split.splits[split.splits.length - 1]?.version ?? null;
	}

	private applyLoadBalancing(
		strategy: LoadBalanceStrategy,
		serviceId: string,
		endpoints: ServiceEndpoint[],
	): ServiceEndpoint {
		switch (strategy) {
			case "round_robin": {
				const counter = this.endpointCounters.get(serviceId) ?? 0;
				const endpoint = endpoints[counter % endpoints.length];
				this.endpointCounters.set(serviceId, counter + 1);
				return endpoint;
			}

			case "least_connections": {
				// In a real implementation, track active connections per endpoint
				return endpoints.reduce((min, ep) =>
					(ep.metadata.connections ?? 0) < (min.metadata.connections ?? 0) ? ep : min,
				);
			}

			case "weighted": {
				const totalWeight = endpoints.reduce((sum, ep) => sum + ep.weight, 0);
				let random = Math.random() * totalWeight;
				for (const ep of endpoints) {
					random -= ep.weight;
					if (random <= 0) return ep;
				}
				return endpoints[endpoints.length - 1];
			}

			case "random": {
				return endpoints[Math.floor(Math.random() * endpoints.length)];
			}

			case "ip_hash": {
				// In a real implementation, hash the source IP
				const hash = serviceId.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0);
				return endpoints[hash % endpoints.length];
			}

			default:
				return endpoints[0];
		}
	}

	routeRequest(params: {
		sourceService: string;
		destinationService: string;
		method: string;
		path: string;
		headers?: Record<string, string>;
		correlationId?: string;
		parentSpanId?: string;
	}): { endpoint: ServiceEndpoint; request: ServiceRequest; routeActions: RouteAction } | null {
		const correlationId = params.correlationId ?? randomUUID();
		const now = Date.now();

		// Get applicable routing rules
		const rules = this.getRoutingRules(params.sourceService, params.destinationService);
		let appliedActions: RouteAction = {};

		// Evaluate routing rules
		for (const rule of rules) {
			if (this.evaluateConditions(rule.conditions, params)) {
				appliedActions = { ...appliedActions, ...rule.actions };
				break; // Use first matching rule
			}
		}

		// Determine destination version
		let destinationVersion: string | undefined;
		if (appliedActions.destinationVersion) {
			destinationVersion = appliedActions.destinationVersion;
		} else if (appliedActions.weightDistribution) {
			destinationVersion = this.selectFromWeightDistribution(appliedActions.weightDistribution);
		}

		// Apply fault injection if configured
		if (appliedActions.faultInjection?.enabled) {
			const fi = appliedActions.faultInjection;
			if (fi.abort && Math.random() * 100 < fi.abort.percent) {
				const request = this.createRequest(params, correlationId, now, destinationVersion, false);
				request.statusCode = fi.abort.httpStatus;
				request.error = "Fault injection: abort";
				request.completedAt = now;
				request.durationMs = 0;
				this.saveRequest(request);
				this.emit("fault:injected", { type: "abort", request });
				return null;
			}

			if (fi.delay && Math.random() * 100 < fi.delay.percent) {
				// In a real implementation, this would add actual delay
				this.emit("fault:injected", { type: "delay", durationMs: fi.delay.durationMs });
			}
		}

		// Select endpoint
		const endpoint = this.selectEndpointWithVersion(
			params.destinationService,
			destinationVersion,
			params.sourceService,
		);

		if (!endpoint) {
			const request = this.createRequest(params, correlationId, now, destinationVersion, false);
			request.error = "No healthy endpoint available";
			request.completedAt = now;
			request.durationMs = 0;
			this.saveRequest(request);
			return null;
		}

		// Create request record
		const request = this.createRequest(params, correlationId, now, destinationVersion, false);

		// Add headers from routing action
		if (appliedActions.headers?.add) {
			request.headers = { ...request.headers, ...appliedActions.headers.add };
		}

		// Handle traffic mirroring
		if (appliedActions.mirror && Math.random() * 100 < appliedActions.mirror.percent) {
			this.mirrorRequest(params, appliedActions.mirror, correlationId);
		}

		this.saveRequest(request);

		return {
			endpoint,
			request,
			routeActions: appliedActions,
		};
	}

	private selectEndpointWithVersion(
		serviceId: string,
		version: string | undefined,
		_sourceService?: string,
	): ServiceEndpoint | null {
		const service = this.getService(serviceId);
		if (!service) return null;

		let endpoints = service.endpoints.filter((ep) => ep.isHealthy);
		if (version) {
			const versionEndpoints = endpoints.filter((ep) => ep.version === version);
			if (versionEndpoints.length > 0) {
				endpoints = versionEndpoints;
			}
		}

		if (endpoints.length === 0) return null;

		return this.applyLoadBalancing(service.loadBalanceStrategy, serviceId, endpoints);
	}

	private selectFromWeightDistribution(distribution: { version: string; weight: number }[]): string | undefined {
		const total = distribution.reduce((sum, d) => sum + d.weight, 0);
		let random = Math.random() * total;

		for (const d of distribution) {
			random -= d.weight;
			if (random <= 0) return d.version;
		}

		return distribution[distribution.length - 1]?.version;
	}

	private evaluateConditions(
		conditions: RouteCondition[],
		request: {
			method: string;
			path: string;
			headers?: Record<string, string>;
		},
	): boolean {
		if (conditions.length === 0) return true;

		for (const condition of conditions) {
			let value: string | undefined;

			switch (condition.type) {
				case "header":
					value = request.headers?.[condition.key ?? ""];
					break;
				case "path":
					value = request.path;
					break;
				case "method":
					value = request.method;
					break;
				default:
					continue;
			}

			if (!this.evaluateCondition(condition.operator, value, condition.value)) {
				return false;
			}
		}

		return true;
	}

	private evaluateCondition(operator: string, value: string | undefined, expected: string): boolean {
		if (operator === "exists") {
			return value !== undefined;
		}

		if (value === undefined) return false;

		switch (operator) {
			case "equals":
				return value === expected;
			case "contains":
				return value.includes(expected);
			case "regex":
				return new RegExp(expected).test(value);
			case "gt":
				return parseFloat(value) > parseFloat(expected);
			case "lt":
				return parseFloat(value) < parseFloat(expected);
			default:
				return false;
		}
	}

	private createRequest(
		params: {
			sourceService: string;
			destinationService: string;
			method: string;
			path: string;
			headers?: Record<string, string>;
			parentSpanId?: string;
		},
		correlationId: string,
		startedAt: number,
		destinationVersion: string | undefined,
		isMirrored: boolean,
	): ServiceRequest {
		return {
			id: `req_${randomUUID().slice(0, 12)}`,
			correlationId,
			parentSpanId: params.parentSpanId,
			sourceService: params.sourceService,
			destinationService: params.destinationService,
			destinationVersion,
			method: params.method,
			path: params.path,
			headers: params.headers ?? {},
			startedAt,
			retryCount: 0,
			isMirrored,
		};
	}

	private mirrorRequest(
		params: {
			sourceService: string;
			destinationService: string;
			method: string;
			path: string;
			headers?: Record<string, string>;
		},
		mirror: MirrorConfig,
		correlationId: string,
	): void {
		const mirroredRequest = this.createRequest(
			{
				...params,
				destinationService: mirror.destinationService,
			},
			correlationId,
			Date.now(),
			mirror.destinationVersion,
			true,
		);

		this.saveRequest(mirroredRequest);
		this.emit("request:mirrored", { request: mirroredRequest, originalDestination: params.destinationService });
	}

	completeRequest(requestId: string, statusCode: number, error?: string): void {
		const now = Date.now();
		const row = this.db.prepare(`SELECT * FROM service_requests WHERE id = ?`).get(requestId) as
			| DbServiceRequestRow
			| undefined;

		if (!row) return;

		const durationMs = now - row.started_at;

		this.db
			.prepare(
				`
      UPDATE service_requests
      SET completed_at = ?, duration_ms = ?, status_code = ?, error = ?
      WHERE id = ?
    `,
			)
			.run(now, durationMs, statusCode, error ?? null, requestId);

		// Update metrics
		this.recordMetrics(row.destination_service, statusCode >= 200 && statusCode < 400, durationMs);

		// Update circuit breaker
		if (statusCode >= 500 || error) {
			this.recordCircuitFailure(row.destination_service);
		} else {
			this.recordCircuitSuccess(row.destination_service);
		}

		this.emit("request:completed", {
			requestId,
			destinationService: row.destination_service,
			statusCode,
			durationMs,
			error,
		});
	}

	private saveRequest(request: ServiceRequest): void {
		this.db
			.prepare(
				`
      INSERT INTO service_requests (id, correlation_id, parent_span_id, source_service, destination_service, destination_version, method, path, headers, started_at, completed_at, duration_ms, status_code, error, retry_count, is_mirrored)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
			)
			.run(
				request.id,
				request.correlationId,
				request.parentSpanId ?? null,
				request.sourceService,
				request.destinationService,
				request.destinationVersion ?? null,
				request.method,
				request.path,
				JSON.stringify(request.headers),
				request.startedAt,
				request.completedAt ?? null,
				request.durationMs ?? null,
				request.statusCode ?? null,
				request.error ?? null,
				request.retryCount,
				request.isMirrored ? 1 : 0,
			);
	}

	// ============================================================================
	// Circuit Breaker
	// ============================================================================

	initCircuitBreaker(serviceId: string, config?: Partial<CircuitBreakerConfig>): void {
		const now = Date.now();

		this.db
			.prepare(
				`
      INSERT INTO circuit_breakers (service_id, failure_threshold, success_threshold, timeout_ms, half_open_max_calls, state, last_state_change)
      VALUES (?, ?, ?, ?, ?, 'closed', ?)
      ON CONFLICT(service_id) DO NOTHING
    `,
			)
			.run(
				serviceId,
				config?.failureThreshold ?? 5,
				config?.successThreshold ?? 3,
				config?.timeoutMs ?? 30000,
				config?.halfOpenMaxCalls ?? 3,
				now,
			);

		this.circuitBreakers.set(serviceId, {
			serviceId,
			state: "closed",
			failureCount: 0,
			successCount: 0,
			lastStateChange: now,
			halfOpenCallCount: 0,
		});
	}

	getCircuitBreakerState(serviceId: string): CircuitBreakerState | null {
		return this.circuitBreakers.get(serviceId) ?? null;
	}

	private recordCircuitFailure(serviceId: string): void {
		const state = this.circuitBreakers.get(serviceId);
		if (!state) return;

		state.failureCount++;
		state.lastFailureAt = Date.now();
		state.successCount = 0;

		// Check if we should open the circuit
		const config = this.getCircuitBreakerConfig(serviceId);
		if (state.failureCount >= config.failureThreshold) {
			this.updateCircuitState(serviceId, "open");
		}

		this.saveCircuitState(state);
	}

	private recordCircuitSuccess(serviceId: string): void {
		const state = this.circuitBreakers.get(serviceId);
		if (!state) return;

		if (state.state === "half_open") {
			state.successCount++;
			state.halfOpenCallCount++;

			const config = this.getCircuitBreakerConfig(serviceId);
			if (state.successCount >= config.successThreshold) {
				this.updateCircuitState(serviceId, "closed");
			}
		}

		state.failureCount = Math.max(0, state.failureCount - 1);
		this.saveCircuitState(state);
	}

	private updateCircuitState(serviceId: string, newState: CircuitState): void {
		const state = this.circuitBreakers.get(serviceId);
		if (!state) return;

		const oldState = state.state;
		state.state = newState;
		state.lastStateChange = Date.now();

		if (newState === "closed") {
			state.failureCount = 0;
			state.successCount = 0;
		} else if (newState === "half_open") {
			state.halfOpenCallCount = 0;
		}

		this.saveCircuitState(state);
		this.emit("circuit:state-changed", { serviceId, oldState, newState });
	}

	private getCircuitBreakerConfig(serviceId: string): CircuitBreakerConfig {
		const row = this.db.prepare(`SELECT * FROM circuit_breakers WHERE service_id = ?`).get(serviceId) as
			| DbCircuitBreakerRow
			| undefined;

		if (!row) {
			return {
				serviceId,
				failureThreshold: 5,
				successThreshold: 3,
				timeoutMs: 30000,
				halfOpenMaxCalls: 3,
			};
		}

		return {
			serviceId: row.service_id,
			failureThreshold: row.failure_threshold,
			successThreshold: row.success_threshold,
			timeoutMs: row.timeout_ms,
			halfOpenMaxCalls: row.half_open_max_calls,
		};
	}

	private saveCircuitState(state: CircuitBreakerState): void {
		this.db
			.prepare(
				`
      UPDATE circuit_breakers SET
        state = ?,
        failure_count = ?,
        success_count = ?,
        last_failure_at = ?,
        last_state_change = ?
      WHERE service_id = ?
    `,
			)
			.run(
				state.state,
				state.failureCount,
				state.successCount,
				state.lastFailureAt ?? null,
				state.lastStateChange,
				state.serviceId,
			);
	}

	resetCircuitBreaker(serviceId: string): void {
		this.updateCircuitState(serviceId, "closed");
	}

	// ============================================================================
	// Rate Limiting
	// ============================================================================

	setRateLimit(
		sourceService: string,
		destinationService: string,
		requestsPerSecond: number,
		burstSize: number = 10,
	): void {
		this.db
			.prepare(
				`
      INSERT INTO rate_limits (id, source_service, destination_service, requests_per_second, burst_size)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_service, destination_service) DO UPDATE SET
        requests_per_second = excluded.requests_per_second,
        burst_size = excluded.burst_size
    `,
			)
			.run(
				`rl_${sourceService}_${destinationService}`,
				sourceService,
				destinationService,
				requestsPerSecond,
				burstSize,
			);
	}

	private checkRateLimit(sourceService: string, destinationService: string): boolean {
		const key = `${sourceService}:${destinationService}`;
		const limit = this.getRateLimitConfig(sourceService, destinationService);
		if (!limit) return true;

		const now = Date.now();
		let state = this.rateLimitStates.get(key);

		if (!state) {
			state = { key, tokens: limit.burstSize, lastRefill: now };
			this.rateLimitStates.set(key, state);
		}

		// Refill tokens
		const elapsedSeconds = (now - state.lastRefill) / 1000;
		const refill = elapsedSeconds * limit.requestsPerSecond;
		state.tokens = Math.min(limit.burstSize, state.tokens + refill);
		state.lastRefill = now;

		// Check if we have tokens
		if (state.tokens >= 1) {
			state.tokens -= 1;
			return true;
		}

		return false;
	}

	private getRateLimitConfig(sourceService: string, destinationService: string): RateLimitConfig | null {
		const row = this.db
			.prepare(
				`
      SELECT * FROM rate_limits
      WHERE (source_service = ? OR source_service = '*') AND destination_service = ?
      ORDER BY CASE WHEN source_service = '*' THEN 1 ELSE 0 END
      LIMIT 1
    `,
			)
			.get(sourceService, destinationService) as
			| { source_service: string; destination_service: string; requests_per_second: number; burst_size: number }
			| undefined;

		if (!row) return null;

		return {
			sourceService: row.source_service,
			destinationService: row.destination_service,
			requestsPerSecond: row.requests_per_second,
			burstSize: row.burst_size,
		};
	}

	// ============================================================================
	// mTLS / Trust
	// ============================================================================

	checkTrust(sourceServiceId: string, destinationServiceId: string): boolean {
		if (!this.config.enableMtls) return true;

		const source = this.getService(sourceServiceId);
		const destination = this.getService(destinationServiceId);

		if (!source || !destination) return false;

		const trustHierarchy: TrustLevel[] = ["untrusted", "basic", "verified", "trusted", "system"];
		const sourceLevel = trustHierarchy.indexOf(source.trustLevel);
		const destLevel = trustHierarchy.indexOf(destination.trustLevel);

		// System can access anything
		if (source.trustLevel === "system") return true;

		// Higher trust can access lower trust
		return sourceLevel >= destLevel;
	}

	setServiceTrustLevel(serviceId: string, trustLevel: TrustLevel): boolean {
		const result = this.db
			.prepare(`UPDATE services SET trust_level = ?, updated_at = ? WHERE id = ?`)
			.run(trustLevel, Date.now(), serviceId);

		if (result.changes > 0) {
			this.emit("service:trust-changed", { serviceId, trustLevel });
		}

		return result.changes > 0;
	}

	// ============================================================================
	// Health Checks
	// ============================================================================

	private startHealthChecks(service: ServiceDefinition): void {
		this.stopHealthChecks(service.id);

		const timer = setInterval(() => {
			this.performHealthChecks(service.id);
		}, service.healthCheckIntervalMs);

		this.healthCheckTimers.set(service.id, timer);

		// Perform initial check
		this.performHealthChecks(service.id);
	}

	private stopHealthChecks(serviceId: string): void {
		const timer = this.healthCheckTimers.get(serviceId);
		if (timer) {
			clearInterval(timer);
			this.healthCheckTimers.delete(serviceId);
		}
	}

	private async performHealthChecks(serviceId: string): Promise<void> {
		const service = this.getService(serviceId);
		if (!service) return;

		for (const endpoint of service.endpoints) {
			// In a real implementation, this would make actual HTTP/TCP health check requests
			// For now, we simulate based on the endpoint configuration
			const isHealthy = endpoint.healthCheckPath
				? Math.random() > 0.05 // 95% health rate simulation
				: true;

			this.updateEndpointHealth(serviceId, endpoint.id, isHealthy);
		}

		this.emit("health-check:completed", { serviceId });
	}

	// ============================================================================
	// Metrics
	// ============================================================================

	private recordMetrics(serviceId: string, success: boolean, latencyMs: number): void {
		const now = Date.now();
		const metricsId = `m_${serviceId}_${Math.floor(now / 60000)}`;

		this.db
			.prepare(
				`
      INSERT INTO service_metrics (id, service_id, timestamp, request_count, success_count, failure_count, total_latency_ms)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        request_count = request_count + 1,
        success_count = success_count + ?,
        failure_count = failure_count + ?,
        total_latency_ms = total_latency_ms + ?
    `,
			)
			.run(
				metricsId,
				serviceId,
				now,
				success ? 1 : 0,
				success ? 0 : 1,
				latencyMs,
				success ? 1 : 0,
				success ? 0 : 1,
				latencyMs,
			);

		// Update latency histogram
		if (!this.latencyHistograms.has(serviceId)) {
			this.latencyHistograms.set(serviceId, []);
		}
		const histogram = this.latencyHistograms.get(serviceId)!;
		histogram.push(latencyMs);
		if (histogram.length > 1000) {
			histogram.shift();
		}
	}

	getServiceMetrics(serviceId: string): ServiceMetrics {
		const cached = this.metricsCache.get(serviceId);
		if (cached && Date.now() - cached.lastUpdated < 5000) {
			return cached;
		}

		const cutoff = Date.now() - 300000; // Last 5 minutes
		const rows = this.db
			.prepare(
				`
      SELECT
        SUM(request_count) as request_count,
        SUM(success_count) as success_count,
        SUM(failure_count) as failure_count,
        SUM(total_latency_ms) as total_latency_ms
      FROM service_metrics
      WHERE service_id = ? AND timestamp > ?
    `,
			)
			.get(serviceId, cutoff) as {
			request_count: number | null;
			success_count: number | null;
			failure_count: number | null;
			total_latency_ms: number | null;
		};

		const requestCount = rows.request_count ?? 0;
		const successCount = rows.success_count ?? 0;
		const failureCount = rows.failure_count ?? 0;
		const totalLatencyMs = rows.total_latency_ms ?? 0;

		// Calculate percentiles from histogram
		const histogram = this.latencyHistograms.get(serviceId) ?? [];
		const sorted = [...histogram].sort((a, b) => a - b);
		const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
		const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
		const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;

		const metrics: ServiceMetrics = {
			serviceId,
			requestCount,
			successCount,
			failureCount,
			avgLatencyMs: requestCount > 0 ? Math.round(totalLatencyMs / requestCount) : 0,
			p50LatencyMs: Math.round(p50),
			p95LatencyMs: Math.round(p95),
			p99LatencyMs: Math.round(p99),
			activeConnections: 0, // Would need external tracking
			requestsPerSecond: requestCount / 300, // 5 min window
			errorRate: requestCount > 0 ? failureCount / requestCount : 0,
			lastUpdated: Date.now(),
		};

		this.metricsCache.set(serviceId, metrics);
		return metrics;
	}

	// ============================================================================
	// Request Tracing
	// ============================================================================

	getRequestTrace(correlationId: string): ServiceRequest[] {
		const rows = this.db
			.prepare(
				`
      SELECT * FROM service_requests
      WHERE correlation_id = ?
      ORDER BY started_at ASC
    `,
			)
			.all(correlationId) as DbServiceRequestRow[];

		return rows.map((row) => this.rowToServiceRequest(row));
	}

	getRequestsByService(serviceId: string, limit: number = 100): ServiceRequest[] {
		const rows = this.db
			.prepare(
				`
      SELECT * FROM service_requests
      WHERE destination_service = ?
      ORDER BY started_at DESC
      LIMIT ?
    `,
			)
			.all(serviceId, limit) as DbServiceRequestRow[];

		return rows.map((row) => this.rowToServiceRequest(row));
	}

	// ============================================================================
	// Dependency Tracking
	// ============================================================================

	getServiceDependencies(serviceId: string): ServiceDefinition[] {
		const service = this.getService(serviceId);
		if (!service) return [];

		const deps: ServiceDefinition[] = [];
		for (const depId of service.dependencies) {
			const dep = this.getService(depId);
			if (dep) deps.push(dep);
		}
		return deps;
	}

	getDependentServices(serviceId: string): ServiceDefinition[] {
		const rows = this.db
			.prepare(
				`
      SELECT * FROM services WHERE dependencies LIKE ?
    `,
			)
			.all(`%"${serviceId}"%`) as DbServiceRow[];

		return rows.map((row) => this.rowToService(row));
	}

	// ============================================================================
	// Statistics
	// ============================================================================

	getStats(): ServiceMeshStats {
		const serviceStats = this.db
			.prepare(
				`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online,
        SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as offline,
        SUM(CASE WHEN status = 'degraded' THEN 1 ELSE 0 END) as degraded
      FROM services
    `,
			)
			.get() as { total: number; online: number; offline: number; degraded: number };

		const endpointStats = this.db.prepare(`SELECT endpoints FROM services`).all() as { endpoints: string }[];

		let totalEndpoints = 0;
		let healthyEndpoints = 0;
		for (const row of endpointStats) {
			const endpoints = JSON.parse(row.endpoints) as ServiceEndpoint[];
			totalEndpoints += endpoints.length;
			healthyEndpoints += endpoints.filter((ep) => ep.isHealthy).length;
		}

		const routingStats = this.db
			.prepare(
				`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled
      FROM routing_rules
    `,
			)
			.get() as { total: number; enabled: number };

		const splitStats = this.db.prepare(`SELECT COUNT(*) as total FROM traffic_splits WHERE enabled = 1`).get() as {
			total: number;
		};

		const openCircuits = Array.from(this.circuitBreakers.values()).filter((cb) => cb.state === "open").length;

		// Calculate average RPS and error rate
		const services = this.listServices({ status: "online" });
		let totalRps = 0;
		let totalErrorRate = 0;
		for (const service of services) {
			const metrics = this.getServiceMetrics(service.id);
			totalRps += metrics.requestsPerSecond;
			totalErrorRate += metrics.errorRate;
		}

		return {
			totalServices: serviceStats.total,
			onlineServices: serviceStats.online,
			offlineServices: serviceStats.offline,
			degradedServices: serviceStats.degraded,
			totalEndpoints,
			healthyEndpoints,
			totalRoutingRules: routingStats.total,
			enabledRoutingRules: routingStats.enabled,
			totalTrafficSplits: splitStats.total,
			openCircuits,
			avgRequestsPerSecond: services.length > 0 ? totalRps / services.length : 0,
			avgErrorRate: services.length > 0 ? totalErrorRate / services.length : 0,
		};
	}

	// ============================================================================
	// Cleanup
	// ============================================================================

	private cleanup(): void {
		const now = Date.now();
		const metricsCutoff = now - this.config.metricsRetentionMs;
		const traceCutoff = now - this.config.traceRetentionMs;

		this.db.prepare(`DELETE FROM service_metrics WHERE timestamp < ?`).run(metricsCutoff);
		this.db.prepare(`DELETE FROM service_requests WHERE started_at < ?`).run(traceCutoff);

		// Clean up latency histograms
		for (const [serviceId, histogram] of this.latencyHistograms.entries()) {
			if (histogram.length > 500) {
				this.latencyHistograms.set(serviceId, histogram.slice(-500));
			}
		}

		this.emit("cleanup:completed", { metricsCutoff, traceCutoff });
	}

	// ============================================================================
	// Row Converters
	// ============================================================================

	private rowToService(row: DbServiceRow): ServiceDefinition {
		return {
			id: row.id,
			name: row.name,
			namespace: row.namespace,
			description: row.description,
			version: row.version,
			status: row.status as ServiceStatus,
			endpoints: JSON.parse(row.endpoints),
			tags: JSON.parse(row.tags),
			trustLevel: row.trust_level as TrustLevel,
			dependencies: JSON.parse(row.dependencies),
			loadBalanceStrategy: row.load_balance_strategy as LoadBalanceStrategy,
			healthCheckIntervalMs: row.health_check_interval_ms,
			registeredAt: row.registered_at,
			updatedAt: row.updated_at,
		};
	}

	private rowToRoutingRule(row: DbRoutingRuleRow): RoutingRule {
		return {
			id: row.id,
			name: row.name,
			sourceService: row.source_service,
			destinationService: row.destination_service,
			priority: row.priority,
			conditions: JSON.parse(row.conditions),
			actions: JSON.parse(row.actions),
			enabled: row.enabled === 1,
			createdAt: row.created_at,
		};
	}

	private rowToTrafficSplit(row: DbTrafficSplitRow): TrafficSplit {
		return {
			id: row.id,
			name: row.name,
			service: row.service,
			splits: JSON.parse(row.splits),
			enabled: row.enabled === 1,
			createdAt: row.created_at,
		};
	}

	private rowToServiceRequest(row: DbServiceRequestRow): ServiceRequest {
		return {
			id: row.id,
			correlationId: row.correlation_id,
			parentSpanId: row.parent_span_id ?? undefined,
			sourceService: row.source_service,
			destinationService: row.destination_service,
			destinationVersion: row.destination_version ?? undefined,
			method: row.method,
			path: row.path,
			headers: JSON.parse(row.headers),
			startedAt: row.started_at,
			completedAt: row.completed_at ?? undefined,
			durationMs: row.duration_ms ?? undefined,
			statusCode: row.status_code ?? undefined,
			error: row.error ?? undefined,
			retryCount: row.retry_count,
			isMirrored: row.is_mirrored === 1,
		};
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	close(): void {
		// Stop all health check timers
		for (const [serviceId] of this.healthCheckTimers) {
			this.stopHealthChecks(serviceId);
		}

		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = undefined;
		}

		this.db.close();
		this.emit("system:closed");
	}
}

// ============================================================================
// Internal Types
// ============================================================================

interface DbServiceRow {
	id: string;
	name: string;
	namespace: string;
	description: string;
	version: string;
	status: string;
	endpoints: string;
	tags: string;
	trust_level: string;
	dependencies: string;
	load_balance_strategy: string;
	health_check_interval_ms: number;
	registered_at: number;
	updated_at: number;
}

interface DbRoutingRuleRow {
	id: string;
	name: string;
	source_service: string;
	destination_service: string;
	priority: number;
	conditions: string;
	actions: string;
	enabled: number;
	created_at: number;
}

interface DbTrafficSplitRow {
	id: string;
	name: string;
	service: string;
	splits: string;
	enabled: number;
	created_at: number;
}

interface DbServiceRequestRow {
	id: string;
	correlation_id: string;
	parent_span_id: string | null;
	source_service: string;
	destination_service: string;
	destination_version: string | null;
	method: string;
	path: string;
	headers: string;
	started_at: number;
	completed_at: number | null;
	duration_ms: number | null;
	status_code: number | null;
	error: string | null;
	retry_count: number;
	is_mirrored: number;
}

interface DbCircuitBreakerRow {
	service_id: string;
	failure_threshold: number;
	success_threshold: number;
	timeout_ms: number;
	half_open_max_calls: number;
	state: string;
	failure_count: number;
	success_count: number;
	last_failure_at: number | null;
	last_state_change: number;
}

// ============================================================================
// Singleton Factory
// ============================================================================

let instance: ServiceMeshSystem | null = null;

export function getServiceMesh(dataDir: string, config?: Partial<ServiceMeshConfig>): ServiceMeshSystem {
	if (!instance) {
		instance = new ServiceMeshSystem(dataDir, config);
	}
	return instance;
}

export function resetServiceMesh(): void {
	if (instance) {
		instance.close();
		instance = null;
	}
}
