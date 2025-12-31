/**
 * Stateful Agent - Persistent Agent State with Checkpoint/Restore
 *
 * Implements Phase 3 from the Letta Superiority Roadmap:
 * - Persistent agent state across sessions
 * - Resume from any point
 * - Checkpoint for rollback
 * - Restore to previous states
 *
 * Integrates with:
 * - checkpoint-hook.ts for Git-based state persistence
 * - memory-blocks.ts for structured memory
 * - agent-messaging.ts for inter-agent communication
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { type CheckpointTag, CheckpointUtils } from "./hooks/checkpoint-hook.js";
import type { CheckpointData } from "./hooks/types.js";
import { getMemoryManager, type MemoryBlockManager } from "./memory-blocks.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..", "..");

// Default data directory
const DEFAULT_DATA_DIR = join(packageRoot, "data");

// ============================================================================
// Types
// ============================================================================

export type AgentStatus = "idle" | "running" | "paused" | "completed" | "failed" | "suspended";

export interface AgentState {
	/** Current execution status */
	status: AgentStatus;

	/** Current task being executed */
	currentTask?: string;

	/** Progress indicator (0-100) */
	progress: number;

	/** Custom state data */
	data: Record<string, unknown>;

	/** Error message if failed */
	error?: string;

	/** Last activity timestamp */
	lastActivity: number;

	/** Execution history */
	history: ExecutionHistoryEntry[];
}

export interface ExecutionHistoryEntry {
	timestamp: number;
	action: string;
	status: AgentStatus;
	details?: string;
	checkpointId?: string;
}

export interface StatefulAgentConfig {
	/** Unique agent identifier */
	id: string;

	/** Working directory for checkpoints */
	cwd?: string;

	/** Data directory for state persistence */
	dataDir?: string;

	/** Auto-checkpoint on state changes */
	autoCheckpoint?: boolean;

	/** Maximum history entries to keep */
	maxHistory?: number;

	/** Session ID for checkpoint grouping */
	sessionId?: string;
}

export interface ResumeOptions {
	/** Checkpoint ID to resume from */
	checkpointId?: string;

	/** Tag name to resume from */
	tagName?: string;

	/** Resume from latest checkpoint */
	latest?: boolean;

	/** Restore files (default: true) */
	restoreFiles?: boolean;
}

export interface CheckpointResult {
	success: boolean;
	checkpointId?: string;
	error?: string;
}

export interface RestoreResult {
	success: boolean;
	checkpoint?: CheckpointData;
	previousState?: AgentState;
	error?: string;
}

// ============================================================================
// Stateful Agent Implementation
// ============================================================================

export class StatefulAgent {
	readonly id: string;
	private cwd: string;
	private dataDir: string;
	private statePath: string;
	private autoCheckpoint: boolean;
	private maxHistory: number;
	private sessionId: string;
	private _state: AgentState;
	private _memory: MemoryBlockManager | null = null;
	private checkpointCount = 0;

	constructor(config: StatefulAgentConfig) {
		this.id = config.id;
		this.cwd = config.cwd || process.cwd();
		this.dataDir = config.dataDir || DEFAULT_DATA_DIR;
		this.autoCheckpoint = config.autoCheckpoint ?? true;
		this.maxHistory = config.maxHistory ?? 100;
		this.sessionId = config.sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

		// Ensure directories exist
		const stateDir = join(this.dataDir, "agents");
		if (!existsSync(stateDir)) {
			mkdirSync(stateDir, { recursive: true });
		}
		this.statePath = join(stateDir, `${this.id}.json`);

		// Load or initialize state
		this._state = this.loadState();
	}

	// ============================================================================
	// State Access
	// ============================================================================

	/** Get current agent state (read-only copy) */
	get state(): Readonly<AgentState> {
		return { ...this._state };
	}

	/** Get current status */
	get status(): AgentStatus {
		return this._state.status;
	}

	/** Get memory manager (lazy initialization) */
	get memory(): MemoryBlockManager {
		if (!this._memory) {
			this._memory = getMemoryManager(this.id, this.dataDir);
		}
		return this._memory;
	}

	/** Check if agent is active */
	get isActive(): boolean {
		return this._state.status === "running" || this._state.status === "paused";
	}

