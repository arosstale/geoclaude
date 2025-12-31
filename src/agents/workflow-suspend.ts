/**
 * Workflow Suspend Manager - VoltAgent-style Suspend/Resume
 *
 * Enables workflows to be suspended mid-execution and resumed later with
 * full state restoration. Useful for:
 * - Long-running workflows that need to pause for external input
 * - Resource-constrained environments (save memory/CPU)
 * - Human-in-the-loop workflows waiting for approval
 * - Scheduled workflows that need to pause overnight
 *
 * Features:
 * - Persist suspended workflows to SQLite database
 * - Automatic expiration with configurable TTL
 * - Resume with optional new input data
 * - Cleanup of expired suspensions
 * - Query by workflow ID, expiration status
 *
 * Example:
 * ```typescript
 * const manager = getWorkflowSuspendManager();
 *
 * // Suspend a running workflow
 * const suspendId = await manager.suspend(workflow, "Waiting for user approval", 3600000);
 *
 * // Later, resume it
 * const result = await manager.resume(suspendId, { approved: true });
 * ```
 */

import { existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { getDatabase } from "../database.js";
import type { Workflow, WorkflowContext } from "./workflow-chains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..", "..");

// Default data directory
const DEFAULT_DATA_DIR = join(packageRoot, "data");

// ============================================================================
// Types
// ============================================================================

export interface SuspendedWorkflow {
	/** Unique suspension ID */
	id: string;

	/** Workflow ID being suspended */
	workflowId: string;

	/** Current step ID where suspended */
	step: string;

	/** Full workflow state snapshot */
	state: Record<string, unknown>;

	/** Reason for suspension */
	reason: string;

	/** When this workflow was suspended */
	suspendedAt: Date;

	/** When this suspension expires (null = never) */
	expiresAt: Date | null;

	/** Optional input to provide when resuming */
	resumeInput?: unknown;

	/** Workflow metadata for reference */
	metadata?: Record<string, unknown>;
}

export interface SuspendOptions {
	/** Reason for suspension */
	reason: string;

	/** Expiration time in milliseconds (null = never expires) */
	expiresIn?: number | null;

	/** Input data to use when resuming */
	resumeInput?: unknown;

	/** Additional metadata */
	metadata?: Record<string, unknown>;
}

export interface ResumeResult {
	/** Whether resume was successful */
	success: boolean;

	/** Workflow execution result if successful */
	result?: WorkflowContext;

	/** Error message if failed */
	error?: string;

	/** The suspended workflow that was resumed */
	suspended?: SuspendedWorkflow;
}

export interface SuspendFilter {
	/** Filter by workflow ID */
	workflowId?: string;

	/** Filter by expiration status */
	expired?: boolean;

	/** Filter by suspension time (since timestamp) */
	since?: number;

	/** Maximum results to return */
	limit?: number;
}

// ============================================================================
// Database Schema Extension
// ============================================================================

/**
 * Initialize the suspended_workflows table in the database
 */
function initializeSuspendedWorkflowsTable(): void {
	const db = getDatabase();
	db.initSuspendedWorkflowsTable();
}

// ============================================================================
// Workflow Suspend Manager
// ============================================================================

export class WorkflowSuspendManager {
	private dataDir: string;

	constructor(dataDir = DEFAULT_DATA_DIR) {
		this.dataDir = dataDir;

		// Ensure data directory exists
		const workflowDir = join(this.dataDir, "workflows");
		if (!existsSync(workflowDir)) {
			mkdirSync(workflowDir, { recursive: true });
		}

		// Initialize database table
		initializeSuspendedWorkflowsTable();
	}

	// ============================================================================
	// Suspend Operations
	// ============================================================================

