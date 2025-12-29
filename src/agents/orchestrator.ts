/**
 * Class 3 Orchestrator Agent
 *
 * The Codebase Singularity - Class 3 Grade 1
 * "One agent to rule them all. CRUD, command, and manage other agents."
 *
 * This orchestrator provides:
 * - CRUD operations over agents (Create, Read, Update, Delete)
 * - Centralized control over the agentic layer
 * - Deterministic workflow execution with non-deterministic agents
 * - Agent lifecycle management
 * - Task delegation and result aggregation
 *
 * Based on: Tactical Agentic Coding + Agentic Horizon frameworks
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";

// =============================================================================
// Types
// =============================================================================

/** Agent definition for the registry */
export interface AgentDefinition {
	id: string;
	name: string;
	type: "skill" | "mcp" | "subprocess" | "webhook" | "inline";
	role: "architect" | "builder" | "tester" | "reviewer" | "expert" | "scout" | "executor";
	description: string;
	systemPrompt?: string;
	config: Record<string, unknown>;
	status: "active" | "paused" | "error" | "disabled";
	createdAt: Date;
	updatedAt: Date;
	lastRunAt?: Date;
	runCount: number;
	successCount: number;
	failureCount: number;
	avgLatencyMs: number;
	totalCost: number;
}

/** Workflow step definition */
export interface WorkflowStep {
	id: string;
	name: string;
	agentId: string;
	action: string;
	input: Record<string, unknown>;
	dependsOn: string[]; // Step IDs this step depends on
	timeout: number;
	retries: number;
	onError: "fail" | "skip" | "retry" | "fallback";
	fallbackAgentId?: string;
}

/** Workflow definition */
export interface WorkflowDefinition {
	id: string;
	name: string;
	description: string;
	steps: WorkflowStep[];
	trigger: "manual" | "webhook" | "schedule" | "event";
	triggerConfig?: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

/** Workflow execution state */
export interface WorkflowExecution {
	id: string;
	workflowId: string;
	status: "pending" | "running" | "completed" | "failed" | "cancelled";
	startedAt: Date;
	completedAt?: Date;
	currentStep?: string;
	stepResults: Map<string, StepResult>;
	error?: string;
}

/** Step execution result */
export interface StepResult {
	stepId: string;
	status: "pending" | "running" | "completed" | "failed" | "skipped";
	startedAt?: Date;
	completedAt?: Date;
	output?: unknown;
	error?: string;
	latencyMs?: number;
	retryCount: number;
}

/** Orchestrator event types */
export type OrchestratorEvent =
	| "agent:created"
	| "agent:updated"
	| "agent:deleted"
	| "agent:started"
	| "agent:completed"
	| "agent:failed"
	| "workflow:started"
	| "workflow:step:started"
	| "workflow:step:completed"
	| "workflow:step:failed"
	| "workflow:completed"
	| "workflow:failed";

/** Task delegation request */
export interface DelegationRequest {
	id: string;
	taskType: string;
	prompt: string;
	context?: Record<string, unknown>;
	requiredRole?: AgentDefinition["role"];
	requiredCapabilities?: string[];
	timeout: number;
	priority: number;
}

/** Task delegation result */
export interface DelegationResult {
	requestId: string;
	agentId: string;
	status: "success" | "failure" | "timeout";
	output?: unknown;
	error?: string;
	latencyMs: number;
	tokensUsed?: number;
	cost?: number;
}

// =============================================================================
// Database Schema
// =============================================================================

const SCHEMA = `
-- Agent Registry
CREATE TABLE IF NOT EXISTS orchestrator_agents (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	type TEXT NOT NULL,
	role TEXT NOT NULL,
	description TEXT,
	system_prompt TEXT,
	config TEXT NOT NULL DEFAULT '{}',
	status TEXT NOT NULL DEFAULT 'active',
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	last_run_at DATETIME,
	run_count INTEGER DEFAULT 0,
	success_count INTEGER DEFAULT 0,
	failure_count INTEGER DEFAULT 0,
	avg_latency_ms REAL DEFAULT 0,
	total_cost REAL DEFAULT 0
);

-- Workflow Definitions
CREATE TABLE IF NOT EXISTS orchestrator_workflows (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	description TEXT,
	steps TEXT NOT NULL DEFAULT '[]',
	trigger TEXT NOT NULL DEFAULT 'manual',
	trigger_config TEXT DEFAULT '{}',
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Workflow Executions
CREATE TABLE IF NOT EXISTS orchestrator_executions (
	id TEXT PRIMARY KEY,
	workflow_id TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	completed_at DATETIME,
	current_step TEXT,
	step_results TEXT NOT NULL DEFAULT '{}',
	error TEXT,
	FOREIGN KEY (workflow_id) REFERENCES orchestrator_workflows(id)
);

-- Delegation History
CREATE TABLE IF NOT EXISTS orchestrator_delegations (
	id TEXT PRIMARY KEY,
	agent_id TEXT NOT NULL,
	task_type TEXT NOT NULL,
	prompt TEXT,
	status TEXT NOT NULL,
	output TEXT,
	error TEXT,
	latency_ms INTEGER,
	tokens_used INTEGER,
	cost REAL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (agent_id) REFERENCES orchestrator_agents(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agents_role ON orchestrator_agents(role);
CREATE INDEX IF NOT EXISTS idx_agents_status ON orchestrator_agents(status);
CREATE INDEX IF NOT EXISTS idx_executions_workflow ON orchestrator_executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_delegations_agent ON orchestrator_delegations(agent_id);
`;

// =============================================================================
// Orchestrator Class
// =============================================================================

export class Orchestrator extends EventEmitter {
	private db: Database.Database;
	private runningExecutions = new Map<string, WorkflowExecution>();
	private agentHandlers = new Map<string, (prompt: string, context?: Record<string, unknown>) => Promise<unknown>>();

