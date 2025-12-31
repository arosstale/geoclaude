/**
 * Class 3.38: Checkpoint Manager
 *
 * Save/restore agent execution state for resumable workflows.
 * Enables agents to pause and resume execution with full state preservation.
 *
 * Features:
 * - State serialization with compression
 * - Incremental checkpoints
 * - TTL-based cleanup
 * - Restore by agent/task ID
 * - Checkpoint versioning
 *
 * @module checkpoint-manager
 */

import { EventEmitter } from "events";
import { gunzipSync, gzipSync } from "zlib";

// =============================================================================
// Types
// =============================================================================

export type CheckpointStatus = "active" | "restored" | "expired" | "deleted";

export interface CheckpointData {
	/** Arbitrary state data to checkpoint */
	state: Record<string, unknown>;
	/** Current step/phase in execution */
	step?: string;
	/** Progress indicator (0-100) */
	progress?: number;
	/** Context data for restoration */
	context?: Record<string, unknown>;
	/** Custom metadata */
	metadata?: Record<string, unknown>;
}

export interface Checkpoint {
	/** Unique checkpoint ID */
	id: string;
	/** Agent ID this checkpoint belongs to */
	agentId: string;
	/** Task ID this checkpoint is associated with */
	taskId: string;
	/** Checkpoint version (incremental) */
	version: number;
	/** Checkpoint status */
	status: CheckpointStatus;
	/** Serialized and optionally compressed state */
	data: CheckpointData;
	/** Size in bytes (compressed) */
	sizeBytes: number;
	/** Whether data is compressed */
	compressed: boolean;
	/** When checkpoint was created */
	createdAt: number;
	/** When checkpoint was last updated */
	updatedAt: number;
	/** When checkpoint expires (null = never) */
	expiresAt: number | null;
	/** Parent checkpoint ID for incremental checkpoints */
	parentId?: string;
	/** Diff from parent (for incremental checkpoints) */
	diff?: CheckpointDiff;
}

export interface CheckpointDiff {
	/** Keys that were added */
	added: string[];
	/** Keys that were modified */
	modified: string[];
	/** Keys that were removed */
	removed: string[];
	/** The actual changes (only changed values) */
	changes: Record<string, unknown>;
}

export interface CheckpointFilter {
	/** Filter by agent ID */
	agentId?: string;
	/** Filter by task ID */
	taskId?: string;
	/** Filter by status */
	status?: CheckpointStatus;
	/** Include expired checkpoints */
	includeExpired?: boolean;
	/** Only return latest version per task */
	latestOnly?: boolean;
	/** Limit results */
	limit?: number;
	/** Offset for pagination */
	offset?: number;
}

export interface RestoreOptions {
	/** Checkpoint ID to restore */
	checkpointId?: string;
	/** Restore by agent ID (gets latest) */
	agentId?: string;
	/** Restore by task ID (gets latest) */
	taskId?: string;
	/** Specific version to restore */
	version?: number;
	/** Apply incremental diffs from parent chain */
	resolveIncrementals?: boolean;
}

export interface CheckpointManagerConfig {
	/** Maximum checkpoints to keep in memory */
	maxCheckpointsInMemory: number;
	/** Default TTL in milliseconds (null = never expires) */
	defaultTTLMs: number | null;
	/** Compress checkpoints larger than this size (bytes) */
	compressionThreshold: number;
	/** Enable compression */
	enableCompression: boolean;
	/** Maximum checkpoint size in bytes */
	maxCheckpointSize: number;
	/** Auto-cleanup interval in milliseconds */
	cleanupIntervalMs: number;
	/** Maximum versions to keep per task */
	maxVersionsPerTask: number;
	/** Enable incremental checkpoints */
	enableIncrementals: boolean;
}

export interface CheckpointManagerEvents {
	"checkpoint:created": { checkpoint: Checkpoint };
	"checkpoint:updated": { checkpoint: Checkpoint; previousVersion: number };
	"checkpoint:restored": { checkpoint: Checkpoint };
	"checkpoint:expired": { checkpoint: Checkpoint };
	"checkpoint:deleted": { checkpointId: string };
	"cleanup:completed": { removed: number; remaining: number };
	error: { operation: string; error: Error };
}

export interface CheckpointStats {
	totalCheckpoints: number;
	activeCheckpoints: number;
	expiredCheckpoints: number;
	totalSizeBytes: number;
	compressedCount: number;
	byAgent: Record<string, number>;
	byTask: Record<string, number>;
	avgVersionsPerTask: number;
}

// =============================================================================
// Checkpoint Manager
// =============================================================================

