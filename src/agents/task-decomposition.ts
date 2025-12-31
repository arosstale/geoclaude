/**
 * Class 3.23: Task Decomposition Engine
 *
 * Breaks complex tasks into atomic subtasks with dependency ordering.
 * Based on TaskGen (arXiv 2407.15734) patterns.
 *
 * Features:
 * - Automatic task decomposition
 * - Dependency graph construction
 * - Topological sort for execution order
 * - Parallel execution of independent tasks
 * - Progress tracking and rollback
 *
 * @module task-decomposition
 */

import Database from "better-sqlite3";
import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export type TaskStatus = "pending" | "ready" | "running" | "completed" | "failed" | "skipped";

export type TaskPriority = "critical" | "high" | "medium" | "low";

export interface SubTask {
	id: string;
	parentId: string;
	description: string;
	dependencies: string[];
	status: TaskStatus;
	priority: TaskPriority;
	estimatedDuration: number;
	actualDuration?: number;
	result?: unknown;
	error?: string;
	retries: number;
	maxRetries: number;
	metadata: Record<string, unknown>;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
}

export interface TaskGraph {
	id: string;
	rootTask: string;
	subtasks: Map<string, SubTask>;
	adjacencyList: Map<string, string[]>; // task -> dependents
	reverseList: Map<string, string[]>; // task -> dependencies
	executionOrder: string[];
	parallelGroups: string[][];
	status: "pending" | "running" | "completed" | "failed";
	createdAt: number;
}

export interface DecompositionResult {
	graph: TaskGraph;
	subtaskCount: number;
	maxDepth: number;
	criticalPath: string[];
	estimatedDuration: number;
}

export interface ExecutionProgress {
	graphId: string;
	total: number;
	completed: number;
	failed: number;
	running: number;
	pending: number;
	percentComplete: number;
	currentTasks: string[];
	estimatedRemaining: number;
}

export interface DecompositionConfig {
	maxSubtasks: number;
	maxDepth: number;
	defaultMaxRetries: number;
	parallelLimit: number;
	enablePersistence: boolean;
	dbPath: string;
}

export interface DecompositionEvents {
	"graph:created": { graph: TaskGraph };
	"graph:completed": { graph: TaskGraph; results: Map<string, unknown> };
	"graph:failed": { graph: TaskGraph; error: Error };
	"task:started": { graph: TaskGraph; task: SubTask };
	"task:completed": { graph: TaskGraph; task: SubTask; result: unknown };
	"task:failed": { graph: TaskGraph; task: SubTask; error: Error };
	"task:retrying": { graph: TaskGraph; task: SubTask; attempt: number };
	"parallel:batch": { graph: TaskGraph; tasks: SubTask[] };
}

// =============================================================================
// Task Decomposition Engine
// =============================================================================

export class TaskDecompositionEngine extends EventEmitter {
	private db: Database.Database | null = null;
	private config: DecompositionConfig;
	private activeGraphs: Map<string, TaskGraph> = new Map();

	constructor(config: Partial<DecompositionConfig> = {}) {
		super();
		this.config = {
			maxSubtasks: 50,
			maxDepth: 5,
			defaultMaxRetries: 2,
			parallelLimit: 5,
			enablePersistence: true,
			dbPath: "./data/task-decomposition.db",
			...config,
		};

		if (this.config.enablePersistence) {
			this.initDatabase();
		}
	}

	private initDatabase(): void {
		this.db = new Database(this.config.dbPath, { fileMustExist: false });
		this.db.pragma("journal_mode = WAL");

		this.db.exec(`
			CREATE TABLE IF NOT EXISTS task_graphs (
				id TEXT PRIMARY KEY,
				root_task TEXT NOT NULL,
				status TEXT NOT NULL,
				subtasks_json TEXT,
				execution_order_json TEXT,
				parallel_groups_json TEXT,
				created_at INTEGER NOT NULL,
				completed_at INTEGER
			);

			CREATE TABLE IF NOT EXISTS subtasks (
				id TEXT PRIMARY KEY,
				graph_id TEXT NOT NULL,
				parent_id TEXT,
				description TEXT NOT NULL,
				dependencies_json TEXT,
				status TEXT NOT NULL,
				priority TEXT,
				result_json TEXT,
				error TEXT,
				retries INTEGER DEFAULT 0,
				created_at INTEGER NOT NULL,
				started_at INTEGER,
				completed_at INTEGER,
				FOREIGN KEY (graph_id) REFERENCES task_graphs(id)
			);

			CREATE INDEX IF NOT EXISTS idx_subtasks_graph ON subtasks(graph_id);
			CREATE INDEX IF NOT EXISTS idx_subtasks_status ON subtasks(status);
		`);
	}