	constructor(dbPath: string = "orchestrator.db") {
		super();
		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL");
		this.db.exec(SCHEMA);
	}

	// =========================================================================
	// CRUD: Agents
	// =========================================================================

	/** Create a new agent */
	createAgent(input: Omit<AgentDefinition, "id" | "createdAt" | "updatedAt" | "runCount" | "successCount" | "failureCount" | "avgLatencyMs" | "totalCost">): AgentDefinition {
		const id = randomUUID();
		const now = new Date();

		this.db
			.prepare(
				`INSERT INTO orchestrator_agents
				(id, name, type, role, description, system_prompt, config, status)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				input.name,
				input.type,
				input.role,
				input.description,
				input.systemPrompt || null,
				JSON.stringify(input.config),
				input.status,
			);

		const agent: AgentDefinition = {
			...input,
			id,
			createdAt: now,
			updatedAt: now,
			runCount: 0,
			successCount: 0,
			failureCount: 0,
			avgLatencyMs: 0,
			totalCost: 0,
		};

		this.emit("agent:created", agent);
		return agent;
	}

	/** Read an agent by ID */
	getAgent(id: string): AgentDefinition | null {
		const row = this.db.prepare("SELECT * FROM orchestrator_agents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
		return row ? this.rowToAgent(row) : null;
	}

	/** List all agents */
	listAgents(filters?: { role?: string; status?: string; type?: string }): AgentDefinition[] {
		let query = "SELECT * FROM orchestrator_agents WHERE 1=1";
		const params: unknown[] = [];

		if (filters?.role) {
			query += " AND role = ?";
			params.push(filters.role);
		}
		if (filters?.status) {
			query += " AND status = ?";
			params.push(filters.status);
		}
		if (filters?.type) {
			query += " AND type = ?";
			params.push(filters.type);
		}

		query += " ORDER BY name";

		const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
		return rows.map((row) => this.rowToAgent(row));
	}

	/** Update an agent */
	updateAgent(id: string, updates: Partial<Omit<AgentDefinition, "id" | "createdAt">>): AgentDefinition | null {
		const existing = this.getAgent(id);
		if (!existing) return null;

		const sets: string[] = ["updated_at = CURRENT_TIMESTAMP"];
		const values: unknown[] = [];

		if (updates.name !== undefined) {
			sets.push("name = ?");
			values.push(updates.name);
		}
		if (updates.type !== undefined) {
			sets.push("type = ?");
			values.push(updates.type);
		}
		if (updates.role !== undefined) {
			sets.push("role = ?");
			values.push(updates.role);
		}
		if (updates.description !== undefined) {
			sets.push("description = ?");
			values.push(updates.description);
		}
		if (updates.systemPrompt !== undefined) {
			sets.push("system_prompt = ?");
			values.push(updates.systemPrompt);
		}
		if (updates.config !== undefined) {
			sets.push("config = ?");
			values.push(JSON.stringify(updates.config));
		}
		if (updates.status !== undefined) {
			sets.push("status = ?");
			values.push(updates.status);
		}

		values.push(id);
		this.db.prepare(`UPDATE orchestrator_agents SET ${sets.join(", ")} WHERE id = ?`).run(...values);

		const updated = this.getAgent(id);
		if (updated) this.emit("agent:updated", updated);
		return updated;
	}

	/** Delete an agent */
	deleteAgent(id: string): boolean {
		const agent = this.getAgent(id);
		if (!agent) return false;

		this.db.prepare("DELETE FROM orchestrator_agents WHERE id = ?").run(id);
		this.agentHandlers.delete(id);
		this.emit("agent:deleted", agent);
		return true;
	}

	// =========================================================================
	// Agent Registration & Handlers
	// =========================================================================

	/** Register an agent handler function */
	registerHandler(agentId: string, handler: (prompt: string, context?: Record<string, unknown>) => Promise<unknown>): void {
		this.agentHandlers.set(agentId, handler);
	}

	/** Unregister an agent handler */
	unregisterHandler(agentId: string): void {
		this.agentHandlers.delete(agentId);
	}

	// =========================================================================
	// Task Delegation
	// =========================================================================

	/** Delegate a task to the best available agent */
	async delegate(request: DelegationRequest): Promise<DelegationResult> {
		const startTime = Date.now();

		// Find suitable agent
		const agents = this.listAgents({
			role: request.requiredRole,
			status: "active",
		});

		if (agents.length === 0) {
			return {
				requestId: request.id,
				agentId: "",
				status: "failure",
				error: "No suitable agent found",
				latencyMs: Date.now() - startTime,
			};
		}

		// Select agent with best success rate and lowest latency
		const selectedAgent = agents.sort((a, b) => {
			const aScore = (a.successCount / Math.max(a.runCount, 1)) * 100 - a.avgLatencyMs / 1000;
			const bScore = (b.successCount / Math.max(b.runCount, 1)) * 100 - b.avgLatencyMs / 1000;
			return bScore - aScore;
		})[0];

		// Get handler
		const handler = this.agentHandlers.get(selectedAgent.id);
		if (!handler) {
			return {
				requestId: request.id,
				agentId: selectedAgent.id,
				status: "failure",
				error: "No handler registered for agent",
				latencyMs: Date.now() - startTime,
			};
		}

		// Execute with timeout
		try {
			this.emit("agent:started", { agentId: selectedAgent.id, request });

			const result = await Promise.race([
				handler(request.prompt, request.context),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("Timeout")), request.timeout),
				),
			]);

			const latencyMs = Date.now() - startTime;

			// Update agent stats
			this.updateAgentStats(selectedAgent.id, true, latencyMs);

			// Log delegation
			this.logDelegation(request.id, selectedAgent.id, request.taskType, request.prompt, "success", result, undefined, latencyMs);

			this.emit("agent:completed", { agentId: selectedAgent.id, result });

			return {
				requestId: request.id,
				agentId: selectedAgent.id,
				status: "success",
				output: result,
				latencyMs,
			};
		} catch (error) {
			const latencyMs = Date.now() - startTime;
			const errorMsg = error instanceof Error ? error.message : String(error);

			// Update agent stats
			this.updateAgentStats(selectedAgent.id, false, latencyMs);

			// Log delegation
			this.logDelegation(request.id, selectedAgent.id, request.taskType, request.prompt, "failure", undefined, errorMsg, latencyMs);

			this.emit("agent:failed", { agentId: selectedAgent.id, error: errorMsg });

			return {
				requestId: request.id,
				agentId: selectedAgent.id,
				status: error instanceof Error && error.message === "Timeout" ? "timeout" : "failure",
				error: errorMsg,
				latencyMs,
			};
		}
	}

	// =========================================================================
	// Workflow Management
	// =========================================================================

	/** Create a workflow */
	createWorkflow(input: Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt">): WorkflowDefinition {
		const id = randomUUID();
		const now = new Date();

		this.db
			.prepare(
				`INSERT INTO orchestrator_workflows
				(id, name, description, steps, trigger, trigger_config)
				VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				input.name,
				input.description,
				JSON.stringify(input.steps),
				input.trigger,
				JSON.stringify(input.triggerConfig || {}),
			);

		return {
			...input,
			id,
			createdAt: now,
			updatedAt: now,
		};
	}

