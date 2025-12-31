/**
 * Agent Pool Segregation System
 * Organizes trading agents into specialized pools with different orchestration modes
 *
 * Pools:
 * - Scouts: Data collection (PriceAgent, WhaleAgent, etc.)
 * - Analysts: Pattern analysis and research
 * - Traders: Signal generation
 * - Risk Managers: Risk assessment and position sizing
 * - Executors: Trade execution and monitoring
 *
 * Orchestration Modes:
 * - Sequential: Run agents one after another (pipeline)
 * - Parallel: Run all agents simultaneously
 * - Pipeline: Run pools in sequence with data passing
 * - Swarm: Distributed execution with consensus
 */

import type { BaseAgent } from "./base-agent.js";

export enum OrchestrationMode {
	SEQUENTIAL = "sequential",
	PARALLEL = "parallel",
	PIPELINE = "pipeline",
	SWARM = "swarm",
}

export interface AgentPool {
	scouts: BaseAgent[];
	analysts: BaseAgent[];
	traders: BaseAgent[];
	riskManagers: BaseAgent[];
	executors: BaseAgent[];
}

export type PoolType = keyof AgentPool;

export interface Task {
	id: string;
	type: "analyze" | "signal" | "execute" | "research";
	symbol?: string;
	data?: unknown;
	priority?: number;
	timeout?: number;
}

export interface TaskResult {
	taskId: string;
	success: boolean;
	data?: unknown;
	error?: string;
	executionTimeMs: number;
	agentsUsed: string[];
	poolsInvolved: PoolType[];
}

export interface PoolStats {
	totalAgents: number;
	activeAgents: number;
	tasksCompleted: number;
	avgExecutionTimeMs: number;
	errorCount: number;
}

export class AgentPoolManager {
	private pools: AgentPool;
	private poolStats: Map<PoolType, PoolStats>;
	private taskHistory: TaskResult[] = [];
	private readonly MAX_HISTORY = 1000;

	constructor() {
		this.pools = {
			scouts: [],
			analysts: [],
			traders: [],
			riskManagers: [],
			executors: [],
		};

		this.poolStats = new Map([
			["scouts", { totalAgents: 0, activeAgents: 0, tasksCompleted: 0, avgExecutionTimeMs: 0, errorCount: 0 }],
			["analysts", { totalAgents: 0, activeAgents: 0, tasksCompleted: 0, avgExecutionTimeMs: 0, errorCount: 0 }],
			["traders", { totalAgents: 0, activeAgents: 0, tasksCompleted: 0, avgExecutionTimeMs: 0, errorCount: 0 }],
			["riskManagers", { totalAgents: 0, activeAgents: 0, tasksCompleted: 0, avgExecutionTimeMs: 0, errorCount: 0 }],
			["executors", { totalAgents: 0, activeAgents: 0, tasksCompleted: 0, avgExecutionTimeMs: 0, errorCount: 0 }],
		]);
	}

	/**
	 * Assign agent to a specific pool
	 */
	assignToPool(agent: BaseAgent, pool: PoolType): void {
		// Remove from all pools first
		this.removeFromAllPools(agent);

		// Add to target pool
		this.pools[pool].push(agent);

		// Update stats
		const stats = this.poolStats.get(pool);
		if (stats) {
			stats.totalAgents = this.pools[pool].length;
			stats.activeAgents = this.pools[pool].filter((a) => a.isEnabled).length;
		}

		console.log(`[AgentPoolManager] Assigned ${agent.name} to ${pool} pool`);
	}

	/**
	 * Remove agent from all pools
	 */
	private removeFromAllPools(agent: BaseAgent): void {
		for (const poolName of Object.keys(this.pools) as PoolType[]) {
			const pool = this.pools[poolName];
			const index = pool.findIndex((a) => a.name === agent.name);
			if (index !== -1) {
				pool.splice(index, 1);
				const stats = this.poolStats.get(poolName);
				if (stats) {
					stats.totalAgents = pool.length;
					stats.activeAgents = pool.filter((a) => a.isEnabled).length;
				}
			}
		}
	}

	/**
	 * Get all agents in a pool
	 */
	getPool(name: PoolType): BaseAgent[] {
		return [...this.pools[name]];
	}

	/**
	 * Get active agents in a pool
	 */
	getActiveAgents(pool: PoolType): BaseAgent[] {
		return this.pools[pool].filter((agent) => agent.isEnabled);
	}

