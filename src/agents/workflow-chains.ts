/**
 * Workflow Chains - Multi-Step Agent Orchestration
 *
 * Implements Phase 3 from the Letta Superiority Roadmap:
 * - Define multi-step workflows with persistent state
 * - State persists across failures - resume from any step
 * - Parallel and sequential step execution
 * - Automatic checkpoint management
 *
 * Example:
 * ```typescript
 * const workflow = createWorkflow("trading-analysis", [
 *   { agent: "data-collector", output: "market_data" },
 *   { agent: "pattern-analyzer", input: "market_data", output: "patterns" },
 *   { agent: "signal-generator", input: "patterns", output: "signals" },
 *   { agent: "risk-assessor", input: "signals", output: "trade_plan" },
 * ]);
 * await workflow.run();
 * ```
 */

import { EventEmitter } from "events";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { getStatefulAgent, type StatefulAgent } from "./stateful-agent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..", "..");

// Default data directory
const DEFAULT_DATA_DIR = join(packageRoot, "data");

// ============================================================================
// Types
// ============================================================================

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type WorkflowStatus = "idle" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface WorkflowStep {
	/** Step identifier */
	id: string;

	/** Agent ID to execute this step */
	agent: string;

	/** Input data key(s) from previous steps */
	input?: string | string[];

	/** Output data key for this step's result */
	output?: string;

	/** Custom task prompt/description */
	task?: string;

	/** Timeout in milliseconds */
	timeout?: number;

	/** Retry count on failure */
	retries?: number;

	/** Condition to skip this step */
	condition?: (context: WorkflowContext) => boolean | Promise<boolean>;

	/** Transform input before execution */
	transformInput?: (input: unknown) => unknown | Promise<unknown>;

	/** Transform output after execution */
	transformOutput?: (output: unknown) => unknown | Promise<unknown>;

	/** Error handler for this step */
	onError?: (error: Error, context: WorkflowContext) => void | Promise<void>;
}

export interface StepResult {
	stepId: string;
	status: StepStatus;
	startedAt: number;
	completedAt?: number;
	output?: unknown;
	error?: string;
	retryCount: number;
}

export interface WorkflowContext {
	/** Workflow ID */
	workflowId: string;

	/** Current data store */
	data: Record<string, unknown>;

	/** Step results */
	results: Record<string, StepResult>;

	/** Current step index */
	currentStep: number;

	/** Total steps */
	totalSteps: number;

	/** Workflow start time */
	startedAt: number;

	/** Custom metadata */
	metadata: Record<string, unknown>;
}

export interface WorkflowState {
	id: string;
	name: string;
	status: WorkflowStatus;
	context: WorkflowContext;
	steps: WorkflowStep[];
	createdAt: number;
	updatedAt: number;
	completedAt?: number;
	error?: string;
}

export interface WorkflowConfig {
	/** Unique workflow name */
	name: string;

	/** Workflow steps */
	steps: (WorkflowStep | WorkflowStepConfig)[];

	/** Working directory */
	cwd?: string;

	/** Data directory */
	dataDir?: string;

	/** Auto-checkpoint between steps */
	autoCheckpoint?: boolean;

	/** Continue on step failure */
	continueOnError?: boolean;

	/** Maximum concurrent parallel steps */
	maxConcurrency?: number;

	/** Global timeout in milliseconds */
	timeout?: number;

	/** Initial data */
	initialData?: Record<string, unknown>;

	/** Metadata */
	metadata?: Record<string, unknown>;
}

export interface WorkflowStepConfig {
	agent: string;
	input?: string | string[];
	output?: string;
	task?: string;
	timeout?: number;
	retries?: number;
}

export type StepExecutor = (step: WorkflowStep, input: unknown, context: WorkflowContext) => Promise<unknown>;

export interface WorkflowEvents {
	start: [workflow: Workflow];
	stepStart: [step: WorkflowStep, context: WorkflowContext];
	stepComplete: [step: WorkflowStep, result: StepResult, context: WorkflowContext];
	stepError: [step: WorkflowStep, error: Error, context: WorkflowContext];
	pause: [workflow: Workflow];
	resume: [workflow: Workflow];
	complete: [workflow: Workflow, context: WorkflowContext];
	error: [workflow: Workflow, error: Error];
	cancel: [workflow: Workflow];
}