export class CheckpointManager extends EventEmitter {
	private config: CheckpointManagerConfig;
	private checkpoints: Map<string, Checkpoint> = new Map();
	private taskVersions: Map<string, number> = new Map();
	private cleanupTimer?: ReturnType<typeof setInterval>;

	constructor(config: Partial<CheckpointManagerConfig> = {}) {
		super();
		this.config = {
			maxCheckpointsInMemory: 1000,
			defaultTTLMs: 24 * 60 * 60 * 1000, // 24 hours
			compressionThreshold: 10 * 1024, // 10KB
			enableCompression: true,
			maxCheckpointSize: 50 * 1024 * 1024, // 50MB
			cleanupIntervalMs: 5 * 60 * 1000, // 5 minutes
			maxVersionsPerTask: 10,
			enableIncrementals: true,
			...config,
		};

		this.startCleanupTimer();
	}

	// ---------------------------------------------------------------------------
	// Checkpoint Creation
	// ---------------------------------------------------------------------------

	/**
	 * Create a new checkpoint
	 */
	async create(
		agentId: string,
		taskId: string,
		data: CheckpointData,
		options: { ttlMs?: number | null; parentId?: string } = {},
	): Promise<Checkpoint> {
		const id = this.generateId();
		const version = this.getNextVersion(taskId);
		const now = Date.now();

		// Calculate TTL
		const ttl = options.ttlMs !== undefined ? options.ttlMs : this.config.defaultTTLMs;
		const expiresAt = ttl !== null ? now + ttl : null;

		// Prepare data for storage
		const storedData = data;
		let sizeBytes = 0;
		let compressed = false;

		// Serialize and optionally compress
		const serialized = JSON.stringify(data);
		sizeBytes = Buffer.byteLength(serialized, "utf-8");

		if (sizeBytes > this.config.maxCheckpointSize) {
			throw new Error(
				`Checkpoint size (${sizeBytes} bytes) exceeds maximum (${this.config.maxCheckpointSize} bytes)`,
			);
		}

		if (this.config.enableCompression && sizeBytes > this.config.compressionThreshold) {
			try {
				const compressedData = gzipSync(Buffer.from(serialized));
				sizeBytes = compressedData.length;
				compressed = true;
			} catch (error) {
				// Compression failed, use uncompressed
				this.emit("error", { operation: "compress", error: error as Error });
			}
		}

		// Calculate diff for incremental checkpoints
		let diff: CheckpointDiff | undefined;
		if (this.config.enableIncrementals && options.parentId) {
			const parent = this.checkpoints.get(options.parentId);
			if (parent) {
				diff = this.calculateDiff(parent.data.state, data.state);
			}
		}

		const checkpoint: Checkpoint = {
			id,
			agentId,
			taskId,
			version,
			status: "active",
			data: storedData,
			sizeBytes,
			compressed,
			createdAt: now,
			updatedAt: now,
			expiresAt,
			parentId: options.parentId,
			diff,
		};

		this.checkpoints.set(id, checkpoint);
		this.enforceMemoryLimits();
		this.pruneOldVersions(taskId);

		this.emit("checkpoint:created", { checkpoint });
		return checkpoint;
	}

	/**
	 * Create an incremental checkpoint from the latest
	 */
	async createIncremental(
		agentId: string,
		taskId: string,
		data: CheckpointData,
		options: { ttlMs?: number | null } = {},
	): Promise<Checkpoint> {
		const latest = this.getLatest(taskId);
		return this.create(agentId, taskId, data, {
			...options,
			parentId: latest?.id,
		});
	}

	/**
	 * Update an existing checkpoint
	 */
	async update(checkpointId: string, data: Partial<CheckpointData>): Promise<Checkpoint | null> {
		const checkpoint = this.checkpoints.get(checkpointId);
		if (!checkpoint) return null;

		const previousVersion = checkpoint.version;

		// Merge data
		checkpoint.data = {
			...checkpoint.data,
			...data,
			state: { ...checkpoint.data.state, ...data.state },
			context: { ...checkpoint.data.context, ...data.context },
			metadata: { ...checkpoint.data.metadata, ...data.metadata },
		};

		checkpoint.version = this.getNextVersion(checkpoint.taskId);
		checkpoint.updatedAt = Date.now();

		// Recalculate size
		const serialized = JSON.stringify(checkpoint.data);
		checkpoint.sizeBytes = Buffer.byteLength(serialized, "utf-8");

		this.emit("checkpoint:updated", { checkpoint, previousVersion });
		return checkpoint;
	}

	// ---------------------------------------------------------------------------
	// Checkpoint Restoration
	// ---------------------------------------------------------------------------

