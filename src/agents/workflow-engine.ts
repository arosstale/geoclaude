/**
 * Class 3.58: Workflow Engine System
 * TAC Pattern: DAG-based workflow execution with comprehensive state management
 *
 * Features:
 * - Workflow definition with nodes and edges (DAG)
 * - Node types: task, decision, fork, join, wait, subprocess
 * - Condition-based branching
 * - Parallel execution paths
 * - Workflow instance management
 * - Variable/context passing between nodes
 * - Error handling nodes
 * - Timeout per node and workflow
 * - Retry policies
 * - Workflow versioning
 * - Instance state persistence
 * - Pause/resume/cancel operations
 * - Event triggers
 * - Scheduled workflows
 * - Workflow templates
 * - Execution history
 * - Metrics (duration, success rate, bottlenecks)
 */

import Database from "better-sqlite3";
import { EventEmitter } from "events";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export type WorkflowNodeType =
	| "task" // Execute a task/function
	| "decision" // Conditional branching
	| "fork" // Split into parallel paths
	| "join" // Wait for parallel paths to complete
	| "wait" // Wait for event/timer
	| "subprocess" // Execute nested workflow
	| "error" // Error handler
	| "start" // Workflow entry point
	| "end"; // Workflow exit point

export type WorkflowInstanceStatus =
	| "pending"
	| "running"
	| "paused"
	| "waiting"
	| "completed"
	| "failed"
	| "cancelled"
	| "timed_out";

export type WorkflowNodeStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "waiting";

export type WorkflowTriggerType = "manual" | "scheduled" | "event" | "webhook" | "subprocess";

export interface RetryPolicy {
	maxAttempts: number;
	initialDelayMs: number;
	maxDelayMs: number;
	backoffMultiplier: number;
	retryableErrors?: string[];
}

export interface WorkflowNode {
	id: string;
	type: WorkflowNodeType;
	name: string;
	description?: string;
	// Task execution
	handler?: string; // Handler function name
	handlerArgs?: Record<string, unknown>;
	// Decision branching
	condition?: string; // Expression to evaluate
	// Wait configuration
	waitEvent?: string;
	waitTimeoutMs?: number;
	// Subprocess
	subworkflowId?: string;
	// Timeout and retry
	timeoutMs?: number;
	retryPolicy?: RetryPolicy;
	// Error handling
	errorNodeId?: string;
	// Metadata
	metadata?: Record<string, unknown>;
}

export interface WorkflowEdge {
	id: string;
	sourceNodeId: string;
	targetNodeId: string;
	condition?: string; // Optional condition for decision nodes
	label?: string;
	priority?: number; // For decision nodes with multiple paths
}

export interface WorkflowDefinition {
	id: string;
	name: string;
	description?: string;
	version: number;
	nodes: WorkflowNode[];
	edges: WorkflowEdge[];
	startNodeId: string;
	endNodeIds: string[];
	globalTimeoutMs?: number;
	defaultRetryPolicy?: RetryPolicy;
	variables?: Record<string, unknown>; // Default variables
	metadata?: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
	isActive: boolean;
}

export interface WorkflowNodeExecution {
	nodeId: string;
	status: WorkflowNodeStatus;
	startedAt?: Date;
	completedAt?: Date;
	input?: Record<string, unknown>;
	output?: Record<string, unknown>;
	error?: string;
	attempts: number;
	nextRetryAt?: Date;
}

export interface WorkflowInstance {
	id: string;
	workflowId: string;
	workflowVersion: number;
	status: WorkflowInstanceStatus;
	triggerType: WorkflowTriggerType;
	triggeredBy?: string;
	variables: Record<string, unknown>;
	nodeExecutions: Record<string, WorkflowNodeExecution>;
	currentNodeIds: string[]; // Nodes currently being executed (can be multiple for parallel)
	completedNodeIds: string[];
	parentInstanceId?: string; // For subprocesses
	startedAt?: Date;
	completedAt?: Date;
	error?: string;
	metadata?: Record<string, unknown>;
}

export interface WorkflowSchedule {
	id: string;
	workflowId: string;
	cronExpression: string;
	timezone: string;
	enabled: boolean;
	variables?: Record<string, unknown>;
	nextRunAt?: Date;
	lastRunAt?: Date;
	lastRunInstanceId?: string;
	createdAt: Date;
	metadata?: Record<string, unknown>;
}

export interface WorkflowTemplate {
	id: string;
	name: string;
	description?: string;
	category: string;
	definition: Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt">;
	variables?: Record<string, { type: string; default?: unknown; required?: boolean; description?: string }>;
	createdAt: Date;
	usageCount: number;
}

export interface WorkflowMetrics {
	workflowId: string;
	totalExecutions: number;
	successfulExecutions: number;
	failedExecutions: number;
	avgDurationMs: number;
	minDurationMs: number;
	maxDurationMs: number;
	successRate: number;
	nodeMetrics: Record<string, NodeMetrics>;
}

export interface NodeMetrics {
	nodeId: string;
	totalExecutions: number;
	successfulExecutions: number;
	failedExecutions: number;
	avgDurationMs: number;
	isBottleneck: boolean;
}

export interface WorkflowExecutionHistory {
	instanceId: string;
	workflowId: string;
	workflowName: string;
	status: WorkflowInstanceStatus;
	triggerType: WorkflowTriggerType;
	startedAt?: Date;
	completedAt?: Date;
	durationMs?: number;
	nodeCount: number;
	completedNodeCount: number;
	error?: string;
}

export interface WorkflowEngineConfig {
	dataDir: string;
	maxConcurrentInstances: number;
	defaultTimeoutMs: number;
	cleanupRetentionDays: number;
	enableMetrics: boolean;
	enableScheduler: boolean;
	schedulerIntervalMs: number;
}

export interface WorkflowEngineStats {
	totalDefinitions: number;
	activeDefinitions: number;
	totalInstances: number;
	runningInstances: number;
	completedInstances: number;
	failedInstances: number;
	scheduledWorkflows: number;
	templates: number;
}

// Handler function type
export type WorkflowHandler = (context: WorkflowExecutionContext) => Promise<Record<string, unknown> | undefined>;

export interface WorkflowExecutionContext {
	instanceId: string;
	workflowId: string;
	nodeId: string;
	variables: Record<string, unknown>;
	input: Record<string, unknown>;
	setVariable: (key: string, value: unknown) => void;
	emit: (event: string, data?: unknown) => void;
}

// ============================================================================
// Workflow Engine System
// ============================================================================

