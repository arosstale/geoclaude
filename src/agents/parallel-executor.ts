/**
 * Class 3.25: Parallel Tool Executor
 *
 * Executes multiple independent tool calls in parallel.
 * Optimizes throughput while respecting dependencies.
 *
 * Features:
 * - Automatic dependency detection
 * - Parallel execution with concurrency limit
 * - Result aggregation
 * - Error isolation (one failure doesn't stop others)
 * - Timeout handling per tool
 *
 * @module parallel-executor
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export interface ToolCall {
	id: string;
	tool: string;
	params: Record<string, unknown>;
	dependencies?: string[]; // IDs of tool calls this depends on
	timeout?: number;
	priority?: number;
	metadata?: Record<string, unknown>;
}

export interface ToolResult {
	id: string;
	tool: string;
	success: boolean;
	result?: unknown;
	error?: string;
	duration: number;
	startedAt: number;
	completedAt: number;
}

export interface ExecutionPlan {
	id: string;
	calls: ToolCall[];
	batches: string[][];
	dependencies: Map<string, string[]>;
	estimatedDuration: number;
}

export interface BatchResult {
	batchIndex: number;
	results: ToolResult[];
	duration: number;
	allSucceeded: boolean;
}

export interface ParallelExecutionResult {
	planId: string;
	results: Map<string, ToolResult>;
	batches: BatchResult[];
	totalDuration: number;
	successCount: number;
	failureCount: number;
	parallelEfficiency: number;
}

export interface ParallelExecutorConfig {
	maxConcurrency: number;
	defaultTimeout: number;
	continueOnError: boolean;
	retryOnTimeout: boolean;
	maxRetries: number;
}

export interface ParallelExecutorEvents {
	"plan:created": { plan: ExecutionPlan };
	"batch:started": { planId: string; batchIndex: number; calls: ToolCall[] };
	"batch:completed": { planId: string; batch: BatchResult };
	"tool:started": { planId: string; call: ToolCall };
	"tool:completed": { planId: string; result: ToolResult };
	"tool:failed": { planId: string; call: ToolCall; error: Error };
	"execution:completed": { result: ParallelExecutionResult };
}

export type ToolExecutor = (tool: string, params: Record<string, unknown>) => Promise<unknown>;

// =============================================================================
// Parallel Executor
// =============================================================================

export class ParallelExecutor extends EventEmitter {
	private config: ParallelExecutorConfig;
	private executionHistory: Map<string, ParallelExecutionResult> = new Map();

	constructor(config: Partial<ParallelExecutorConfig> = {}) {
		super();
		this.config = {
			maxConcurrency: 5,
			defaultTimeout: 30000,
			continueOnError: true,
			retryOnTimeout: true,
			maxRetries: 1,
			...config,
		};
	}

	// ---------------------------------------------------------------------------
	// Planning
	// ---------------------------------------------------------------------------

	createPlan(calls: ToolCall[]): ExecutionPlan {
		const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

		// Build dependency map
		const dependencies = new Map<string, string[]>();
		for (const call of calls) {
			dependencies.set(call.id, call.dependencies || []);
		}

		// Create execution batches (topological sort)
		const batches = this.createBatches(calls, dependencies);

		// Estimate duration (sum of longest in each batch)
		const estimatedDuration = batches.reduce((sum, batch) => {
			const maxTimeout = Math.max(
				...batch.map((id) => {
					const call = calls.find((c) => c.id === id);
					return call?.timeout || this.config.defaultTimeout;
				})
			);
			return sum + maxTimeout;
		}, 0);

		const plan: ExecutionPlan = {
			id: planId,
			calls,
			batches,
			dependencies,
			estimatedDuration,
		};

		this.emit("plan:created", { plan });
		return plan;
	}

	private createBatches(calls: ToolCall[], dependencies: Map<string, string[]>): string[][] {
		const batches: string[][] = [];
		const completed = new Set<string>();
		const remaining = new Set(calls.map((c) => c.id));

		while (remaining.size > 0) {
			const batch: string[] = [];

			for (const id of remaining) {
				const deps = dependencies.get(id) || [];
				const allDepsCompleted = deps.every((d) => completed.has(d));

				if (allDepsCompleted) {
					batch.push(id);
				}
			}

			if (batch.length === 0) {
				// Circular dependency or missing dependency
				console.warn("Could not resolve all dependencies, adding remaining");
				batch.push(...remaining);
			}

			// Sort batch by priority
			batch.sort((a, b) => {
				const callA = calls.find((c) => c.id === a);
				const callB = calls.find((c) => c.id === b);
				return (callB?.priority || 0) - (callA?.priority || 0);
			});

			batches.push(batch);

			for (const id of batch) {
				completed.add(id);
				remaining.delete(id);
			}
		}

		return batches;
	}

	// ---------------------------------------------------------------------------
	// Execution
	// ---------------------------------------------------------------------------

	async execute(
		calls: ToolCall[],
		executor: ToolExecutor
	): Promise<ParallelExecutionResult> {
		const plan = this.createPlan(calls);
		return this.executePlan(plan, executor);
	}

	async executePlan(
		plan: ExecutionPlan,
		executor: ToolExecutor
	): Promise<ParallelExecutionResult> {
		const startTime = Date.now();
		const results = new Map<string, ToolResult>();
		const batchResults: BatchResult[] = [];

		let successCount = 0;
		let failureCount = 0;
		let sequentialTime = 0;

		for (let batchIndex = 0; batchIndex < plan.batches.length; batchIndex++) {
			const batchIds = plan.batches[batchIndex];
			const batchCalls = batchIds
				.map((id) => plan.calls.find((c) => c.id === id)!)
				.filter(Boolean);

			this.emit("batch:started", { planId: plan.id, batchIndex, calls: batchCalls });

			const batchStart = Date.now();
			const batchToolResults = await this.executeBatch(plan.id, batchCalls, executor, results);

			for (const result of batchToolResults) {
				results.set(result.id, result);
				sequentialTime += result.duration;

				if (result.success) {
					successCount++;
				} else {
					failureCount++;

					if (!this.config.continueOnError) {
						// Stop execution
						break;
					}
				}
			}

			const batchResult: BatchResult = {
				batchIndex,
				results: batchToolResults,
				duration: Date.now() - batchStart,
				allSucceeded: batchToolResults.every((r) => r.success),
			};

			batchResults.push(batchResult);
			this.emit("batch:completed", { planId: plan.id, batch: batchResult });

			if (!this.config.continueOnError && !batchResult.allSucceeded) {
				break;
			}
		}

		const totalDuration = Date.now() - startTime;

		// Calculate parallel efficiency
		// Efficiency = (sum of individual durations) / (actual total duration * concurrency)
		const parallelEfficiency =
			totalDuration > 0 ? sequentialTime / (totalDuration * this.config.maxConcurrency) : 1;

		const result: ParallelExecutionResult = {
			planId: plan.id,
			results,
			batches: batchResults,
			totalDuration,
			successCount,
			failureCount,
			parallelEfficiency: Math.min(1, parallelEfficiency),
		};

		this.executionHistory.set(plan.id, result);
		this.emit("execution:completed", { result });

		return result;
	}

	private async executeBatch(
		planId: string,
		calls: ToolCall[],
		executor: ToolExecutor,
		previousResults: Map<string, ToolResult>
	): Promise<ToolResult[]> {
		// Chunk by concurrency limit
		const chunks = this.chunk(calls, this.config.maxConcurrency);
		const results: ToolResult[] = [];

		for (const chunk of chunks) {
			const chunkResults = await Promise.all(
				chunk.map((call) => this.executeCall(planId, call, executor, previousResults))
			);
			results.push(...chunkResults);
		}

		return results;
	}

	private async executeCall(
		planId: string,
		call: ToolCall,
		executor: ToolExecutor,
		previousResults: Map<string, ToolResult>
	): Promise<ToolResult> {
		const startedAt = Date.now();
		const timeout = call.timeout || this.config.defaultTimeout;

		this.emit("tool:started", { planId, call });

		// Inject dependency results into params if needed
		const enrichedParams = this.enrichParams(call.params, call.dependencies, previousResults);

		let attempts = 0;
		const maxAttempts = this.config.maxRetries + 1;

		while (attempts < maxAttempts) {
			attempts++;

			try {
				const result = await this.withTimeout(executor(call.tool, enrichedParams), timeout);

				const toolResult: ToolResult = {
					id: call.id,
					tool: call.tool,
					success: true,
					result,
					duration: Date.now() - startedAt,
					startedAt,
					completedAt: Date.now(),
				};

				this.emit("tool:completed", { planId, result: toolResult });
				return toolResult;
			} catch (error) {
				const isTimeout = error instanceof Error && error.message.includes("timeout");

				if (isTimeout && this.config.retryOnTimeout && attempts < maxAttempts) {
					continue; // Retry
				}

				const toolResult: ToolResult = {
					id: call.id,
					tool: call.tool,
					success: false,
					error: error instanceof Error ? error.message : String(error),
					duration: Date.now() - startedAt,
					startedAt,
					completedAt: Date.now(),
				};

				this.emit("tool:failed", { planId, call, error: error as Error });
				return toolResult;
			}
		}

		// Should not reach here, but safety fallback
		return {
			id: call.id,
			tool: call.tool,
			success: false,
			error: "Max retries exceeded",
			duration: Date.now() - startedAt,
			startedAt,
			completedAt: Date.now(),
		};
	}

	private enrichParams(
		params: Record<string, unknown>,
		dependencies: string[] | undefined,
		previousResults: Map<string, ToolResult>
	): Record<string, unknown> {
		if (!dependencies || dependencies.length === 0) {
			return params;
		}

		const enriched = { ...params };

		// Add __dependencies with results from dependent calls
		const depResults: Record<string, unknown> = {};
		for (const depId of dependencies) {
			const depResult = previousResults.get(depId);
			if (depResult?.success) {
				depResults[depId] = depResult.result;
			}
		}

		if (Object.keys(depResults).length > 0) {
			enriched.__dependencies = depResults;
		}

		return enriched;
	}

	// ---------------------------------------------------------------------------
	// Utility Methods
	// ---------------------------------------------------------------------------

	private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
		return Promise.race([
			promise,
			new Promise<T>((_, reject) =>
				setTimeout(() => reject(new Error(`Tool execution timeout after ${ms}ms`)), ms)
			),
		]);
	}

	private chunk<T>(array: T[], size: number): T[][] {
		const chunks: T[][] = [];
		for (let i = 0; i < array.length; i += size) {
			chunks.push(array.slice(i, i + size));
		}
		return chunks;
	}

	// ---------------------------------------------------------------------------
	// Convenience Methods
	// ---------------------------------------------------------------------------

	/**
	 * Execute multiple independent tools in parallel (no dependencies)
	 */
	async executeParallel(
		tools: Array<{ tool: string; params: Record<string, unknown> }>,
		executor: ToolExecutor
	): Promise<Map<string, unknown>> {
		const calls: ToolCall[] = tools.map((t, i) => ({
			id: `call_${i}`,
			tool: t.tool,
			params: t.params,
		}));

		const result = await this.execute(calls, executor);

		const outputs = new Map<string, unknown>();
		for (const [id, toolResult] of result.results) {
			if (toolResult.success) {
				outputs.set(id, toolResult.result);
			}
		}

		return outputs;
	}

	/**
	 * Execute tools in sequence (each depends on previous)
	 */
	async executeSequential(
		tools: Array<{ tool: string; params: Record<string, unknown> }>,
		executor: ToolExecutor
	): Promise<Map<string, unknown>> {
		const calls: ToolCall[] = tools.map((t, i) => ({
			id: `call_${i}`,
			tool: t.tool,
			params: t.params,
			dependencies: i > 0 ? [`call_${i - 1}`] : [],
		}));

		const result = await this.execute(calls, executor);

		const outputs = new Map<string, unknown>();
		for (const [id, toolResult] of result.results) {
			if (toolResult.success) {
				outputs.set(id, toolResult.result);
			}
		}

		return outputs;
	}

	/**
	 * Execute with auto-detected dependencies based on param references
	 */
	async executeWithAutoDetect(
		tools: Array<{ id: string; tool: string; params: Record<string, unknown> }>,
		executor: ToolExecutor
	): Promise<Map<string, unknown>> {
		// Detect dependencies from params that reference other tool IDs
		const calls: ToolCall[] = tools.map((t) => {
			const deps: string[] = [];

			// Look for $ref patterns in params
			const findRefs = (obj: unknown): void => {
				if (typeof obj === "string" && obj.startsWith("$ref:")) {
					const refId = obj.slice(5);
					if (tools.some((tool) => tool.id === refId)) {
						deps.push(refId);
					}
				} else if (typeof obj === "object" && obj !== null) {
					for (const value of Object.values(obj)) {
						findRefs(value);
					}
				}
			};

			findRefs(t.params);

			return {
				id: t.id,
				tool: t.tool,
				params: t.params,
				dependencies: deps,
			};
		});

		const result = await this.execute(calls, executor);

		const outputs = new Map<string, unknown>();
		for (const [id, toolResult] of result.results) {
			if (toolResult.success) {
				outputs.set(id, toolResult.result);
			}
		}

		return outputs;
	}

	// ---------------------------------------------------------------------------
	// Query Methods
	// ---------------------------------------------------------------------------

	getExecutionHistory(planId?: string): ParallelExecutionResult | ParallelExecutionResult[] | null {
		if (planId) {
			return this.executionHistory.get(planId) || null;
		}
		return Array.from(this.executionHistory.values());
	}

	getStats(): {
		totalExecutions: number;
		avgSuccessRate: number;
		avgParallelEfficiency: number;
		avgBatchCount: number;
	} {
		const executions = Array.from(this.executionHistory.values());
		if (executions.length === 0) {
			return {
				totalExecutions: 0,
				avgSuccessRate: 0,
				avgParallelEfficiency: 0,
				avgBatchCount: 0,
			};
		}

		const totalSuccess = executions.reduce((sum, e) => sum + e.successCount, 0);
		const totalCalls = executions.reduce((sum, e) => sum + e.successCount + e.failureCount, 0);
		const totalEfficiency = executions.reduce((sum, e) => sum + e.parallelEfficiency, 0);
		const totalBatches = executions.reduce((sum, e) => sum + e.batches.length, 0);

		return {
			totalExecutions: executions.length,
			avgSuccessRate: totalCalls > 0 ? totalSuccess / totalCalls : 0,
			avgParallelEfficiency: totalEfficiency / executions.length,
			avgBatchCount: totalBatches / executions.length,
		};
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	clearHistory(): void {
		this.executionHistory.clear();
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: ParallelExecutor | null = null;

export function getParallelExecutor(config?: Partial<ParallelExecutorConfig>): ParallelExecutor {
	if (!instance) {
		instance = new ParallelExecutor(config);
	}
	return instance;
}

export function resetParallelExecutor(): void {
	if (instance) {
		instance.clearHistory();
	}
	instance = null;
}