	/**
	 * Restore a checkpoint
	 */
	async restore(options: RestoreOptions): Promise<CheckpointData | null> {
		let checkpoint: Checkpoint | null = null;

		if (options.checkpointId) {
			checkpoint = this.checkpoints.get(options.checkpointId) || null;
		} else if (options.taskId) {
			if (options.version !== undefined) {
				checkpoint = this.getByVersion(options.taskId, options.version);
			} else {
				checkpoint = this.getLatest(options.taskId);
			}
		} else if (options.agentId) {
			checkpoint = this.getLatestByAgent(options.agentId);
		}

		if (!checkpoint) return null;

		// Check expiration
		if (checkpoint.expiresAt && checkpoint.expiresAt < Date.now()) {
			checkpoint.status = "expired";
			this.emit("checkpoint:expired", { checkpoint });
			return null;
		}

		// Resolve incremental chain if needed
		let data = checkpoint.data;
		if (options.resolveIncrementals !== false && checkpoint.parentId) {
			data = await this.resolveIncrementalChain(checkpoint);
		}

		// Decompress if needed
		if (checkpoint.compressed) {
			try {
				const serialized = JSON.stringify(data);
				const decompressed = gunzipSync(Buffer.from(serialized));
				data = JSON.parse(decompressed.toString());
			} catch (error) {
				this.emit("error", { operation: "decompress", error: error as Error });
				// Data might already be decompressed
			}
		}

		checkpoint.status = "restored";
		this.emit("checkpoint:restored", { checkpoint });

		return data;
	}

	/**
	 * Resolve the full state from an incremental checkpoint chain
	 */
	private async resolveIncrementalChain(checkpoint: Checkpoint): Promise<CheckpointData> {
		const chain: Checkpoint[] = [checkpoint];
		let current = checkpoint;

		// Build chain back to root
		while (current.parentId) {
			const parent = this.checkpoints.get(current.parentId);
			if (!parent) break;
			chain.unshift(parent);
			current = parent;
		}

		// Start with root state
		let state: Record<string, unknown> = {};
		let context: Record<string, unknown> = {};
		let metadata: Record<string, unknown> = {};
		let step: string | undefined;
		let progress: number | undefined;

		// Apply each checkpoint in order
		for (const cp of chain) {
			if (cp.diff) {
				// Apply diff
				for (const key of cp.diff.removed) {
					delete state[key];
				}
				Object.assign(state, cp.diff.changes);
			} else {
				// Full state
				state = { ...state, ...cp.data.state };
			}

			context = { ...context, ...cp.data.context };
			metadata = { ...metadata, ...cp.data.metadata };
			step = cp.data.step ?? step;
			progress = cp.data.progress ?? progress;
		}

		return { state, context, metadata, step, progress };
	}

	// ---------------------------------------------------------------------------
	// Query Methods
	// ---------------------------------------------------------------------------

	/**
	 * Get checkpoint by ID
	 */
	get(checkpointId: string): Checkpoint | null {
		return this.checkpoints.get(checkpointId) || null;
	}

	/**
	 * Get latest checkpoint for a task
	 */
	getLatest(taskId: string): Checkpoint | null {
		let latest: Checkpoint | null = null;
		let maxVersion = -1;

		for (const checkpoint of Array.from(this.checkpoints.values())) {
			if (checkpoint.taskId === taskId && checkpoint.status === "active" && checkpoint.version > maxVersion) {
				maxVersion = checkpoint.version;
				latest = checkpoint;
			}
		}

		return latest;
	}

	/**
	 * Get latest checkpoint for an agent
	 */
	getLatestByAgent(agentId: string): Checkpoint | null {
		let latest: Checkpoint | null = null;
		let maxTime = 0;

		for (const checkpoint of Array.from(this.checkpoints.values())) {
			if (checkpoint.agentId === agentId && checkpoint.status === "active" && checkpoint.createdAt > maxTime) {
				maxTime = checkpoint.createdAt;
				latest = checkpoint;
			}
		}

		return latest;
	}

	/**
	 * Get checkpoint by version
	 */
	getByVersion(taskId: string, version: number): Checkpoint | null {
		for (const checkpoint of Array.from(this.checkpoints.values())) {
			if (checkpoint.taskId === taskId && checkpoint.version === version) {
				return checkpoint;
			}
		}
		return null;
	}