	/** Get a workflow by ID */
	getWorkflow(id: string): WorkflowDefinition | null {
		const row = this.db.prepare("SELECT * FROM orchestrator_workflows WHERE id = ?").get(id) as Record<string, unknown> | undefined;
		return row ? this.rowToWorkflow(row) : null;
	}

	/** List all workflows */
	listWorkflows(): WorkflowDefinition[] {
		const rows = this.db.prepare("SELECT * FROM orchestrator_workflows ORDER BY name").all() as Record<string, unknown>[];
		return rows.map((row) => this.rowToWorkflow(row));
	}

	/** Execute a workflow */
	async executeWorkflow(workflowId: string, input?: Record<string, unknown>): Promise<WorkflowExecution> {
		const workflow = this.getWorkflow(workflowId);
		if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

		const execution: WorkflowExecution = {
			id: randomUUID(),
			workflowId,
			status: "running",
			startedAt: new Date(),
			stepResults: new Map(),
		};

		this.runningExecutions.set(execution.id, execution);
		this.emit("workflow:started", { workflowId, executionId: execution.id });

		// Save initial execution state
		this.saveExecution(execution);

		try {
			// Build dependency graph and execute steps
			const completed = new Set<string>();
			const stepOutputs = new Map<string, unknown>();

			// Add initial input to outputs
			if (input) {
				stepOutputs.set("__input__", input);
			}

			while (completed.size < workflow.steps.length) {
				// Find steps ready to execute
				const readySteps = workflow.steps.filter(
					(step) =>
						!completed.has(step.id) &&
						step.dependsOn.every((dep) => completed.has(dep)),
				);

				if (readySteps.length === 0 && completed.size < workflow.steps.length) {
					throw new Error("Workflow has circular dependencies or unreachable steps");
				}

				// Execute ready steps in parallel
				const results = await Promise.all(
					readySteps.map((step) => this.executeStep(step, stepOutputs, execution)),
				);

				// Process results
				for (let i = 0; i < readySteps.length; i++) {
					const step = readySteps[i];
					const result = results[i];

					execution.stepResults.set(step.id, result);
					completed.add(step.id);

					if (result.status === "completed" && result.output !== undefined) {
						stepOutputs.set(step.id, result.output);
					}
				}

				// Update execution state
				this.saveExecution(execution);
			}

			execution.status = "completed";
			execution.completedAt = new Date();
			this.saveExecution(execution);

			this.emit("workflow:completed", { workflowId, executionId: execution.id });
		} catch (error) {
			execution.status = "failed";
			execution.error = error instanceof Error ? error.message : String(error);
			execution.completedAt = new Date();
			this.saveExecution(execution);

			this.emit("workflow:failed", { workflowId, executionId: execution.id, error: execution.error });
		} finally {
			this.runningExecutions.delete(execution.id);
		}

		return execution;
	}