// ============================================================================
// Workflow Implementation
// ============================================================================

export class Workflow extends EventEmitter {
	readonly id: string;
	readonly name: string;
	private steps: WorkflowStep[];
	private cwd: string;
	private dataDir: string;
	private statePath: string;
	private autoCheckpoint: boolean;
	private continueOnError: boolean;
	private maxConcurrency: number;
	private globalTimeout?: number;
	private _state: WorkflowState;
	private executor?: StepExecutor;
	private agent?: StatefulAgent;
	private abortController?: AbortController;

	constructor(config: WorkflowConfig) {
		super();

		this.id = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		this.name = config.name;
		this.cwd = config.cwd || process.cwd();
		this.dataDir = config.dataDir || DEFAULT_DATA_DIR;
		this.autoCheckpoint = config.autoCheckpoint ?? true;
		this.continueOnError = config.continueOnError ?? false;
		this.maxConcurrency = config.maxConcurrency ?? 1;
		this.globalTimeout = config.timeout;

		// Normalize steps
		this.steps = config.steps.map((step, index) => this.normalizeStep(step, index));

		// Ensure directories exist
		const workflowDir = join(this.dataDir, "workflows");
		if (!existsSync(workflowDir)) {
			mkdirSync(workflowDir, { recursive: true });
		}
		this.statePath = join(workflowDir, `${this.id}.json`);

		// Initialize state
		this._state = {
			id: this.id,
			name: this.name,
			status: "idle",
			context: {
				workflowId: this.id,
				data: config.initialData || {},
				results: {},
				currentStep: 0,
				totalSteps: this.steps.length,
				startedAt: 0,
				metadata: config.metadata || {},
			},
			steps: this.steps,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
	}

	// ============================================================================
	// State Access
	// ============================================================================

	get state(): Readonly<WorkflowState> {
		return { ...this._state };
	}

	get status(): WorkflowStatus {
		return this._state.status;
	}

	get context(): Readonly<WorkflowContext> {
		return { ...this._state.context };
	}

	get progress(): number {
		const completed = Object.values(this._state.context.results).filter(
			(r) => r.status === "completed" || r.status === "skipped",
		).length;
		return Math.round((completed / this.steps.length) * 100);
	}

	get isRunning(): boolean {
		return this._state.status === "running";
	}

	get canResume(): boolean {
		return this._state.status === "paused" || this._state.status === "failed";
	}

	// ============================================================================
	// Step Normalization
	// ============================================================================

	private normalizeStep(step: WorkflowStep | WorkflowStepConfig, index: number): WorkflowStep {
		const normalized: WorkflowStep = {
			id: (step as WorkflowStep).id || `step-${index}`,
			agent: step.agent,
			input: step.input,
			output: step.output,
			task: step.task,
			timeout: step.timeout,
			retries: step.retries ?? 0,
		};

		// Copy optional handlers if present
		const fullStep = step as WorkflowStep;
		if (fullStep.condition) normalized.condition = fullStep.condition;
		if (fullStep.transformInput) normalized.transformInput = fullStep.transformInput;
		if (fullStep.transformOutput) normalized.transformOutput = fullStep.transformOutput;
		if (fullStep.onError) normalized.onError = fullStep.onError;

		return normalized;
	}

	// ============================================================================
	// State Persistence
	// ============================================================================

	private saveState(): void {
		this._state.updatedAt = Date.now();
		try {
			writeFileSync(this.statePath, JSON.stringify(this._state, null, 2));
		} catch (error) {
			console.error(`Failed to save workflow state: ${error}`);
		}
	}

	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: Reserved for workflow restoration
	private _loadState(): boolean {
		if (existsSync(this.statePath)) {
			try {
				const data = readFileSync(this.statePath, "utf-8");
				this._state = JSON.parse(data);
				return true;
			} catch {
				return false;
			}
		}
		return false;
	}

	// ============================================================================
	// Execution Control
	// ============================================================================

	/**
	 * Set the step executor function
	 */
	setExecutor(executor: StepExecutor): this {
		this.executor = executor;
		return this;
	}

	/**
	 * Run the workflow
	 */
	async run(executor?: StepExecutor): Promise<WorkflowContext> {
		if (executor) {
			this.executor = executor;
		}

		if (!this.executor) {
			throw new Error("No executor provided. Call setExecutor() first.");
		}

		if (this._state.status === "running") {
			throw new Error("Workflow is already running");
		}

		// Initialize
		this._state.status = "running";
		this._state.context.startedAt = Date.now();
		this.abortController = new AbortController();

		// Create stateful agent for checkpointing
		this.agent = getStatefulAgent({
			id: `workflow-${this.id}`,
			cwd: this.cwd,
			dataDir: this.dataDir,
		});

		this.emit("start", this);
		this.saveState();

		try {
			// Execute steps
			for (let i = this._state.context.currentStep; i < this.steps.length; i++) {
				// Check for abort
				if (this.abortController.signal.aborted) {
					this._state.status = "cancelled";
					this.emit("cancel", this);
					break;
				}

				// Check for pause (may be set by external pause() call)
				if ((this._state.status as WorkflowStatus) === "paused") {
					this.emit("pause", this);
					break;
				}

				this._state.context.currentStep = i;
				const step = this.steps[i];

				// Execute step
				const result = await this.executeStep(step);
				this._state.context.results[step.id] = result;

				// Handle failure
				if (result.status === "failed" && !this.continueOnError) {
					this._state.status = "failed";
					this._state.error = result.error;
					this.emit("error", this, new Error(result.error));
					break;
				}

				// Auto-checkpoint
				if (this.autoCheckpoint && this.agent) {
					await this.agent.checkpoint(`step-${step.id}`);
				}

				this.saveState();
			}

			// Mark complete if all steps done
			if (this._state.status === "running" && this._state.context.currentStep >= this.steps.length - 1) {
				const lastResult = this._state.context.results[this.steps[this.steps.length - 1].id];
				if (lastResult?.status === "completed" || lastResult?.status === "skipped") {
					this._state.status = "completed";
					this._state.completedAt = Date.now();
					this.emit("complete", this, this._state.context);
				}
			}
		} catch (error) {
			this._state.status = "failed";
			this._state.error = error instanceof Error ? error.message : String(error);
			this.emit("error", this, error instanceof Error ? error : new Error(String(error)));
		}

		this.saveState();
		return this._state.context;
	}

	/**
	 * Execute a single step
	 */
	private async executeStep(step: WorkflowStep): Promise<StepResult> {
		const result: StepResult = {
			stepId: step.id,
			status: "pending",
			startedAt: Date.now(),
			retryCount: 0,
		};

		// Check condition
		if (step.condition) {
			const shouldRun = await step.condition(this._state.context);
			if (!shouldRun) {
				result.status = "skipped";
				result.completedAt = Date.now();
				return result;
			}
		}

		// Gather input
		let input: unknown;
		if (step.input) {
			const inputKeys = Array.isArray(step.input) ? step.input : [step.input];
			if (inputKeys.length === 1) {
				input = this._state.context.data[inputKeys[0]];
			} else {
				input = inputKeys.reduce(
					(acc, key) => {
						acc[key] = this._state.context.data[key];
						return acc;
					},
					{} as Record<string, unknown>,
				);
			}
		}

		// Transform input
		if (step.transformInput) {
			input = await step.transformInput(input);
		}

		// Execute with retries
		result.status = "running";
		this.emit("stepStart", step, this._state.context);

		let lastError: Error | undefined;
		const maxAttempts = (step.retries ?? 0) + 1;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			result.retryCount = attempt;

			try {
				// Execute with timeout
				let output: unknown;
				const timeout = step.timeout || this.globalTimeout;

				if (timeout) {
					output = await Promise.race([
						this.executor!(step, input, this._state.context),
						new Promise((_, reject) => setTimeout(() => reject(new Error("Step timeout")), timeout)),
					]);
				} else {
					output = await this.executor!(step, input, this._state.context);
				}

				// Transform output
				if (step.transformOutput) {
					output = await step.transformOutput(output);
				}

				// Store output
				if (step.output) {
					this._state.context.data[step.output] = output;
				}

				result.status = "completed";
				result.output = output;
				result.completedAt = Date.now();

				this.emit("stepComplete", step, result, this._state.context);
				return result;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				// Call error handler if present
				if (step.onError) {
					await step.onError(lastError, this._state.context);
				}

				// Retry if attempts remaining
				if (attempt < maxAttempts - 1) {
					console.warn(`Step ${step.id} failed (attempt ${attempt + 1}/${maxAttempts}): ${lastError.message}`);
					await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); // Exponential backoff
				}
			}
		}

