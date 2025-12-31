/**
 * Class 3.35: Agent Lifecycle Manager
 *
 * Manages agent creation, monitoring, and cleanup.
 * Handles agent state transitions and resource management.
 *
 * Features:
 * - Agent creation and destruction
 * - State machine for agent lifecycle
 * - Health monitoring and auto-recovery
 * - Resource cleanup on termination
 *
 * @module agent-lifecycle
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export type AgentState =
	| "created"
	| "initializing"
	| "ready"
	| "running"
	| "paused"
	| "stopping"
	| "stopped"
	| "failed"
	| "terminated";

export interface ManagedAgent {
	id: string;
	name: string;
	type: string;
	state: AgentState;
	createdAt: number;
	startedAt: number | null;
	stoppedAt: number | null;
	lastActivity: number;
	restartCount: number;
	errorCount: number;
	lastError: string | null;
	metadata: Record<string, unknown>;
	resources: AgentResources;
}

export interface AgentResources {
	memoryUsed: number;
	tokensUsed: number;
	toolCalls: number;
	llmCalls: number;
	activeConnections: number;
}

export interface AgentSpec {
	name: string;
	type: string;
	config?: Record<string, unknown>;
	autoStart?: boolean;
	restartPolicy?: RestartPolicy;
	healthCheck?: HealthCheckConfig;
	metadata?: Record<string, unknown>;
}

export type RestartPolicy = "never" | "on-failure" | "always";

export interface HealthCheckConfig {
	enabled: boolean;
	intervalMs: number;
	timeoutMs: number;
	maxFailures: number;
	checker?: () => Promise<boolean>;
}

export interface LifecycleEvent {
	agentId: string;
	event: string;
	fromState?: AgentState;
	toState: AgentState;
	timestamp: number;
	reason?: string;
}

export interface LifecycleConfig {
	maxAgents: number;
	defaultRestartPolicy: RestartPolicy;
	healthCheckInterval: number;
	cleanupInterval: number;
	maxRestarts: number;
	autoCleanupStopped: boolean;
}

export interface LifecycleEvents {
	"agent:created": { agent: ManagedAgent };
	"agent:started": { agent: ManagedAgent };
	"agent:stopped": { agent: ManagedAgent; reason: string };
	"agent:failed": { agent: ManagedAgent; error: Error };
	"agent:restarted": { agent: ManagedAgent; attempt: number };
	"agent:terminated": { agent: ManagedAgent };
	"state:changed": { event: LifecycleEvent };
	"health:check": { agentId: string; healthy: boolean };
}

export type AgentFactory = (spec: AgentSpec) => Promise<{
	start: () => Promise<void>;
	stop: () => Promise<void>;
	health?: () => Promise<boolean>;
}>;

// =============================================================================
// State Machine
// =============================================================================

const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
	created: ["initializing", "terminated"],
	initializing: ["ready", "failed", "terminated"],
	ready: ["running", "stopped", "terminated"],
	running: ["paused", "stopping", "failed"],
	paused: ["running", "stopping", "terminated"],
	stopping: ["stopped", "failed"],
	stopped: ["initializing", "terminated"],
	failed: ["initializing", "terminated"],
	terminated: [],
};

// =============================================================================
// Agent Lifecycle Manager
// =============================================================================

export class AgentLifecycleManager extends EventEmitter {
	private config: LifecycleConfig;
	private agents: Map<string, ManagedAgent> = new Map();
	private factories: Map<string, AgentFactory> = new Map();
	private instances: Map<
		string,
		{ start: () => Promise<void>; stop: () => Promise<void>; health?: () => Promise<boolean> }
	> = new Map();
	private eventLog: LifecycleEvent[] = [];
	private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();
	private cleanupInterval: NodeJS.Timeout | null = null;

	constructor(config: Partial<LifecycleConfig> = {}) {
		super();
		this.config = {
			maxAgents: 50,
			defaultRestartPolicy: "on-failure",
			healthCheckInterval: 30000,
			cleanupInterval: 60000,
			maxRestarts: 3,
			autoCleanupStopped: true,
			...config,
		};

		// Start cleanup interval
		this.cleanupInterval = setInterval(() => this.cleanup(), this.config.cleanupInterval);
	}

	// ---------------------------------------------------------------------------
	// Factory Registration
	// ---------------------------------------------------------------------------

	registerFactory(type: string, factory: AgentFactory): void {
		this.factories.set(type, factory);
	}

	// ---------------------------------------------------------------------------
	// Agent Creation
	// ---------------------------------------------------------------------------

	async create(spec: AgentSpec): Promise<ManagedAgent> {
		if (this.agents.size >= this.config.maxAgents) {
			throw new Error(`Max agents (${this.config.maxAgents}) reached`);
		}

		const factory = this.factories.get(spec.type);
		if (!factory) {
			throw new Error(`No factory registered for agent type: ${spec.type}`);
		}

		const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

		const agent: ManagedAgent = {
			id,
			name: spec.name,
			type: spec.type,
			state: "created",
			createdAt: Date.now(),
			startedAt: null,
			stoppedAt: null,
			lastActivity: Date.now(),
			restartCount: 0,
			errorCount: 0,
			lastError: null,
			metadata: spec.metadata || {},
			resources: {
				memoryUsed: 0,
				tokensUsed: 0,
				toolCalls: 0,
				llmCalls: 0,
				activeConnections: 0,
			},
		};

		this.agents.set(id, agent);
		this.logEvent(id, "created", undefined, "created");

		this.emit("agent:created", { agent });

		// Auto-start if configured
		if (spec.autoStart !== false) {
			await this.start(id, spec, factory);
		}

		return agent;
	}

	// ---------------------------------------------------------------------------
	// Lifecycle Operations
	// ---------------------------------------------------------------------------

	async start(id: string, spec?: AgentSpec, factory?: AgentFactory): Promise<void> {
		const agent = this.agents.get(id);
		if (!agent) {
			throw new Error(`Agent ${id} not found`);
		}

		if (!this.canTransition(agent.state, "initializing")) {
			throw new Error(`Cannot start agent in state ${agent.state}`);
		}

		this.transition(agent, "initializing");

		try {
			// Get or create instance
			let instance = this.instances.get(id);
			if (!instance) {
				const factoryToUse = factory || this.factories.get(agent.type);
				if (!factoryToUse) {
					throw new Error(`No factory for agent type: ${agent.type}`);
				}
				instance = await factoryToUse(spec || { name: agent.name, type: agent.type });
				this.instances.set(id, instance);
			}

			this.transition(agent, "ready");
			await instance.start();

			agent.startedAt = Date.now();
			agent.lastActivity = Date.now();
			this.transition(agent, "running");

			this.emit("agent:started", { agent });

			// Start health checks
			if (spec?.healthCheck?.enabled || instance.health) {
				this.startHealthCheck(id, spec?.healthCheck);
			}
		} catch (error) {
			agent.errorCount++;
			agent.lastError = error instanceof Error ? error.message : String(error);
			this.transition(agent, "failed");
			this.emit("agent:failed", { agent, error: error as Error });

			// Auto-restart if policy allows
			const restartPolicy = spec?.restartPolicy || this.config.defaultRestartPolicy;
			if (this.shouldRestart(agent, restartPolicy)) {
				await this.restart(id, spec, factory);
			}
		}
	}

	async stop(id: string, reason = "manual"): Promise<void> {
		const agent = this.agents.get(id);
		if (!agent) {
			throw new Error(`Agent ${id} not found`);
		}

		if (!this.canTransition(agent.state, "stopping")) {
			// Already stopped or terminated
			return;
		}

		this.transition(agent, "stopping", reason);

		try {
			const instance = this.instances.get(id);
			if (instance) {
				await instance.stop();
			}

			// Stop health checks
			this.stopHealthCheck(id);

			agent.stoppedAt = Date.now();
			this.transition(agent, "stopped");
			this.emit("agent:stopped", { agent, reason });
		} catch (error) {
			agent.errorCount++;
			agent.lastError = error instanceof Error ? error.message : String(error);
			this.transition(agent, "failed");
		}
	}

	async restart(id: string, spec?: AgentSpec, factory?: AgentFactory): Promise<void> {
		const agent = this.agents.get(id);
		if (!agent) {
			throw new Error(`Agent ${id} not found`);
		}

		if (agent.restartCount >= this.config.maxRestarts) {
			await this.terminate(id, "max restarts exceeded");
			return;
		}

		agent.restartCount++;
		this.emit("agent:restarted", { agent, attempt: agent.restartCount });

		// Stop first if running
		if (agent.state === "running" || agent.state === "paused") {
			await this.stop(id, "restart");
		}

		// Wait a bit before restarting (exponential backoff)
		const delay = Math.min(1000 * 2 ** (agent.restartCount - 1), 30000);
		await new Promise((resolve) => setTimeout(resolve, delay));

		// Start again
		await this.start(id, spec, factory);
	}

	async pause(id: string): Promise<void> {
		const agent = this.agents.get(id);
		if (!agent) {
			throw new Error(`Agent ${id} not found`);
		}

		if (!this.canTransition(agent.state, "paused")) {
			throw new Error(`Cannot pause agent in state ${agent.state}`);
		}

		this.transition(agent, "paused", "manual pause");
	}

	async resume(id: string): Promise<void> {
		const agent = this.agents.get(id);
		if (!agent) {
			throw new Error(`Agent ${id} not found`);
		}

		if (agent.state !== "paused") {
			throw new Error(`Agent is not paused`);
		}

		this.transition(agent, "running", "resumed");
	}

	async terminate(id: string, reason = "manual"): Promise<void> {
		const agent = this.agents.get(id);
		if (!agent) return;

		// Stop first
		if (agent.state === "running" || agent.state === "paused") {
			await this.stop(id, reason);
		}

		// Stop health checks
		this.stopHealthCheck(id);

		// Remove instance
		this.instances.delete(id);

		this.transition(agent, "terminated", reason);
		this.emit("agent:terminated", { agent });

		// Remove from agents map
		this.agents.delete(id);
	}

	// ---------------------------------------------------------------------------
	// State Machine
	// ---------------------------------------------------------------------------

	private canTransition(from: AgentState, to: AgentState): boolean {
		return VALID_TRANSITIONS[from]?.includes(to) ?? false;
	}

	private transition(agent: ManagedAgent, to: AgentState, reason?: string): void {
		const from = agent.state;
		if (!this.canTransition(from, to)) {
			console.warn(`Invalid transition ${from} -> ${to} for agent ${agent.id}`);
			return;
		}

		agent.state = to;
		agent.lastActivity = Date.now();

		const event: LifecycleEvent = {
			agentId: agent.id,
			event: `${from}_to_${to}`,
			fromState: from,
			toState: to,
			timestamp: Date.now(),
			reason,
		};

		this.logEvent(agent.id, event.event, from, to, reason);
		this.emit("state:changed", { event });
	}

	private logEvent(agentId: string, event: string, from?: AgentState, to?: AgentState, reason?: string): void {
		this.eventLog.push({
			agentId,
			event,
			fromState: from,
			toState: to || "created",
			timestamp: Date.now(),
			reason,
		});

		// Keep only last 1000 events
		if (this.eventLog.length > 1000) {
			this.eventLog = this.eventLog.slice(-500);
		}
	}

	// ---------------------------------------------------------------------------
	// Health Checks
	// ---------------------------------------------------------------------------

	private startHealthCheck(id: string, config?: HealthCheckConfig): void {
		const interval = config?.intervalMs || this.config.healthCheckInterval;
		const maxFailures = config?.maxFailures || 3;

		let failures = 0;

		const check = async () => {
			const agent = this.agents.get(id);
			if (!agent || agent.state !== "running") {
				this.stopHealthCheck(id);
				return;
			}

			try {
				const instance = this.instances.get(id);
				const healthy = config?.checker
					? await config.checker()
					: instance?.health
						? await instance.health()
						: true;

				this.emit("health:check", { agentId: id, healthy });

				if (healthy) {
					failures = 0;
				} else {
					failures++;
					if (failures >= maxFailures) {
						await this.restart(id);
					}
				}
			} catch {
				failures++;
				if (failures >= maxFailures) {
					await this.restart(id);
				}
			}
		};

		const intervalHandle = setInterval(check, interval);
		this.healthCheckIntervals.set(id, intervalHandle);
	}

	private stopHealthCheck(id: string): void {
		const interval = this.healthCheckIntervals.get(id);
		if (interval) {
			clearInterval(interval);
			this.healthCheckIntervals.delete(id);
		}
	}

	// ---------------------------------------------------------------------------
	// Restart Policy
	// ---------------------------------------------------------------------------

	private shouldRestart(agent: ManagedAgent, policy: RestartPolicy): boolean {
		if (agent.restartCount >= this.config.maxRestarts) {
			return false;
		}

		switch (policy) {
			case "never":
				return false;
			case "on-failure":
				return agent.state === "failed";
			case "always":
				return true;
			default:
				return false;
		}
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	private cleanup(): void {
		if (!this.config.autoCleanupStopped) return;

		for (const [id, agent] of this.agents) {
			if (agent.state === "stopped" || agent.state === "terminated") {
				const age = Date.now() - (agent.stoppedAt || agent.createdAt);
				if (age > 300000) {
					// 5 minutes
					this.agents.delete(id);
					this.instances.delete(id);
				}
			}
		}
	}

	// ---------------------------------------------------------------------------
	// Resource Tracking
	// ---------------------------------------------------------------------------

	updateResources(id: string, updates: Partial<AgentResources>): void {
		const agent = this.agents.get(id);
		if (agent) {
			agent.resources = { ...agent.resources, ...updates };
			agent.lastActivity = Date.now();
		}
	}

	// ---------------------------------------------------------------------------
	// Query Methods
	// ---------------------------------------------------------------------------

	getAgent(id: string): ManagedAgent | null {
		return this.agents.get(id) || null;
	}

	getAllAgents(): ManagedAgent[] {
		return Array.from(this.agents.values());
	}

	getAgentsByState(state: AgentState): ManagedAgent[] {
		return Array.from(this.agents.values()).filter((a) => a.state === state);
	}

	getAgentsByType(type: string): ManagedAgent[] {
		return Array.from(this.agents.values()).filter((a) => a.type === type);
	}

	getEventLog(agentId?: string, limit = 100): LifecycleEvent[] {
		let events = this.eventLog;
		if (agentId) {
			events = events.filter((e) => e.agentId === agentId);
		}
		return events.slice(-limit);
	}

	getStats(): {
		totalAgents: number;
		byState: Map<AgentState, number>;
		byType: Map<string, number>;
		totalRestarts: number;
		totalErrors: number;
	} {
		const byState = new Map<AgentState, number>();
		const byType = new Map<string, number>();
		let totalRestarts = 0;
		let totalErrors = 0;

		for (const agent of this.agents.values()) {
			byState.set(agent.state, (byState.get(agent.state) || 0) + 1);
			byType.set(agent.type, (byType.get(agent.type) || 0) + 1);
			totalRestarts += agent.restartCount;
			totalErrors += agent.errorCount;
		}

		return {
			totalAgents: this.agents.size,
			byState,
			byType,
			totalRestarts,
			totalErrors,
		};
	}

	// ---------------------------------------------------------------------------
	// Shutdown
	// ---------------------------------------------------------------------------

	async shutdown(): Promise<void> {
		// Stop cleanup interval
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		// Stop all health checks
		for (const id of this.healthCheckIntervals.keys()) {
			this.stopHealthCheck(id);
		}

		// Stop all running agents
		const stopPromises: Promise<void>[] = [];
		for (const agent of this.agents.values()) {
			if (agent.state === "running" || agent.state === "paused") {
				stopPromises.push(this.stop(agent.id, "shutdown"));
			}
		}

		await Promise.all(stopPromises);
	}

	reset(): void {
		this.shutdown();
		this.agents.clear();
		this.instances.clear();
		this.eventLog = [];
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: AgentLifecycleManager | null = null;

export function getAgentLifecycle(config?: Partial<LifecycleConfig>): AgentLifecycleManager {
	if (!instance) {
		instance = new AgentLifecycleManager(config);
	}
	return instance;
}

export function resetAgentLifecycle(): void {
	if (instance) {
		instance.reset();
	}
	instance = null;
}
