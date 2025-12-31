/**
 * Class 3.46: Resource Pool
 * TAC Pattern: Generic connection/resource pooling with health checks
 *
 * Features:
 * - Min/max pool size management
 * - Acquire/release with timeout
 * - Health checks with configurable intervals
 * - Idle resource eviction
 * - Pool warm-up on initialization
 * - Resource validation before use
 * - Comprehensive metrics and statistics
 */

import { EventEmitter } from "events";

// ============================================================================
// Types
// ============================================================================

export type ResourceState = "available" | "in_use" | "unhealthy" | "evicted";
export type PoolState = "initializing" | "running" | "draining" | "stopped";

export interface Resource<T> {
	id: string;
	instance: T;
	state: ResourceState;
	createdAt: Date;
	lastUsedAt: Date;
	lastHealthCheckAt: Date;
	useCount: number;
	consecutiveFailures: number;
	metadata?: Record<string, unknown>;
}

export interface ResourcePoolConfig<T> {
	/** Minimum number of resources to maintain in the pool */
	minSize: number;
	/** Maximum number of resources allowed in the pool */
	maxSize: number;
	/** Timeout in milliseconds when acquiring a resource */
	acquireTimeoutMs: number;
	/** Time in milliseconds a resource can be idle before eviction */
	idleTimeoutMs: number;
	/** Interval in milliseconds between health checks */
	healthCheckIntervalMs: number;
	/** Maximum consecutive health check failures before marking unhealthy */
	maxConsecutiveFailures: number;
	/** Whether to warm up the pool on creation */
	warmUpOnCreate: boolean;
	/** Whether to validate resources before returning them */
	validateOnAcquire: boolean;
	/** Maximum time in milliseconds a resource can be held */
	maxHoldTimeMs: number;
	/** Factory function to create new resources */
	factory: () => Promise<T>;
	/** Function to destroy a resource */
	destroyer: (resource: T) => Promise<void>;
	/** Function to validate a resource is healthy */
	validator: (resource: T) => Promise<boolean>;
	/** Optional name for the pool (for logging/metrics) */
	name?: string;
}

export interface AcquireOptions {
	/** Timeout override for this acquisition */
	timeoutMs?: number;
	/** Priority for this acquisition (higher = sooner) */
	priority?: number;
	/** Metadata to attach to the acquisition */
	metadata?: Record<string, unknown>;
}

export interface AcquireResult<T> {
	resource: Resource<T>;
	waitTimeMs: number;
	wasCreated: boolean;
}

export interface PoolMetrics {
	poolName: string;
	state: PoolState;
	totalCreated: number;
	totalDestroyed: number;
	totalAcquired: number;
	totalReleased: number;
	totalTimeouts: number;
	totalHealthChecksPassed: number;
	totalHealthChecksFailed: number;
	totalEvictions: number;
	avgAcquireTimeMs: number;
	avgHoldTimeMs: number;
	currentSize: number;
	availableCount: number;
	inUseCount: number;
	unhealthyCount: number;
	waitingRequests: number;
	utilizationPercent: number;
}

export interface WaitingRequest<T> {
	id: string;
	priority: number;
	queuedAt: Date;
	timeoutMs: number;
	resolve: (result: AcquireResult<T>) => void;
	reject: (error: Error) => void;
	timeoutHandle: NodeJS.Timeout;
	metadata?: Record<string, unknown>;
}

export interface PoolStats {
	acquireTimes: number[];
	holdTimes: number[];
	lastHealthCheck: Date | null;
	lastEviction: Date | null;
	lastWarmUp: Date | null;
}

// ============================================================================
// Resource Pool
// ============================================================================

export class ResourcePool<T> extends EventEmitter {
	private config: ResourcePoolConfig<T>;
	private resources: Map<string, Resource<T>> = new Map();
	private waitingQueue: WaitingRequest<T>[] = [];
	private state: PoolState = "initializing";
	private healthCheckInterval: NodeJS.Timeout | null = null;
	private evictionInterval: NodeJS.Timeout | null = null;
	private holdTimeoutChecks: Map<string, NodeJS.Timeout> = new Map();

	private stats: PoolStats = {
		acquireTimes: [],
		holdTimes: [],
		lastHealthCheck: null,
		lastEviction: null,
		lastWarmUp: null,
	};

