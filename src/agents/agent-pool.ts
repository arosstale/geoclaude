/**
 * TAC-12 Agent Pool Segregation Pattern
 * Organizes agents by role for efficient orchestration
 *
 * Based on TAC Foundation's 12 leverage points model:
 * - In-Agent (1-4): Context, Model, Prompt, Tools
 * - Through-Agent (5-12): Output, Types, Docs, Tests, Architecture, Plans, Templates, ADWs
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

/** Agent role categories (TAC-12 aligned) */
export type AgentRole =
	| "architect" // Planning, design, feature breakdown
	| "builder" // Implementation, coding, execution
	| "tester" // Validation, testing, verification
	| "reviewer" // Quality review, code review
	| "expert" // Domain specialist
	| "scout" // Data collection, reconnaissance
	| "executor"; // Trade execution, action taking

/** Trading-specific agent roles */
export type TradingAgentRole =
	| "scout" // Market data collectors
	| "analyst" // Pattern analysis, technical indicators
	| "strategist" // Strategy formulation
	| "risk_manager" // Risk assessment
	| "executor"; // Trade execution

/** Orchestration execution mode */
export enum OrchestrationMode {
	SEQUENTIAL = "sequential", // One after another
	PARALLEL = "parallel", // All at once
	PIPELINE = "pipeline", // Output → Input chain
	SWARM = "swarm", // Autonomous coordination
}

/** Agent registration info */
export interface AgentRegistration {
	id: string;
	name: string;
	role: AgentRole | TradingAgentRole;
	tags: string[];
	maxConcurrency: number;
	costPerCall?: number; // Estimated cost
	priority: number; // 0-10, higher = prefer
	status: "idle" | "busy" | "error" | "disabled";
	lastUsed?: Date;
	metadata?: Record<string, unknown>;
}

/** Agent cost tracking */
export interface AgentCostRecord {
	agentId: string;
	timestamp: number;
	inputTokens: number;
	outputTokens: number;
	apiCalls: number;
	totalCost: number;
	latencyMs: number;
	success: boolean;
	roi?: number; // Return on investment (for trading)
}

/** Agent pool statistics */
export interface AgentPoolStats {
	totalAgents: number;
	byRole: Record<string, number>;
	byStatus: Record<string, number>;
	totalCost: number;
	avgLatency: number;
	successRate: number;
}

/** Task for agent execution */
export interface AgentTask {
	id: string;
	type: string;
	payload: Record<string, unknown>;
	requiredRole?: AgentRole | TradingAgentRole;
	requiredTags?: string[];
	priority: number;
	timeout: number;
	createdAt: Date;
	assignedTo?: string;
	status: "pending" | "assigned" | "running" | "completed" | "failed";
	result?: unknown;
	error?: string;
}

// =============================================================================
// Agent Pool Manager
// =============================================================================

export class AgentPoolManager extends EventEmitter {
	private agents = new Map<string, AgentRegistration>();
	private pools = new Map<string, Set<string>>(); // role → agentIds
	private costs: AgentCostRecord[] = [];
	private taskQueue: AgentTask[] = [];
	private maxCostHistory = 1000;
	private maxWorkers: number;

	constructor(options: { maxWorkers?: number } = {}) {
		super();
		this.maxWorkers = options.maxWorkers ?? 4;

		// Initialize role pools
		const roles: (AgentRole | TradingAgentRole)[] = [
			"architect",
			"builder",
			"tester",
			"reviewer",
			"expert",
			"scout",
			"analyst",
			"strategist",
			"risk_manager",
			"executor",
		];
		for (const role of roles) {
			this.pools.set(role, new Set());
		}
	}

	// =========================================================================
	// Agent Registration
	// =========================================================================

	/**
	 * Register an agent in the pool
	 */
	register(agent: AgentRegistration): void {
		this.agents.set(agent.id, { ...agent, status: "idle" });

		// Add to role pool
		const pool = this.pools.get(agent.role);
		if (pool) {
			pool.add(agent.id);
		}

		this.emit("agent:registered", agent);
	}

