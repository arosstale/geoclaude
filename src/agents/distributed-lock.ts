/**
 * Class 3.60: Distributed Lock System
 * TAC Pattern: Distributed locking with persistence, deadlock detection, and fair queuing
 *
 * Features:
 * - Lock acquisition with timeout
 * - Lock release and renewal/extension
 * - Automatic lock expiration (TTL)
 * - Reentrant locks (same owner can acquire multiple times)
 * - Read-write locks (shared read, exclusive write)
 * - Lock queuing (fair ordering)
 * - Deadlock detection
 * - Lock ownership tracking
 * - Fencing tokens for safety
 * - Lock groups/namespaces
 * - Try-lock (non-blocking)
 * - Lock-with-callback pattern
 * - Metrics (wait time, hold time, contention)
 * - Lock hierarchy/ordering
 * - Automatic cleanup of stale locks
 * - SQLite persistence for lock state
 */

import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export type LockType = "exclusive" | "shared";
export type LockStatus = "acquired" | "waiting" | "released" | "expired" | "failed";

export interface LockOptions {
	timeoutMs?: number; // Max time to wait for lock acquisition
	ttlMs?: number; // Time-to-live before automatic expiration
	reentrant?: boolean; // Allow same owner to acquire multiple times
	priority?: number; // Queue priority (higher = first)
	namespace?: string; // Lock group/namespace
	metadata?: Record<string, unknown>;
}

export interface Lock {
	id: string;
	resourceId: string;
	ownerId: string;
	ownerName?: string;
	type: LockType;
	status: LockStatus;
	fencingToken: number;
	reentrantCount: number;
	namespace: string;
	acquiredAt: Date;
	expiresAt: Date;
	metadata?: Record<string, unknown>;
}

export interface LockWaiter {
	id: string;
	resourceId: string;
	ownerId: string;
	ownerName?: string;
	type: LockType;
	priority: number;
	queuedAt: Date;
	timeoutAt: Date;
	callback?: () => void;
	metadata?: Record<string, unknown>;
}

export interface LockResult {
	success: boolean;
	lock?: Lock;
	fencingToken?: number;
	waitTime?: number;
	error?: string;
	queuePosition?: number;
}

export interface LockMetrics {
	resourceId: string;
	namespace: string;
	totalAcquisitions: number;
	totalContention: number;
	avgWaitTimeMs: number;
	avgHoldTimeMs: number;
	maxWaitTimeMs: number;
	maxHoldTimeMs: number;
	currentWaiters: number;
	lastAcquiredAt?: Date;
}

export interface DeadlockInfo {
	detected: boolean;
	cycle: string[];
	involvedOwners: string[];
	involvedResources: string[];
	detectedAt: Date;
}

export interface LockHierarchy {
	id: string;
	name: string;
	level: number;
	parentId?: string;
	description?: string;
}

export interface LockStats {
	totalLocks: number;
	activeLocks: number;
	waitingRequests: number;
	totalAcquisitions: number;
	totalReleases: number;
	totalTimeouts: number;
	totalDeadlocks: number;
	avgWaitTimeMs: number;
	avgHoldTimeMs: number;
	locksByNamespace: Record<string, number>;
}

export interface DistributedLockConfig {
	dataDir: string;
	defaultTtlMs: number;
	defaultTimeoutMs: number;
	cleanupIntervalMs: number;
	deadlockCheckIntervalMs: number;
	enableDeadlockDetection: boolean;
	enableMetrics: boolean;
	maxWaitersPerResource: number;
}

// ============================================================================
// Distributed Lock System
// ============================================================================

export class DistributedLockSystem extends EventEmitter {
	private db: Database.Database;
	private config: DistributedLockConfig;
	private locks: Map<string, Lock> = new Map();
	private waiters: Map<string, LockWaiter[]> = new Map();
	private fencingTokens: Map<string, number> = new Map();
	private ownerHeldLocks: Map<string, Set<string>> = new Map();
	private hierarchies: Map<string, LockHierarchy> = new Map();
	private cleanupInterval: NodeJS.Timeout | null = null;
	private deadlockCheckInterval: NodeJS.Timeout | null = null;
	private stats = {
		totalAcquisitions: 0,
		totalReleases: 0,
		totalTimeouts: 0,
		totalDeadlocks: 0,
		totalWaitTime: 0,
		totalHoldTime: 0,
		waitCount: 0,
		releaseCount: 0,
	};

	constructor(config: DistributedLockConfig) {
		super();
		this.config = config;
		this.db = new Database(join(config.dataDir, "distributed_lock.db"));
		this.initializeDatabase();
		this.loadPersistedLocks();
		this.startCleanupScheduler();
		if (config.enableDeadlockDetection) {
			this.startDeadlockDetection();
		}
	}