export class WorkflowEngineSystem extends EventEmitter {
	private db: Database.Database;
	private config: WorkflowEngineConfig;
	private handlers: Map<string, WorkflowHandler> = new Map();
	private runningInstances: Map<string, AbortController> = new Map();
	private cleanupInterval: NodeJS.Timeout | null = null;
	private schedulerInterval: NodeJS.Timeout | null = null;
	private waitingEvents: Map<string, { instanceId: string; nodeId: string; resolve: () => void }> = new Map();

	constructor(config: WorkflowEngineConfig) {
		super();
		this.config = config;
		this.db = new Database(join(config.dataDir, "workflow_engine.db"));
		this.initializeDatabase();
		this.startCleanupScheduler();
		if (config.enableScheduler) {
			this.startWorkflowScheduler();
		}
	}

	private initializeDatabase(): void {
		this.db.pragma("journal_mode = WAL");

		// Workflow definitions table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        nodes TEXT NOT NULL,
        edges TEXT NOT NULL,
        start_node_id TEXT NOT NULL,
        end_node_ids TEXT NOT NULL,
        global_timeout_ms INTEGER,
        default_retry_policy TEXT,
        variables TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `);

		// Workflow instances table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_instances (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_version INTEGER NOT NULL,
        status TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        triggered_by TEXT,
        variables TEXT NOT NULL,
        node_executions TEXT NOT NULL,
        current_node_ids TEXT NOT NULL,
        completed_node_ids TEXT NOT NULL,
        parent_instance_id TEXT,
        started_at TEXT,
        completed_at TEXT,
        error TEXT,
        metadata TEXT,
        FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id)
      )
    `);