	// ---------------------------------------------------------------------------
	// Decomposition
	// ---------------------------------------------------------------------------

	async decompose(
		task: string,
		decomposer: (
			task: string,
			depth: number,
		) => Promise<{
			subtasks: Array<{
				description: string;
				dependencies: string[];
				priority?: TaskPriority;
				estimatedDuration?: number;
			}>;
		}>,
		options?: { maxDepth?: number },
	): Promise<DecompositionResult> {
		const graphId = `graph_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const maxDepth = options?.maxDepth || this.config.maxDepth;

		const graph: TaskGraph = {
			id: graphId,
			rootTask: task,
			subtasks: new Map(),
			adjacencyList: new Map(),
			reverseList: new Map(),
			executionOrder: [],
			parallelGroups: [],
			status: "pending",
			createdAt: Date.now(),
		};

		// Create root task
		const rootId = `task_0`;
		const rootSubtask: SubTask = {
			id: rootId,
			parentId: "",
			description: task,
			dependencies: [],
			status: "pending",
			priority: "high",
			estimatedDuration: 0,
			retries: 0,
			maxRetries: this.config.defaultMaxRetries,
			metadata: { isRoot: true },
			createdAt: Date.now(),
		};
		graph.subtasks.set(rootId, rootSubtask);

		// Decompose recursively
		await this.decomposeRecursive(graph, rootId, decomposer, 0, maxDepth);

		// Build dependency graph
		this.buildDependencyGraph(graph);

		// Calculate execution order (topological sort)
		graph.executionOrder = this.topologicalSort(graph);

		// Group parallel tasks
		graph.parallelGroups = this.groupParallelTasks(graph);

		// Calculate critical path
		const criticalPath = this.calculateCriticalPath(graph);

		// Estimate total duration
		const estimatedDuration = this.estimateTotalDuration(graph, criticalPath);

		// Calculate max depth
		const maxGraphDepth = this.calculateMaxDepth(graph);

		this.activeGraphs.set(graphId, graph);
		this.persistGraph(graph);
		this.emit("graph:created", { graph });

		return {
			graph,
			subtaskCount: graph.subtasks.size,
			maxDepth: maxGraphDepth,
			criticalPath,
			estimatedDuration,
		};
	}

	private async decomposeRecursive(
		graph: TaskGraph,
		parentId: string,
		decomposer: (
			task: string,
			depth: number,
		) => Promise<{
			subtasks: Array<{
				description: string;
				dependencies: string[];
				priority?: TaskPriority;
				estimatedDuration?: number;
			}>;
		}>,
		depth: number,
		maxDepth: number,
	): Promise<void> {
		if (depth >= maxDepth || graph.subtasks.size >= this.config.maxSubtasks) {
			return;
		}

		const parentTask = graph.subtasks.get(parentId);
		if (!parentTask) return;

		try {
			const result = await decomposer(parentTask.description, depth);

			for (let i = 0; i < result.subtasks.length; i++) {
				const subtaskDef = result.subtasks[i];
				const subtaskId = `task_${graph.subtasks.size}`;

				const subtask: SubTask = {
					id: subtaskId,
					parentId,
					description: subtaskDef.description,
					dependencies: subtaskDef.dependencies.map((d) => {
						// Map relative dependencies to absolute IDs
						const depIndex = parseInt(d, 10);
						if (!Number.isNaN(depIndex) && depIndex < i) {
							return `task_${graph.subtasks.size - i + depIndex}`;
						}
						return d;
					}),
					status: "pending",
					priority: subtaskDef.priority || "medium",
					estimatedDuration: subtaskDef.estimatedDuration || 1000,
					retries: 0,
					maxRetries: this.config.defaultMaxRetries,
					metadata: { depth },
					createdAt: Date.now(),
				};

				graph.subtasks.set(subtaskId, subtask);

				// Recursively decompose if task is complex
				if (depth < maxDepth - 1 && this.isComplexTask(subtaskDef.description)) {
					await this.decomposeRecursive(graph, subtaskId, decomposer, depth + 1, maxDepth);
				}
			}
		} catch (error) {
			console.error(`Decomposition failed at depth ${depth}:`, error);
		}
	}

	private isComplexTask(description: string): boolean {
		// Heuristic: tasks with multiple verbs or "and" are complex
		const complexIndicators = [" and ", " then ", " after ", " before ", " while "];
		return complexIndicators.some((indicator) => description.toLowerCase().includes(indicator));
	}

	// ---------------------------------------------------------------------------
	// Graph Operations
	// ---------------------------------------------------------------------------

	private buildDependencyGraph(graph: TaskGraph): void {
		// Initialize adjacency lists
		for (const [id] of graph.subtasks) {
			graph.adjacencyList.set(id, []);
			graph.reverseList.set(id, []);
		}

		// Build edges
		for (const [id, task] of graph.subtasks) {
			for (const depId of task.dependencies) {
				if (graph.subtasks.has(depId)) {
					// depId -> id (dependent)
					const dependents = graph.adjacencyList.get(depId) || [];
					dependents.push(id);
					graph.adjacencyList.set(depId, dependents);

					// id -> depId (reverse)
					const deps = graph.reverseList.get(id) || [];
					deps.push(depId);
					graph.reverseList.set(id, deps);
				}
			}
		}
	}

	private topologicalSort(graph: TaskGraph): string[] {
		const inDegree = new Map<string, number>();
		const queue: string[] = [];
		const result: string[] = [];

		// Calculate in-degrees
		for (const [id] of graph.subtasks) {
			const deps = graph.reverseList.get(id) || [];
			inDegree.set(id, deps.length);
			if (deps.length === 0) {
				queue.push(id);
			}
		}

		// Process queue
		while (queue.length > 0) {
			const current = queue.shift()!;
			result.push(current);

			const dependents = graph.adjacencyList.get(current) || [];
			for (const dep of dependents) {
				const degree = (inDegree.get(dep) || 0) - 1;
				inDegree.set(dep, degree);
				if (degree === 0) {
					queue.push(dep);
				}
			}
		}

		// Check for cycles
		if (result.length !== graph.subtasks.size) {
			console.warn("Cycle detected in task graph");
		}

		return result;
	}

	private groupParallelTasks(graph: TaskGraph): string[][] {
		const groups: string[][] = [];
		const completed = new Set<string>();

		while (completed.size < graph.subtasks.size) {
			const group: string[] = [];

			for (const [id, task] of graph.subtasks) {
				if (completed.has(id)) continue;

				// Check if all dependencies are completed
				const allDepsCompleted = task.dependencies.every((d) => completed.has(d));
				if (allDepsCompleted) {
					group.push(id);
				}
			}

			if (group.length === 0) break; // Prevent infinite loop

			groups.push(group);
			group.forEach((id) => completed.add(id));
		}

		return groups;
	}

	private calculateCriticalPath(graph: TaskGraph): string[] {
		const distances = new Map<string, number>();
		const predecessors = new Map<string, string>();

		// Initialize
		for (const [id, task] of graph.subtasks) {
			distances.set(id, task.dependencies.length === 0 ? task.estimatedDuration : -Infinity);
		}

		// Process in topological order
		for (const id of graph.executionOrder) {
			const _task = graph.subtasks.get(id)!;
			const currentDist = distances.get(id)!;

			const dependents = graph.adjacencyList.get(id) || [];
			for (const depId of dependents) {
				const depTask = graph.subtasks.get(depId)!;
				const newDist = currentDist + depTask.estimatedDuration;

				if (newDist > (distances.get(depId) || -Infinity)) {
					distances.set(depId, newDist);
					predecessors.set(depId, id);
				}
			}
		}

		// Find end node (max distance)
		let endNode = "";
		let maxDist = -Infinity;
		for (const [id, dist] of distances) {
			if (dist > maxDist) {
				maxDist = dist;
				endNode = id;
			}
		}

		// Reconstruct path
		const path: string[] = [];
		let current = endNode;
		while (current) {
			path.unshift(current);
			current = predecessors.get(current) || "";
		}

		return path;
	}

	private calculateMaxDepth(graph: TaskGraph): number {
		let maxDepth = 0;
		for (const [, task] of graph.subtasks) {
			const depth = (task.metadata.depth as number) || 0;
			if (depth > maxDepth) maxDepth = depth;
		}
		return maxDepth;
	}

	private estimateTotalDuration(graph: TaskGraph, criticalPath: string[]): number {
		return criticalPath.reduce((sum, id) => {
			const task = graph.subtasks.get(id);
			return sum + (task?.estimatedDuration || 0);
		}, 0);
	}

	// ---------------------------------------------------------------------------
	// Execution
	// ---------------------------------------------------------------------------

	async execute(
		graph: TaskGraph,
		executor: (task: SubTask) => Promise<unknown>,
		options?: { parallelLimit?: number },
	): Promise<Map<string, unknown>> {
		const parallelLimit = options?.parallelLimit || this.config.parallelLimit;
		const results = new Map<string, unknown>();

		graph.status = "running";

		try {
			for (const group of graph.parallelGroups) {
				// Execute group in parallel with limit
				const batches = this.chunkArray(group, parallelLimit);

				for (const batch of batches) {
					this.emit("parallel:batch", {
						graph,
						tasks: batch.map((id) => graph.subtasks.get(id)!),
					});

					await Promise.all(
						batch.map(async (taskId) => {
							const task = graph.subtasks.get(taskId)!;
							await this.executeTask(graph, task, executor, results);
						}),
					);
				}
			}

			graph.status = "completed";
			this.emit("graph:completed", { graph, results });
		} catch (error) {
			graph.status = "failed";
			this.emit("graph:failed", { graph, error: error as Error });
			throw error;
		}

		this.persistGraph(graph);
		return results;
	}

	private async executeTask(
		graph: TaskGraph,
		task: SubTask,
		executor: (task: SubTask) => Promise<unknown>,
		results: Map<string, unknown>,
	): Promise<void> {
		// Check dependencies
		for (const depId of task.dependencies) {
			const depTask = graph.subtasks.get(depId);
			if (depTask?.status !== "completed") {
				task.status = "skipped";
				return;
			}
		}

		task.status = "running";
		task.startedAt = Date.now();
		this.emit("task:started", { graph, task });

		while (task.retries <= task.maxRetries) {
			try {
				const result = await executor(task);
				task.result = result;
				task.status = "completed";
				task.completedAt = Date.now();
				task.actualDuration = task.completedAt - task.startedAt!;
				results.set(task.id, result);
				this.emit("task:completed", { graph, task, result });
				return;
			} catch (error) {
				task.retries++;

				if (task.retries <= task.maxRetries) {
					this.emit("task:retrying", { graph, task, attempt: task.retries });
					await this.delay(1000 * task.retries); // Exponential backoff
				} else {
					task.error = error instanceof Error ? error.message : String(error);
					task.status = "failed";
					task.completedAt = Date.now();
					this.emit("task:failed", { graph, task, error: error as Error });
					throw error;
				}
			}
		}
	}

	// ---------------------------------------------------------------------------
	// Progress Tracking
	// ---------------------------------------------------------------------------

	getProgress(graphId: string): ExecutionProgress | null {
		const graph = this.activeGraphs.get(graphId);
		if (!graph) return null;

		let completed = 0;
		let failed = 0;
		let running = 0;
		let pending = 0;
		const currentTasks: string[] = [];
		let remainingDuration = 0;

		for (const [, task] of graph.subtasks) {
			switch (task.status) {
				case "completed":
					completed++;
					break;
				case "failed":
					failed++;
					break;
				case "running":
					running++;
					currentTasks.push(task.description);
					break;
				default:
					pending++;
					remainingDuration += task.estimatedDuration;
			}
		}

		const total = graph.subtasks.size;

		return {
			graphId,
			total,
			completed,
			failed,
			running,
			pending,
			percentComplete: Math.round((completed / total) * 100),
			currentTasks,
			estimatedRemaining: remainingDuration,
		};
	}

	// ---------------------------------------------------------------------------
	// Utility Methods
	// ---------------------------------------------------------------------------

	private chunkArray<T>(array: T[], size: number): T[][] {
		const chunks: T[][] = [];
		for (let i = 0; i < array.length; i += size) {
			chunks.push(array.slice(i, i + size));
		}
		return chunks;
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private persistGraph(graph: TaskGraph): void {
		if (!this.db) return;

		const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO task_graphs
			(id, root_task, status, subtasks_json, execution_order_json, parallel_groups_json, created_at, completed_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`);

		const subtasksObj: Record<string, SubTask> = {};
		graph.subtasks.forEach((v, k) => {
			subtasksObj[k] = v;
		});

		stmt.run(
			graph.id,
			graph.rootTask,
			graph.status,
			JSON.stringify(subtasksObj),
			JSON.stringify(graph.executionOrder),
			JSON.stringify(graph.parallelGroups),
			graph.createdAt,
			graph.status === "completed" || graph.status === "failed" ? Date.now() : null,
		);
	}

	// ---------------------------------------------------------------------------
	// Query Methods
	// ---------------------------------------------------------------------------

	getActiveGraphs(): TaskGraph[] {
		return Array.from(this.activeGraphs.values());
	}

	getGraph(graphId: string): TaskGraph | null {
		return this.activeGraphs.get(graphId) || null;
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: TaskDecompositionEngine | null = null;

export function getTaskDecomposition(config?: Partial<DecompositionConfig>): TaskDecompositionEngine {
	if (!instance) {
		instance = new TaskDecompositionEngine(config);
	}
	return instance;
}

export function resetTaskDecomposition(): void {
	if (instance) {
		instance.close();
		instance = null;
	}
}