	/** Check if agent can be resumed */
	get canResume(): boolean {
		return this._state.status === "paused" || this._state.status === "suspended" || this._state.status === "failed";
	}

	// ============================================================================
	// State Management
	// ============================================================================

	/** Load state from disk */
	private loadState(): AgentState {
		if (existsSync(this.statePath)) {
			try {
				const data = readFileSync(this.statePath, "utf-8");
				return JSON.parse(data) as AgentState;
			} catch {
				console.error(`Failed to load state for agent ${this.id}, creating new state`);
			}
		}

		return this.createInitialState();
	}

	/** Create initial state */
	private createInitialState(): AgentState {
		return {
			status: "idle",
			progress: 0,
			data: {},
			lastActivity: Date.now(),
			history: [],
		};
	}

	/** Save state to disk */
	private saveState(): void {
		try {
			writeFileSync(this.statePath, JSON.stringify(this._state, null, 2));
		} catch (error) {
			console.error(`Failed to save state for agent ${this.id}:`, error);
		}
	}

	/** Update state with optional checkpoint */
	private async updateState(updates: Partial<AgentState>, action: string, createCheckpoint = false): Promise<void> {
		const previousStatus = this._state.status;

		// Apply updates
		Object.assign(this._state, updates);
		this._state.lastActivity = Date.now();

		// Add history entry
		const historyEntry: ExecutionHistoryEntry = {
			timestamp: Date.now(),
			action,
			status: this._state.status,
		};

		// Create checkpoint if requested or auto-checkpoint enabled
		if (createCheckpoint || (this.autoCheckpoint && previousStatus !== this._state.status)) {
			const result = await this.checkpoint(`auto-${action}`);
			if (result.success) {
				historyEntry.checkpointId = result.checkpointId;
			}
		}

		this._state.history.push(historyEntry);

		// Trim history if needed
		if (this._state.history.length > this.maxHistory) {
			this._state.history = this._state.history.slice(-this.maxHistory);
		}

		this.saveState();
	}

	// ============================================================================
	// Lifecycle Methods
	// ============================================================================

	/**
	 * Start the agent with a task
	 */
	async start(task: string): Promise<void> {
		if (this._state.status === "running") {
			throw new Error(`Agent ${this.id} is already running`);
		}

		await this.updateState(
			{
				status: "running",
				currentTask: task,
				progress: 0,
				error: undefined,
			},
			"start",
			true,
		);
	}

	/**
	 * Pause the agent (can be resumed)
	 */
	async pause(): Promise<void> {
		if (this._state.status !== "running") {
			throw new Error(`Agent ${this.id} is not running`);
		}

		await this.updateState({ status: "paused" }, "pause", true);
	}

	/**
	 * Resume the agent from paused or suspended state
	 */
	async resume(options: ResumeOptions = {}): Promise<RestoreResult> {
		const { checkpointId, tagName, latest = false, restoreFiles = true } = options;

		// If resuming from checkpoint
		if (checkpointId || tagName || latest) {
			const result = await this.restore({ checkpointId, tagName, latest, restoreFiles });
			if (!result.success) {
				return result;
			}
		}

		// Resume execution
		if (this.canResume) {
			const previousState = { ...this._state };
			await this.updateState(
				{
					status: "running",
					error: undefined,
				},
				"resume",
			);
			return { success: true, previousState };
		}

		return {
			success: false,
			error: `Cannot resume agent in ${this._state.status} state`,
		};
	}

	/**
	 * Suspend the agent (saves state for later resume)
	 */
	async suspend(): Promise<CheckpointResult> {
		const result = await this.checkpoint("suspend");

		await this.updateState({ status: "suspended" }, "suspend", false);

		return result;
	}

	/**
	 * Complete the agent's task
	 */
	async complete(result?: unknown): Promise<void> {
		await this.updateState(
			{
				status: "completed",
				progress: 100,
				data: { ...this._state.data, result },
			},
			"complete",
			true,
		);
	}

	/**
	 * Mark the agent as failed
	 */
	async fail(error: string | Error): Promise<void> {
		const errorMessage = error instanceof Error ? error.message : error;

		await this.updateState(
			{
				status: "failed",
				error: errorMessage,
			},
			"fail",
			true,
		);
	}