	private counters = {
		totalCreated: 0,
		totalDestroyed: 0,
		totalAcquired: 0,
		totalReleased: 0,
		totalTimeouts: 0,
		totalHealthChecksPassed: 0,
		totalHealthChecksFailed: 0,
		totalEvictions: 0,
	};

	constructor(config: ResourcePoolConfig<T>) {
		super();
		this.config = {
			...config,
			name: config.name ?? `pool_${Date.now()}`,
		};

		if (config.minSize > config.maxSize) {
			throw new Error("minSize cannot be greater than maxSize");
		}

		if (config.minSize < 0 || config.maxSize < 1) {
			throw new Error("Invalid pool size configuration");
		}
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	/**
	 * Initialize the pool and optionally warm it up
	 */
	async initialize(): Promise<void> {
		if (this.state !== "initializing") {
			throw new Error(`Cannot initialize pool in state: ${this.state}`);
		}

		this.emit("pool:initializing", { name: this.config.name });

		if (this.config.warmUpOnCreate) {
			await this.warmUp();
		}

		this.startHealthChecks();
		this.startEvictionChecks();

		this.state = "running";
		this.emit("pool:initialized", { name: this.config.name, size: this.resources.size });
	}

	/**
	 * Warm up the pool by creating minimum resources
	 */
	async warmUp(): Promise<void> {
		this.emit("pool:warmup:start", { targetSize: this.config.minSize });

		const createPromises: Promise<void>[] = [];
		const currentSize = this.getAvailableCount();
		const needed = Math.max(0, this.config.minSize - currentSize);

		for (let i = 0; i < needed; i++) {
			createPromises.push(
				this.createResource()
					.then(() => {})
					.catch((err) => {
						this.emit("pool:warmup:error", { error: err });
					}),
			);
		}

		await Promise.allSettled(createPromises);
		this.stats.lastWarmUp = new Date();
		this.emit("pool:warmup:complete", { created: needed, totalSize: this.resources.size });
	}

	/**
	 * Gracefully drain the pool (stop accepting new requests, wait for in-use resources)
	 */
	async drain(timeoutMs: number = 30000): Promise<void> {
		if (this.state !== "running") {
			throw new Error(`Cannot drain pool in state: ${this.state}`);
		}

		this.state = "draining";
		this.emit("pool:draining", { name: this.config.name });

		// Reject all waiting requests
		for (const request of this.waitingQueue) {
			clearTimeout(request.timeoutHandle);
			request.reject(new Error("Pool is draining"));
		}
		this.waitingQueue = [];

		// Wait for in-use resources to be released
		const startTime = Date.now();
		while (this.getInUseCount() > 0 && Date.now() - startTime < timeoutMs) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		// Force release any remaining resources
		if (this.getInUseCount() > 0) {
			this.emit("pool:drain:forced", { remaining: this.getInUseCount() });
		}

		await this.shutdown();
	}

	/**
	 * Shutdown the pool immediately
	 */
	async shutdown(): Promise<void> {
		this.state = "stopped";

		// Stop intervals
		if (this.healthCheckInterval) {
			clearInterval(this.healthCheckInterval);
			this.healthCheckInterval = null;
		}
		if (this.evictionInterval) {
			clearInterval(this.evictionInterval);
			this.evictionInterval = null;
		}

		// Clear hold timeout checks
		for (const timeout of this.holdTimeoutChecks.values()) {
			clearTimeout(timeout);
		}
		this.holdTimeoutChecks.clear();

		// Destroy all resources
		const destroyPromises: Promise<void>[] = [];
		for (const resource of this.resources.values()) {
			destroyPromises.push(this.destroyResource(resource));
		}
		await Promise.allSettled(destroyPromises);

		this.resources.clear();
		this.emit("pool:shutdown", { name: this.config.name });
	}

	// ============================================================================
	// Resource Management
	// ============================================================================

	/**
	 * Acquire a resource from the pool
	 */
	async acquire(options: AcquireOptions = {}): Promise<AcquireResult<T>> {
		if (this.state !== "running") {
			throw new Error(`Cannot acquire resource from pool in state: ${this.state}`);
		}

		const startTime = Date.now();
		const timeoutMs = options.timeoutMs ?? this.config.acquireTimeoutMs;

		// Try to get an available resource
		const available = this.findAvailableResource();
		if (available) {
			return this.checkoutResource(available, startTime, false);
		}

		// Try to create a new resource if under max
		if (this.resources.size < this.config.maxSize) {
			try {
				const resource = await this.createResource();
				return this.checkoutResource(resource, startTime, true);
			} catch (error) {
				this.emit("resource:create:error", { error });
				// Fall through to wait queue
			}
		}

		// Add to wait queue
		return new Promise<AcquireResult<T>>((resolve, reject) => {
			const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

			const timeoutHandle = setTimeout(() => {
				this.removeFromWaitQueue(requestId);
				this.counters.totalTimeouts++;
				this.emit("acquire:timeout", { requestId, waitedMs: Date.now() - startTime });
				reject(new Error(`Acquire timeout after ${timeoutMs}ms`));
			}, timeoutMs);

			const request: WaitingRequest<T> = {
				id: requestId,
				priority: options.priority ?? 0,
				queuedAt: new Date(),
				timeoutMs,
				resolve,
				reject,
				timeoutHandle,
				metadata: options.metadata,
			};

			// Insert in priority order
			const insertIndex = this.waitingQueue.findIndex((r) => r.priority < request.priority);
			if (insertIndex === -1) {
				this.waitingQueue.push(request);
			} else {
				this.waitingQueue.splice(insertIndex, 0, request);
			}

			this.emit("acquire:queued", {
				requestId,
				queuePosition: insertIndex === -1 ? this.waitingQueue.length : insertIndex + 1,
			});
		});
	}

	/**
	 * Release a resource back to the pool
	 */
	async release(resourceId: string): Promise<void> {
		const resource = this.resources.get(resourceId);
		if (!resource) {
			throw new Error(`Resource not found: ${resourceId}`);
		}

		if (resource.state !== "in_use") {
			throw new Error(`Cannot release resource in state: ${resource.state}`);
		}

		// Clear hold timeout
		const holdTimeout = this.holdTimeoutChecks.get(resourceId);
		if (holdTimeout) {
			clearTimeout(holdTimeout);
			this.holdTimeoutChecks.delete(resourceId);
		}

		// Record hold time
		const holdTimeMs = Date.now() - resource.lastUsedAt.getTime();
		this.recordHoldTime(holdTimeMs);
		this.counters.totalReleased++;

		// Validate resource if configured
		let isHealthy = true;
		if (this.config.validateOnAcquire) {
			try {
				isHealthy = await this.config.validator(resource.instance);
			} catch {
				isHealthy = false;
			}
		}

		if (!isHealthy) {
			resource.state = "unhealthy";
			resource.consecutiveFailures++;
			this.emit("resource:unhealthy", { resourceId, consecutiveFailures: resource.consecutiveFailures });
			await this.destroyResource(resource);
			await this.ensureMinSize();
			return;
		}

		resource.state = "available";
		resource.consecutiveFailures = 0;
		this.emit("resource:released", { resourceId, holdTimeMs });

		// Check waiting queue
		await this.processWaitingQueue();
	}

	/**
	 * Mark a resource as unhealthy and remove it
	 */
	async invalidate(resourceId: string): Promise<void> {
		const resource = this.resources.get(resourceId);
		if (!resource) {
			return;
		}

		resource.state = "unhealthy";
		this.emit("resource:invalidated", { resourceId });

		await this.destroyResource(resource);
		await this.ensureMinSize();
	}

	// ============================================================================
	// Internal Resource Operations
	// ============================================================================

	private async createResource(): Promise<Resource<T>> {
		const id = `res_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const now = new Date();

		this.emit("resource:creating", { id });

		const instance = await this.config.factory();

		const resource: Resource<T> = {
			id,
			instance,
			state: "available",
			createdAt: now,
			lastUsedAt: now,
			lastHealthCheckAt: now,
			useCount: 0,
			consecutiveFailures: 0,
		};

		this.resources.set(id, resource);
		this.counters.totalCreated++;
		this.emit("resource:created", { id, totalSize: this.resources.size });

		return resource;
	}

	private async destroyResource(resource: Resource<T>): Promise<void> {
		this.emit("resource:destroying", { id: resource.id });

		try {
			await this.config.destroyer(resource.instance);
		} catch (error) {
			this.emit("resource:destroy:error", { id: resource.id, error });
		}

		this.resources.delete(resource.id);
		this.counters.totalDestroyed++;
		this.emit("resource:destroyed", { id: resource.id, totalSize: this.resources.size });
	}

	private findAvailableResource(): Resource<T> | null {
		for (const resource of this.resources.values()) {
			if (resource.state === "available") {
				return resource;
			}
		}
		return null;
	}

	private async checkoutResource(
		resource: Resource<T>,
		startTime: number,
		wasCreated: boolean,
	): Promise<AcquireResult<T>> {
		// Validate if configured
		if (this.config.validateOnAcquire && !wasCreated) {
			try {
				const isValid = await this.config.validator(resource.instance);
				if (!isValid) {
					resource.state = "unhealthy";
					resource.consecutiveFailures++;
					await this.destroyResource(resource);

					// Try to get another resource
					const another = this.findAvailableResource();
					if (another) {
						return this.checkoutResource(another, startTime, false);
					}

					// Create new if possible
					if (this.resources.size < this.config.maxSize) {
						const newResource = await this.createResource();
						return this.checkoutResource(newResource, startTime, true);
					}

					throw new Error("No healthy resources available");
				}
			} catch (error) {
				resource.state = "unhealthy";
				await this.destroyResource(resource);
				throw error;
			}
		}

		resource.state = "in_use";
		resource.lastUsedAt = new Date();
		resource.useCount++;
		resource.consecutiveFailures = 0;

		const waitTimeMs = Date.now() - startTime;
		this.recordAcquireTime(waitTimeMs);
		this.counters.totalAcquired++;

		// Set hold timeout
		if (this.config.maxHoldTimeMs > 0) {
			const timeoutHandle = setTimeout(() => {
				this.handleHoldTimeout(resource.id);
			}, this.config.maxHoldTimeMs);
			this.holdTimeoutChecks.set(resource.id, timeoutHandle);
		}

		this.emit("resource:acquired", { id: resource.id, waitTimeMs, wasCreated });

		return { resource, waitTimeMs, wasCreated };
	}

	private handleHoldTimeout(resourceId: string): void {
		const resource = this.resources.get(resourceId);
		if (!resource || resource.state !== "in_use") {
			return;
		}

		this.emit("resource:hold:timeout", {
			resourceId,
			holdTimeMs: Date.now() - resource.lastUsedAt.getTime(),
		});

		// Force release and mark as unhealthy
		resource.state = "unhealthy";
		this.holdTimeoutChecks.delete(resourceId);
	}

	private async processWaitingQueue(): Promise<void> {
		if (this.waitingQueue.length === 0) {
			return;
		}

		const available = this.findAvailableResource();
		if (!available) {
			return;
		}

		const request = this.waitingQueue.shift();
		if (!request) {
			return;
		}

		clearTimeout(request.timeoutHandle);
		const startTime = request.queuedAt.getTime();

		try {
			const result = await this.checkoutResource(available, startTime, false);
			request.resolve(result);
		} catch (error) {
			request.reject(error instanceof Error ? error : new Error(String(error)));
		}
	}

	private removeFromWaitQueue(requestId: string): void {
		const index = this.waitingQueue.findIndex((r) => r.id === requestId);
		if (index !== -1) {
			this.waitingQueue.splice(index, 1);
		}
	}

	private async ensureMinSize(): Promise<void> {
		const _currentAvailable = this.getAvailableCount();
		const currentTotal = this.resources.size;

		if (currentTotal < this.config.minSize) {
			const needed = this.config.minSize - currentTotal;
			for (let i = 0; i < needed; i++) {
				try {
					await this.createResource();
				} catch (error) {
					this.emit("resource:create:error", { error, reason: "ensureMinSize" });
				}
			}
		}
	}

	// ============================================================================
	// Health Checks
	// ============================================================================

	private startHealthChecks(): void {
		if (this.config.healthCheckIntervalMs <= 0) {
			return;
		}

		this.healthCheckInterval = setInterval(async () => {
			await this.runHealthChecks();
		}, this.config.healthCheckIntervalMs);
	}

	private async runHealthChecks(): Promise<void> {
		this.stats.lastHealthCheck = new Date();
		const resources = Array.from(this.resources.values()).filter((r) => r.state === "available");

		for (const resource of resources) {
			try {
				const isHealthy = await this.config.validator(resource.instance);
				resource.lastHealthCheckAt = new Date();

				if (isHealthy) {
					resource.consecutiveFailures = 0;
					this.counters.totalHealthChecksPassed++;
				} else {
					resource.consecutiveFailures++;
					this.counters.totalHealthChecksFailed++;
					this.emit("healthcheck:failed", {
						resourceId: resource.id,
						consecutiveFailures: resource.consecutiveFailures,
					});

					if (resource.consecutiveFailures >= this.config.maxConsecutiveFailures) {
						resource.state = "unhealthy";
						await this.destroyResource(resource);
					}
				}
			} catch (error) {
				resource.consecutiveFailures++;
				this.counters.totalHealthChecksFailed++;
				this.emit("healthcheck:error", { resourceId: resource.id, error });

				if (resource.consecutiveFailures >= this.config.maxConsecutiveFailures) {
					resource.state = "unhealthy";
					await this.destroyResource(resource);
				}
			}
		}

		await this.ensureMinSize();
		this.emit("healthcheck:complete", { checked: resources.length });
	}

	/**
	 * Manually trigger health checks
	 */
	async checkHealth(): Promise<{ passed: number; failed: number }> {
		const before = {
			passed: this.counters.totalHealthChecksPassed,
			failed: this.counters.totalHealthChecksFailed,
		};

		await this.runHealthChecks();

		return {
			passed: this.counters.totalHealthChecksPassed - before.passed,
			failed: this.counters.totalHealthChecksFailed - before.failed,
		};
	}

	// ============================================================================
	// Eviction
	// ============================================================================

	private startEvictionChecks(): void {
		if (this.config.idleTimeoutMs <= 0) {
			return;
		}

		// Check for idle resources every minute or half the idle timeout, whichever is less
		const checkInterval = Math.min(60000, this.config.idleTimeoutMs / 2);

		this.evictionInterval = setInterval(() => {
			this.evictIdleResources();
		}, checkInterval);
	}

	private evictIdleResources(): void {
		const now = Date.now();
		const resources = Array.from(this.resources.values()).filter((r) => r.state === "available");

		let evicted = 0;

		for (const resource of resources) {
			// Don't evict below minimum
			if (this.resources.size <= this.config.minSize) {
				break;
			}

			const idleTimeMs = now - resource.lastUsedAt.getTime();
			if (idleTimeMs >= this.config.idleTimeoutMs) {
				resource.state = "evicted";
				this.destroyResource(resource).catch((err) => {
					this.emit("eviction:error", { resourceId: resource.id, error: err });
				});
				evicted++;
				this.counters.totalEvictions++;
			}
		}

		if (evicted > 0) {
			this.stats.lastEviction = new Date();
			this.emit("eviction:complete", { evicted, remainingSize: this.resources.size });
		}
	}

	// ============================================================================
	// Metrics & Stats
	// ============================================================================

	private recordAcquireTime(ms: number): void {
		this.stats.acquireTimes.push(ms);
		if (this.stats.acquireTimes.length > 1000) {
			this.stats.acquireTimes = this.stats.acquireTimes.slice(-1000);
		}
	}

	private recordHoldTime(ms: number): void {
		this.stats.holdTimes.push(ms);
		if (this.stats.holdTimes.length > 1000) {
			this.stats.holdTimes = this.stats.holdTimes.slice(-1000);
		}
	}

	/**
	 * Get current pool metrics
	 */
	getMetrics(): PoolMetrics {
		const avgAcquireTimeMs =
			this.stats.acquireTimes.length > 0
				? this.stats.acquireTimes.reduce((a, b) => a + b, 0) / this.stats.acquireTimes.length
				: 0;

		const avgHoldTimeMs =
			this.stats.holdTimes.length > 0
				? this.stats.holdTimes.reduce((a, b) => a + b, 0) / this.stats.holdTimes.length
				: 0;

		const currentSize = this.resources.size;
		const inUseCount = this.getInUseCount();
		const utilizationPercent = currentSize > 0 ? (inUseCount / currentSize) * 100 : 0;

		return {
			poolName: this.config.name!,
			state: this.state,
			totalCreated: this.counters.totalCreated,
			totalDestroyed: this.counters.totalDestroyed,
			totalAcquired: this.counters.totalAcquired,
			totalReleased: this.counters.totalReleased,
			totalTimeouts: this.counters.totalTimeouts,
			totalHealthChecksPassed: this.counters.totalHealthChecksPassed,
			totalHealthChecksFailed: this.counters.totalHealthChecksFailed,
			totalEvictions: this.counters.totalEvictions,
			avgAcquireTimeMs: Math.round(avgAcquireTimeMs * 100) / 100,
			avgHoldTimeMs: Math.round(avgHoldTimeMs * 100) / 100,
			currentSize,
			availableCount: this.getAvailableCount(),
			inUseCount,
			unhealthyCount: this.getUnhealthyCount(),
			waitingRequests: this.waitingQueue.length,
			utilizationPercent: Math.round(utilizationPercent * 100) / 100,
		};
	}

	/**
	 * Get all resources with their current state
	 */
	getResources(): Resource<T>[] {
		return Array.from(this.resources.values());
	}

	/**
	 * Get resource by ID
	 */
	getResource(id: string): Resource<T> | undefined {
		return this.resources.get(id);
	}

	/**
	 * Get count of available resources
	 */
	getAvailableCount(): number {
		let count = 0;
		for (const resource of this.resources.values()) {
			if (resource.state === "available") count++;
		}
		return count;
	}

	/**
	 * Get count of in-use resources
	 */
	getInUseCount(): number {
		let count = 0;
		for (const resource of this.resources.values()) {
			if (resource.state === "in_use") count++;
		}
		return count;
	}

	/**
	 * Get count of unhealthy resources
	 */
	getUnhealthyCount(): number {
		let count = 0;
		for (const resource of this.resources.values()) {
			if (resource.state === "unhealthy") count++;
		}
		return count;
	}

	/**
	 * Get current pool state
	 */
	getState(): PoolState {
		return this.state;
	}

	/**
	 * Get pool configuration
	 */
	getConfig(): Readonly<ResourcePoolConfig<T>> {
		return { ...this.config };
	}

	/**
	 * Reset statistics (does not affect pool state)
	 */
	resetStats(): void {
		this.stats = {
			acquireTimes: [],
			holdTimes: [],
			lastHealthCheck: null,
			lastEviction: null,
			lastWarmUp: null,
		};
		this.counters = {
			totalCreated: 0,
			totalDestroyed: 0,
			totalAcquired: 0,
			totalReleased: 0,
			totalTimeouts: 0,
			totalHealthChecksPassed: 0,
			totalHealthChecksFailed: 0,
			totalEvictions: 0,
		};
		this.emit("stats:reset");
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new resource pool instance
 * Note: Each pool is separate, no singleton pattern
 */
export function createResourcePool<T>(config: ResourcePoolConfig<T>): ResourcePool<T> {
	return new ResourcePool<T>(config);
}

/**
 * Create and initialize a resource pool in one call
 */
export async function createAndInitializePool<T>(config: ResourcePoolConfig<T>): Promise<ResourcePool<T>> {
	const pool = createResourcePool(config);
	await pool.initialize();
	return pool;
}

// ============================================================================
// Utility: Connection Pool Helpers
// ============================================================================

/**
 * Default configuration for a generic connection pool
 */
export function getDefaultPoolConfig<T>(
	factory: () => Promise<T>,
	destroyer: (resource: T) => Promise<void>,
	validator: (resource: T) => Promise<boolean>,
): ResourcePoolConfig<T> {
	return {
		minSize: 2,
		maxSize: 10,
		acquireTimeoutMs: 30000,
		idleTimeoutMs: 300000, // 5 minutes
		healthCheckIntervalMs: 60000, // 1 minute
		maxConsecutiveFailures: 3,
		warmUpOnCreate: true,
		validateOnAcquire: true,
		maxHoldTimeMs: 60000, // 1 minute
		factory,
		destroyer,
		validator,
	};
}

/**
 * Helper to wrap a pool operation with automatic release
 */
export async function withResource<T, R>(
	pool: ResourcePool<T>,
	operation: (resource: T) => Promise<R>,
	options?: AcquireOptions,
): Promise<R> {
	const result = await pool.acquire(options);
	try {
		return await operation(result.resource.instance);
	} finally {
		await pool.release(result.resource.id);
	}
}