		// All retries exhausted
		result.status = "failed";
		result.error = lastError?.message || "Unknown error";
		result.completedAt = Date.now();

		this.emit("stepError", step, lastError!, this._state.context);
		return result;
	}

	/**
	 * Pause the workflow
	 */
	async pause(): Promise<void> {
		if (this._state.status !== "running") {
			throw new Error("Workflow is not running");
		}

		this._state.status = "paused";
		this.saveState();

		if (this.agent) {
			await this.agent.checkpoint("pause");
		}
	}

	/**
	 * Resume the workflow
	 */
	async resume(executor?: StepExecutor): Promise<WorkflowContext> {
		if (!this.canResume) {
			throw new Error(`Cannot resume workflow in ${this._state.status} state`);
		}

		this._state.status = "running";
		this.emit("resume", this);

		// If failed, move to next step
		if (this._state.error) {
			this._state.context.currentStep++;
			this._state.error = undefined;
		}

		return this.run(executor);
	}

	/**
	 * Cancel the workflow
	 */
	cancel(): void {
		if (this.abortController) {
			this.abortController.abort();
		}
		this._state.status = "cancelled";
		this.saveState();
		this.emit("cancel", this);
	}

	/**
	 * Reset the workflow
	 */
	reset(): void {
		this._state.status = "idle";
		this._state.context = {
			workflowId: this.id,
			data: {},
			results: {},
			currentStep: 0,
			totalSteps: this.steps.length,
			startedAt: 0,
			metadata: this._state.context.metadata,
		};
		this._state.error = undefined;
		this._state.completedAt = undefined;
		this.saveState();
	}

	/**
	 * Restart from a specific step
	 */
	async restartFrom(stepId: string, executor?: StepExecutor): Promise<WorkflowContext> {
		const stepIndex = this.steps.findIndex((s) => s.id === stepId);
		if (stepIndex === -1) {
			throw new Error(`Step not found: ${stepId}`);
		}

		this._state.context.currentStep = stepIndex;
		this._state.status = "idle";
		this._state.error = undefined;

		// Clear results from this step onward
		for (let i = stepIndex; i < this.steps.length; i++) {
			delete this._state.context.results[this.steps[i].id];
		}

		this.saveState();
		return this.run(executor);
	}

	// ============================================================================
	// Suspend/Resume Operations (VoltAgent-style)
	// ============================================================================

	/**
	 * Suspend the workflow for later resumption with state persistence
	 * This is different from pause() as it saves suspension metadata to database
	 *
	 * @param reason - Reason for suspension (e.g., "waiting for approval")
	 * @param expiresIn - Optional expiration time in milliseconds
	 * @param resumeInput - Optional input to provide when resuming
	 * @returns Suspension ID for later resume
	 */
	async suspend(reason: string, expiresIn?: number | null, resumeInput?: unknown): Promise<string> {
		// Lazy import to avoid circular dependencies
		const { getWorkflowSuspendManager } = await import("./workflow-suspend.js");
		const manager = getWorkflowSuspendManager(this.dataDir);

		return manager.suspend(this, {
			reason,
			expiresIn,
			resumeInput,
		});
	}

	/**
	 * Resume a workflow from a suspension
	 *
	 * @param suspendId - The suspension ID to resume from
	 * @param input - Optional input data to inject when resuming
	 */
	async resumeFromSuspension(suspendId: string, input?: unknown): Promise<WorkflowContext> {
		// Lazy import to avoid circular dependencies
		const { getWorkflowSuspendManager } = await import("./workflow-suspend.js");
		const manager = getWorkflowSuspendManager(this.dataDir);

		const result = await manager.resume(suspendId, input);

		if (!result.success) {
			throw new Error(result.error || "Failed to resume from suspension");
		}

		return result.result!;
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new workflow
 */
export function createWorkflow(
	name: string,
	steps: (WorkflowStep | WorkflowStepConfig)[],
	options: Partial<WorkflowConfig> = {},
): Workflow {
	return new Workflow({
		name,
		steps,
		...options,
	});
}

/**
 * Load a workflow from state file
 */
export function loadWorkflow(workflowId: string, dataDir = DEFAULT_DATA_DIR): Workflow | null {
	const statePath = join(dataDir, "workflows", `${workflowId}.json`);
	if (!existsSync(statePath)) {
		return null;
	}

	try {
		const data = readFileSync(statePath, "utf-8");
		const state: WorkflowState = JSON.parse(data);

		const workflow = new Workflow({
			name: state.name,
			steps: state.steps,
			dataDir,
			initialData: state.context.data,
			metadata: state.context.metadata,
		});

		// Restore state
		(workflow as unknown as { _state: WorkflowState })._state = state;

		return workflow;
	} catch {
		return null;
	}
}

/**
 * List all workflow states
 */
export function listWorkflows(dataDir = DEFAULT_DATA_DIR): WorkflowState[] {
	const workflowDir = join(dataDir, "workflows");
	if (!existsSync(workflowDir)) {
		return [];
	}

	const files = readdirSync(workflowDir).filter((f) => f.endsWith(".json"));

	return files
		.map((file: string) => {
			try {
				const data = readFileSync(join(workflowDir, file), "utf-8");
				return JSON.parse(data) as WorkflowState;
			} catch {
				return null;
			}
		})
		.filter((s: WorkflowState | null): s is WorkflowState => s !== null);
}

// ============================================================================
// Parallel Workflow Support
// ============================================================================

export interface ParallelStep {
	steps: WorkflowStep[];
	waitForAll?: boolean;
}

/**
 * Create a parallel step group
 */
export function parallel(
	steps: (WorkflowStep | WorkflowStepConfig)[],
	options: { waitForAll?: boolean } = {},
): ParallelStep {
	return {
		steps: steps.map((s, i) => ({
			id: (s as WorkflowStep).id || `parallel-${i}`,
			agent: s.agent,
			input: s.input,
			output: s.output,
			task: s.task,
			timeout: s.timeout,
			retries: (s as WorkflowStep).retries ?? 0,
		})),
		waitForAll: options.waitForAll ?? true,
	};
}

// ============================================================================
// Workflow Chain Builder (Fluent API)
// ============================================================================

export class WorkflowBuilder {
	private name: string;
	private steps: WorkflowStep[] = [];
	private options: Partial<WorkflowConfig> = {};

	constructor(name: string) {
		this.name = name;
	}

	/**
	 * Add a step
	 */
	step(config: WorkflowStepConfig | WorkflowStep): this {
		this.steps.push({
			id: (config as WorkflowStep).id || `step-${this.steps.length}`,
			agent: config.agent,
			input: config.input,
			output: config.output,
			task: config.task,
			timeout: config.timeout,
			retries: (config as WorkflowStep).retries ?? 0,
		});
		return this;
	}

	/**
	 * Add a conditional step
	 */
	when(condition: (context: WorkflowContext) => boolean | Promise<boolean>, config: WorkflowStepConfig): this {
		this.steps.push({
			id: `step-${this.steps.length}`,
			agent: config.agent,
			input: config.input,
			output: config.output,
			task: config.task,
			timeout: config.timeout,
			retries: 0,
			condition,
		});
		return this;
	}

	/**
	 * Set working directory
	 */
	cwd(path: string): this {
		this.options.cwd = path;
		return this;
	}

	/**
	 * Set data directory
	 */
	dataDir(path: string): this {
		this.options.dataDir = path;
		return this;
	}

	/**
	 * Enable/disable auto-checkpointing
	 */
	autoCheckpoint(enabled: boolean): this {
		this.options.autoCheckpoint = enabled;
		return this;
	}

	/**
	 * Continue on step failure
	 */
	continueOnError(enabled: boolean): this {
		this.options.continueOnError = enabled;
		return this;
	}

	/**
	 * Set initial data
	 */
	withData(data: Record<string, unknown>): this {
		this.options.initialData = data;
		return this;
	}

	/**
	 * Set metadata
	 */
	withMetadata(metadata: Record<string, unknown>): this {
		this.options.metadata = metadata;
		return this;
	}

	/**
	 * Set global timeout
	 */
	timeout(ms: number): this {
		this.options.timeout = ms;
		return this;
	}

	/**
	 * Build the workflow
	 */
	build(): Workflow {
		return createWorkflow(this.name, this.steps, this.options);
	}
}

/**
 * Start building a workflow
 */
export function workflow(name: string): WorkflowBuilder {
	return new WorkflowBuilder(name);
}

// ============================================================================
// Workflow Tools for MCP/Discord Integration
// ============================================================================

export interface WorkflowTool {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
	};
}