	/**
	 * Suspend a workflow for later resumption
	 */
	async suspend(workflow: Workflow, options: string | SuspendOptions): Promise<string> {
		// Normalize options
		const opts: SuspendOptions = typeof options === "string" ? { reason: options } : options;

		// Validate workflow state
		if (!workflow.isRunning) {
			throw new Error("Cannot suspend a workflow that is not running");
		}

		// Get current workflow state
		const state = workflow.state;
		const context = workflow.context;

		// Determine current step
		const currentStep = state.steps[context.currentStep];
		if (!currentStep) {
			throw new Error("No current step found in workflow");
		}

		// Calculate expiration
		const suspendedAt = new Date();
		const expiresAt =
			opts.expiresIn !== undefined && opts.expiresIn !== null ? new Date(Date.now() + opts.expiresIn) : null;

		// Generate suspension ID
		const suspendId = `suspend_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

		// Create suspended workflow record
		const suspended: SuspendedWorkflow = {
			id: suspendId,
			workflowId: state.id,
			step: currentStep.id,
			state: {
				workflowState: state,
				context: context,
			},
			reason: opts.reason,
			suspendedAt,
			expiresAt,
			resumeInput: opts.resumeInput,
			metadata: opts.metadata,
		};

		// Save to database
		this.saveSuspended(suspended);

		// Pause the workflow (sets status to 'paused')
		await workflow.pause();

		return suspendId;
	}

	/**
	 * Resume a suspended workflow
	 */
	async resume(suspendId: string, input?: unknown): Promise<ResumeResult> {
		// Load suspended workflow
		const suspended = this.getSuspended(suspendId);
		if (!suspended) {
			return {
				success: false,
				error: `Suspended workflow not found: ${suspendId}`,
			};
		}

		// Check expiration
		if (suspended.expiresAt && suspended.expiresAt < new Date()) {
			return {
				success: false,
				error: `Suspended workflow expired at ${suspended.expiresAt.toISOString()}`,
				suspended,
			};
		}

		try {
			// Load the workflow from state
			const { loadWorkflow } = await import("./workflow-chains.js");
			const workflow = loadWorkflow(suspended.workflowId, this.dataDir);

			if (!workflow) {
				return {
					success: false,
					error: `Workflow not found: ${suspended.workflowId}`,
					suspended,
				};
			}

			// Apply resume input to context if provided
			if (input !== undefined || suspended.resumeInput !== undefined) {
				const resumeData = input ?? suspended.resumeInput;
				const currentStep = workflow.state.steps[workflow.context.currentStep];

				// Store resume input in workflow context data
				if (currentStep?.output) {
					(workflow as any)._state.context.data[currentStep.output] = resumeData;
				} else {
					(workflow as any)._state.context.data._resumeInput = resumeData;
				}
			}

			// Resume workflow execution
			const result = await workflow.resume();

			// Delete suspension record (successful resume)
			this.deleteSuspended(suspendId);

			return {
				success: true,
				result,
				suspended,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				suspended,
			};
		}
	}

	// ============================================================================
	// Query Operations
	// ============================================================================

	/**
	 * List suspended workflows with optional filtering
	 */
	list(filter: SuspendFilter = {}): SuspendedWorkflow[] {
		const db = getDatabase();

		const conditions: string[] = [];
		const params: (string | number)[] = [];

		// Apply filters
		if (filter.workflowId) {
			conditions.push("workflow_id = ?");
			params.push(filter.workflowId);
		}

		if (filter.since !== undefined) {
			conditions.push("suspended_at >= ?");
			params.push(new Date(filter.since).toISOString());
		}

		if (filter.expired !== undefined) {
			if (filter.expired) {
				conditions.push("expires_at IS NOT NULL AND expires_at <= ?");
				params.push(new Date().toISOString());
			} else {
				conditions.push("(expires_at IS NULL OR expires_at > ?)");
				params.push(new Date().toISOString());
			}
		}

		// Execute query using database method
		const rows = db.querySuspendedWorkflows(conditions, params, filter.limit);

		// Convert to SuspendedWorkflow objects
		return rows.map((row) => this.deserialize(row));
	}

	/**
	 * Get a specific suspended workflow by ID
	 */
	getSuspended(suspendId: string): SuspendedWorkflow | null {
		const db = getDatabase();
		const row = db.getSuspendedWorkflow(suspendId);

		if (!row) {
			return null;
		}

		return this.deserialize(row);
	}

	/**
	 * Check if a suspension exists and is not expired
	 */
	isValid(suspendId: string): boolean {
		const suspended = this.getSuspended(suspendId);
		if (!suspended) {
			return false;
		}

		// Check expiration
		if (suspended.expiresAt && suspended.expiresAt < new Date()) {
			return false;
		}

		return true;
	}

	// ============================================================================
	// Cleanup Operations
	// ============================================================================

	/**
	 * Remove expired suspensions
	 * @returns Number of expired suspensions removed
	 */
	cleanup(): number {
		const db = getDatabase();
		const now = new Date().toISOString();
		return db.deleteExpiredSuspendedWorkflows(now);
	}

	/**
	 * Delete a specific suspended workflow
	 */
	deleteSuspended(suspendId: string): boolean {
		const db = getDatabase();
		const changes = db.deleteSuspendedWorkflow(suspendId);
		return changes > 0;
	}

	/**
	 * Delete all suspended workflows for a specific workflow ID
	 */
	deleteByWorkflowId(workflowId: string): number {
		const db = getDatabase();
		return db.deleteSuspendedWorkflowsByWorkflowId(workflowId);
	}

	/**
	 * Get suspension statistics
	 */
	getStats(): {
		total: number;
		expired: number;
		active: number;
		byWorkflow: Record<string, number>;
	} {
		const db = getDatabase();

		// Total count
		const total = db.countSuspendedWorkflows();

		// Expired count
		const now = new Date().toISOString();
		const expired = db.countExpiredSuspendedWorkflows(now);

		// Active count
		const active = total - expired;

		// Count by workflow
		const byWorkflowRows = db.getSuspendedWorkflowCountsByWorkflowId();

		const byWorkflow: Record<string, number> = {};
		for (const row of byWorkflowRows) {
			byWorkflow[row.workflow_id] = row.count;
		}

		return { total, expired, active, byWorkflow };
	}

	// ============================================================================
	// Internal Helpers
	// ============================================================================

	/**
	 * Save a suspended workflow to database
	 */
	private saveSuspended(suspended: SuspendedWorkflow): void {
		const db = getDatabase();
		db.saveSuspendedWorkflow({
			id: suspended.id,
			workflowId: suspended.workflowId,
			step: suspended.step,
			state: JSON.stringify(suspended.state),
			reason: suspended.reason,
			suspendedAt: suspended.suspendedAt.toISOString(),
			expiresAt: suspended.expiresAt ? suspended.expiresAt.toISOString() : null,
			resumeInput: suspended.resumeInput !== undefined ? JSON.stringify(suspended.resumeInput) : null,
			metadata: suspended.metadata !== undefined ? JSON.stringify(suspended.metadata) : null,
		});
	}

	/**
	 * Deserialize database row to SuspendedWorkflow
	 */
	private deserialize(row: {
		id: string;
		workflow_id: string;
		step: string;
		state: string;
		reason: string;
		suspended_at: string;
		expires_at: string | null;
		resume_input: string | null;
		metadata: string | null;
	}): SuspendedWorkflow {
		return {
			id: row.id,
			workflowId: row.workflow_id,
			step: row.step,
			state: JSON.parse(row.state),
			reason: row.reason,
			suspendedAt: new Date(row.suspended_at),
			expiresAt: row.expires_at ? new Date(row.expires_at) : null,
			resumeInput: row.resume_input ? JSON.parse(row.resume_input) : undefined,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		};
	}
}

// ============================================================================
// Factory & Singleton
// ============================================================================

let managerInstance: WorkflowSuspendManager | null = null;

/**
 * Get or create the workflow suspend manager singleton
 */
export function getWorkflowSuspendManager(dataDir = DEFAULT_DATA_DIR): WorkflowSuspendManager {
	if (!managerInstance) {
		managerInstance = new WorkflowSuspendManager(dataDir);
	}
	return managerInstance;
}

/**
 * Dispose of the singleton instance
 */
export function disposeWorkflowSuspendManager(): void {
	managerInstance = null;
}

// ============================================================================
// Workflow Class Extensions (Convenience Methods)
// ============================================================================

/**
 * Add suspend method to Workflow class
 *
 * Usage:
 * ```typescript
 * import { addSuspendMethods } from "./workflow-suspend.js";
 *
 * const workflow = createWorkflow(...);
 * addSuspendMethods(workflow);
 *
 * const suspendId = await workflow.suspend("Waiting for approval", 3600000);
 * ```
 */
export function addSuspendMethods(workflow: Workflow): void {
	const manager = getWorkflowSuspendManager();

	// Add suspend method
	(workflow as any).suspend = async (options: string | SuspendOptions): Promise<string> =>
		manager.suspend(workflow, options);

	// Add resumeFromSuspension method
	(workflow as any).resumeFromSuspension = async (suspendId: string, input?: unknown): Promise<ResumeResult> =>
		manager.resume(suspendId, input);
}

// ============================================================================
// MCP Tools for Workflow Suspension
// ============================================================================

export interface WorkflowSuspendTool {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
	};
}

/**
 * Create MCP tools for workflow suspension management
 */
export function createWorkflowSuspendTools(): WorkflowSuspendTool[] {
	return [
		{
			name: "workflow_suspend",
			description: "Suspend a running workflow for later resumption",
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
						description: "Expiration time in milliseconds (null = never)",
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
			description: "Resume a suspended workflow",
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
			name: "workflow_cleanup_suspended",
			description: "Remove expired suspended workflows",
			inputSchema: {
				type: "object",
				properties: {},
			},
		},
		{
			name: "workflow_suspend_status",
			description: "Get suspension statistics",
			inputSchema: {
				type: "object",
				properties: {},
			},
		},
		{
			name: "workflow_delete_suspended",
			description: "Delete a specific suspended workflow",
			inputSchema: {
				type: "object",
				properties: {
					suspend_id: {
						type: "string",
						description: "Suspension ID to delete",
					},
				},
				required: ["suspend_id"],
			},
		},
	];
}