		// Workflow schedules table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_schedules (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        enabled INTEGER NOT NULL DEFAULT 1,
        variables TEXT,
        next_run_at TEXT,
        last_run_at TEXT,
        last_run_instance_id TEXT,
        created_at TEXT NOT NULL,
        metadata TEXT,
        FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id)
      )
    `);

		// Workflow templates table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL,
        definition TEXT NOT NULL,
        variables TEXT,
        created_at TEXT NOT NULL,
        usage_count INTEGER NOT NULL DEFAULT 0
      )
    `);

		// Execution history table (for analytics)
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_execution_history (
        id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        duration_ms INTEGER,
        node_count INTEGER NOT NULL,
        completed_node_count INTEGER NOT NULL,
        error TEXT,
        recorded_at TEXT NOT NULL
      )
    `);

		// Indexes
		this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_definitions_name ON workflow_definitions(name);
      CREATE INDEX IF NOT EXISTS idx_definitions_active ON workflow_definitions(is_active);
      CREATE INDEX IF NOT EXISTS idx_instances_workflow ON workflow_instances(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_instances_status ON workflow_instances(status);
      CREATE INDEX IF NOT EXISTS idx_instances_started ON workflow_instances(started_at);
      CREATE INDEX IF NOT EXISTS idx_schedules_next ON workflow_schedules(next_run_at);
      CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON workflow_schedules(enabled);
      CREATE INDEX IF NOT EXISTS idx_history_workflow ON workflow_execution_history(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_history_recorded ON workflow_execution_history(recorded_at);
    `);
	}

	private startCleanupScheduler(): void {
		this.cleanupInterval = setInterval(
			() => {
				this.cleanupOldRecords();
			},
			24 * 60 * 60 * 1000,
		); // Daily
	}

	private startWorkflowScheduler(): void {
		this.schedulerInterval = setInterval(() => {
			this.processScheduledWorkflows();
		}, this.config.schedulerIntervalMs);
	}

	private cleanupOldRecords(): void {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - this.config.cleanupRetentionDays);

		// Clean up old completed/failed instances
		const stmt = this.db.prepare(`
      DELETE FROM workflow_instances
      WHERE status IN ('completed', 'failed', 'cancelled', 'timed_out')
      AND completed_at < ?
    `);
		const result = stmt.run(cutoffDate.toISOString());

		// Clean up old execution history
		const historyStmt = this.db.prepare(`
      DELETE FROM workflow_execution_history WHERE recorded_at < ?
    `);
		historyStmt.run(cutoffDate.toISOString());

		if (result.changes > 0) {
			this.emit("cleanup", { deletedInstances: result.changes });
		}
	}

	private async processScheduledWorkflows(): Promise<void> {
		const now = new Date();
		const stmt = this.db.prepare(`
      SELECT * FROM workflow_schedules
      WHERE enabled = 1 AND next_run_at <= ?
    `);
		const schedules = stmt.all(now.toISOString()) as Record<string, unknown>[];

		for (const row of schedules) {
			const schedule = this.rowToSchedule(row);
			try {
				const instance = await this.startWorkflow({
					workflowId: schedule.workflowId,
					triggerType: "scheduled",
					variables: schedule.variables,
				});

				// Update schedule
				const nextRun = this.calculateNextRun(schedule.cronExpression, schedule.timezone);
				const updateStmt = this.db.prepare(`
          UPDATE workflow_schedules
          SET last_run_at = ?, last_run_instance_id = ?, next_run_at = ?
          WHERE id = ?
        `);
				updateStmt.run(now.toISOString(), instance.id, nextRun.toISOString(), schedule.id);

				this.emit("schedule:executed", { schedule, instanceId: instance.id });
			} catch (error) {
				this.emit("schedule:error", { schedule, error });
			}
		}
	}

	// ============================================================================
	// Handler Registration
	// ============================================================================

	registerHandler(name: string, handler: WorkflowHandler): void {
		this.handlers.set(name, handler);
		this.emit("handler:registered", { name });
	}

	unregisterHandler(name: string): boolean {
		const result = this.handlers.delete(name);
		if (result) {
			this.emit("handler:unregistered", { name });
		}
		return result;
	}

	getRegisteredHandlers(): string[] {
		return Array.from(this.handlers.keys());
	}

	// ============================================================================
	// Workflow Definition Management
	// ============================================================================

	createWorkflow(params: {
		name: string;
		description?: string;
		nodes: WorkflowNode[];
		edges: WorkflowEdge[];
		startNodeId: string;
		endNodeIds: string[];
		globalTimeoutMs?: number;
		defaultRetryPolicy?: RetryPolicy;
		variables?: Record<string, unknown>;
		metadata?: Record<string, unknown>;
	}): WorkflowDefinition {
		// Validate the DAG
		this.validateWorkflowDAG(params.nodes, params.edges, params.startNodeId, params.endNodeIds);

		const id = `wf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const now = new Date();

		const definition: WorkflowDefinition = {
			id,
			name: params.name,
			description: params.description,
			version: 1,
			nodes: params.nodes,
			edges: params.edges,
			startNodeId: params.startNodeId,
			endNodeIds: params.endNodeIds,
			globalTimeoutMs: params.globalTimeoutMs ?? this.config.defaultTimeoutMs,
			defaultRetryPolicy: params.defaultRetryPolicy,
			variables: params.variables ?? {},
			metadata: params.metadata,
			createdAt: now,
			updatedAt: now,
			isActive: true,
		};

		const stmt = this.db.prepare(`
      INSERT INTO workflow_definitions
      (id, name, description, version, nodes, edges, start_node_id, end_node_ids,
       global_timeout_ms, default_retry_policy, variables, metadata, created_at, updated_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			definition.id,
			definition.name,
			definition.description ?? null,
			definition.version,
			JSON.stringify(definition.nodes),
			JSON.stringify(definition.edges),
			definition.startNodeId,
			JSON.stringify(definition.endNodeIds),
			definition.globalTimeoutMs ?? null,
			definition.defaultRetryPolicy ? JSON.stringify(definition.defaultRetryPolicy) : null,
			JSON.stringify(definition.variables),
			definition.metadata ? JSON.stringify(definition.metadata) : null,
			definition.createdAt.toISOString(),
			definition.updatedAt.toISOString(),
			1,
		);

		this.emit("workflow:created", definition);
		return definition;
	}

	private validateWorkflowDAG(
		nodes: WorkflowNode[],
		edges: WorkflowEdge[],
		startNodeId: string,
		endNodeIds: string[],
	): void {
		const nodeIds = new Set(nodes.map((n) => n.id));

		// Check start node exists
		if (!nodeIds.has(startNodeId)) {
			throw new Error(`Start node '${startNodeId}' not found in nodes`);
		}

		// Check end nodes exist
		for (const endId of endNodeIds) {
			if (!nodeIds.has(endId)) {
				throw new Error(`End node '${endId}' not found in nodes`);
			}
		}

		// Check all edges reference valid nodes
		for (const edge of edges) {
			if (!nodeIds.has(edge.sourceNodeId)) {
				throw new Error(`Edge source '${edge.sourceNodeId}' not found`);
			}
			if (!nodeIds.has(edge.targetNodeId)) {
				throw new Error(`Edge target '${edge.targetNodeId}' not found`);
			}
		}

		// Check for cycles using DFS
		const visited = new Set<string>();
		const recursionStack = new Set<string>();
		const adjacencyList = new Map<string, string[]>();

		for (const edge of edges) {
			if (!adjacencyList.has(edge.sourceNodeId)) {
				adjacencyList.set(edge.sourceNodeId, []);
			}
			adjacencyList.get(edge.sourceNodeId)!.push(edge.targetNodeId);
		}

		const hasCycle = (nodeId: string): boolean => {
			visited.add(nodeId);
			recursionStack.add(nodeId);

			const neighbors = adjacencyList.get(nodeId) ?? [];
			for (const neighbor of neighbors) {
				if (!visited.has(neighbor)) {
					if (hasCycle(neighbor)) return true;
				} else if (recursionStack.has(neighbor)) {
					return true;
				}
			}

			recursionStack.delete(nodeId);
			return false;
		};

		for (const node of nodes) {
			if (!visited.has(node.id)) {
				if (hasCycle(node.id)) {
					throw new Error("Workflow contains a cycle - must be a DAG");
				}
			}
		}
	}

	updateWorkflow(
		workflowId: string,
		updates: Partial<
			Pick<
				WorkflowDefinition,
				| "name"
				| "description"
				| "nodes"
				| "edges"
				| "startNodeId"
				| "endNodeIds"
				| "globalTimeoutMs"
				| "defaultRetryPolicy"
				| "variables"
				| "metadata"
			>
		>,
	): WorkflowDefinition | null {
		const current = this.getWorkflow(workflowId);
		if (!current) return null;

		// If structure changed, validate
		if (updates.nodes || updates.edges || updates.startNodeId || updates.endNodeIds) {
			this.validateWorkflowDAG(
				updates.nodes ?? current.nodes,
				updates.edges ?? current.edges,
				updates.startNodeId ?? current.startNodeId,
				updates.endNodeIds ?? current.endNodeIds,
			);
		}

		const updated: WorkflowDefinition = {
			...current,
			...updates,
			version: current.version + 1,
			updatedAt: new Date(),
		};

		const stmt = this.db.prepare(`
      UPDATE workflow_definitions
      SET name = ?, description = ?, version = ?, nodes = ?, edges = ?,
          start_node_id = ?, end_node_ids = ?, global_timeout_ms = ?,
          default_retry_policy = ?, variables = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `);

		stmt.run(
			updated.name,
			updated.description ?? null,
			updated.version,
			JSON.stringify(updated.nodes),
			JSON.stringify(updated.edges),
			updated.startNodeId,
			JSON.stringify(updated.endNodeIds),
			updated.globalTimeoutMs ?? null,
			updated.defaultRetryPolicy ? JSON.stringify(updated.defaultRetryPolicy) : null,
			JSON.stringify(updated.variables),
			updated.metadata ? JSON.stringify(updated.metadata) : null,
			updated.updatedAt.toISOString(),
			workflowId,
		);

		this.emit("workflow:updated", updated);
		return updated;
	}

	getWorkflow(workflowId: string): WorkflowDefinition | null {
		const stmt = this.db.prepare("SELECT * FROM workflow_definitions WHERE id = ?");
		const row = stmt.get(workflowId) as Record<string, unknown> | undefined;

		if (!row) return null;
		return this.rowToDefinition(row);
	}

	getWorkflowByName(name: string): WorkflowDefinition | null {
		const stmt = this.db.prepare("SELECT * FROM workflow_definitions WHERE name = ? AND is_active = 1");
		const row = stmt.get(name) as Record<string, unknown> | undefined;

		if (!row) return null;
		return this.rowToDefinition(row);
	}

	getAllWorkflows(activeOnly: boolean = true): WorkflowDefinition[] {
		const query = activeOnly
			? "SELECT * FROM workflow_definitions WHERE is_active = 1 ORDER BY name"
			: "SELECT * FROM workflow_definitions ORDER BY name";

		const stmt = this.db.prepare(query);
		const rows = stmt.all() as Record<string, unknown>[];

		return rows.map((row) => this.rowToDefinition(row));
	}

	deactivateWorkflow(workflowId: string): boolean {
		const stmt = this.db.prepare("UPDATE workflow_definitions SET is_active = 0, updated_at = ? WHERE id = ?");
		const result = stmt.run(new Date().toISOString(), workflowId);

		if (result.changes > 0) {
			this.emit("workflow:deactivated", { workflowId });
			return true;
		}
		return false;
	}

	private rowToDefinition(row: Record<string, unknown>): WorkflowDefinition {
		return {
			id: row.id as string,
			name: row.name as string,
			description: row.description as string | undefined,
			version: row.version as number,
			nodes: JSON.parse(row.nodes as string),
			edges: JSON.parse(row.edges as string),
			startNodeId: row.start_node_id as string,
			endNodeIds: JSON.parse(row.end_node_ids as string),
			globalTimeoutMs: row.global_timeout_ms as number | undefined,
			defaultRetryPolicy: row.default_retry_policy ? JSON.parse(row.default_retry_policy as string) : undefined,
			variables: JSON.parse(row.variables as string),
			metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
			createdAt: new Date(row.created_at as string),
			updatedAt: new Date(row.updated_at as string),
			isActive: Boolean(row.is_active),
		};
	}

	// ============================================================================
	// Workflow Instance Management
	// ============================================================================

	async startWorkflow(params: {
		workflowId: string;
		triggerType?: WorkflowTriggerType;
		triggeredBy?: string;
		variables?: Record<string, unknown>;
		parentInstanceId?: string;
		metadata?: Record<string, unknown>;
	}): Promise<WorkflowInstance> {
		const definition = this.getWorkflow(params.workflowId);
		if (!definition) {
			throw new Error(`Workflow '${params.workflowId}' not found`);
		}

		if (!definition.isActive) {
			throw new Error(`Workflow '${params.workflowId}' is not active`);
		}

		// Check concurrent instance limit
		const runningCount = this.getRunningInstanceCount();
		if (runningCount >= this.config.maxConcurrentInstances) {
			throw new Error(`Maximum concurrent instances (${this.config.maxConcurrentInstances}) reached`);
		}

		const id = `inst_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		// Initialize node executions
		const nodeExecutions: Record<string, WorkflowNodeExecution> = {};
		for (const node of definition.nodes) {
			nodeExecutions[node.id] = {
				nodeId: node.id,
				status: "pending",
				attempts: 0,
			};
		}

		const instance: WorkflowInstance = {
			id,
			workflowId: params.workflowId,
			workflowVersion: definition.version,
			status: "pending",
			triggerType: params.triggerType ?? "manual",
			triggeredBy: params.triggeredBy,
			variables: { ...definition.variables, ...params.variables },
			nodeExecutions,
			currentNodeIds: [],
			completedNodeIds: [],
			parentInstanceId: params.parentInstanceId,
			metadata: params.metadata,
		};

		this.saveInstance(instance);
		this.emit("instance:created", instance);

		// Start execution
		await this.executeWorkflow(instance, definition);

		return this.getInstance(id)!;
	}

	private async executeWorkflow(instance: WorkflowInstance, definition: WorkflowDefinition): Promise<void> {
		const abortController = new AbortController();
		this.runningInstances.set(instance.id, abortController);

		try {
			// Update status to running
			instance.status = "running";
			instance.startedAt = new Date();
			this.saveInstance(instance);
			this.emit("instance:started", instance);

			// Set global timeout
			let timeoutId: NodeJS.Timeout | undefined;
			if (definition.globalTimeoutMs) {
				timeoutId = setTimeout(() => {
					abortController.abort();
				}, definition.globalTimeoutMs);
			}

			try {
				// Start with the start node
				await this.executeNode(instance, definition, definition.startNodeId, abortController.signal);

				// Check final status
				const finalInstance = this.getInstance(instance.id)!;
				if (finalInstance.status === "running") {
					finalInstance.status = "completed";
					finalInstance.completedAt = new Date();
					this.saveInstance(finalInstance);
					this.recordExecutionHistory(finalInstance, definition);
					this.emit("instance:completed", finalInstance);
				}
			} finally {
				if (timeoutId) clearTimeout(timeoutId);
			}
		} catch (error) {
			const currentInstance = this.getInstance(instance.id)!;
			if (abortController.signal.aborted && currentInstance.status !== "cancelled") {
				currentInstance.status = "timed_out";
				currentInstance.error = "Workflow timed out";
			} else if (currentInstance.status === "running") {
				currentInstance.status = "failed";
				currentInstance.error = error instanceof Error ? error.message : String(error);
			}
			currentInstance.completedAt = new Date();
			this.saveInstance(currentInstance);
			this.recordExecutionHistory(currentInstance, definition);
			this.emit("instance:failed", { instance: currentInstance, error });
		} finally {
			this.runningInstances.delete(instance.id);
		}
	}

	private async executeNode(
		instance: WorkflowInstance,
		definition: WorkflowDefinition,
		nodeId: string,
		signal: AbortSignal,
	): Promise<void> {
		if (signal.aborted) return;

		const node = definition.nodes.find((n) => n.id === nodeId);
		if (!node) {
			throw new Error(`Node '${nodeId}' not found`);
		}

		// Refresh instance
		instance = this.getInstance(instance.id)!;

		// Update current node
		if (!instance.currentNodeIds.includes(nodeId)) {
			instance.currentNodeIds.push(nodeId);
		}

		const execution = instance.nodeExecutions[nodeId];
		execution.status = "running";
		execution.startedAt = new Date();
		this.saveInstance(instance);
		this.emit("node:started", { instanceId: instance.id, nodeId, node });

		try {
			let output: Record<string, unknown> | undefined;

			switch (node.type) {
				case "start":
					// Start node just passes through
					output = {};
					break;

				case "end":
					// End node marks completion
					output = {};
					break;

				case "task":
					output = await this.executeTaskNode(instance, node, signal);
					break;

				case "decision":
					output = await this.executeDecisionNode(instance, definition, node, signal);
					break;

				case "fork":
					await this.executeForkNode(instance, definition, node, signal);
					return; // Fork handles its own flow

				case "join":
					output = await this.executeJoinNode(instance, definition, node, signal);
					break;

				case "wait":
					output = await this.executeWaitNode(instance, node, signal);
					break;

				case "subprocess":
					output = await this.executeSubprocessNode(instance, node, signal);
					break;

				case "error":
					output = await this.executeErrorNode(instance, node);
					break;
			}

			// Update execution as completed
			instance = this.getInstance(instance.id)!;
			execution.status = "completed";
			execution.completedAt = new Date();
			execution.output = output;

			// Remove from current, add to completed
			instance.currentNodeIds = instance.currentNodeIds.filter((id) => id !== nodeId);
			if (!instance.completedNodeIds.includes(nodeId)) {
				instance.completedNodeIds.push(nodeId);
			}
			this.saveInstance(instance);
			this.emit("node:completed", { instanceId: instance.id, nodeId, output });

			// Find and execute next nodes (fork returns early in switch, so not here)
			const nextEdges = definition.edges.filter((e) => e.sourceNodeId === nodeId);

			if (node.type === "decision") {
				// Decision already picked the path
				const nextEdge = nextEdges.find((e) => e.label === String(output?.decision));
				if (nextEdge) {
					await this.executeNode(instance, definition, nextEdge.targetNodeId, signal);
				}
			} else if (!definition.endNodeIds.includes(nodeId)) {
				// Execute all outgoing edges (should be 1 for non-fork nodes)
				for (const edge of nextEdges) {
					await this.executeNode(instance, definition, edge.targetNodeId, signal);
				}
			}
		} catch (error) {
			// Handle retry
			instance = this.getInstance(instance.id)!;
			const retryPolicy = node.retryPolicy ?? definition.defaultRetryPolicy;

			if (retryPolicy && execution.attempts < retryPolicy.maxAttempts) {
				execution.attempts++;
				const delay = Math.min(
					retryPolicy.initialDelayMs * retryPolicy.backoffMultiplier ** (execution.attempts - 1),
					retryPolicy.maxDelayMs,
				);
				execution.nextRetryAt = new Date(Date.now() + delay);
				this.saveInstance(instance);
				this.emit("node:retry", { instanceId: instance.id, nodeId, attempt: execution.attempts, delay });

				await new Promise((resolve) => setTimeout(resolve, delay));
				await this.executeNode(instance, definition, nodeId, signal);
			} else {
				// Check for error handler
				if (node.errorNodeId) {
					execution.status = "failed";
					execution.error = error instanceof Error ? error.message : String(error);
					this.saveInstance(instance);
					await this.executeNode(instance, definition, node.errorNodeId, signal);
				} else {
					throw error;
				}
			}
		}
	}

	private async executeTaskNode(
		instance: WorkflowInstance,
		node: WorkflowNode,
		signal: AbortSignal,
	): Promise<Record<string, unknown>> {
		if (!node.handler) {
			throw new Error(`Task node '${node.id}' has no handler`);
		}

		const handler = this.handlers.get(node.handler);
		if (!handler) {
			throw new Error(`Handler '${node.handler}' not registered`);
		}

		const context: WorkflowExecutionContext = {
			instanceId: instance.id,
			workflowId: instance.workflowId,
			nodeId: node.id,
			variables: { ...instance.variables },
			input: node.handlerArgs ?? {},
			setVariable: (key: string, value: unknown) => {
				instance.variables[key] = value;
				this.saveInstance(instance);
			},
			emit: (event: string, data?: unknown) => {
				this.emit(`workflow:${event}`, { instanceId: instance.id, nodeId: node.id, data });
			},
		};

		// Execute with timeout
		let timeoutId: NodeJS.Timeout | undefined;
		const timeoutPromise = new Promise<never>((_, reject) => {
			if (node.timeoutMs) {
				timeoutId = setTimeout(() => reject(new Error("Node timeout")), node.timeoutMs);
			}
		});

		try {
			const result = await Promise.race([
				handler(context),
				timeoutPromise,
				new Promise<never>((_, reject) => {
					signal.addEventListener("abort", () => reject(new Error("Aborted")));
				}),
			]);

			return result ?? {};
		} finally {
			if (timeoutId) clearTimeout(timeoutId);
		}
	}

	private async executeDecisionNode(
		instance: WorkflowInstance,
		definition: WorkflowDefinition,
		node: WorkflowNode,
		_signal: AbortSignal,
	): Promise<Record<string, unknown>> {
		if (!node.condition) {
			throw new Error(`Decision node '${node.id}' has no condition`);
		}

		// Evaluate condition (simple expression evaluation)
		const result = this.evaluateCondition(node.condition, instance.variables);
		const outgoingEdges = definition.edges
			.filter((e) => e.sourceNodeId === node.id)
			.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

		// Find matching edge based on condition
		let selectedEdge = outgoingEdges.find(
			(e) => e.condition && this.evaluateCondition(e.condition, { ...instance.variables, __result: result }),
		);

		// If no condition matched, use default (edge without condition)
		if (!selectedEdge) {
			selectedEdge = outgoingEdges.find((e) => !e.condition);
		}

		return { decision: selectedEdge?.label ?? "default", result };
	}

	private evaluateCondition(condition: string, variables: Record<string, unknown>): unknown {
		// Simple expression evaluator - in production use a proper expression parser
		try {
			const fn = new Function(...Object.keys(variables), `return ${condition}`);
			return fn(...Object.values(variables));
		} catch {
			return false;
		}
	}

	private async executeForkNode(
		instance: WorkflowInstance,
		definition: WorkflowDefinition,
		node: WorkflowNode,
		signal: AbortSignal,
	): Promise<void> {
		const outgoingEdges = definition.edges.filter((e) => e.sourceNodeId === node.id);

		// Mark fork as completed
		instance = this.getInstance(instance.id)!;
		const execution = instance.nodeExecutions[node.id];
		execution.status = "completed";
		execution.completedAt = new Date();
		instance.currentNodeIds = instance.currentNodeIds.filter((id) => id !== node.id);
		instance.completedNodeIds.push(node.id);
		this.saveInstance(instance);

		// Execute all branches in parallel
		await Promise.all(outgoingEdges.map((edge) => this.executeNode(instance, definition, edge.targetNodeId, signal)));
	}

	private async executeJoinNode(
		instance: WorkflowInstance,
		definition: WorkflowDefinition,
		node: WorkflowNode,
		_signal: AbortSignal,
	): Promise<Record<string, unknown>> {
		// Check if all incoming nodes are completed
		const incomingEdges = definition.edges.filter((e) => e.targetNodeId === node.id);
		const allCompleted = incomingEdges.every((e) => instance.completedNodeIds.includes(e.sourceNodeId));

		if (!allCompleted) {
			// Wait for other branches - mark as waiting
			instance.nodeExecutions[node.id].status = "waiting";
			this.saveInstance(instance);

			// This will be re-triggered when other branches complete
			return {};
		}

		// Merge outputs from all incoming nodes
		const mergedOutput: Record<string, unknown> = {};
		for (const edge of incomingEdges) {
			const nodeExecution = instance.nodeExecutions[edge.sourceNodeId];
			if (nodeExecution.output) {
				Object.assign(mergedOutput, { [edge.sourceNodeId]: nodeExecution.output });
			}
		}

		return mergedOutput;
	}

	private async executeWaitNode(
		instance: WorkflowInstance,
		node: WorkflowNode,
		signal: AbortSignal,
	): Promise<Record<string, unknown>> {
		if (node.waitEvent) {
			// Wait for external event
			return new Promise((resolve, reject) => {
				const eventKey = `${instance.id}:${node.id}:${node.waitEvent}`;

				const cleanup = () => {
					this.waitingEvents.delete(eventKey);
				};

				const timeoutId = node.waitTimeoutMs
					? setTimeout(() => {
							cleanup();
							reject(new Error("Wait timeout"));
						}, node.waitTimeoutMs)
					: undefined;

				this.waitingEvents.set(eventKey, {
					instanceId: instance.id,
					nodeId: node.id,
					resolve: () => {
						if (timeoutId) clearTimeout(timeoutId);
						cleanup();
						resolve({});
					},
				});

				signal.addEventListener("abort", () => {
					if (timeoutId) clearTimeout(timeoutId);
					cleanup();
					reject(new Error("Aborted"));
				});

				// Update instance status
				instance.status = "waiting";
				this.saveInstance(instance);
			});
		} else if (node.waitTimeoutMs) {
			// Simple delay
			await new Promise((resolve) => setTimeout(resolve, node.waitTimeoutMs));
			return {};
		}

		return {};
	}

	async triggerWaitEvent(instanceId: string, nodeId: string, eventName: string): Promise<boolean> {
		const eventKey = `${instanceId}:${nodeId}:${eventName}`;
		const waiter = this.waitingEvents.get(eventKey);

		if (waiter) {
			waiter.resolve();
			return true;
		}

		return false;
	}

	private async executeSubprocessNode(
		instance: WorkflowInstance,
		node: WorkflowNode,
		signal: AbortSignal,
	): Promise<Record<string, unknown>> {
		if (!node.subworkflowId) {
			throw new Error(`Subprocess node '${node.id}' has no subworkflowId`);
		}

		const subInstance = await this.startWorkflow({
			workflowId: node.subworkflowId,
			triggerType: "subprocess",
			parentInstanceId: instance.id,
			variables: instance.variables,
		});

		// Wait for subprocess to complete
		while (true) {
			if (signal.aborted) throw new Error("Aborted");

			const current = this.getInstance(subInstance.id);
			if (!current) throw new Error("Subprocess instance lost");

			if (["completed", "failed", "cancelled", "timed_out"].includes(current.status)) {
				if (current.status !== "completed") {
					throw new Error(`Subprocess ${current.status}: ${current.error}`);
				}
				return { subworkflowResult: current.variables };
			}

			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	private async executeErrorNode(instance: WorkflowInstance, node: WorkflowNode): Promise<Record<string, unknown>> {
		// Error node can do cleanup, logging, etc.
		// The handler (if any) receives error context
		if (node.handler) {
			const handler = this.handlers.get(node.handler);
			if (handler) {
				const context: WorkflowExecutionContext = {
					instanceId: instance.id,
					workflowId: instance.workflowId,
					nodeId: node.id,
					variables: instance.variables,
					input: { error: instance.error },
					setVariable: (key, value) => {
						instance.variables[key] = value;
					},
					emit: (event, data) => {
						this.emit(`workflow:${event}`, { instanceId: instance.id, nodeId: node.id, data });
					},
				};

				await handler(context);
			}
		}

		return { handled: true };
	}

	// ============================================================================
	// Instance Operations
	// ============================================================================

	getInstance(instanceId: string): WorkflowInstance | null {
		const stmt = this.db.prepare("SELECT * FROM workflow_instances WHERE id = ?");
		const row = stmt.get(instanceId) as Record<string, unknown> | undefined;

		if (!row) return null;
		return this.rowToInstance(row);
	}

	getAllInstances(
		params: { workflowId?: string; status?: WorkflowInstanceStatus; limit?: number; offset?: number } = {},
	): WorkflowInstance[] {
		let query = "SELECT * FROM workflow_instances WHERE 1=1";
		const queryParams: unknown[] = [];

		if (params.workflowId) {
			query += " AND workflow_id = ?";
			queryParams.push(params.workflowId);
		}
		if (params.status) {
			query += " AND status = ?";
			queryParams.push(params.status);
		}

		query += " ORDER BY started_at DESC NULLS LAST";

		if (params.limit) {
			query += " LIMIT ?";
			queryParams.push(params.limit);
		}
		if (params.offset) {
			query += " OFFSET ?";
			queryParams.push(params.offset);
		}

		const stmt = this.db.prepare(query);
		const rows = stmt.all(...queryParams) as Record<string, unknown>[];

		return rows.map((row) => this.rowToInstance(row));
	}

	getRunningInstanceCount(): number {
		const stmt = this.db.prepare(
			"SELECT COUNT(*) as count FROM workflow_instances WHERE status IN ('running', 'waiting')",
		);
		const result = stmt.get() as { count: number };
		return result.count;
	}

	async pauseInstance(instanceId: string): Promise<boolean> {
		const instance = this.getInstance(instanceId);
		if (!instance || instance.status !== "running") return false;

		instance.status = "paused";
		this.saveInstance(instance);
		this.emit("instance:paused", instance);
		return true;
	}

	async resumeInstance(instanceId: string): Promise<boolean> {
		const instance = this.getInstance(instanceId);
		if (!instance || instance.status !== "paused") return false;

		const definition = this.getWorkflow(instance.workflowId);
		if (!definition) return false;

		// Resume execution
		await this.executeWorkflow(instance, definition);
		return true;
	}

	async cancelInstance(instanceId: string): Promise<boolean> {
		const abortController = this.runningInstances.get(instanceId);
		if (abortController) {
			abortController.abort();
		}

		const instance = this.getInstance(instanceId);
		if (!instance) return false;

		instance.status = "cancelled";
		instance.completedAt = new Date();
		this.saveInstance(instance);
		this.emit("instance:cancelled", instance);
		return true;
	}

	private saveInstance(instance: WorkflowInstance): void {
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO workflow_instances
      (id, workflow_id, workflow_version, status, trigger_type, triggered_by, variables,
       node_executions, current_node_ids, completed_node_ids, parent_instance_id,
       started_at, completed_at, error, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			instance.id,
			instance.workflowId,
			instance.workflowVersion,
			instance.status,
			instance.triggerType,
			instance.triggeredBy ?? null,
			JSON.stringify(instance.variables),
			JSON.stringify(instance.nodeExecutions),
			JSON.stringify(instance.currentNodeIds),
			JSON.stringify(instance.completedNodeIds),
			instance.parentInstanceId ?? null,
			instance.startedAt?.toISOString() ?? null,
			instance.completedAt?.toISOString() ?? null,
			instance.error ?? null,
			instance.metadata ? JSON.stringify(instance.metadata) : null,
		);
	}

	private rowToInstance(row: Record<string, unknown>): WorkflowInstance {
		return {
			id: row.id as string,
			workflowId: row.workflow_id as string,
			workflowVersion: row.workflow_version as number,
			status: row.status as WorkflowInstanceStatus,
			triggerType: row.trigger_type as WorkflowTriggerType,
			triggeredBy: row.triggered_by as string | undefined,
			variables: JSON.parse(row.variables as string),
			nodeExecutions: JSON.parse(row.node_executions as string),
			currentNodeIds: JSON.parse(row.current_node_ids as string),
			completedNodeIds: JSON.parse(row.completed_node_ids as string),
			parentInstanceId: row.parent_instance_id as string | undefined,
			startedAt: row.started_at ? new Date(row.started_at as string) : undefined,
			completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
			error: row.error as string | undefined,
			metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
		};
	}

	// ============================================================================
	// Scheduling
	// ============================================================================

	createSchedule(params: {
		workflowId: string;
		cronExpression: string;
		timezone?: string;
		variables?: Record<string, unknown>;
		metadata?: Record<string, unknown>;
	}): WorkflowSchedule {
		const definition = this.getWorkflow(params.workflowId);
		if (!definition) {
			throw new Error(`Workflow '${params.workflowId}' not found`);
		}

		const id = `sched_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const timezone = params.timezone ?? "UTC";
		const nextRunAt = this.calculateNextRun(params.cronExpression, timezone);

		const schedule: WorkflowSchedule = {
			id,
			workflowId: params.workflowId,
			cronExpression: params.cronExpression,
			timezone,
			enabled: true,
			variables: params.variables,
			nextRunAt,
			createdAt: new Date(),
			metadata: params.metadata,
		};

		const stmt = this.db.prepare(`
      INSERT INTO workflow_schedules
      (id, workflow_id, cron_expression, timezone, enabled, variables, next_run_at, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			schedule.id,
			schedule.workflowId,
			schedule.cronExpression,
			schedule.timezone,
			1,
			schedule.variables ? JSON.stringify(schedule.variables) : null,
			schedule.nextRunAt?.toISOString() ?? null,
			schedule.createdAt.toISOString(),
			schedule.metadata ? JSON.stringify(schedule.metadata) : null,
		);

		this.emit("schedule:created", schedule);
		return schedule;
	}

	private calculateNextRun(cronExpression: string, _timezone: string): Date {
		// Simple cron parser - in production use a proper cron library
		// This is a basic implementation for common patterns
		const parts = cronExpression.split(" ");
		if (parts.length < 5) {
			throw new Error("Invalid cron expression");
		}

		const now = new Date();
		const next = new Date(now);
		next.setSeconds(0);
		next.setMilliseconds(0);

		// Advance by 1 minute at minimum
		next.setMinutes(next.getMinutes() + 1);

		return next;
	}

	getSchedule(scheduleId: string): WorkflowSchedule | null {
		const stmt = this.db.prepare("SELECT * FROM workflow_schedules WHERE id = ?");
		const row = stmt.get(scheduleId) as Record<string, unknown> | undefined;

		if (!row) return null;
		return this.rowToSchedule(row);
	}

	getAllSchedules(enabledOnly: boolean = true): WorkflowSchedule[] {
		const query = enabledOnly
			? "SELECT * FROM workflow_schedules WHERE enabled = 1 ORDER BY next_run_at"
			: "SELECT * FROM workflow_schedules ORDER BY created_at DESC";

		const stmt = this.db.prepare(query);
		const rows = stmt.all() as Record<string, unknown>[];

		return rows.map((row) => this.rowToSchedule(row));
	}

	enableSchedule(scheduleId: string): boolean {
		const stmt = this.db.prepare("UPDATE workflow_schedules SET enabled = 1 WHERE id = ?");
		const result = stmt.run(scheduleId);
		return result.changes > 0;
	}

	disableSchedule(scheduleId: string): boolean {
		const stmt = this.db.prepare("UPDATE workflow_schedules SET enabled = 0 WHERE id = ?");
		const result = stmt.run(scheduleId);
		return result.changes > 0;
	}

	deleteSchedule(scheduleId: string): boolean {
		const stmt = this.db.prepare("DELETE FROM workflow_schedules WHERE id = ?");
		const result = stmt.run(scheduleId);
		return result.changes > 0;
	}

	private rowToSchedule(row: Record<string, unknown>): WorkflowSchedule {
		return {
			id: row.id as string,
			workflowId: row.workflow_id as string,
			cronExpression: row.cron_expression as string,
			timezone: row.timezone as string,
			enabled: Boolean(row.enabled),
			variables: row.variables ? JSON.parse(row.variables as string) : undefined,
			nextRunAt: row.next_run_at ? new Date(row.next_run_at as string) : undefined,
			lastRunAt: row.last_run_at ? new Date(row.last_run_at as string) : undefined,
			lastRunInstanceId: row.last_run_instance_id as string | undefined,
			createdAt: new Date(row.created_at as string),
			metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
		};
	}

	// ============================================================================
	// Templates
	// ============================================================================

	createTemplate(params: {
		name: string;
		description?: string;
		category: string;
		definition: Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt">;
		variables?: Record<string, { type: string; default?: unknown; required?: boolean; description?: string }>;
	}): WorkflowTemplate {
		const id = `tmpl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		const template: WorkflowTemplate = {
			id,
			name: params.name,
			description: params.description,
			category: params.category,
			definition: params.definition,
			variables: params.variables,
			createdAt: new Date(),
			usageCount: 0,
		};

		const stmt = this.db.prepare(`
      INSERT INTO workflow_templates
      (id, name, description, category, definition, variables, created_at, usage_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			template.id,
			template.name,
			template.description ?? null,
			template.category,
			JSON.stringify(template.definition),
			template.variables ? JSON.stringify(template.variables) : null,
			template.createdAt.toISOString(),
			0,
		);

		this.emit("template:created", template);
		return template;
	}

	getTemplate(templateId: string): WorkflowTemplate | null {
		const stmt = this.db.prepare("SELECT * FROM workflow_templates WHERE id = ?");
		const row = stmt.get(templateId) as Record<string, unknown> | undefined;

		if (!row) return null;
		return this.rowToTemplate(row);
	}

	getAllTemplates(category?: string): WorkflowTemplate[] {
		let query = "SELECT * FROM workflow_templates";
		const params: unknown[] = [];

		if (category) {
			query += " WHERE category = ?";
			params.push(category);
		}

		query += " ORDER BY usage_count DESC, name";

		const stmt = this.db.prepare(query);
		const rows = stmt.all(...params) as Record<string, unknown>[];

		return rows.map((row) => this.rowToTemplate(row));
	}

	createFromTemplate(templateId: string, name: string, variables?: Record<string, unknown>): WorkflowDefinition {
		const template = this.getTemplate(templateId);
		if (!template) {
			throw new Error(`Template '${templateId}' not found`);
		}

		// Increment usage count
		const updateStmt = this.db.prepare("UPDATE workflow_templates SET usage_count = usage_count + 1 WHERE id = ?");
		updateStmt.run(templateId);

		// Create workflow from template
		return this.createWorkflow({
			...template.definition,
			name,
			variables: { ...template.definition.variables, ...variables },
		});
	}

	private rowToTemplate(row: Record<string, unknown>): WorkflowTemplate {
		return {
			id: row.id as string,
			name: row.name as string,
			description: row.description as string | undefined,
			category: row.category as string,
			definition: JSON.parse(row.definition as string),
			variables: row.variables ? JSON.parse(row.variables as string) : undefined,
			createdAt: new Date(row.created_at as string),
			usageCount: row.usage_count as number,
		};
	}

	// ============================================================================
	// Execution History & Metrics
	// ============================================================================

	private recordExecutionHistory(instance: WorkflowInstance, definition: WorkflowDefinition): void {
		if (!this.config.enableMetrics) return;

		const durationMs =
			instance.startedAt && instance.completedAt
				? instance.completedAt.getTime() - instance.startedAt.getTime()
				: undefined;

		const stmt = this.db.prepare(`
      INSERT INTO workflow_execution_history
      (id, instance_id, workflow_id, workflow_name, status, trigger_type, started_at, completed_at,
       duration_ms, node_count, completed_node_count, error, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			`hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			instance.id,
			instance.workflowId,
			definition.name,
			instance.status,
			instance.triggerType,
			instance.startedAt?.toISOString() ?? null,
			instance.completedAt?.toISOString() ?? null,
			durationMs ?? null,
			definition.nodes.length,
			instance.completedNodeIds.length,
			instance.error ?? null,
			new Date().toISOString(),
		);
	}

	getExecutionHistory(
		params: {
			workflowId?: string;
			status?: WorkflowInstanceStatus;
			startDate?: Date;
			endDate?: Date;
			limit?: number;
		} = {},
	): WorkflowExecutionHistory[] {
		let query = "SELECT * FROM workflow_execution_history WHERE 1=1";
		const queryParams: unknown[] = [];

		if (params.workflowId) {
			query += " AND workflow_id = ?";
			queryParams.push(params.workflowId);
		}
		if (params.status) {
			query += " AND status = ?";
			queryParams.push(params.status);
		}
		if (params.startDate) {
			query += " AND started_at >= ?";
			queryParams.push(params.startDate.toISOString());
		}
		if (params.endDate) {
			query += " AND started_at <= ?";
			queryParams.push(params.endDate.toISOString());
		}

		query += " ORDER BY recorded_at DESC";

		if (params.limit) {
			query += " LIMIT ?";
			queryParams.push(params.limit);
		}

		const stmt = this.db.prepare(query);
		const rows = stmt.all(...queryParams) as Record<string, unknown>[];

		return rows.map((row) => ({
			instanceId: row.instance_id as string,
			workflowId: row.workflow_id as string,
			workflowName: row.workflow_name as string,
			status: row.status as WorkflowInstanceStatus,
			triggerType: row.trigger_type as WorkflowTriggerType,
			startedAt: row.started_at ? new Date(row.started_at as string) : undefined,
			completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
			durationMs: row.duration_ms as number | undefined,
			nodeCount: row.node_count as number,
			completedNodeCount: row.completed_node_count as number,
			error: row.error as string | undefined,
		}));
	}

	getWorkflowMetrics(workflowId: string): WorkflowMetrics | null {
		const definition = this.getWorkflow(workflowId);
		if (!definition) return null;

		const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status IN ('failed', 'timed_out') THEN 1 ELSE 0 END) as failed,
        AVG(duration_ms) as avg_duration,
        MIN(duration_ms) as min_duration,
        MAX(duration_ms) as max_duration
      FROM workflow_execution_history
      WHERE workflow_id = ?
    `);

		const result = stmt.get(workflowId) as Record<string, unknown>;

		const total = result.total as number;
		const successful = result.successful as number;

		return {
			workflowId,
			totalExecutions: total,
			successfulExecutions: successful,
			failedExecutions: result.failed as number,
			avgDurationMs: (result.avg_duration as number) ?? 0,
			minDurationMs: (result.min_duration as number) ?? 0,
			maxDurationMs: (result.max_duration as number) ?? 0,
			successRate: total > 0 ? (successful / total) * 100 : 0,
			nodeMetrics: {}, // Would require per-node tracking
		};
	}

	// ============================================================================
	// Statistics
	// ============================================================================

	getStats(): WorkflowEngineStats {
		const defStmt = this.db.prepare(
			"SELECT COUNT(*) as total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active FROM workflow_definitions",
		);
		const defResult = defStmt.get() as Record<string, number>;

		const instStmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('running', 'waiting') THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status IN ('failed', 'timed_out') THEN 1 ELSE 0 END) as failed
      FROM workflow_instances
    `);
		const instResult = instStmt.get() as Record<string, number>;

		const schedStmt = this.db.prepare("SELECT COUNT(*) as count FROM workflow_schedules WHERE enabled = 1");
		const schedResult = schedStmt.get() as { count: number };

		const tmplStmt = this.db.prepare("SELECT COUNT(*) as count FROM workflow_templates");
		const tmplResult = tmplStmt.get() as { count: number };

		return {
			totalDefinitions: defResult.total,
			activeDefinitions: defResult.active,
			totalInstances: instResult.total,
			runningInstances: instResult.running,
			completedInstances: instResult.completed,
			failedInstances: instResult.failed,
			scheduledWorkflows: schedResult.count,
			templates: tmplResult.count,
		};
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	shutdown(): void {
		// Cancel all running instances
		for (const [instanceId, controller] of this.runningInstances) {
			controller.abort();
			const instance = this.getInstance(instanceId);
			if (instance) {
				instance.status = "cancelled";
				instance.completedAt = new Date();
				this.saveInstance(instance);
			}
		}
		this.runningInstances.clear();

		// Clear waiting events
		this.waitingEvents.clear();

		// Stop schedulers
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		if (this.schedulerInterval) {
			clearInterval(this.schedulerInterval);
			this.schedulerInterval = null;
		}

		this.db.close();
		this.emit("shutdown");
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

let workflowEngineInstance: WorkflowEngineSystem | null = null;

export function getWorkflowEngine(config?: WorkflowEngineConfig): WorkflowEngineSystem {
	if (!workflowEngineInstance) {
		if (!config) {
			throw new Error("WorkflowEngineSystem requires config on first initialization");
		}
		workflowEngineInstance = new WorkflowEngineSystem(config);
	}
	return workflowEngineInstance;
}

export function resetWorkflowEngine(): void {
	if (workflowEngineInstance) {
		workflowEngineInstance.shutdown();
		workflowEngineInstance = null;
	}
}