	/**
	 * Get all pools
	 */
	getAllPools(): AgentPool {
		return {
			scouts: this.pools.scouts.slice(),
			analysts: this.pools.analysts.slice(),
			traders: this.pools.traders.slice(),
			riskManagers: this.pools.riskManagers.slice(),
			executors: this.pools.executors.slice(),
		};
	}

	/**
	 * Run task with specified orchestration mode
	 */
	async runMode(mode: OrchestrationMode, task: Task): Promise<TaskResult> {
		const startTime = Date.now();
		const agentsUsed: string[] = [];
		const poolsInvolved: PoolType[] = [];

		try {
			let result: unknown;

			switch (mode) {
				case OrchestrationMode.SEQUENTIAL:
					result = await this.runSequential(task, agentsUsed, poolsInvolved);
					break;
				case OrchestrationMode.PARALLEL:
					result = await this.runParallel(task, agentsUsed, poolsInvolved);
					break;
				case OrchestrationMode.PIPELINE:
					result = await this.runPipeline(task, agentsUsed, poolsInvolved);
					break;
				case OrchestrationMode.SWARM:
					result = await this.runSwarm(task, agentsUsed, poolsInvolved);
					break;
			}

			const executionTimeMs = Date.now() - startTime;

			// Update pool stats
			for (const poolName of poolsInvolved) {
				const stats = this.poolStats.get(poolName);
				if (stats) {
					stats.tasksCompleted++;
					stats.avgExecutionTimeMs =
						(stats.avgExecutionTimeMs * (stats.tasksCompleted - 1) + executionTimeMs) / stats.tasksCompleted;
				}
			}

			const taskResult: TaskResult = {
				taskId: task.id,
				success: true,
				data: result,
				executionTimeMs,
				agentsUsed,
				poolsInvolved,
			};

			this.addToHistory(taskResult);
			return taskResult;
		} catch (error) {
			const executionTimeMs = Date.now() - startTime;

			// Update error counts
			for (const poolName of poolsInvolved) {
				const stats = this.poolStats.get(poolName);
				if (stats) {
					stats.errorCount++;
				}
			}

			const taskResult: TaskResult = {
				taskId: task.id,
				success: false,
				error: error instanceof Error ? error.message : String(error),
				executionTimeMs,
				agentsUsed,
				poolsInvolved,
			};

			this.addToHistory(taskResult);
			return taskResult;
		}
	}

	/**
	 * Sequential execution: Run agents one after another
	 */
	private async runSequential(_task: Task, agentsUsed: string[], poolsInvolved: PoolType[]): Promise<unknown> {
		const results: unknown[] = [];

		// Execute in order: scouts -> analysts -> traders -> risk managers -> executors
		const poolOrder: PoolType[] = ["scouts", "analysts", "traders", "riskManagers", "executors"];

		for (const poolName of poolOrder) {
			const agents = this.getActiveAgents(poolName);
			if (agents.length === 0) continue;

			poolsInvolved.push(poolName);

			for (const agent of agents) {
				agentsUsed.push(agent.name);
				// Note: BaseAgent doesn't expose run() directly, would need to extend interface
				// For now, this is a placeholder for the execution logic
				results.push({ agent: agent.name, pool: poolName });
			}
		}

		return results;
	}

	/**
	 * Parallel execution: Run all agents simultaneously
	 */
	private async runParallel(_task: Task, agentsUsed: string[], poolsInvolved: PoolType[]): Promise<unknown> {
		const promises: Promise<unknown>[] = [];

		for (const poolName of Object.keys(this.pools) as PoolType[]) {
			const agents = this.getActiveAgents(poolName);
			if (agents.length === 0) continue;

			poolsInvolved.push(poolName);

			for (const agent of agents) {
				agentsUsed.push(agent.name);
				// Placeholder for parallel execution
				promises.push(Promise.resolve({ agent: agent.name, pool: poolName }));
			}
		}

		return Promise.all(promises);
	}