	/** Execute a single workflow step */
	private async executeStep(
		step: WorkflowStep,
		outputs: Map<string, unknown>,
		execution: WorkflowExecution,
	): Promise<StepResult> {
		const result: StepResult = {
			stepId: step.id,
			status: "running",
			startedAt: new Date(),
			retryCount: 0,
		};

		execution.currentStep = step.id;
		this.emit("workflow:step:started", { executionId: execution.id, stepId: step.id });

		// Resolve input references
		const resolvedInput = this.resolveReferences(step.input, outputs);

		// Build prompt from action and input
		const prompt = `Action: ${step.action}\nInput: ${JSON.stringify(resolvedInput, null, 2)}`;

		let attempts = 0;
		const maxAttempts = step.retries + 1;

		while (attempts < maxAttempts) {
			attempts++;
			result.retryCount = attempts - 1;

			const delegationResult = await this.delegate({
				id: randomUUID(),
				taskType: step.action,
				prompt,
				context: resolvedInput,
				timeout: step.timeout,
				priority: 5,
			});

			if (delegationResult.status === "success") {
				result.status = "completed";
				result.output = delegationResult.output;
				result.latencyMs = delegationResult.latencyMs;
				result.completedAt = new Date();

				this.emit("workflow:step:completed", { executionId: execution.id, stepId: step.id, output: result.output });
				return result;
			}

			if (attempts >= maxAttempts) {
				// Handle error based on strategy
				if (step.onError === "skip") {
					result.status = "skipped";
					result.error = delegationResult.error;
					result.completedAt = new Date();
					return result;
				}

				if (step.onError === "fallback" && step.fallbackAgentId) {
					// Try fallback agent
					const fallbackHandler = this.agentHandlers.get(step.fallbackAgentId);
					if (fallbackHandler) {
						try {
							const fallbackResult = await fallbackHandler(prompt, resolvedInput);
							result.status = "completed";
							result.output = fallbackResult;
							result.completedAt = new Date();
							return result;
						} catch {
							// Fallback also failed
						}
					}
				}

				result.status = "failed";
				result.error = delegationResult.error;
				result.completedAt = new Date();

				this.emit("workflow:step:failed", { executionId: execution.id, stepId: step.id, error: result.error });
				return result;
			}

			// Wait before retry
			await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
		}

		return result;
	}