	/**
	 * List checkpoints with filtering
	 */
	list(filter: CheckpointFilter = {}): Checkpoint[] {
		let results: Checkpoint[] = [];

		for (const checkpoint of Array.from(this.checkpoints.values())) {
			// Apply filters
			if (filter.agentId && checkpoint.agentId !== filter.agentId) continue;
			if (filter.taskId && checkpoint.taskId !== filter.taskId) continue;
			if (filter.status && checkpoint.status !== filter.status) continue;

			// Check expiration
			if (!filter.includeExpired && checkpoint.expiresAt && checkpoint.expiresAt < Date.now()) {
				continue;
			}

			results.push(checkpoint);
		}

		// Sort by version descending
		results.sort((a, b) => b.version - a.version);

		// Latest only filter
		if (filter.latestOnly) {
			const seen = new Set<string>();
			results = results.filter((cp) => {
				if (seen.has(cp.taskId)) return false;
				seen.add(cp.taskId);
				return true;
			});
		}

		// Pagination
		if (filter.offset) {
			results = results.slice(filter.offset);
		}
		if (filter.limit) {
			results = results.slice(0, filter.limit);
		}

		return results;
	}

	/**
	 * Get all checkpoints for a task
	 */
	getTaskHistory(taskId: string): Checkpoint[] {
		return this.list({ taskId, includeExpired: true });
	}

	/**
	 * Get all checkpoints for an agent
	 */
	getAgentCheckpoints(agentId: string): Checkpoint[] {
		return this.list({ agentId, latestOnly: true });
	}

	// ---------------------------------------------------------------------------
	// Deletion
	// ---------------------------------------------------------------------------

	/**
	 * Delete a specific checkpoint
	 */
	delete(checkpointId: string): boolean {
		const checkpoint = this.checkpoints.get(checkpointId);
		if (!checkpoint) return false;

		checkpoint.status = "deleted";
		this.checkpoints.delete(checkpointId);
		this.emit("checkpoint:deleted", { checkpointId });

		return true;
	}

	/**
	 * Delete all checkpoints for a task
	 */
	deleteByTask(taskId: string): number {
		let count = 0;
		for (const [id, checkpoint] of Array.from(this.checkpoints.entries())) {
			if (checkpoint.taskId === taskId) {
				this.checkpoints.delete(id);
				count++;
			}
		}
		return count;
	}

	/**
	 * Delete all checkpoints for an agent
	 */
	deleteByAgent(agentId: string): number {
		let count = 0;
		for (const [id, checkpoint] of Array.from(this.checkpoints.entries())) {
			if (checkpoint.agentId === agentId) {
				this.checkpoints.delete(id);
				count++;
			}
		}
		return count;
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	/**
	 * Clean up expired checkpoints
	 */
	cleanup(): { removed: number; remaining: number } {
		const now = Date.now();
		let removed = 0;

		for (const [id, checkpoint] of Array.from(this.checkpoints.entries())) {
			if (checkpoint.expiresAt && checkpoint.expiresAt < now) {
				checkpoint.status = "expired";
				this.checkpoints.delete(id);
				this.emit("checkpoint:expired", { checkpoint });
				removed++;
			}
		}

		const remaining = this.checkpoints.size;
		this.emit("cleanup:completed", { removed, remaining });

		return { removed, remaining };
	}

	private startCleanupTimer(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
		}

		this.cleanupTimer = setInterval(() => {
			this.cleanup();
		}, this.config.cleanupIntervalMs);
	}

	private enforceMemoryLimits(): void {
		if (this.checkpoints.size <= this.config.maxCheckpointsInMemory) return;

		// Remove oldest expired first
		const expired = Array.from(this.checkpoints.entries())
			.filter(([_, cp]) => cp.expiresAt && cp.expiresAt < Date.now())
			.sort((a, b) => a[1].createdAt - b[1].createdAt);

		for (const [id] of expired) {
			if (this.checkpoints.size <= this.config.maxCheckpointsInMemory) break;
			this.checkpoints.delete(id);
		}

		// If still over limit, remove oldest non-latest versions
		if (this.checkpoints.size > this.config.maxCheckpointsInMemory) {
			const latestByTask = new Map<string, string>();
			for (const [id, cp] of Array.from(this.checkpoints.entries())) {
				const existing = latestByTask.get(cp.taskId);
				if (!existing) {
					latestByTask.set(cp.taskId, id);
				} else {
					const existingCp = this.checkpoints.get(existing)!;
					if (cp.version > existingCp.version) {
						latestByTask.set(cp.taskId, id);
					}
				}
			}

			const sorted = Array.from(this.checkpoints.entries())
				.filter(([id]) => !Array.from(latestByTask.values()).includes(id))
				.sort((a, b) => a[1].createdAt - b[1].createdAt);

			for (const [id] of sorted) {
				if (this.checkpoints.size <= this.config.maxCheckpointsInMemory) break;
				this.checkpoints.delete(id);
			}
		}
	}