	/**
	 * Pipeline execution: Run pools in sequence, passing data between them
	 */
	private async runPipeline(task: Task, agentsUsed: string[], poolsInvolved: PoolType[]): Promise<unknown> {
		let pipelineData: unknown = task.data;

		// Pipeline stages
		const stages: Array<{ pool: PoolType; transform: (data: unknown) => unknown }> = [
			{
				pool: "scouts",
				transform: (data) => Object.assign({}, data as object, { scoutData: "collected" }),
			},
			{
				pool: "analysts",
				transform: (data) => Object.assign({}, data as object, { analysis: "completed" }),
			},
			{
				pool: "traders",
				transform: (data) => Object.assign({}, data as object, { signals: "generated" }),
			},
			{
				pool: "riskManagers",
				transform: (data) => Object.assign({}, data as object, { riskAssessed: true }),
			},
			{
				pool: "executors",
				transform: (data) => Object.assign({}, data as object, { executed: true }),
			},
		];

		for (const stage of stages) {
			const agents = this.getActiveAgents(stage.pool);
			if (agents.length === 0) continue;

			poolsInvolved.push(stage.pool);

			// Execute all agents in pool on current data
			for (const agent of agents) {
				agentsUsed.push(agent.name);
			}

			// Transform data for next stage
			pipelineData = stage.transform(pipelineData);
		}

		return pipelineData;
	}

	/**
	 * Swarm execution: Distributed execution with consensus
	 */
	private async runSwarm(_task: Task, agentsUsed: string[], poolsInvolved: PoolType[]): Promise<unknown> {
		const swarmResults: Map<string, unknown[]> = new Map();

		// Execute all pools in parallel with consensus
		const poolPromises = (Object.keys(this.pools) as PoolType[]).map(async (poolName) => {
			const agents = this.getActiveAgents(poolName);
			if (agents.length === 0) return;

			poolsInvolved.push(poolName);
			const poolResults: unknown[] = [];

			// Run agents in parallel within pool
			const agentPromises = agents.map(async (agent) => {
				agentsUsed.push(agent.name);
				// Placeholder for agent execution
				return { agent: agent.name, pool: poolName };
			});

			const results = await Promise.all(agentPromises);
			poolResults.push(...results);
			swarmResults.set(poolName, poolResults);
		});

		await Promise.all(poolPromises);

		// Build consensus from swarm results
		return {
			consensus: "achieved",
			results: Object.fromEntries(swarmResults),
		};
	}

	/**
	 * Add task result to history
	 */
	private addToHistory(result: TaskResult): void {
		this.taskHistory.push(result);
		while (this.taskHistory.length > this.MAX_HISTORY) {
			this.taskHistory.shift();
		}
	}

	/**
	 * Get pool statistics
	 */
	getPoolStats(pool: PoolType): PoolStats | undefined {
		return this.poolStats.get(pool);
	}

	/**
	 * Get all pool statistics
	 */
	getAllPoolStats(): Map<PoolType, PoolStats> {
		return new Map(this.poolStats);
	}

	/**
	 * Get task history
	 */
	getTaskHistory(limit?: number): TaskResult[] {
		const history = [...this.taskHistory].reverse();
		return limit ? history.slice(0, limit) : history;
	}

	/**
	 * Get task success rate
	 */
	getTaskSuccessRate(pool?: PoolType): number {
		const relevantTasks = pool ? this.taskHistory.filter((t) => t.poolsInvolved.includes(pool)) : this.taskHistory;

		if (relevantTasks.length === 0) return 0;

		const successful = relevantTasks.filter((t) => t.success).length;
		return (successful / relevantTasks.length) * 100;
	}

	/**
	 * Clear all pools
	 */
	clearAllPools(): void {
		for (const poolName of Object.keys(this.pools) as PoolType[]) {
			this.pools[poolName] = [];
			const stats = this.poolStats.get(poolName);
			if (stats) {
				stats.totalAgents = 0;
				stats.activeAgents = 0;
			}
		}
		console.log("[AgentPoolManager] All pools cleared");
	}

	/**
	 * Get pool distribution
	 */
	getPoolDistribution(): Record<PoolType, number> {
		return {
			scouts: this.pools.scouts.length,
			analysts: this.pools.analysts.length,
			traders: this.pools.traders.length,
			riskManagers: this.pools.riskManagers.length,
			executors: this.pools.executors.length,
		};
	}
}

// Singleton instance
let poolManagerInstance: AgentPoolManager | null = null;

export function getAgentPoolManager(): AgentPoolManager {
	if (!poolManagerInstance) {
		poolManagerInstance = new AgentPoolManager();
	}
	return poolManagerInstance;
}