	/**
	 * Unregister an agent
	 */
	unregister(agentId: string): boolean {
		const agent = this.agents.get(agentId);
		if (!agent) return false;

		// Remove from role pool
		const pool = this.pools.get(agent.role);
		if (pool) {
			pool.delete(agentId);
		}

		this.agents.delete(agentId);
		this.emit("agent:unregistered", agentId);
		return true;
	}

	/**
	 * Get agent by ID
	 */
	getAgent(agentId: string): AgentRegistration | undefined {
		return this.agents.get(agentId);
	}

	/**
	 * Get all agents in a role pool
	 */
	getPool(role: AgentRole | TradingAgentRole): AgentRegistration[] {
		const pool = this.pools.get(role);
		if (!pool) return [];

		return Array.from(pool)
			.map((id) => this.agents.get(id))
			.filter((a): a is AgentRegistration => a !== undefined);
	}

	/**
	 * Get available agents (idle and not disabled)
	 */
	getAvailable(role?: AgentRole | TradingAgentRole): AgentRegistration[] {
		let agents = Array.from(this.agents.values());

		if (role) {
			agents = agents.filter((a) => a.role === role);
		}

		return agents.filter((a) => a.status === "idle").sort((a, b) => b.priority - a.priority);
	}

	/**
	 * Update agent status
	 */
	setStatus(agentId: string, status: AgentRegistration["status"]): void {
		const agent = this.agents.get(agentId);
		if (agent) {
			agent.status = status;
			if (status === "idle" || status === "busy") {
				agent.lastUsed = new Date();
			}
			this.emit("agent:status", { agentId, status });
		}
	}

	// =========================================================================
	// Cost Tracking
	// =========================================================================

	/**
	 * Record agent cost
	 */
	recordCost(record: AgentCostRecord): void {
		this.costs.push(record);

		// Trim history
		if (this.costs.length > this.maxCostHistory) {
			this.costs = this.costs.slice(-this.maxCostHistory);
		}

		this.emit("cost:recorded", record);
	}

	/**
	 * Get cost summary for an agent
	 */
	getAgentCosts(
		agentId: string,
		since?: Date,
	): {
		totalCost: number;
		totalCalls: number;
		avgLatency: number;
		successRate: number;
		totalTokens: { input: number; output: number };
	} {
		let records = this.costs.filter((c) => c.agentId === agentId);

		if (since) {
			const sinceTs = since.getTime();
			records = records.filter((c) => c.timestamp >= sinceTs);
		}

		if (records.length === 0) {
			return {
				totalCost: 0,
				totalCalls: 0,
				avgLatency: 0,
				successRate: 0,
				totalTokens: { input: 0, output: 0 },
			};
		}

		const totalCost = records.reduce((sum, r) => sum + r.totalCost, 0);
		const avgLatency = records.reduce((sum, r) => sum + r.latencyMs, 0) / records.length;
		const successCount = records.filter((r) => r.success).length;

		return {
			totalCost,
			totalCalls: records.length,
			avgLatency: Math.round(avgLatency),
			successRate: successCount / records.length,
			totalTokens: {
				input: records.reduce((sum, r) => sum + r.inputTokens, 0),
				output: records.reduce((sum, r) => sum + r.outputTokens, 0),
			},
		};
	}

	/**
	 * Get total costs across all agents
	 */
	getTotalCosts(since?: Date): {
		byAgent: Map<string, number>;
		total: number;
		topAgents: { agentId: string; cost: number }[];
	} {
		let records = this.costs;

		if (since) {
			const sinceTs = since.getTime();
			records = records.filter((c) => c.timestamp >= sinceTs);
		}

		const byAgent = new Map<string, number>();
		for (const record of records) {
			const current = byAgent.get(record.agentId) || 0;
			byAgent.set(record.agentId, current + record.totalCost);
		}

		const total = records.reduce((sum, r) => sum + r.totalCost, 0);

		const topAgents = Array.from(byAgent.entries())
			.map(([agentId, cost]) => ({ agentId, cost }))
			.sort((a, b) => b.cost - a.cost)
			.slice(0, 10);

		return { byAgent, total, topAgents };
	}

