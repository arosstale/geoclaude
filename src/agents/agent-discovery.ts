/**
 * Class 3.13: Agent Discovery System
 * TAC Pattern: Dynamic agent registration and capability-based discovery
 *
 * Provides agent registration and discovery:
 * - Dynamic agent registration with capabilities
 * - Capability-based agent discovery
 * - Agent health status tracking
 * - Load balancing across similar agents
 * - Agent dependency resolution
 * - Service mesh patterns for agent communication
 */

import Database from "better-sqlite3";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

export type AgentStatus = "online" | "offline" | "busy" | "degraded" | "maintenance";

export interface AgentCapability {
	name: string;
	version: string;
	description: string;
	inputTypes: string[];
	outputTypes: string[];
	cost: number; // Relative cost 1-10
	latency: number; // Expected latency in ms
}

export interface RegisteredAgent {
	id: string;
	name: string;
	description: string;
	status: AgentStatus;
	capabilities: AgentCapability[];
	endpoints: AgentEndpoint[];
	metadata: Record<string, unknown>;
	tags: string[];
	priority: number; // Higher = preferred
	maxConcurrency: number;
	currentLoad: number;
	registeredAt: number;
	lastHeartbeat: number;
	healthScore: number; // 0-100
	dependencies: string[]; // Other agent IDs this depends on
}

export interface AgentEndpoint {
	type: "http" | "grpc" | "websocket" | "internal";
	url: string;
	healthCheck?: string;
}

export interface DiscoveryQuery {
	capability?: string;
	capabilityVersion?: string;
	tags?: string[];
	status?: AgentStatus[];
	minHealthScore?: number;
	maxLatency?: number;
	maxCost?: number;
	excludeAgents?: string[];
}

export interface DiscoveryResult {
	agents: RegisteredAgent[];
	totalMatches: number;
	query: DiscoveryQuery;
	timestamp: number;
}

export interface HealthCheckResult {
	agentId: string;
	healthy: boolean;
	latency: number;
	message?: string;
	checkedAt: number;
}

export interface DiscoveryConfig {
	heartbeatTimeoutMs: number; // Mark offline after this
	healthCheckIntervalMs: number;
	maxAgentsPerQuery: number;
	enableLoadBalancing: boolean;
	preferLocalAgents: boolean;
}

export interface DiscoveryStats {
	totalAgents: number;
	onlineAgents: number;
	offlineAgents: number;
	busyAgents: number;
	degradedAgents: number;
	totalCapabilities: number;
	uniqueCapabilities: number;
	avgHealthScore: number;
	queriesPerMinute: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: DiscoveryConfig = {
	heartbeatTimeoutMs: 60000, // 1 minute
	healthCheckIntervalMs: 30000, // 30 seconds
	maxAgentsPerQuery: 50,
	enableLoadBalancing: true,
	preferLocalAgents: true,
};

// ============================================================================
// Agent Discovery System
// ============================================================================

export class AgentDiscoverySystem extends EventEmitter {
	private db: Database.Database;
	private config: DiscoveryConfig;
	private healthCheckTimer?: NodeJS.Timeout;
	private queryCount = 0;
	private queryCountResetTime = Date.now();

	constructor(dataDir: string, config: Partial<DiscoveryConfig> = {}) {
		super();
		this.config = { ...DEFAULT_CONFIG, ...config };

		const dbPath = path.join(dataDir, "agent-discovery.db");
		fs.mkdirSync(dataDir, { recursive: true });

		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL");
		this.initSchema();

		this.startHealthCheckTimer();
	}