	private initializeDatabase(): void {
		this.db.pragma("journal_mode = WAL");

		// Active locks table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS locks (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        owner_name TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        fencing_token INTEGER NOT NULL,
        reentrant_count INTEGER NOT NULL DEFAULT 1,
        namespace TEXT NOT NULL DEFAULT 'default',
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        metadata TEXT,
        UNIQUE(resource_id, owner_id)
      )
    `);

		// Lock waiters table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS lock_waiters (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        owner_name TEXT,
        type TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        queued_at TEXT NOT NULL,
        timeout_at TEXT NOT NULL,
        metadata TEXT
      )
    `);

		// Fencing tokens table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS fencing_tokens (
        resource_id TEXT PRIMARY KEY,
        token INTEGER NOT NULL DEFAULT 0
      )
    `);

		// Lock metrics table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS lock_metrics (
        resource_id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        total_acquisitions INTEGER NOT NULL DEFAULT 0,
        total_contention INTEGER NOT NULL DEFAULT 0,
        total_wait_time_ms INTEGER NOT NULL DEFAULT 0,
        total_hold_time_ms INTEGER NOT NULL DEFAULT 0,
        max_wait_time_ms INTEGER NOT NULL DEFAULT 0,
        max_hold_time_ms INTEGER NOT NULL DEFAULT 0,
        last_acquired_at TEXT
      )
    `);

		// Lock history table (for audit)
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS lock_history (
        id TEXT PRIMARY KEY,
        lock_id TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        action TEXT NOT NULL,
        fencing_token INTEGER,
        wait_time_ms INTEGER,
        hold_time_ms INTEGER,
        timestamp TEXT NOT NULL
      )
    `);

		// Lock hierarchies table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS lock_hierarchies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        level INTEGER NOT NULL,
        parent_id TEXT,
        description TEXT
      )
    `);

		// Indexes
		this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_locks_resource ON locks(resource_id);
      CREATE INDEX IF NOT EXISTS idx_locks_owner ON locks(owner_id);
      CREATE INDEX IF NOT EXISTS idx_locks_namespace ON locks(namespace);
      CREATE INDEX IF NOT EXISTS idx_locks_expires ON locks(expires_at);
      CREATE INDEX IF NOT EXISTS idx_waiters_resource ON lock_waiters(resource_id);
      CREATE INDEX IF NOT EXISTS idx_waiters_timeout ON lock_waiters(timeout_at);
      CREATE INDEX IF NOT EXISTS idx_history_resource ON lock_history(resource_id);
      CREATE INDEX IF NOT EXISTS idx_history_timestamp ON lock_history(timestamp);
    `);
	}

	private loadPersistedLocks(): void {
		const now = new Date();

		// Load active locks
		const lockStmt = this.db.prepare(`
      SELECT * FROM locks WHERE status = 'acquired' AND expires_at > ?
    `);
		const lockRows = lockStmt.all(now.toISOString()) as Record<string, unknown>[];

		for (const row of lockRows) {
			const lock = this.rowToLock(row);
			this.locks.set(lock.id, lock);
			this.trackOwnerLock(lock.ownerId, lock.id);
		}

		// Load fencing tokens
		const tokenStmt = this.db.prepare("SELECT * FROM fencing_tokens");
		const tokenRows = tokenStmt.all() as { resource_id: string; token: number }[];

		for (const row of tokenRows) {
			this.fencingTokens.set(row.resource_id, row.token);
		}

		// Load hierarchies
		const hierarchyStmt = this.db.prepare("SELECT * FROM lock_hierarchies");
		const hierarchyRows = hierarchyStmt.all() as Record<string, unknown>[];

		for (const row of hierarchyRows) {
			const hierarchy: LockHierarchy = {
				id: row.id as string,
				name: row.name as string,
				level: row.level as number,
				parentId: row.parent_id as string | undefined,
				description: row.description as string | undefined,
			};
			this.hierarchies.set(hierarchy.id, hierarchy);
		}

		// Clean up expired locks
		this.cleanupExpiredLocks();
	}

	private rowToLock(row: Record<string, unknown>): Lock {
		return {
			id: row.id as string,
			resourceId: row.resource_id as string,
			ownerId: row.owner_id as string,
			ownerName: row.owner_name as string | undefined,
			type: row.type as LockType,
			status: row.status as LockStatus,
			fencingToken: row.fencing_token as number,
			reentrantCount: row.reentrant_count as number,
			namespace: row.namespace as string,
			acquiredAt: new Date(row.acquired_at as string),
			expiresAt: new Date(row.expires_at as string),
			metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
		};
	}

	private startCleanupScheduler(): void {
		this.cleanupInterval = setInterval(() => {
			this.cleanupExpiredLocks();
			this.processWaitQueue();
		}, this.config.cleanupIntervalMs);
	}

	private startDeadlockDetection(): void {
		this.deadlockCheckInterval = setInterval(() => {
			this.detectDeadlocks();
		}, this.config.deadlockCheckIntervalMs);
	}

	// ============================================================================
	// Lock Acquisition
	// ============================================================================

	async acquire(resourceId: string, ownerId: string, options: LockOptions = {}): Promise<LockResult> {
		const {
			timeoutMs = this.config.defaultTimeoutMs,
			ttlMs = this.config.defaultTtlMs,
			reentrant = false,
			priority = 0,
			namespace = "default",
			metadata,
		} = options;

		const startTime = Date.now();

		// Check hierarchy ordering
		if (!this.checkHierarchyOrdering(resourceId, ownerId)) {
			return {
				success: false,
				error: "Lock hierarchy violation: would cause out-of-order lock acquisition",
			};
		}

		// Check for existing lock on this resource
		const existingLock = this.findLockByResource(resourceId);

		if (existingLock) {
			// Reentrant case: same owner, same lock
			if (existingLock.ownerId === ownerId && reentrant) {
				return this.reacquireLock(existingLock, ttlMs);
			}

			// Already locked by someone else
			if (timeoutMs === 0) {
				// Try-lock: fail immediately
				return {
					success: false,
					error: "Resource is locked",
					queuePosition: this.getQueuePosition(resourceId),
				};
			}

			// Wait for lock
			return this.waitForLock(
				resourceId,
				ownerId,
				{
					timeoutMs,
					ttlMs,
					priority,
					namespace,
					metadata,
					type: "exclusive",
					ownerName: options.metadata?.ownerName as string,
				},
				startTime,
			);
		}

		// No existing lock, acquire immediately
		return this.createLock(resourceId, ownerId, {
			ttlMs,
			namespace,
			metadata,
			type: "exclusive",
			ownerName: options.metadata?.ownerName as string,
		});
	}

	async acquireRead(resourceId: string, ownerId: string, options: LockOptions = {}): Promise<LockResult> {
		const {
			timeoutMs = this.config.defaultTimeoutMs,
			ttlMs = this.config.defaultTtlMs,
			priority = 0,
			namespace = "default",
			metadata,
		} = options;

		const startTime = Date.now();
		const existingLock = this.findLockByResource(resourceId);

		if (existingLock) {
			// Allow shared read if existing lock is also shared
			if (existingLock.type === "shared") {
				return this.createLock(resourceId, ownerId, {
					ttlMs,
					namespace,
					metadata,
					type: "shared",
					ownerName: options.metadata?.ownerName as string,
				});
			}

			// Exclusive lock exists, must wait
			if (timeoutMs === 0) {
				return {
					success: false,
					error: "Resource has exclusive lock",
					queuePosition: this.getQueuePosition(resourceId),
				};
			}

			return this.waitForLock(
				resourceId,
				ownerId,
				{
					timeoutMs,
					ttlMs,
					priority,
					namespace,
					metadata,
					type: "shared",
					ownerName: options.metadata?.ownerName as string,
				},
				startTime,
			);
		}

		return this.createLock(resourceId, ownerId, {
			ttlMs,
			namespace,
			metadata,
			type: "shared",
			ownerName: options.metadata?.ownerName as string,
		});
	}

	tryAcquire(resourceId: string, ownerId: string, options: LockOptions = {}): LockResult {
		// Non-blocking lock attempt
		const existingLock = this.findLockByResource(resourceId);

		if (existingLock) {
			// Check reentrant
			if (existingLock.ownerId === ownerId && options.reentrant) {
				return this.reacquireLockSync(existingLock, options.ttlMs ?? this.config.defaultTtlMs);
			}

			return {
				success: false,
				error: "Resource is locked",
				queuePosition: this.getQueuePosition(resourceId),
			};
		}

		return this.createLockSync(resourceId, ownerId, {
			ttlMs: options.ttlMs ?? this.config.defaultTtlMs,
			namespace: options.namespace ?? "default",
			metadata: options.metadata,
			type: "exclusive",
			ownerName: options.metadata?.ownerName as string,
		});
	}

	private async waitForLock(
		resourceId: string,
		ownerId: string,
		options: {
			timeoutMs: number;
			ttlMs: number;
			priority: number;
			namespace: string;
			metadata?: Record<string, unknown>;
			type: LockType;
			ownerName?: string;
		},
		startTime: number,
	): Promise<LockResult> {
		const waiterId = randomUUID();
		const timeoutAt = new Date(Date.now() + options.timeoutMs);

		const waiter: LockWaiter = {
			id: waiterId,
			resourceId,
			ownerId,
			ownerName: options.ownerName,
			type: options.type,
			priority: options.priority,
			queuedAt: new Date(),
			timeoutAt,
			metadata: options.metadata,
		};

		// Check max waiters
		const currentWaiters = this.waiters.get(resourceId) ?? [];
		if (currentWaiters.length >= this.config.maxWaitersPerResource) {
			return {
				success: false,
				error: "Maximum waiters exceeded for resource",
			};
		}

		// Add to wait queue
		this.addWaiter(waiter);
		this.emit("lock:waiting", waiter);

		// Wait for lock or timeout
		return new Promise<LockResult>((resolve) => {
			const checkInterval = setInterval(() => {
				const now = Date.now();

				// Check timeout
				if (now >= timeoutAt.getTime()) {
					clearInterval(checkInterval);
					this.removeWaiter(waiterId, resourceId);
					this.stats.totalTimeouts++;
					this.emit("lock:timeout", waiter);
					resolve({
						success: false,
						error: "Lock acquisition timed out",
						waitTime: now - startTime,
					});
					return;
				}

				// Check if lock is available
				const existingLock = this.findLockByResource(resourceId);
				if (!existingLock || (options.type === "shared" && existingLock.type === "shared")) {
					// Check if we're next in queue
					if (this.isNextInQueue(waiterId, resourceId)) {
						clearInterval(checkInterval);
						this.removeWaiter(waiterId, resourceId);

						const result = this.createLockSync(resourceId, ownerId, options);
						result.waitTime = now - startTime;

						if (result.success) {
							this.recordWaitTime(resourceId, result.waitTime);
						}

						resolve(result);
					}
				}
			}, 50);

			// Store callback for immediate notification
			waiter.callback = () => {
				clearInterval(checkInterval);
				this.removeWaiter(waiterId, resourceId);
				const result = this.createLockSync(resourceId, ownerId, options);
				result.waitTime = Date.now() - startTime;
				resolve(result);
			};
		});
	}

	private createLock(
		resourceId: string,
		ownerId: string,
		options: {
			ttlMs: number;
			namespace: string;
			metadata?: Record<string, unknown>;
			type: LockType;
			ownerName?: string;
		},
	): LockResult {
		return this.createLockSync(resourceId, ownerId, options);
	}

	private createLockSync(
		resourceId: string,
		ownerId: string,
		options: {
			ttlMs: number;
			namespace: string;
			metadata?: Record<string, unknown>;
			type: LockType;
			ownerName?: string;
		},
	): LockResult {
		const now = new Date();
		const fencingToken = this.getNextFencingToken(resourceId);

		const lock: Lock = {
			id: randomUUID(),
			resourceId,
			ownerId,
			ownerName: options.ownerName,
			type: options.type,
			status: "acquired",
			fencingToken,
			reentrantCount: 1,
			namespace: options.namespace,
			acquiredAt: now,
			expiresAt: new Date(now.getTime() + options.ttlMs),
			metadata: options.metadata,
		};

		// Persist lock
		const stmt = this.db.prepare(`
      INSERT INTO locks
      (id, resource_id, owner_id, owner_name, type, status, fencing_token,
       reentrant_count, namespace, acquired_at, expires_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			lock.id,
			lock.resourceId,
			lock.ownerId,
			lock.ownerName ?? null,
			lock.type,
			lock.status,
			lock.fencingToken,
			lock.reentrantCount,
			lock.namespace,
			lock.acquiredAt.toISOString(),
			lock.expiresAt.toISOString(),
			lock.metadata ? JSON.stringify(lock.metadata) : null,
		);

		// Update in-memory state
		this.locks.set(lock.id, lock);
		this.trackOwnerLock(ownerId, lock.id);

		// Update metrics
		this.stats.totalAcquisitions++;
		this.updateMetrics(resourceId, options.namespace, "acquire");

		// Record history
		this.recordHistory(lock.id, resourceId, ownerId, "acquired", fencingToken);

		this.emit("lock:acquired", lock);

		return {
			success: true,
			lock,
			fencingToken,
		};
	}

	private reacquireLock(lock: Lock, ttlMs: number): LockResult {
		return this.reacquireLockSync(lock, ttlMs);
	}

	private reacquireLockSync(lock: Lock, ttlMs: number): LockResult {
		lock.reentrantCount++;
		lock.expiresAt = new Date(Date.now() + ttlMs);

		// Update in database
		const stmt = this.db.prepare(`
      UPDATE locks SET reentrant_count = ?, expires_at = ? WHERE id = ?
    `);
		stmt.run(lock.reentrantCount, lock.expiresAt.toISOString(), lock.id);

		this.emit("lock:reacquired", lock);

		return {
			success: true,
			lock,
			fencingToken: lock.fencingToken,
		};
	}

	// ============================================================================
	// Lock Release
	// ============================================================================

	release(lockId: string, ownerId: string): boolean {
		const lock = this.locks.get(lockId);

		if (!lock) {
			return false;
		}

		if (lock.ownerId !== ownerId) {
			this.emit("lock:release_denied", { lockId, ownerId, actualOwner: lock.ownerId });
			return false;
		}

		// Handle reentrant locks
		if (lock.reentrantCount > 1) {
			lock.reentrantCount--;
			const stmt = this.db.prepare("UPDATE locks SET reentrant_count = ? WHERE id = ?");
			stmt.run(lock.reentrantCount, lockId);
			this.emit("lock:reentrant_release", lock);
			return true;
		}

		// Full release
		return this.releaseLockFully(lock);
	}

	releaseByResource(resourceId: string, ownerId: string): boolean {
		const lock = this.findLockByResourceAndOwner(resourceId, ownerId);
		if (!lock) return false;
		return this.release(lock.id, ownerId);
	}

	releaseAll(ownerId: string): number {
		const ownerLocks = this.ownerHeldLocks.get(ownerId);
		if (!ownerLocks) return 0;

		let released = 0;
		for (const lockId of ownerLocks) {
			if (this.release(lockId, ownerId)) {
				released++;
			}
		}

		return released;
	}

	private releaseLockFully(lock: Lock): boolean {
		const holdTime = Date.now() - lock.acquiredAt.getTime();

		// Update status
		lock.status = "released";

		// Remove from database
		const stmt = this.db.prepare("DELETE FROM locks WHERE id = ?");
		stmt.run(lock.id);

		// Remove from in-memory state
		this.locks.delete(lock.id);
		this.untrackOwnerLock(lock.ownerId, lock.id);

		// Update metrics
		this.stats.totalReleases++;
		this.stats.totalHoldTime += holdTime;
		this.stats.releaseCount++;
		this.updateMetrics(lock.resourceId, lock.namespace, "release", holdTime);

		// Record history
		this.recordHistory(lock.id, lock.resourceId, lock.ownerId, "released", lock.fencingToken, undefined, holdTime);

		this.emit("lock:released", lock);

		// Process wait queue
		this.notifyWaiters(lock.resourceId);

		return true;
	}

	// ============================================================================
	// Lock Extension
	// ============================================================================

	extend(lockId: string, ownerId: string, additionalTtlMs: number): LockResult {
		const lock = this.locks.get(lockId);

		if (!lock) {
			return { success: false, error: "Lock not found" };
		}

		if (lock.ownerId !== ownerId) {
			return { success: false, error: "Not lock owner" };
		}

		if (lock.status !== "acquired") {
			return { success: false, error: "Lock not in acquired state" };
		}

		// Extend expiration
		lock.expiresAt = new Date(Math.max(lock.expiresAt.getTime(), Date.now()) + additionalTtlMs);

		// Update database
		const stmt = this.db.prepare("UPDATE locks SET expires_at = ? WHERE id = ?");
		stmt.run(lock.expiresAt.toISOString(), lockId);

		this.emit("lock:extended", lock);

		return {
			success: true,
			lock,
			fencingToken: lock.fencingToken,
		};
	}

	// ============================================================================
	// Lock-With-Callback Pattern
	// ============================================================================

	async withLock<T>(
		resourceId: string,
		ownerId: string,
		callback: (lock: Lock) => Promise<T>,
		options: LockOptions = {},
	): Promise<{ success: boolean; result?: T; error?: string }> {
		const lockResult = await this.acquire(resourceId, ownerId, options);

		if (!lockResult.success || !lockResult.lock) {
			return { success: false, error: lockResult.error };
		}

		try {
			const result = await callback(lockResult.lock);
			return { success: true, result };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		} finally {
			this.release(lockResult.lock.id, ownerId);
		}
	}

	async withReadLock<T>(
		resourceId: string,
		ownerId: string,
		callback: (lock: Lock) => Promise<T>,
		options: LockOptions = {},
	): Promise<{ success: boolean; result?: T; error?: string }> {
		const lockResult = await this.acquireRead(resourceId, ownerId, options);

		if (!lockResult.success || !lockResult.lock) {
			return { success: false, error: lockResult.error };
		}

		try {
			const result = await callback(lockResult.lock);
			return { success: true, result };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		} finally {
			this.release(lockResult.lock.id, ownerId);
		}
	}

	// ============================================================================
	// Waiter Management
	// ============================================================================

	private addWaiter(waiter: LockWaiter): void {
		let waiters = this.waiters.get(waiter.resourceId);
		if (!waiters) {
			waiters = [];
			this.waiters.set(waiter.resourceId, waiters);
		}

		// Insert in priority order (higher priority first, then by queue time)
		const insertIndex = waiters.findIndex(
			(w) => w.priority < waiter.priority || (w.priority === waiter.priority && w.queuedAt > waiter.queuedAt),
		);

		if (insertIndex === -1) {
			waiters.push(waiter);
		} else {
			waiters.splice(insertIndex, 0, waiter);
		}

		// Persist waiter
		const stmt = this.db.prepare(`
      INSERT INTO lock_waiters
      (id, resource_id, owner_id, owner_name, type, priority, queued_at, timeout_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			waiter.id,
			waiter.resourceId,
			waiter.ownerId,
			waiter.ownerName ?? null,
			waiter.type,
			waiter.priority,
			waiter.queuedAt.toISOString(),
			waiter.timeoutAt.toISOString(),
			waiter.metadata ? JSON.stringify(waiter.metadata) : null,
		);

		// Update contention metric
		this.updateMetrics(waiter.resourceId, "default", "contention");
	}

	private removeWaiter(waiterId: string, resourceId: string): void {
		const waiters = this.waiters.get(resourceId);
		if (waiters) {
			const index = waiters.findIndex((w) => w.id === waiterId);
			if (index !== -1) {
				waiters.splice(index, 1);
			}
		}

		const stmt = this.db.prepare("DELETE FROM lock_waiters WHERE id = ?");
		stmt.run(waiterId);
	}

	private isNextInQueue(waiterId: string, resourceId: string): boolean {
		const waiters = this.waiters.get(resourceId);
		if (!waiters || waiters.length === 0) return true;
		return waiters[0].id === waiterId;
	}

	private getQueuePosition(resourceId: string): number {
		const waiters = this.waiters.get(resourceId);
		return waiters ? waiters.length : 0;
	}

	private notifyWaiters(resourceId: string): void {
		const waiters = this.waiters.get(resourceId);
		if (!waiters || waiters.length === 0) return;

		// Notify first waiter
		const firstWaiter = waiters[0];
		if (firstWaiter.callback) {
			firstWaiter.callback();
		}
	}

	private processWaitQueue(): void {
		const now = Date.now();

		for (const [resourceId, waiters] of this.waiters) {
			// Remove timed out waiters
			const toRemove: number[] = [];
			for (let i = 0; i < waiters.length; i++) {
				if (now >= waiters[i].timeoutAt.getTime()) {
					toRemove.push(i);
				}
			}

			for (let i = toRemove.length - 1; i >= 0; i--) {
				const waiter = waiters[toRemove[i]];
				waiters.splice(toRemove[i], 1);
				this.emit("lock:waiter_timeout", waiter);
			}

			// Clean up empty entries
			if (waiters.length === 0) {
				this.waiters.delete(resourceId);
			}
		}
	}

	// ============================================================================
	// Ownership Tracking
	// ============================================================================

	private trackOwnerLock(ownerId: string, lockId: string): void {
		let locks = this.ownerHeldLocks.get(ownerId);
		if (!locks) {
			locks = new Set();
			this.ownerHeldLocks.set(ownerId, locks);
		}
		locks.add(lockId);
	}

	private untrackOwnerLock(ownerId: string, lockId: string): void {
		const locks = this.ownerHeldLocks.get(ownerId);
		if (locks) {
			locks.delete(lockId);
			if (locks.size === 0) {
				this.ownerHeldLocks.delete(ownerId);
			}
		}
	}

	getOwnerLocks(ownerId: string): Lock[] {
		const lockIds = this.ownerHeldLocks.get(ownerId);
		if (!lockIds) return [];

		const locks: Lock[] = [];
		for (const lockId of lockIds) {
			const lock = this.locks.get(lockId);
			if (lock) locks.push(lock);
		}
		return locks;
	}

	// ============================================================================
	// Fencing Tokens
	// ============================================================================

	private getNextFencingToken(resourceId: string): number {
		const current = this.fencingTokens.get(resourceId) ?? 0;
		const next = current + 1;

		this.fencingTokens.set(resourceId, next);

		// Persist
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO fencing_tokens (resource_id, token)
      VALUES (?, ?)
    `);
		stmt.run(resourceId, next);

		return next;
	}

	validateFencingToken(resourceId: string, token: number): boolean {
		const currentToken = this.fencingTokens.get(resourceId);
		return currentToken !== undefined && token >= currentToken;
	}

	getCurrentFencingToken(resourceId: string): number | undefined {
		return this.fencingTokens.get(resourceId);
	}

	// ============================================================================
	// Lock Lookup
	// ============================================================================

	private findLockByResource(resourceId: string): Lock | undefined {
		for (const lock of this.locks.values()) {
			if (lock.resourceId === resourceId && lock.status === "acquired") {
				return lock;
			}
		}
		return undefined;
	}

	private findLockByResourceAndOwner(resourceId: string, ownerId: string): Lock | undefined {
		for (const lock of this.locks.values()) {
			if (lock.resourceId === resourceId && lock.ownerId === ownerId && lock.status === "acquired") {
				return lock;
			}
		}
		return undefined;
	}

	getLock(lockId: string): Lock | undefined {
		return this.locks.get(lockId);
	}

	getLocksByNamespace(namespace: string): Lock[] {
		return Array.from(this.locks.values()).filter((l) => l.namespace === namespace);
	}

	getAllLocks(): Lock[] {
		return Array.from(this.locks.values());
	}

	isLocked(resourceId: string): boolean {
		return this.findLockByResource(resourceId) !== undefined;
	}

	// ============================================================================
	// Deadlock Detection
	// ============================================================================

	private detectDeadlocks(): DeadlockInfo | null {
		// Build wait-for graph
		const waitForGraph = new Map<string, Set<string>>();

		// Owner -> Resource they're waiting for
		for (const [resourceId, waiters] of this.waiters) {
			const lock = this.findLockByResource(resourceId);
			if (!lock) continue;

			for (const waiter of waiters) {
				if (!waitForGraph.has(waiter.ownerId)) {
					waitForGraph.set(waiter.ownerId, new Set());
				}
				waitForGraph.get(waiter.ownerId)!.add(lock.ownerId);
			}
		}

		// Detect cycles using DFS
		const visited = new Set<string>();
		const recursionStack = new Set<string>();
		const path: string[] = [];

		const hasCycle = (node: string): boolean => {
			visited.add(node);
			recursionStack.add(node);
			path.push(node);

			const neighbors = waitForGraph.get(node);
			if (neighbors) {
				for (const neighbor of neighbors) {
					if (!visited.has(neighbor)) {
						if (hasCycle(neighbor)) return true;
					} else if (recursionStack.has(neighbor)) {
						// Found cycle
						const cycleStart = path.indexOf(neighbor);
						const cycle = path.slice(cycleStart);
						cycle.push(neighbor);

						const deadlockInfo: DeadlockInfo = {
							detected: true,
							cycle,
							involvedOwners: cycle.filter((_v, i) => i < cycle.length - 1),
							involvedResources: this.getResourcesForOwners(cycle),
							detectedAt: new Date(),
						};

						this.stats.totalDeadlocks++;
						this.emit("deadlock:detected", deadlockInfo);
						return true;
					}
				}
			}

			path.pop();
			recursionStack.delete(node);
			return false;
		};

		for (const node of waitForGraph.keys()) {
			if (!visited.has(node)) {
				if (hasCycle(node)) {
					return {
						detected: true,
						cycle: path,
						involvedOwners: Array.from(new Set(path)),
						involvedResources: this.getResourcesForOwners(path),
						detectedAt: new Date(),
					};
				}
			}
		}

		return null;
	}

	private getResourcesForOwners(owners: string[]): string[] {
		const resources: string[] = [];
		for (const ownerId of owners) {
			const locks = this.getOwnerLocks(ownerId);
			for (const lock of locks) {
				if (!resources.includes(lock.resourceId)) {
					resources.push(lock.resourceId);
				}
			}
		}
		return resources;
	}

	// ============================================================================
	// Lock Hierarchy
	// ============================================================================

	createHierarchy(params: { name: string; level: number; parentId?: string; description?: string }): LockHierarchy {
		const id = randomUUID();

		const hierarchy: LockHierarchy = {
			id,
			name: params.name,
			level: params.level,
			parentId: params.parentId,
			description: params.description,
		};

		const stmt = this.db.prepare(`
      INSERT INTO lock_hierarchies (id, name, level, parent_id, description)
      VALUES (?, ?, ?, ?, ?)
    `);

		stmt.run(id, params.name, params.level, params.parentId ?? null, params.description ?? null);

		this.hierarchies.set(id, hierarchy);
		this.emit("hierarchy:created", hierarchy);

		return hierarchy;
	}

	getHierarchy(id: string): LockHierarchy | undefined {
		return this.hierarchies.get(id);
	}

	getAllHierarchies(): LockHierarchy[] {
		return Array.from(this.hierarchies.values());
	}

	private checkHierarchyOrdering(resourceId: string, ownerId: string): boolean {
		// Simple check: ensure locks are acquired in hierarchy order
		const ownerLocks = this.getOwnerLocks(ownerId);
		if (ownerLocks.length === 0) return true;

		// Get resource's hierarchy level (if defined)
		const resourceHierarchy = this.getHierarchyForResource(resourceId);
		if (!resourceHierarchy) return true;

		// Check that all held locks are at lower or equal levels
		for (const lock of ownerLocks) {
			const lockHierarchy = this.getHierarchyForResource(lock.resourceId);
			if (lockHierarchy && lockHierarchy.level > resourceHierarchy.level) {
				return false; // Would violate hierarchy ordering
			}
		}

		return true;
	}

	private getHierarchyForResource(resourceId: string): LockHierarchy | undefined {
		// Match by prefix or exact name
		for (const hierarchy of this.hierarchies.values()) {
			if (resourceId.startsWith(hierarchy.name) || resourceId === hierarchy.name) {
				return hierarchy;
			}
		}
		return undefined;
	}

	// ============================================================================
	// Cleanup
	// ============================================================================

	private cleanupExpiredLocks(): void {
		const now = new Date();
		const expired: Lock[] = [];

		for (const lock of this.locks.values()) {
			if (lock.expiresAt <= now) {
				expired.push(lock);
			}
		}

		for (const lock of expired) {
			lock.status = "expired";
			this.locks.delete(lock.id);
			this.untrackOwnerLock(lock.ownerId, lock.id);

			const stmt = this.db.prepare("DELETE FROM locks WHERE id = ?");
			stmt.run(lock.id);

			this.recordHistory(lock.id, lock.resourceId, lock.ownerId, "expired", lock.fencingToken);
			this.emit("lock:expired", lock);

			// Notify waiters
			this.notifyWaiters(lock.resourceId);
		}

		// Clean up old history
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - 7);
		const historyStmt = this.db.prepare("DELETE FROM lock_history WHERE timestamp < ?");
		historyStmt.run(cutoffDate.toISOString());
	}

	// ============================================================================
	// Metrics
	// ============================================================================

	private updateMetrics(
		resourceId: string,
		namespace: string,
		action: "acquire" | "release" | "contention",
		holdTimeMs?: number,
	): void {
		if (!this.config.enableMetrics) return;

		const stmt = this.db.prepare(`
      INSERT INTO lock_metrics (resource_id, namespace, total_acquisitions, total_contention,
                                total_wait_time_ms, total_hold_time_ms, max_wait_time_ms,
                                max_hold_time_ms, last_acquired_at)
      VALUES (?, ?, 0, 0, 0, 0, 0, 0, NULL)
      ON CONFLICT(resource_id) DO UPDATE SET
        total_acquisitions = CASE WHEN ? = 'acquire' THEN total_acquisitions + 1 ELSE total_acquisitions END,
        total_contention = CASE WHEN ? = 'contention' THEN total_contention + 1 ELSE total_contention END,
        total_hold_time_ms = CASE WHEN ? = 'release' THEN total_hold_time_ms + ? ELSE total_hold_time_ms END,
        max_hold_time_ms = CASE WHEN ? = 'release' AND ? > max_hold_time_ms THEN ? ELSE max_hold_time_ms END,
        last_acquired_at = CASE WHEN ? = 'acquire' THEN ? ELSE last_acquired_at END
    `);

		stmt.run(
			resourceId,
			namespace,
			action,
			action,
			action,
			holdTimeMs ?? 0,
			action,
			holdTimeMs ?? 0,
			holdTimeMs ?? 0,
			action,
			new Date().toISOString(),
		);
	}

	private recordWaitTime(resourceId: string, waitTimeMs: number): void {
		if (!this.config.enableMetrics) return;

		this.stats.totalWaitTime += waitTimeMs;
		this.stats.waitCount++;

		const stmt = this.db.prepare(`
      UPDATE lock_metrics
      SET total_wait_time_ms = total_wait_time_ms + ?,
          max_wait_time_ms = CASE WHEN ? > max_wait_time_ms THEN ? ELSE max_wait_time_ms END
      WHERE resource_id = ?
    `);

		stmt.run(waitTimeMs, waitTimeMs, waitTimeMs, resourceId);
	}

	getMetrics(resourceId: string): LockMetrics | null {
		const stmt = this.db.prepare("SELECT * FROM lock_metrics WHERE resource_id = ?");
		const row = stmt.get(resourceId) as Record<string, unknown> | undefined;

		if (!row) return null;

		const totalAcquisitions = row.total_acquisitions as number;
		const totalContention = row.total_contention as number;
		const totalWaitTimeMs = row.total_wait_time_ms as number;
		const totalHoldTimeMs = row.total_hold_time_ms as number;

		const waiters = this.waiters.get(resourceId);

		return {
			resourceId,
			namespace: row.namespace as string,
			totalAcquisitions,
			totalContention,
			avgWaitTimeMs: totalContention > 0 ? totalWaitTimeMs / totalContention : 0,
			avgHoldTimeMs: totalAcquisitions > 0 ? totalHoldTimeMs / totalAcquisitions : 0,
			maxWaitTimeMs: row.max_wait_time_ms as number,
			maxHoldTimeMs: row.max_hold_time_ms as number,
			currentWaiters: waiters ? waiters.length : 0,
			lastAcquiredAt: row.last_acquired_at ? new Date(row.last_acquired_at as string) : undefined,
		};
	}

	getAllMetrics(): LockMetrics[] {
		const stmt = this.db.prepare("SELECT * FROM lock_metrics ORDER BY total_acquisitions DESC");
		const rows = stmt.all() as Record<string, unknown>[];

		return rows.map((row) => {
			const resourceId = row.resource_id as string;
			const totalAcquisitions = row.total_acquisitions as number;
			const totalContention = row.total_contention as number;
			const totalWaitTimeMs = row.total_wait_time_ms as number;
			const totalHoldTimeMs = row.total_hold_time_ms as number;
			const waiters = this.waiters.get(resourceId);

			return {
				resourceId,
				namespace: row.namespace as string,
				totalAcquisitions,
				totalContention,
				avgWaitTimeMs: totalContention > 0 ? totalWaitTimeMs / totalContention : 0,
				avgHoldTimeMs: totalAcquisitions > 0 ? totalHoldTimeMs / totalAcquisitions : 0,
				maxWaitTimeMs: row.max_wait_time_ms as number,
				maxHoldTimeMs: row.max_hold_time_ms as number,
				currentWaiters: waiters ? waiters.length : 0,
				lastAcquiredAt: row.last_acquired_at ? new Date(row.last_acquired_at as string) : undefined,
			};
		});
	}

	// ============================================================================
	// History
	// ============================================================================

	private recordHistory(
		lockId: string,
		resourceId: string,
		ownerId: string,
		action: string,
		fencingToken?: number,
		waitTimeMs?: number,
		holdTimeMs?: number,
	): void {
		const stmt = this.db.prepare(`
      INSERT INTO lock_history
      (id, lock_id, resource_id, owner_id, action, fencing_token, wait_time_ms, hold_time_ms, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			randomUUID(),
			lockId,
			resourceId,
			ownerId,
			action,
			fencingToken ?? null,
			waitTimeMs ?? null,
			holdTimeMs ?? null,
			new Date().toISOString(),
		);
	}

	getHistory(
		resourceId: string,
		limit: number = 100,
	): Array<{
		lockId: string;
		resourceId: string;
		ownerId: string;
		action: string;
		fencingToken?: number;
		waitTimeMs?: number;
		holdTimeMs?: number;
		timestamp: Date;
	}> {
		const stmt = this.db.prepare(`
      SELECT * FROM lock_history
      WHERE resource_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

		const rows = stmt.all(resourceId, limit) as Record<string, unknown>[];

		return rows.map((row) => ({
			lockId: row.lock_id as string,
			resourceId: row.resource_id as string,
			ownerId: row.owner_id as string,
			action: row.action as string,
			fencingToken: row.fencing_token as number | undefined,
			waitTimeMs: row.wait_time_ms as number | undefined,
			holdTimeMs: row.hold_time_ms as number | undefined,
			timestamp: new Date(row.timestamp as string),
		}));
	}

	// ============================================================================
	// Statistics
	// ============================================================================

	getStats(): LockStats {
		const locksByNamespace: Record<string, number> = {};
		for (const lock of this.locks.values()) {
			locksByNamespace[lock.namespace] = (locksByNamespace[lock.namespace] ?? 0) + 1;
		}

		let totalWaiters = 0;
		for (const waiters of this.waiters.values()) {
			totalWaiters += waiters.length;
		}

		return {
			totalLocks: this.getAllLocksFromDb().length,
			activeLocks: this.locks.size,
			waitingRequests: totalWaiters,
			totalAcquisitions: this.stats.totalAcquisitions,
			totalReleases: this.stats.totalReleases,
			totalTimeouts: this.stats.totalTimeouts,
			totalDeadlocks: this.stats.totalDeadlocks,
			avgWaitTimeMs: this.stats.waitCount > 0 ? this.stats.totalWaitTime / this.stats.waitCount : 0,
			avgHoldTimeMs: this.stats.releaseCount > 0 ? this.stats.totalHoldTime / this.stats.releaseCount : 0,
			locksByNamespace,
		};
	}

	private getAllLocksFromDb(): Lock[] {
		const stmt = this.db.prepare("SELECT * FROM locks");
		const rows = stmt.all() as Record<string, unknown>[];
		return rows.map((row) => this.rowToLock(row));
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	shutdown(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		if (this.deadlockCheckInterval) {
			clearInterval(this.deadlockCheckInterval);
			this.deadlockCheckInterval = null;
		}

		// Release all locks
		for (const lock of this.locks.values()) {
			this.releaseLockFully(lock);
		}

		this.db.close();
		this.emit("shutdown");
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

let distributedLockInstance: DistributedLockSystem | null = null;

export function getDistributedLock(config?: DistributedLockConfig): DistributedLockSystem {
	if (!distributedLockInstance) {
		if (!config) {
			throw new Error("DistributedLockSystem requires config on first initialization");
		}
		distributedLockInstance = new DistributedLockSystem(config);
	}
	return distributedLockInstance;
}

export function resetDistributedLock(): void {
	if (distributedLockInstance) {
		distributedLockInstance.shutdown();
		distributedLockInstance = null;
	}
}