	// =========================================================================
	// Task Queue
	// =========================================================================

	/**
	 * Enqueue a task
	 */
	enqueue(task: Omit<AgentTask, "id" | "createdAt" | "status">): string {
		const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const fullTask: AgentTask = {
			...task,
			id,
			createdAt: new Date(),
			status: "pending",
		};

		this.taskQueue.push(fullTask);
		this.taskQueue.sort((a, b) => b.priority - a.priority);

		this.emit("task:enqueued", fullTask);
		return id;
	}

	/**
	 * Get next task for processing
	 */
	dequeue(): AgentTask | undefined {
		const task = this.taskQueue.find((t) => t.status === "pending");
		if (task) {
			task.status = "assigned";
		}
		return task;
	}

	/**
	 * Complete a task
	 */
	completeTask(taskId: string, result: unknown): void {
		const task = this.taskQueue.find((t) => t.id === taskId);
		if (task) {
			task.status = "completed";
			task.result = result;
			this.emit("task:completed", task);
		}
	}

	/**
	 * Fail a task
	 */
	failTask(taskId: string, error: string): void {
		const task = this.taskQueue.find((t) => t.id === taskId);
		if (task) {
			task.status = "failed";
			task.error = error;
			this.emit("task:failed", task);
		}
	}

	/**
	 * Get queue stats
	 */
	getQueueStats(): {
		pending: number;
		running: number;
		completed: number;
		failed: number;
	} {
		return {
			pending: this.taskQueue.filter((t) => t.status === "pending").length,
			running: this.taskQueue.filter((t) => t.status === "running").length,
			completed: this.taskQueue.filter((t) => t.status === "completed").length,
			failed: this.taskQueue.filter((t) => t.status === "failed").length,
		};
	}

	// =========================================================================
	// Agent Selection
	// =========================================================================

	/**
	 * Select best agent for a task (cost-aware)
	 */
	selectAgent(
		task: AgentTask,
		options: {
			preferLowCost?: boolean;
			preferHighReliability?: boolean;
			preferLowLatency?: boolean;
		} = {},
	): AgentRegistration | undefined {
		let candidates = this.getAvailable(task.requiredRole);

		// Filter by tags if specified
		if (task.requiredTags && task.requiredTags.length > 0) {
			candidates = candidates.filter((a) => task.requiredTags!.some((tag) => a.tags.includes(tag)));
		}

		if (candidates.length === 0) return undefined;

		// Score candidates
		const scored = candidates.map((agent) => {
			const costs = this.getAgentCosts(agent.id);
			let score = agent.priority * 10;

			if (options.preferLowCost && costs.totalCalls > 0) {
				const avgCost = costs.totalCost / costs.totalCalls;
				score -= avgCost * 100; // Penalize high cost
			}

			if (options.preferHighReliability && costs.totalCalls > 0) {
				score += costs.successRate * 50;
			}

			if (options.preferLowLatency && costs.totalCalls > 0) {
				score -= costs.avgLatency / 100; // Penalize high latency
			}

			return { agent, score };
		});

		// Return highest scored
		scored.sort((a, b) => b.score - a.score);
		return scored[0]?.agent;
	}

	// =========================================================================
	// Statistics
	// =========================================================================

	/**
	 * Get pool statistics
	 */
	getStats(): AgentPoolStats {
		const agents = Array.from(this.agents.values());

		const byRole: Record<string, number> = {};
		const byStatus: Record<string, number> = {};

		for (const agent of agents) {
			byRole[agent.role] = (byRole[agent.role] || 0) + 1;
			byStatus[agent.status] = (byStatus[agent.status] || 0) + 1;
		}

		const costData = this.getTotalCosts();
		const allCosts = this.costs;
		const avgLatency = allCosts.length > 0 ? allCosts.reduce((sum, c) => sum + c.latencyMs, 0) / allCosts.length : 0;
		const successCount = allCosts.filter((c) => c.success).length;

		return {
			totalAgents: agents.length,
			byRole,
			byStatus,
			totalCost: costData.total,
			avgLatency: Math.round(avgLatency),
			successRate: allCosts.length > 0 ? successCount / allCosts.length : 0,
		};
	}