	private initSchema(): void {
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'offline',
        capabilities TEXT NOT NULL DEFAULT '[]',
        endpoints TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        tags TEXT NOT NULL DEFAULT '[]',
        priority INTEGER NOT NULL DEFAULT 5,
        max_concurrency INTEGER NOT NULL DEFAULT 10,
        current_load INTEGER NOT NULL DEFAULT 0,
        registered_at INTEGER NOT NULL,
        last_heartbeat INTEGER NOT NULL,
        health_score INTEGER NOT NULL DEFAULT 100,
        dependencies TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS health_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        healthy INTEGER NOT NULL,
        latency INTEGER NOT NULL,
        message TEXT,
        checked_at INTEGER NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
      CREATE INDEX IF NOT EXISTS idx_agents_health ON agents(health_score);
      CREATE INDEX IF NOT EXISTS idx_agents_heartbeat ON agents(last_heartbeat);
      CREATE INDEX IF NOT EXISTS idx_health_agent ON health_checks(agent_id);
      CREATE INDEX IF NOT EXISTS idx_health_time ON health_checks(checked_at DESC);
    `);
	}

	private startHealthCheckTimer(): void {
		this.healthCheckTimer = setInterval(() => {
			this.checkHeartbeatTimeouts();
		}, this.config.healthCheckIntervalMs);
	}

	private stopHealthCheckTimer(): void {
		if (this.healthCheckTimer) {
			clearInterval(this.healthCheckTimer);
			this.healthCheckTimer = undefined;
		}
	}

	/**
	 * Check for agents that have missed heartbeats
	 */
	private checkHeartbeatTimeouts(): void {
		const cutoff = Date.now() - this.config.heartbeatTimeoutMs;

		const timedOut = this.db
			.prepare(
				`
      SELECT id FROM agents
      WHERE status = 'online' AND last_heartbeat < ?
    `,
			)
			.all(cutoff) as Array<{ id: string }>;

		for (const { id } of timedOut) {
			this.updateAgentStatus(id, "offline");
			this.emit("agent:timeout", { agentId: id });
		}
	}

	/**
	 * Register a new agent or update existing
	 */
	registerAgent(params: {
		id: string;
		name: string;
		description?: string;
		capabilities?: AgentCapability[];
		endpoints?: AgentEndpoint[];
		metadata?: Record<string, unknown>;
		tags?: string[];
		priority?: number;
		maxConcurrency?: number;
		dependencies?: string[];
	}): RegisteredAgent {
		const now = Date.now();

		const agent: RegisteredAgent = {
			id: params.id,
			name: params.name,
			description: params.description ?? "",
			status: "online",
			capabilities: params.capabilities ?? [],
			endpoints: params.endpoints ?? [],
			metadata: params.metadata ?? {},
			tags: params.tags ?? [],
			priority: params.priority ?? 5,
			maxConcurrency: params.maxConcurrency ?? 10,
			currentLoad: 0,
			registeredAt: now,
			lastHeartbeat: now,
			healthScore: 100,
			dependencies: params.dependencies ?? [],
		};

		this.db
			.prepare(
				`
      INSERT INTO agents (id, name, description, status, capabilities, endpoints, metadata, tags, priority, max_concurrency, current_load, registered_at, last_heartbeat, health_score, dependencies)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        status = 'online',
        capabilities = excluded.capabilities,
        endpoints = excluded.endpoints,
        metadata = excluded.metadata,
        tags = excluded.tags,
        priority = excluded.priority,
        max_concurrency = excluded.max_concurrency,
        last_heartbeat = excluded.last_heartbeat,
        dependencies = excluded.dependencies
    `,
			)
			.run(
				agent.id,
				agent.name,
				agent.description,
				agent.status,
				JSON.stringify(agent.capabilities),
				JSON.stringify(agent.endpoints),
				JSON.stringify(agent.metadata),
				JSON.stringify(agent.tags),
				agent.priority,
				agent.maxConcurrency,
				agent.currentLoad,
				agent.registeredAt,
				agent.lastHeartbeat,
				agent.healthScore,
				JSON.stringify(agent.dependencies),
			);

		this.emit("agent:registered", { agent });
		return agent;
	}

	/**
	 * Unregister an agent
	 */
	unregisterAgent(agentId: string): boolean {
		const result = this.db.prepare(`DELETE FROM agents WHERE id = ?`).run(agentId);

		if (result.changes > 0) {
			this.emit("agent:unregistered", { agentId });
		}

		return result.changes > 0;
	}

	/**
	 * Send heartbeat for an agent
	 */
	heartbeat(agentId: string, load?: number): boolean {
		const now = Date.now();
		const updates: string[] = ["last_heartbeat = ?"];
		const params: unknown[] = [now];

		if (load !== undefined) {
			updates.push("current_load = ?");
			params.push(load);
		}

		// Also set status to online if it was offline
		updates.push("status = CASE WHEN status = 'offline' THEN 'online' ELSE status END");

		params.push(agentId);

		const result = this.db.prepare(`UPDATE agents SET ${updates.join(", ")} WHERE id = ?`).run(...params);

		return result.changes > 0;
	}

	/**
	 * Update agent status
	 */
	updateAgentStatus(agentId: string, status: AgentStatus): boolean {
		const result = this.db.prepare(`UPDATE agents SET status = ? WHERE id = ?`).run(status, agentId);

		if (result.changes > 0) {
			this.emit("agent:status-changed", { agentId, status });
		}

		return result.changes > 0;
	}

	/**
	 * Record health check result
	 */
	recordHealthCheck(result: HealthCheckResult): void {
		this.db
			.prepare(
				`
      INSERT INTO health_checks (agent_id, healthy, latency, message, checked_at)
      VALUES (?, ?, ?, ?, ?)
    `,
			)
			.run(result.agentId, result.healthy ? 1 : 0, result.latency, result.message ?? null, result.checkedAt);

		// Update agent health score based on recent checks
		this.updateHealthScore(result.agentId);

		// Clean up old health checks (keep last 100 per agent)
		this.db
			.prepare(
				`
      DELETE FROM health_checks
      WHERE agent_id = ? AND id NOT IN (
        SELECT id FROM health_checks
        WHERE agent_id = ?
        ORDER BY checked_at DESC
        LIMIT 100
      )
    `,
			)
			.run(result.agentId, result.agentId);
	}

	/**
	 * Update health score based on recent checks
	 */
	private updateHealthScore(agentId: string): void {
		const checks = this.db
			.prepare(
				`
      SELECT healthy, latency FROM health_checks
      WHERE agent_id = ?
      ORDER BY checked_at DESC
      LIMIT 10
    `,
			)
			.all(agentId) as Array<{ healthy: number; latency: number }>;

		if (checks.length === 0) return;

		const healthyCount = checks.filter((c) => c.healthy).length;
		const healthScore = Math.round((healthyCount / checks.length) * 100);

		this.db.prepare(`UPDATE agents SET health_score = ? WHERE id = ?`).run(healthScore, agentId);

		// Auto-degrade if health score is low
		if (healthScore < 50) {
			this.updateAgentStatus(agentId, "degraded");
		}
	}

	/**
	 * Get agent by ID
	 */
	getAgent(agentId: string): RegisteredAgent | null {
		const row = this.db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as DbAgentRow | undefined;

		if (!row) return null;

		return this.rowToAgent(row);
	}

	/**
	 * Discover agents based on query
	 */
	discover(query: DiscoveryQuery = {}): DiscoveryResult {
		this.trackQuery();

		let sql = `SELECT * FROM agents WHERE 1=1`;
		const params: unknown[] = [];

		// Filter by status
		if (query.status && query.status.length > 0) {
			sql += ` AND status IN (${query.status.map(() => "?").join(",")})`;
			params.push(...query.status);
		} else {
			// Default to online agents
			sql += ` AND status IN ('online', 'busy')`;
		}

		// Filter by health score
		if (query.minHealthScore !== undefined) {
			sql += ` AND health_score >= ?`;
			params.push(query.minHealthScore);
		}

		// Filter by tags (JSON contains)
		if (query.tags && query.tags.length > 0) {
			for (const tag of query.tags) {
				sql += ` AND tags LIKE ?`;
				params.push(`%"${tag}"%`);
			}
		}

		// Exclude specific agents
		if (query.excludeAgents && query.excludeAgents.length > 0) {
			sql += ` AND id NOT IN (${query.excludeAgents.map(() => "?").join(",")})`;
			params.push(...query.excludeAgents);
		}

		// Order by priority and health
		sql += ` ORDER BY priority DESC, health_score DESC, current_load ASC`;

		// Limit results
		sql += ` LIMIT ?`;
		params.push(this.config.maxAgentsPerQuery);

		const rows = this.db.prepare(sql).all(...params) as DbAgentRow[];

		let agents = rows.map((row) => this.rowToAgent(row));

		// Filter by capability (post-query for JSON search)
		if (query.capability) {
			agents = agents.filter((a) =>
				a.capabilities.some((c) => {
					const nameMatch = c.name === query.capability;
					const versionMatch = !query.capabilityVersion || c.version === query.capabilityVersion;
					const latencyMatch = !query.maxLatency || c.latency <= query.maxLatency;
					const costMatch = !query.maxCost || c.cost <= query.maxCost;
					return nameMatch && versionMatch && latencyMatch && costMatch;
				}),
			);
		}

		// Load balancing: prefer agents with lower load
		if (this.config.enableLoadBalancing) {
			agents.sort((a, b) => {
				const loadA = a.currentLoad / a.maxConcurrency;
				const loadB = b.currentLoad / b.maxConcurrency;
				return loadA - loadB;
			});
		}

		return {
			agents,
			totalMatches: agents.length,
			query,
			timestamp: Date.now(),
		};
	}

	/**
	 * Find best agent for a capability
	 */
	findBestAgent(capability: string, options: Omit<DiscoveryQuery, "capability"> = {}): RegisteredAgent | null {
		const result = this.discover({
			...options,
			capability,
			status: options.status ?? ["online"],
			minHealthScore: options.minHealthScore ?? 70,
		});

		return result.agents[0] ?? null;
	}

	/**
	 * Get agents by capability
	 */
	getAgentsByCapability(capability: string): RegisteredAgent[] {
		const result = this.discover({ capability });
		return result.agents;
	}

	/**
	 * Get all unique capabilities
	 */
	getAllCapabilities(): AgentCapability[] {
		const rows = this.db.prepare(`SELECT capabilities FROM agents WHERE status != 'offline'`).all() as Array<{
			capabilities: string;
		}>;

		const capabilityMap = new Map<string, AgentCapability>();

		for (const row of rows) {
			const capabilities = JSON.parse(row.capabilities) as AgentCapability[];
			for (const cap of capabilities) {
				const key = `${cap.name}@${cap.version}`;
				if (!capabilityMap.has(key)) {
					capabilityMap.set(key, cap);
				}
			}
		}

		return Array.from(capabilityMap.values());
	}

	/**
	 * Resolve agent dependencies
	 */
	resolveDependencies(agentId: string): { resolved: RegisteredAgent[]; missing: string[] } {
		const agent = this.getAgent(agentId);
		if (!agent) {
			return { resolved: [], missing: [agentId] };
		}

		const resolved: RegisteredAgent[] = [];
		const missing: string[] = [];
		const visited = new Set<string>();

		const resolve = (id: string) => {
			if (visited.has(id)) return;
			visited.add(id);

			const a = this.getAgent(id);
			if (!a) {
				missing.push(id);
				return;
			}

			// Resolve dependencies first
			for (const depId of a.dependencies) {
				resolve(depId);
			}

			resolved.push(a);
		};

		resolve(agentId);

		return { resolved, missing };
	}

	/**
	 * Acquire an agent (increment load)
	 */
	acquireAgent(agentId: string): boolean {
		const agent = this.getAgent(agentId);
		if (!agent || agent.currentLoad >= agent.maxConcurrency) {
			return false;
		}

		this.db.prepare(`UPDATE agents SET current_load = current_load + 1 WHERE id = ?`).run(agentId);

		// Update status if at capacity
		if (agent.currentLoad + 1 >= agent.maxConcurrency) {
			this.updateAgentStatus(agentId, "busy");
		}

		this.emit("agent:acquired", { agentId });
		return true;
	}

	/**
	 * Release an agent (decrement load)
	 */
	releaseAgent(agentId: string): boolean {
		const result = this.db
			.prepare(
				`
      UPDATE agents
      SET current_load = MAX(0, current_load - 1),
          status = CASE WHEN status = 'busy' THEN 'online' ELSE status END
      WHERE id = ?
    `,
			)
			.run(agentId);

		if (result.changes > 0) {
			this.emit("agent:released", { agentId });
		}

		return result.changes > 0;
	}

	/**
	 * Get discovery statistics
	 */
	getStats(): DiscoveryStats {
		const statusCounts = this.db
			.prepare(`SELECT status, COUNT(*) as cnt FROM agents GROUP BY status`)
			.all() as Array<{ status: AgentStatus; cnt: number }>;

		const capabilityCounts = this.db.prepare(`SELECT capabilities FROM agents`).all() as Array<{
			capabilities: string;
		}>;

		const avgHealth = this.db
			.prepare(`SELECT AVG(health_score) as avg FROM agents WHERE status != 'offline'`)
			.get() as { avg: number | null };

		// Calculate queries per minute
		const now = Date.now();
		const elapsed = (now - this.queryCountResetTime) / 60000;
		const queriesPerMinute = elapsed > 0 ? this.queryCount / elapsed : 0;

		// Reset counter every 5 minutes
		if (elapsed > 5) {
			this.queryCount = 0;
			this.queryCountResetTime = now;
		}

		// Count unique capabilities
		const allCaps = new Set<string>();
		let totalCaps = 0;
		for (const row of capabilityCounts) {
			const caps = JSON.parse(row.capabilities) as AgentCapability[];
			totalCaps += caps.length;
			for (const c of caps) {
				allCaps.add(c.name);
			}
		}

		const stats: DiscoveryStats = {
			totalAgents: 0,
			onlineAgents: 0,
			offlineAgents: 0,
			busyAgents: 0,
			degradedAgents: 0,
			totalCapabilities: totalCaps,
			uniqueCapabilities: allCaps.size,
			avgHealthScore: avgHealth.avg ?? 0,
			queriesPerMinute: Math.round(queriesPerMinute * 10) / 10,
		};

		for (const { status, cnt } of statusCounts) {
			stats.totalAgents += cnt;
			switch (status) {
				case "online":
					stats.onlineAgents = cnt;
					break;
				case "offline":
					stats.offlineAgents = cnt;
					break;
				case "busy":
					stats.busyAgents = cnt;
					break;
				case "degraded":
					stats.degradedAgents = cnt;
					break;
			}
		}

		return stats;
	}

	/**
	 * List all agents
	 */
	listAgents(status?: AgentStatus): RegisteredAgent[] {
		let sql = `SELECT * FROM agents`;
		const params: unknown[] = [];

		if (status) {
			sql += ` WHERE status = ?`;
			params.push(status);
		}

		sql += ` ORDER BY priority DESC, name ASC`;

		const rows = this.db.prepare(sql).all(...params) as DbAgentRow[];
		return rows.map((row) => this.rowToAgent(row));
	}

	private trackQuery(): void {
		this.queryCount++;
	}

	private rowToAgent(row: DbAgentRow): RegisteredAgent {
		return {
			id: row.id,
			name: row.name,
			description: row.description,
			status: row.status as AgentStatus,
			capabilities: JSON.parse(row.capabilities),
			endpoints: JSON.parse(row.endpoints),
			metadata: JSON.parse(row.metadata),
			tags: JSON.parse(row.tags),
			priority: row.priority,
			maxConcurrency: row.max_concurrency,
			currentLoad: row.current_load,
			registeredAt: row.registered_at,
			lastHeartbeat: row.last_heartbeat,
			healthScore: row.health_score,
			dependencies: JSON.parse(row.dependencies),
		};
	}

	/**
	 * Close the system
	 */
	close(): void {
		this.stopHealthCheckTimer();
		this.db.close();
		this.emit("system:closed");
	}
}

// ============================================================================
// Internal Types
// ============================================================================

interface DbAgentRow {
	id: string;
	name: string;
	description: string;
	status: string;
	capabilities: string;
	endpoints: string;
	metadata: string;
	tags: string;
	priority: number;
	max_concurrency: number;
	current_load: number;
	registered_at: number;
	last_heartbeat: number;
	health_score: number;
	dependencies: string;
}

// ============================================================================
// Singleton Factory
// ============================================================================

let instance: AgentDiscoverySystem | null = null;

export function getDiscoverySystem(dataDir: string, config?: Partial<DiscoveryConfig>): AgentDiscoverySystem {
	if (!instance) {
		instance = new AgentDiscoverySystem(dataDir, config);
	}
	return instance;
}

export function resetDiscoverySystem(): void {
	if (instance) {
		instance.close();
		instance = null;
	}
}