	/**
	 * Reset the agent to idle state
	 */
	async reset(): Promise<void> {
		await this.updateState(
			{
				status: "idle",
				currentTask: undefined,
				progress: 0,
				error: undefined,
				data: {},
			},
			"reset",
			true,
		);
	}

	// ============================================================================
	// Progress & Data Updates
	// ============================================================================

	/**
	 * Update progress (0-100)
	 */
	async setProgress(progress: number): Promise<void> {
		const clampedProgress = Math.max(0, Math.min(100, progress));
		await this.updateState({ progress: clampedProgress }, `progress:${clampedProgress}`);
	}

	/**
	 * Update custom data
	 */
	async setData(key: string, value: unknown): Promise<void> {
		const newData = { ...this._state.data, [key]: value };
		await this.updateState({ data: newData }, `data:${key}`);
	}

	/**
	 * Get custom data value
	 */
	getData<T>(key: string, defaultValue?: T): T | undefined {
		return (this._state.data[key] as T) ?? defaultValue;
	}

	/**
	 * Merge multiple data updates
	 */
	async mergeData(updates: Record<string, unknown>): Promise<void> {
		const newData = { ...this._state.data, ...updates };
		await this.updateState({ data: newData }, `data:merge`);
	}

	// ============================================================================
	// Checkpoint Management
	// ============================================================================