	/**
	 * Export all data for persistence
	 */
	export(): {
		agents: AgentRegistration[];
		costs: AgentCostRecord[];
		tasks: AgentTask[];
	} {
		return {
			agents: Array.from(this.agents.values()),
			costs: this.costs,
			tasks: this.taskQueue,
		};
	}

	/**
	 * Import data from persistence
	 */
	import(data: { agents?: AgentRegistration[]; costs?: AgentCostRecord[]; tasks?: AgentTask[] }): void {
		if (data.agents) {
			for (const agent of data.agents) {
				this.register(agent);
			}
		}
		if (data.costs) {
			this.costs = data.costs;
		}
		if (data.tasks) {
			this.taskQueue = data.tasks;
		}
	}
}

// =============================================================================
// Orchestration Controller
// =============================================================================

export class OrchestrationController {
	private pool: AgentPoolManager;
	private mode: OrchestrationMode;
	private activeWorkers = 0;
	private maxWorkers: number;

	constructor(pool: AgentPoolManager, options: { mode?: OrchestrationMode; maxWorkers?: number } = {}) {
		this.pool = pool;
		this.mode = options.mode ?? OrchestrationMode.PIPELINE;
		this.maxWorkers = options.maxWorkers ?? 4;
	}

	/**
	 * Set orchestration mode
	 */
	setMode(mode: OrchestrationMode): void {
		this.mode = mode;
	}

	/**
	 * Execute tasks based on current mode
	 */
	async execute<T>(
		tasks: AgentTask[],
		executor: (task: AgentTask, agent: AgentRegistration) => Promise<T>,
	): Promise<{ results: T[]; errors: Error[] }> {
		const results: T[] = [];
		const errors: Error[] = [];

		switch (this.mode) {
			case OrchestrationMode.SEQUENTIAL:
				for (const task of tasks) {
					try {
						const agent = this.pool.selectAgent(task);
						if (!agent) {
							errors.push(new Error(`No agent available for task ${task.id}`));
							continue;
						}
						this.pool.setStatus(agent.id, "busy");
						const result = await executor(task, agent);
						results.push(result);
						this.pool.setStatus(agent.id, "idle");
					} catch (e) {
						errors.push(e instanceof Error ? e : new Error(String(e)));
					}
				}
				break;

			case OrchestrationMode.PARALLEL: {
				const parallelResults = await Promise.allSettled(
					tasks.map(async (task) => {
						const agent = this.pool.selectAgent(task);
						if (!agent) throw new Error(`No agent available for task ${task.id}`);
						this.pool.setStatus(agent.id, "busy");
						try {
							const result = await executor(task, agent);
							this.pool.setStatus(agent.id, "idle");
							return result;
						} catch (e) {
							this.pool.setStatus(agent.id, "error");
							throw e;
						}
					}),
				);

				for (const result of parallelResults) {
					if (result.status === "fulfilled") {
						results.push(result.value);
					} else {
						errors.push(result.reason);
					}
				}
				break;
			}

			case OrchestrationMode.PIPELINE: {
				let pipelineInput: unknown;
				for (const task of tasks) {
					try {
						const agent = this.pool.selectAgent(task);
						if (!agent) {
							errors.push(new Error(`No agent available for task ${task.id}`));
							break;
						}
						// Pass previous output as input
						task.payload._pipelineInput = pipelineInput;
						this.pool.setStatus(agent.id, "busy");
						const result = await executor(task, agent);
						pipelineInput = result;
						results.push(result);
						this.pool.setStatus(agent.id, "idle");
					} catch (e) {
						errors.push(e instanceof Error ? e : new Error(String(e)));
						break; // Pipeline stops on error
					}
				}
				break;
			}

			case OrchestrationMode.SWARM: {
				// Swarm: Process with limited concurrency
				const swarmTasks = [...tasks];
				const swarmResults: Promise<T>[] = [];

				const processNext = async (): Promise<void> => {
					while (swarmTasks.length > 0 && this.activeWorkers < this.maxWorkers) {
						const task = swarmTasks.shift();
						if (!task) break;

						this.activeWorkers++;
						const promise = (async () => {
							const agent = this.pool.selectAgent(task);
							if (!agent) throw new Error(`No agent available for task ${task.id}`);
							this.pool.setStatus(agent.id, "busy");
							try {
								const result = await executor(task, agent);
								this.pool.setStatus(agent.id, "idle");
								return result;
							} finally {
								this.activeWorkers--;
							}
						})();

						swarmResults.push(promise);
						promise.finally(processNext);
					}
				};

				await processNext();
				const swarmSettled = await Promise.allSettled(swarmResults);

				for (const result of swarmSettled) {
					if (result.status === "fulfilled") {
						results.push(result.value);
					} else {
						errors.push(result.reason);
					}
				}
				break;
			}
		}

		return { results, errors };
	}