	private pruneOldVersions(taskId: string): void {
		const taskCheckpoints = Array.from(this.checkpoints.entries())
			.filter(([_, cp]) => cp.taskId === taskId)
			.sort((a, b) => b[1].version - a[1].version);

		if (taskCheckpoints.length <= this.config.maxVersionsPerTask) return;

		const toRemove = taskCheckpoints.slice(this.config.maxVersionsPerTask);
		for (const [id] of toRemove) {
			this.checkpoints.delete(id);
		}
	}

	// ---------------------------------------------------------------------------
	// Statistics
	// ---------------------------------------------------------------------------

	/**
	 * Get checkpoint statistics
	 */
	getStats(): CheckpointStats {
		const byAgent: Record<string, number> = {};
		const byTask: Record<string, number> = {};
		let activeCheckpoints = 0;
		let expiredCheckpoints = 0;
		let totalSizeBytes = 0;
		let compressedCount = 0;
		const now = Date.now();

		for (const checkpoint of Array.from(this.checkpoints.values())) {
			byAgent[checkpoint.agentId] = (byAgent[checkpoint.agentId] || 0) + 1;
			byTask[checkpoint.taskId] = (byTask[checkpoint.taskId] || 0) + 1;
			totalSizeBytes += checkpoint.sizeBytes;

			if (checkpoint.compressed) compressedCount++;

			if (checkpoint.expiresAt && checkpoint.expiresAt < now) {
				expiredCheckpoints++;
			} else if (checkpoint.status === "active") {
				activeCheckpoints++;
			}
		}

		const taskCount = Object.keys(byTask).length;
		const avgVersionsPerTask = taskCount > 0 ? this.checkpoints.size / taskCount : 0;

		return {
			totalCheckpoints: this.checkpoints.size,
			activeCheckpoints,
			expiredCheckpoints,
			totalSizeBytes,
			compressedCount,
			byAgent,
			byTask,
			avgVersionsPerTask,
		};
	}

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	private generateId(): string {
		return `ckpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
	}

	private getNextVersion(taskId: string): number {
		const current = this.taskVersions.get(taskId) || 0;
		const next = current + 1;
		this.taskVersions.set(taskId, next);
		return next;
	}

	private calculateDiff(oldState: Record<string, unknown>, newState: Record<string, unknown>): CheckpointDiff {
		const added: string[] = [];
		const modified: string[] = [];
		const removed: string[] = [];
		const changes: Record<string, unknown> = {};

		// Check for added and modified
		for (const key of Object.keys(newState)) {
			if (!(key in oldState)) {
				added.push(key);
				changes[key] = newState[key];
			} else if (JSON.stringify(oldState[key]) !== JSON.stringify(newState[key])) {
				modified.push(key);
				changes[key] = newState[key];
			}
		}

		// Check for removed
		for (const key of Object.keys(oldState)) {
			if (!(key in newState)) {
				removed.push(key);
			}
		}

		return { added, modified, removed, changes };
	}

	// ---------------------------------------------------------------------------
	// Serialization for Persistence
	// ---------------------------------------------------------------------------

	/**
	 * Export all checkpoints for persistence
	 */
	export(): string {
		const data = {
			checkpoints: Array.from(this.checkpoints.entries()),
			taskVersions: Array.from(this.taskVersions.entries()),
		};
		return JSON.stringify(data);
	}

	/**
	 * Import checkpoints from persistence
	 */
	import(data: string): void {
		try {
			const parsed = JSON.parse(data);
			this.checkpoints = new Map(parsed.checkpoints);
			this.taskVersions = new Map(parsed.taskVersions);
		} catch (error) {
			this.emit("error", { operation: "import", error: error as Error });
		}
	}

	// ---------------------------------------------------------------------------
	// Lifecycle
	// ---------------------------------------------------------------------------

	/**
	 * Clear all checkpoints
	 */
	clear(): void {
		this.checkpoints.clear();
		this.taskVersions.clear();
	}

	/**
	 * Destroy the manager and clean up resources
	 */
	destroy(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = undefined;
		}
		this.clear();
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: CheckpointManager | null = null;

export function getCheckpointManager(config?: Partial<CheckpointManagerConfig>): CheckpointManager {
	if (!instance) {
		instance = new CheckpointManager(config);
	}
	return instance;
}

export function resetCheckpointManager(): void {
	if (instance) {
		instance.destroy();
	}
	instance = null;
}