	// =========================================================================
	// Utilities
	// =========================================================================

	/** Convert database row to AgentDefinition */
	private rowToAgent(row: Record<string, unknown>): AgentDefinition {
		return {
			id: row.id as string,
			name: row.name as string,
			type: row.type as AgentDefinition["type"],
			role: row.role as AgentDefinition["role"],
			description: row.description as string,
			systemPrompt: row.system_prompt as string | undefined,
			config: JSON.parse((row.config as string) || "{}"),
			status: row.status as AgentDefinition["status"],
			createdAt: new Date(row.created_at as string),
			updatedAt: new Date(row.updated_at as string),
			lastRunAt: row.last_run_at ? new Date(row.last_run_at as string) : undefined,
			runCount: row.run_count as number,
			successCount: row.success_count as number,
			failureCount: row.failure_count as number,
			avgLatencyMs: row.avg_latency_ms as number,
			totalCost: row.total_cost as number,
		};
	}

	/** Convert database row to WorkflowDefinition */
	private rowToWorkflow(row: Record<string, unknown>): WorkflowDefinition {
		return {
			id: row.id as string,
			name: row.name as string,
			description: row.description as string,
			steps: JSON.parse((row.steps as string) || "[]"),
			trigger: row.trigger as WorkflowDefinition["trigger"],
			triggerConfig: JSON.parse((row.trigger_config as string) || "{}"),
			createdAt: new Date(row.created_at as string),
			updatedAt: new Date(row.updated_at as string),
		};
	}

	/** Update agent statistics */
	private updateAgentStats(agentId: string, success: boolean, latencyMs: number): void {
		this.db
			.prepare(
				`UPDATE orchestrator_agents SET
				run_count = run_count + 1,
				success_count = success_count + ?,
				failure_count = failure_count + ?,
				avg_latency_ms = (avg_latency_ms * run_count + ?) / (run_count + 1),
				last_run_at = CURRENT_TIMESTAMP,
				updated_at = CURRENT_TIMESTAMP
				WHERE id = ?`,
			)
			.run(success ? 1 : 0, success ? 0 : 1, latencyMs, agentId);
	}