	/**
	 * Get active worker count
	 */
	getActiveWorkers(): number {
		return this.activeWorkers;
	}

	/**
	 * Get current mode
	 */
	getMode(): OrchestrationMode {
		return this.mode;
	}
}

// =============================================================================
// Singleton Access
// =============================================================================

let agentPoolInstance: AgentPoolManager | null = null;

export function getAgentPool(options?: { maxWorkers?: number }): AgentPoolManager {
	if (!agentPoolInstance) {
		agentPoolInstance = new AgentPoolManager(options);
	}
	return agentPoolInstance;
}

export function createOrchestrationController(
	pool?: AgentPoolManager,
	options?: { mode?: OrchestrationMode; maxWorkers?: number },
): OrchestrationController {
	return new OrchestrationController(pool ?? getAgentPool(), options);
}

// =============================================================================
// Helper: Create trading agent pools
// =============================================================================

export function createTradingAgentPool(): AgentPoolManager {
	const pool = new AgentPoolManager({ maxWorkers: 4 });

	// Register default trading agents
	const defaultAgents: AgentRegistration[] = [
		{
			id: "price-agent",
			name: "Price Data Agent",
			role: "scout",
			tags: ["market-data", "real-time"],
			maxConcurrency: 3,
			priority: 8,
			status: "idle",
		},
		{
			id: "sentiment-agent",
			name: "Sentiment Analyzer",
			role: "analyst",
			tags: ["social", "news", "sentiment"],
			maxConcurrency: 2,
			priority: 7,
			status: "idle",
		},
		{
			id: "whale-agent",
			name: "Whale Tracker",
			role: "scout",
			tags: ["on-chain", "whale", "tracking"],
			maxConcurrency: 2,
			priority: 6,
			status: "idle",
		},
		{
			id: "pattern-agent",
			name: "Pattern Analyzer",
			role: "analyst",
			tags: ["technical", "patterns", "indicators"],
			maxConcurrency: 2,
			priority: 8,
			status: "idle",
		},
		{
			id: "signal-agent",
			name: "Signal Generator",
			role: "strategist",
			tags: ["signals", "entry", "exit"],
			maxConcurrency: 1,
			priority: 9,
			status: "idle",
		},
		{
			id: "risk-agent",
			name: "Risk Manager",
			role: "risk_manager",
			tags: ["risk", "portfolio", "sizing"],
			maxConcurrency: 1,
			priority: 10,
			status: "idle",
		},
		{
			id: "executor-agent",
			name: "Trade Executor",
			role: "executor",
			tags: ["execution", "orders", "trading"],
			maxConcurrency: 1,
			priority: 10,
			status: "idle",
		},
	];

	for (const agent of defaultAgents) {
		pool.register(agent);
	}

	return pool;
}