export function createWorkflowTools(): WorkflowTool[] {
	return [
		{
			name: "workflow_create",
			description: "Create a new workflow with defined steps",
			inputSchema: {
				type: "object",
				properties: {
					name: {
						type: "string",
						description: "Workflow name",
					},
					steps: {
						type: "array",
						description: "Array of workflow steps",
						items: {
							type: "object",
							properties: {
								agent: { type: "string" },
								input: { type: "string" },
								output: { type: "string" },
								task: { type: "string" },
							},
							required: ["agent"],
						},
					},
				},
				required: ["name", "steps"],
			},
		},
		{
			name: "workflow_run",
			description: "Run a workflow by ID",
			inputSchema: {
				type: "object",
				properties: {
					workflow_id: {
						type: "string",
						description: "Workflow ID to run",
					},
				},
				required: ["workflow_id"],
			},
		},
		{
			name: "workflow_status",
			description: "Get workflow status and progress",
			inputSchema: {
				type: "object",
				properties: {
					workflow_id: {
						type: "string",
						description: "Workflow ID",
					},
				},
				required: ["workflow_id"],
			},
		},
		{
			name: "workflow_pause",
			description: "Pause a running workflow (temporary, in-memory)",
			inputSchema: {
				type: "object",
				properties: {
					workflow_id: {
						type: "string",
						description: "Workflow ID to pause",
					},
				},
				required: ["workflow_id"],
			},
		},
		{
			name: "workflow_resume",
			description: "Resume a paused workflow",
			inputSchema: {
				type: "object",
				properties: {
					workflow_id: {
						type: "string",
						description: "Workflow ID to resume",
					},
				},
				required: ["workflow_id"],
			},
		},
		{
			name: "workflow_suspend",
			description: "Suspend a running workflow with persistent state for later resumption (VoltAgent-style)",
			inputSchema: {
				type: "object",
				properties: {
					workflow_id: {
						type: "string",
						description: "Workflow ID to suspend",
					},
					reason: {
						type: "string",
						description: "Reason for suspension",
					},
					expires_in_ms: {
						type: "number",
						description: "Optional expiration time in milliseconds",
					},
					resume_input: {
						description: "Optional input to provide when resuming",
					},
				},
				required: ["workflow_id", "reason"],
			},
		},
		{
			name: "workflow_resume_suspended",
			description: "Resume a suspended workflow from database",
			inputSchema: {
				type: "object",
				properties: {
					suspend_id: {
						type: "string",
						description: "Suspension ID",
					},
					input: {
						description: "Optional input data for resumption",
					},
				},
				required: ["suspend_id"],
			},
		},
		{
			name: "workflow_list_suspended",
			description: "List all suspended workflows",
			inputSchema: {
				type: "object",
				properties: {
					workflow_id: {
						type: "string",
						description: "Filter by workflow ID",
					},
					expired: {
						type: "boolean",
						description: "Filter by expiration status",
					},
					limit: {
						type: "number",
						description: "Maximum number of results",
					},
				},
			},
		},
		{
			name: "workflow_cancel",
			description: "Cancel a running workflow",
			inputSchema: {
				type: "object",
				properties: {
					workflow_id: {
						type: "string",
						description: "Workflow ID to cancel",
					},
				},
				required: ["workflow_id"],
			},
		},
		{
			name: "workflow_list",
			description: "List all workflows",
			inputSchema: {
				type: "object",
				properties: {
					status: {
						type: "string",
						description: "Filter by status",
						enum: ["idle", "running", "paused", "completed", "failed", "cancelled"],
					},
				},
			},
		},
		{
			name: "workflow_restart_from",
			description: "Restart workflow from a specific step",
			inputSchema: {
				type: "object",
				properties: {
					workflow_id: {
						type: "string",
						description: "Workflow ID",
					},
					step_id: {
						type: "string",
						description: "Step ID to restart from",
					},
				},
				required: ["workflow_id", "step_id"],
			},
		},
	];
}