	/**
	 * Create a checkpoint of current state
	 */
	async checkpoint(label?: string): Promise<CheckpointResult> {
		const isGitRepo = await CheckpointUtils.isGitRepo(this.cwd);
		if (!isGitRepo) {
			return { success: false, error: "Not a git repository" };
		}

		try {
			this.checkpointCount++;
			const id = label || `${this.id}-${this.checkpointCount}-${Date.now()}`;
			const turnIndex = this._state.history.length;

			const checkpoint = await CheckpointUtils.createCheckpoint(this.cwd, id, turnIndex, this.sessionId);

			return { success: true, checkpointId: checkpoint.id };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Restore to a previous checkpoint
	 */
	async restore(options: ResumeOptions = {}): Promise<RestoreResult> {
		const { checkpointId, tagName, latest = false, restoreFiles = true } = options;

		const isGitRepo = await CheckpointUtils.isGitRepo(this.cwd);
		if (!isGitRepo) {
			return { success: false, error: "Not a git repository" };
		}

		try {
			let checkpoint: CheckpointData | null = null;

			if (checkpointId) {
				checkpoint = await CheckpointUtils.loadCheckpointFromRef(this.cwd, checkpointId);
			} else if (tagName) {
				checkpoint = await CheckpointUtils.getCheckpointByTag(this.cwd, tagName);
			} else if (latest) {
				const checkpoints = await CheckpointUtils.loadAllCheckpoints(this.cwd, this.sessionId);
				if (checkpoints.length > 0) {
					checkpoint = checkpoints.sort((a, b) => b.timestamp - a.timestamp)[0];
				}
			}

			if (!checkpoint) {
				return { success: false, error: "Checkpoint not found" };
			}

			const previousState = { ...this._state };

			// Restore files if requested
			if (restoreFiles) {
				await CheckpointUtils.restoreCheckpoint(this.cwd, checkpoint);
			}

			// Reload state from disk (may have been restored)
			this._state = this.loadState();

			return { success: true, checkpoint, previousState };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Tag a checkpoint for easy reference
	 */
	async tagCheckpoint(checkpointId: string, tagName: string, description?: string): Promise<CheckpointTag> {
		return CheckpointUtils.tagCheckpoint(this.cwd, checkpointId, tagName, description);
	}

	/**
	 * List all checkpoints for this session
	 */
	async listCheckpoints(): Promise<CheckpointData[]> {
		const isGitRepo = await CheckpointUtils.isGitRepo(this.cwd);
		if (!isGitRepo) {
			return [];
		}

		return CheckpointUtils.loadAllCheckpoints(this.cwd, this.sessionId);
	}

	/**
	 * List all checkpoint tags
	 */
	async listTags(): Promise<CheckpointTag[]> {
		const isGitRepo = await CheckpointUtils.isGitRepo(this.cwd);
		if (!isGitRepo) {
			return [];
		}

		return CheckpointUtils.listTags(this.cwd);
	}

	/**
	 * Get diff between current state and a checkpoint
	 */
	async getDiff(checkpointId: string) {
		return CheckpointUtils.getCheckpointDiff(this.cwd, checkpointId);
	}

	// ============================================================================
	// Serialization
	// ============================================================================

	/**
	 * Export agent state for transfer
	 */
	toJSON(): {
		id: string;
		sessionId: string;
		state: AgentState;
		exportedAt: number;
	} {
		return {
			id: this.id,
			sessionId: this.sessionId,
			state: this._state,
			exportedAt: Date.now(),
		};
	}

	/**
	 * Import state from JSON
	 */
	async importState(data: { state: AgentState }, createCheckpoint = true): Promise<void> {
		if (createCheckpoint) {
			await this.checkpoint("before-import");
		}

		this._state = data.state;
		this.saveState();
	}
}

// ============================================================================
// Factory & Registry
// ============================================================================

const agentRegistry = new Map<string, StatefulAgent>();

/**
 * Get or create a stateful agent
 */
export function getStatefulAgent(config: StatefulAgentConfig): StatefulAgent {
	let agent = agentRegistry.get(config.id);
	if (!agent) {
		agent = new StatefulAgent(config);
		agentRegistry.set(config.id, agent);
	}
	return agent;
}

/**
 * List all registered agents
 */
export function listStatefulAgents(): StatefulAgent[] {
	return Array.from(agentRegistry.values());
}

/**
 * Remove agent from registry
 */
export function disposeStatefulAgent(id: string): boolean {
	return agentRegistry.delete(id);
}

/**
 * Clear all agents from registry
 */
export function disposeAllStatefulAgents(): void {
	agentRegistry.clear();
}

// ============================================================================
// Agent Tools for MCP/Discord Integration
// ============================================================================

export interface StatefulAgentTool {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
	};
}

export function createStatefulAgentTools(_agentId: string, _cwd?: string): StatefulAgentTool[] {
	return [
		{
			name: "agent_checkpoint",
			description: "Create a checkpoint of the current agent state for later rollback",
			inputSchema: {
				type: "object",
				properties: {
					label: {
						type: "string",
						description: "Optional label for the checkpoint",
					},
				},
			},
		},
		{
			name: "agent_restore",
			description: "Restore agent to a previous checkpoint",
			inputSchema: {
				type: "object",
				properties: {
					checkpoint_id: {
						type: "string",
						description: "Checkpoint ID to restore",
					},
					tag_name: {
						type: "string",
						description: "Tag name to restore (alternative to checkpoint_id)",
					},
					latest: {
						type: "boolean",
						description: "Restore to latest checkpoint",
					},
					restore_files: {
						type: "boolean",
						description: "Whether to restore files (default: true)",
					},
				},
			},
		},
		{
			name: "agent_status",
			description: "Get current agent status and state",
			inputSchema: {
				type: "object",
				properties: {},
			},
		},
		{
			name: "agent_pause",
			description: "Pause the agent execution",
			inputSchema: {
				type: "object",
				properties: {},
			},
		},
		{
			name: "agent_resume",
			description: "Resume paused or suspended agent",
			inputSchema: {
				type: "object",
				properties: {},
			},
		},
		{
			name: "agent_set_progress",
			description: "Update agent progress (0-100)",
			inputSchema: {
				type: "object",
				properties: {
					progress: {
						type: "number",
						description: "Progress value (0-100)",
					},
				},
				required: ["progress"],
			},
		},
		{
			name: "agent_list_checkpoints",
			description: "List all available checkpoints",
			inputSchema: {
				type: "object",
				properties: {},
			},
		},
		{
			name: "agent_tag_checkpoint",
			description: "Tag a checkpoint with a friendly name",
			inputSchema: {
				type: "object",
				properties: {
					checkpoint_id: {
						type: "string",
						description: "Checkpoint ID to tag",
					},
					tag_name: {
						type: "string",
						description: "Tag name",
					},
					description: {
						type: "string",
						description: "Optional description",
					},
				},
				required: ["checkpoint_id", "tag_name"],
			},
		},
	];
}