	/** Log a delegation */
	private logDelegation(
		id: string,
		agentId: string,
		taskType: string,
		prompt: string,
		status: string,
		output: unknown,
		error: string | undefined,
		latencyMs: number,
	): void {
		this.db
			.prepare(
				`INSERT INTO orchestrator_delegations
				(id, agent_id, task_type, prompt, status, output, error, latency_ms)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(id, agentId, taskType, prompt, status, JSON.stringify(output), error, latencyMs);
	}

	/** Save execution state */
	private saveExecution(execution: WorkflowExecution): void {
		const stepResults: Record<string, StepResult> = {};
		execution.stepResults.forEach((value, key) => {
			stepResults[key] = value;
		});

		this.db
			.prepare(
				`INSERT OR REPLACE INTO orchestrator_executions
				(id, workflow_id, status, started_at, completed_at, current_step, step_results, error)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				execution.id,
				execution.workflowId,
				execution.status,
				execution.startedAt.toISOString(),
				execution.completedAt?.toISOString() || null,
				execution.currentStep || null,
				JSON.stringify(stepResults),
				execution.error || null,
			);
	}

	/** Resolve references in input */
	private resolveReferences(input: Record<string, unknown>, outputs: Map<string, unknown>): Record<string, unknown> {
		const resolved: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(input)) {
			if (typeof value === "string" && value.startsWith("$")) {
				// Reference to previous step output
				const ref = value.slice(1);
				resolved[key] = outputs.get(ref);
			} else if (typeof value === "object" && value !== null) {
				resolved[key] = this.resolveReferences(value as Record<string, unknown>, outputs);
			} else {
				resolved[key] = value;
			}
		}

		return resolved;
	}

	/** Get orchestrator statistics */
	getStats(): {
		agents: { total: number; byRole: Record<string, number>; byStatus: Record<string, number> };
		workflows: { total: number; executions: number };
		delegations: { total: number; successRate: number; avgLatency: number };
	} {
		const agents = this.listAgents();
		const byRole: Record<string, number> = {};
		const byStatus: Record<string, number> = {};

		for (const agent of agents) {
			byRole[agent.role] = (byRole[agent.role] || 0) + 1;
			byStatus[agent.status] = (byStatus[agent.status] || 0) + 1;
		}

		const workflowCount = (this.db.prepare("SELECT COUNT(*) as count FROM orchestrator_workflows").get() as { count: number }).count;
		const executionCount = (this.db.prepare("SELECT COUNT(*) as count FROM orchestrator_executions").get() as { count: number }).count;

		const delegationStats = this.db
			.prepare(
				`SELECT
				COUNT(*) as total,
				SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes,
				AVG(latency_ms) as avg_latency
				FROM orchestrator_delegations`,
			)
			.get() as { total: number; successes: number; avg_latency: number };

		return {
			agents: {
				total: agents.length,
				byRole,
				byStatus,
			},
			workflows: {
				total: workflowCount,
				executions: executionCount,
			},
			delegations: {
				total: delegationStats.total || 0,
				successRate: delegationStats.total ? (delegationStats.successes / delegationStats.total) * 100 : 0,
				avgLatency: delegationStats.avg_latency || 0,
			},
		};
	}

	/** Close the database connection */
	close(): void {
		this.db.close();
	}
}

// =============================================================================
// Singleton Instance
// =============================================================================

let orchestratorInstance: Orchestrator | null = null;

export function getOrchestrator(dbPath?: string): Orchestrator {
	if (!orchestratorInstance) {
		orchestratorInstance = new Orchestrator(dbPath);
	}
	return orchestratorInstance;
}

export function closeOrchestrator(): void {
	if (orchestratorInstance) {
		orchestratorInstance.close();
		orchestratorInstance = null;
	}
}
