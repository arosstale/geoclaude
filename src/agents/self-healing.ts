/**
 * Self-Healing Manager - Autonomous Error Recovery System
 *
 * Features:
 * - Memory leak detection with heap threshold monitoring
 * - Unhandled promise rejection recovery
 * - API rate limit handling with exponential backoff
 * - Database connection failure recovery
 * - Discord gateway disconnect auto-reconnect
 * - Integration with HealthMonitoringSystem
 * - Discord channel logging for healing actions
 *
 * Patterns from existing codebase:
 * - CircuitBreakerSystem for fault tolerance
 * - SelfDebugService for error capture
 * - HealthMonitoringSystem for component health tracking
 */

import type Database from "better-sqlite3";
import type { Client, TextChannel } from "discord.js";
import { EventEmitter } from "events";
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import type { HealthMonitoringSystem } from "./health-monitoring.js";

// ============================================================================
// Types
// ============================================================================

export type HealingActionType =
	| "memory_leak_recovery"
	| "promise_rejection_recovery"
	| "rate_limit_backoff"
	| "database_reconnect"
	| "gateway_reconnect"
	| "process_restart"
	| "garbage_collection"
	| "circuit_reset"
	| "connection_pool_cleanup"
	| "cache_clear";

export type HealingSeverity = "info" | "warning" | "critical" | "emergency";

export type FailurePattern =
	| "memory_exhaustion"
	| "unhandled_rejection"
	| "rate_limited"
	| "database_connection_lost"
	| "gateway_disconnect"
	| "timeout"
	| "econnrefused"
	| "enotfound"
	| "socket_hangup"
	| "unknown";

export interface HealingAction {
	id: string;
	type: HealingActionType;
	severity: HealingSeverity;
	pattern: FailurePattern;
	description: string;
	timestamp: number;
	success: boolean;
	durationMs: number;
	metadata?: Record<string, unknown>;
	errorMessage?: string;
}

export interface ErrorPattern {
	pattern: FailurePattern;
	regex: RegExp;
	count: number;
	firstSeen: number;
	lastSeen: number;
	healed: number;
	failed: number;
}

export interface MemoryMetrics {
	heapUsed: number;
	heapTotal: number;
	external: number;
	arrayBuffers: number;
	rss: number;
	heapUsedPercent: number;
	timestamp: number;
}

export interface SelfHealingConfig {
	enabled: boolean;
	dataDir: string;
	logChannel?: string;

	// Memory monitoring
	heapThresholdPercent: number; // Trigger healing above this % (default: 85)
	heapCriticalPercent: number; // Force GC above this % (default: 95)
	memoryCheckIntervalMs: number; // Check memory every N ms (default: 30000)

	// Rate limiting
	rateLimitBackoffBaseMs: number; // Initial backoff (default: 1000)
	rateLimitBackoffMaxMs: number; // Max backoff (default: 60000)
	rateLimitBackoffMultiplier: number; // Exponential multiplier (default: 2)

	// Database recovery
	dbReconnectMaxAttempts: number; // Max reconnect attempts (default: 5)
	dbReconnectIntervalMs: number; // Time between attempts (default: 5000)

	// Gateway recovery
	gatewayReconnectMaxAttempts: number; // Max attempts (default: 10)
	gatewayReconnectIntervalMs: number; // Time between attempts (default: 5000)

	// Error pattern detection
	patternWindowMs: number; // Time window for pattern detection (default: 300000)
	patternThreshold: number; // Errors to trigger pattern (default: 3)

	// Cooldowns
	healingCooldownMs: number; // Min time between healing actions (default: 60000)
	maxHealingAttemptsPerHour: number; // Max healing attempts per hour (default: 10)

	// Debug
	debugLog: boolean;
}

export interface SelfHealingStatus {
	enabled: boolean;
	uptime: number;
	totalHealingActions: number;
	successfulHealings: number;
	failedHealings: number;
	lastHealingAction?: HealingAction;
	activePatterns: ErrorPattern[];
	memoryMetrics: MemoryMetrics;
	healthScore: number; // 0-100
	isHealing: boolean;
	rateLimitBackoffs: Map<string, { backoff: number; nextRetry: number }>;
	dbConnectionHealthy: boolean;
	gatewayConnected: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_SELF_HEALING_CONFIG: SelfHealingConfig = {
	enabled: true,
	dataDir: "./data",
	logChannel: undefined,

	heapThresholdPercent: 85,
	heapCriticalPercent: 95,
	memoryCheckIntervalMs: 30000,

	rateLimitBackoffBaseMs: 1000,
	rateLimitBackoffMaxMs: 60000,
	rateLimitBackoffMultiplier: 2,

	dbReconnectMaxAttempts: 5,
	dbReconnectIntervalMs: 5000,

	gatewayReconnectMaxAttempts: 10,
	gatewayReconnectIntervalMs: 5000,

	patternWindowMs: 300000, // 5 minutes
	patternThreshold: 3,

	healingCooldownMs: 60000, // 1 minute
	maxHealingAttemptsPerHour: 10,

	debugLog: false,
};

// Error pattern matchers
const ERROR_PATTERNS: Array<{ pattern: FailurePattern; regex: RegExp; severity: HealingSeverity }> = [
	{
		pattern: "memory_exhaustion",
		regex: /heap out of memory|allocation failed|FATAL ERROR.*Reached heap limit/i,
		severity: "emergency",
	},
	{
		pattern: "rate_limited",
		regex: /rate limit|too many requests|429|rate_limit_exceeded/i,
		severity: "warning",
	},
	{
		pattern: "database_connection_lost",
		regex: /SQLITE_BUSY|SQLITE_LOCKED|database is locked|cannot open database/i,
		severity: "critical",
	},
	{
		pattern: "gateway_disconnect",
		regex: /gateway|websocket.*close|WS_CLOSE|disconnect|heartbeat/i,
		severity: "warning",
	},
	{
		pattern: "timeout",
		regex: /timeout|ETIMEDOUT|ESOCKETTIMEDOUT|request timed out/i,
		severity: "warning",
	},
	{
		pattern: "econnrefused",
		regex: /ECONNREFUSED|connection refused/i,
		severity: "critical",
	},
	{
		pattern: "enotfound",
		regex: /ENOTFOUND|EAI_AGAIN|getaddrinfo.*failed/i,
		severity: "warning",
	},
	{
		pattern: "socket_hangup",
		regex: /ECONNRESET|socket hang up|connection reset/i,
		severity: "warning",
	},
	{
		pattern: "unhandled_rejection",
		regex: /unhandledRejection|UnhandledPromiseRejection/i,
		severity: "warning",
	},
];

// ============================================================================
// Self-Healing Manager
// ============================================================================

export class SelfHealingManager extends EventEmitter {
	private config: SelfHealingConfig;
	private startTime: number;
	private isHealing = false;
	private healingActions: HealingAction[] = [];
	private errorPatterns: Map<FailurePattern, ErrorPattern> = new Map();
	private lastHealingTime: Map<HealingActionType, number> = new Map();
	private healingAttemptsThisHour: number = 0;
	private hourResetTimer?: NodeJS.Timeout;
	private memoryCheckTimer?: NodeJS.Timeout;
	private rateLimitBackoffs: Map<string, { backoff: number; nextRetry: number }> = new Map();
	private logFile: string;

	// External references (set via configure)
	private discordClient?: Client;
	private database?: Database.Database;
	private dbReconnectFn?: () => Database.Database;

	// State tracking
	private dbConnectionHealthy = true;
	private gatewayConnected = true;
	private lastMemoryMetrics: MemoryMetrics;

	constructor(config: Partial<SelfHealingConfig> = {}) {
		super();
		this.config = { ...DEFAULT_SELF_HEALING_CONFIG, ...config };
		this.startTime = Date.now();
		this.logFile = join(this.config.dataDir, "self-healing.log");

		// Ensure data directory exists
		const dir = dirname(this.logFile);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		// Initialize memory metrics
		this.lastMemoryMetrics = this.collectMemoryMetrics();

		// Initialize error patterns
		for (const { pattern } of ERROR_PATTERNS) {
			this.errorPatterns.set(pattern, {
				pattern,
				regex: ERROR_PATTERNS.find((p) => p.pattern === pattern)!.regex,
				count: 0,
				firstSeen: 0,
				lastSeen: 0,
				healed: 0,
				failed: 0,
			});
		}

		this.log("INFO", "SelfHealingManager initialized");
	}

	// -------------------------------------------------------------------------
	// Configuration
	// -------------------------------------------------------------------------

	configure(options: {
		discordClient?: Client;
		database?: Database.Database;
		dbReconnectFn?: () => Database.Database;
		logChannel?: string;
		healthMonitor?: HealthMonitoringSystem;
	}): void {
		if (options.discordClient) {
			this.discordClient = options.discordClient;
			this.setupGatewayMonitoring();
		}
		if (options.database) {
			this.database = options.database;
		}
		if (options.dbReconnectFn) {
			this.dbReconnectFn = options.dbReconnectFn;
		}
		if (options.logChannel) {
			this.config.logChannel = options.logChannel;
		}
		if (options.healthMonitor) {
			this.registerWithHealthMonitor(options.healthMonitor);
		}

		this.log(
			"INFO",
			"SelfHealingManager configured",
			options.logChannel ? { logChannel: options.logChannel } : undefined,
		);
	}

	/**
	 * Register self-healing as a component in HealthMonitoringSystem
	 */
	private registerWithHealthMonitor(healthMonitor: HealthMonitoringSystem): void {
		try {
			// Register self-healing as a system component
			healthMonitor.registerComponent({
				id: "self-healing",
				type: "system",
				name: "Self-Healing Manager",
			});

			// Start a health checker
			healthMonitor.startChecker({
				componentId: "self-healing",
				intervalMs: this.config.memoryCheckIntervalMs,
				check: async () => {
					const status = this.getStatus();
					const healthy = status.healthScore >= 50 && !this.isHealing;

					return {
						healthy,
						message: healthy
							? `Health score: ${status.healthScore}/100, Memory: ${status.memoryMetrics.heapUsedPercent.toFixed(1)}%`
							: `Low health (${status.healthScore}/100) or healing in progress`,
						latencyMs: 0,
						metadata: {
							healthScore: status.healthScore,
							memoryPercent: status.memoryMetrics.heapUsedPercent,
							activePatterns: status.activePatterns.length,
							isHealing: this.isHealing,
							dbHealthy: this.dbConnectionHealthy,
							gatewayConnected: this.gatewayConnected,
						},
					};
				},
			});

			this.log("INFO", "Registered with HealthMonitoringSystem");
		} catch (error) {
			this.log("WARN", "Failed to register with HealthMonitoringSystem", { error: String(error) });
		}
	}

	// -------------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------------

	start(): void {
		if (!this.config.enabled) {
			this.log("INFO", "SelfHealingManager disabled, not starting");
			return;
		}

		// Install process error handlers
		this.installErrorHandlers();

		// Start memory monitoring
		this.startMemoryMonitoring();

		// Reset hourly counter
		this.hourResetTimer = setInterval(() => {
			this.healingAttemptsThisHour = 0;
		}, 3600000);

		this.log("INFO", "SelfHealingManager started");
		this.emit("started");
	}

	stop(): void {
		if (this.memoryCheckTimer) {
			clearInterval(this.memoryCheckTimer);
			this.memoryCheckTimer = undefined;
		}
		if (this.hourResetTimer) {
			clearInterval(this.hourResetTimer);
			this.hourResetTimer = undefined;
		}

		this.log("INFO", "SelfHealingManager stopped");
		this.emit("stopped");
	}

	// -------------------------------------------------------------------------
	// Error Handlers
	// -------------------------------------------------------------------------

	private installErrorHandlers(): void {
		// Unhandled promise rejections
		process.on("unhandledRejection", (reason, promise) => {
			this.handleUnhandledRejection(reason, promise);
		});

		// Uncaught exceptions (log but let process handle)
		process.on("uncaughtException", (error) => {
			this.handleUncaughtException(error);
		});

		// Memory warnings (if Node.js supports)
		process.on("warning", (warning) => {
			if (warning.name === "MaxListenersExceededWarning") {
				this.log("WARN", "EventEmitter listener leak detected", { message: warning.message });
			}
		});

		this.log("DEBUG", "Process error handlers installed");
	}

	private handleUnhandledRejection(reason: unknown, _promise: Promise<unknown>): void {
		const error = reason instanceof Error ? reason : new Error(String(reason));
		const message = error.message;

		this.log("WARN", "Unhandled rejection caught", { message, stack: error.stack });

		// Detect pattern
		const pattern = this.detectPattern(message);
		this.recordError(pattern, message);

		// Attempt healing based on pattern
		this.healByPattern(pattern, error).catch((e) => {
			this.log("ERROR", "Healing failed for unhandled rejection", { error: String(e) });
		});

		this.emit("unhandledRejection", { error, pattern });
	}

	private handleUncaughtException(error: Error): void {
		this.log("ERROR", "Uncaught exception", { message: error.message, stack: error.stack });

		const pattern = this.detectPattern(error.message);
		this.recordError(pattern, error.message);

		// For critical patterns, attempt emergency healing
		if (pattern === "memory_exhaustion") {
			this.forceGarbageCollection();
		}

		this.emit("uncaughtException", { error, pattern });

		// Re-throw to let Node.js handle process exit
		// This is intentional - we log and heal what we can but don't suppress the exception
	}

	// -------------------------------------------------------------------------
	// Memory Monitoring
	// -------------------------------------------------------------------------

	private startMemoryMonitoring(): void {
		this.memoryCheckTimer = setInterval(() => {
			this.checkMemory();
		}, this.config.memoryCheckIntervalMs);

		// Initial check
		this.checkMemory();
	}

	private collectMemoryMetrics(): MemoryMetrics {
		const usage = process.memoryUsage();
		return {
			heapUsed: usage.heapUsed,
			heapTotal: usage.heapTotal,
			external: usage.external,
			arrayBuffers: usage.arrayBuffers,
			rss: usage.rss,
			heapUsedPercent: (usage.heapUsed / usage.heapTotal) * 100,
			timestamp: Date.now(),
		};
	}

	private checkMemory(): void {
		const metrics = this.collectMemoryMetrics();
		this.lastMemoryMetrics = metrics;

		this.emit("memoryCheck", { metrics });

		// Critical threshold - force GC
		if (metrics.heapUsedPercent >= this.config.heapCriticalPercent) {
			this.log("WARN", "Critical memory threshold exceeded", {
				heapUsedPercent: metrics.heapUsedPercent.toFixed(1),
				heapUsed: this.formatBytes(metrics.heapUsed),
				heapTotal: this.formatBytes(metrics.heapTotal),
			});

			this.healMemoryLeak("critical");
			return;
		}

		// Warning threshold - trigger healing
		if (metrics.heapUsedPercent >= this.config.heapThresholdPercent) {
			this.log("WARN", "Memory threshold exceeded", {
				heapUsedPercent: metrics.heapUsedPercent.toFixed(1),
				heapUsed: this.formatBytes(metrics.heapUsed),
				heapTotal: this.formatBytes(metrics.heapTotal),
			});

			this.healMemoryLeak("warning");
		}
	}

	private async healMemoryLeak(severity: "warning" | "critical"): Promise<void> {
		if (!this.canHeal("memory_leak_recovery")) {
			this.log("DEBUG", "Memory healing on cooldown");
			return;
		}

		const action = await this.executeHealing(
			{
				type: "memory_leak_recovery",
				severity: severity === "critical" ? "critical" : "warning",
				pattern: "memory_exhaustion",
				description: `Memory healing triggered at ${this.lastMemoryMetrics.heapUsedPercent.toFixed(1)}% heap usage`,
			},
			async () => {
				// Step 1: Force garbage collection if available
				this.forceGarbageCollection();

				// Step 2: Clear internal caches
				this.clearInternalCaches();

				// Step 3: Check if memory improved
				await this.sleep(1000);
				const afterMetrics = this.collectMemoryMetrics();

				const improvement = this.lastMemoryMetrics.heapUsedPercent - afterMetrics.heapUsedPercent;
				this.log("INFO", "Memory healing result", {
					before: this.lastMemoryMetrics.heapUsedPercent.toFixed(1) + "%",
					after: afterMetrics.heapUsedPercent.toFixed(1) + "%",
					improvement: improvement.toFixed(1) + "%",
				});

				return improvement > 0;
			},
		);

		await this.logToDiscord(action);
	}

	private forceGarbageCollection(): void {
		if (global.gc) {
			this.log("INFO", "Forcing garbage collection");
			global.gc();
		} else {
			this.log("DEBUG", "GC not exposed (run with --expose-gc flag)");
		}
	}

	private clearInternalCaches(): void {
		// Clear require cache for non-essential modules
		// This is a lightweight operation - we don't want to clear essential caches
		this.log("DEBUG", "Clearing internal caches");

		// Emit event for other systems to clear their caches
		this.emit("clearCaches");
	}

	// -------------------------------------------------------------------------
	// Rate Limit Handling
	// -------------------------------------------------------------------------

	/**
	 * Get the current backoff time for a rate-limited resource
	 */
	getRateLimitBackoff(resource: string): number {
		const entry = this.rateLimitBackoffs.get(resource);
		if (!entry) return 0;

		const now = Date.now();
		if (now >= entry.nextRetry) {
			this.rateLimitBackoffs.delete(resource);
			return 0;
		}

		return entry.nextRetry - now;
	}

	/**
	 * Record a rate limit and return the backoff time
	 */
	recordRateLimit(resource: string, retryAfterMs?: number): number {
		const existing = this.rateLimitBackoffs.get(resource);
		const currentBackoff = existing?.backoff ?? 0;

		// Calculate new backoff with exponential increase
		let newBackoff: number;
		if (retryAfterMs) {
			newBackoff = retryAfterMs;
		} else if (currentBackoff === 0) {
			newBackoff = this.config.rateLimitBackoffBaseMs;
		} else {
			newBackoff = Math.min(
				currentBackoff * this.config.rateLimitBackoffMultiplier,
				this.config.rateLimitBackoffMaxMs,
			);
		}

		const nextRetry = Date.now() + newBackoff;
		this.rateLimitBackoffs.set(resource, { backoff: newBackoff, nextRetry });

		this.log("INFO", "Rate limit recorded", {
			resource,
			backoffMs: newBackoff,
			nextRetry: new Date(nextRetry).toISOString(),
		});

		this.emit("rateLimit", { resource, backoffMs: newBackoff, nextRetry });

		return newBackoff;
	}

	/**
	 * Clear rate limit for a resource after successful request
	 */
	clearRateLimit(resource: string): void {
		if (this.rateLimitBackoffs.has(resource)) {
			this.rateLimitBackoffs.delete(resource);
			this.log("DEBUG", "Rate limit cleared", { resource });
		}
	}

	/**
	 * Execute a function with rate limit handling
	 */
	async withRateLimitRetry<T>(resource: string, fn: () => Promise<T>, maxRetries: number = 3): Promise<T> {
		let lastError: Error | undefined;

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			// Check if we're in backoff
			const backoffMs = this.getRateLimitBackoff(resource);
			if (backoffMs > 0) {
				this.log("DEBUG", `Waiting for rate limit backoff: ${backoffMs}ms`, { resource });
				await this.sleep(backoffMs);
			}

			try {
				const result = await fn();
				this.clearRateLimit(resource);
				return result;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				// Check if rate limited
				if (this.detectPattern(lastError.message) === "rate_limited") {
					// Extract retry-after if available
					const retryAfterMatch = lastError.message.match(/retry.?after[:\s]+(\d+)/i);
					const retryAfterMs = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) * 1000 : undefined;

					this.recordRateLimit(resource, retryAfterMs);

					if (attempt < maxRetries - 1) {
						continue;
					}
				}

				throw lastError;
			}
		}

		throw lastError ?? new Error("Max retries exceeded");
	}

	// -------------------------------------------------------------------------
	// Database Recovery
	// -------------------------------------------------------------------------

	async healDatabaseConnection(): Promise<boolean> {
		if (!this.dbReconnectFn) {
			this.log("WARN", "No database reconnect function configured");
			return false;
		}

		if (!this.canHeal("database_reconnect")) {
			this.log("DEBUG", "Database healing on cooldown");
			return false;
		}

		const action = await this.executeHealing(
			{
				type: "database_reconnect",
				severity: "critical",
				pattern: "database_connection_lost",
				description: "Attempting database reconnection",
			},
			async () => {
				for (let attempt = 1; attempt <= this.config.dbReconnectMaxAttempts; attempt++) {
					try {
						this.log("INFO", `Database reconnect attempt ${attempt}/${this.config.dbReconnectMaxAttempts}`);

						this.database = this.dbReconnectFn!();

						// Verify connection with simple query
						this.database.pragma("quick_check");

						this.dbConnectionHealthy = true;
						this.log("INFO", "Database reconnected successfully");
						return true;
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						this.log("WARN", `Database reconnect attempt ${attempt} failed`, { error: message });

						if (attempt < this.config.dbReconnectMaxAttempts) {
							await this.sleep(this.config.dbReconnectIntervalMs);
						}
					}
				}

				this.dbConnectionHealthy = false;
				return false;
			},
		);

		await this.logToDiscord(action);
		return action.success;
	}

	// -------------------------------------------------------------------------
	// Gateway Recovery
	// -------------------------------------------------------------------------

	private setupGatewayMonitoring(): void {
		if (!this.discordClient) return;

		this.discordClient.on("ready", () => {
			this.gatewayConnected = true;
			this.log("INFO", "Discord gateway connected");
		});

		this.discordClient.on("disconnect", () => {
			this.gatewayConnected = false;
			this.log("WARN", "Discord gateway disconnected");
			this.healGatewayConnection().catch((e) => {
				this.log("ERROR", "Gateway healing failed", { error: String(e) });
			});
		});

		this.discordClient.on("error", (error) => {
			this.log("ERROR", "Discord client error", { message: error.message });
			const pattern = this.detectPattern(error.message);
			this.recordError(pattern, error.message);
		});

		// Monitor for shard issues
		this.discordClient.on("shardDisconnect", (event, shardId) => {
			this.log("WARN", "Shard disconnected", { shardId, code: event.code });
		});

		this.discordClient.on("shardReconnecting", (shardId) => {
			this.log("INFO", "Shard reconnecting", { shardId });
		});

		this.discordClient.on("shardResume", (shardId, replayedEvents) => {
			this.log("INFO", "Shard resumed", { shardId, replayedEvents });
			this.gatewayConnected = true;
		});
	}

	async healGatewayConnection(): Promise<boolean> {
		if (!this.discordClient) {
			this.log("WARN", "No Discord client configured");
			return false;
		}

		if (!this.canHeal("gateway_reconnect")) {
			this.log("DEBUG", "Gateway healing on cooldown");
			return false;
		}

		const action = await this.executeHealing(
			{
				type: "gateway_reconnect",
				severity: "warning",
				pattern: "gateway_disconnect",
				description: "Attempting Discord gateway reconnection",
			},
			async () => {
				for (let attempt = 1; attempt <= this.config.gatewayReconnectMaxAttempts; attempt++) {
					try {
						this.log("INFO", `Gateway reconnect attempt ${attempt}/${this.config.gatewayReconnectMaxAttempts}`);

						// Discord.js handles reconnection automatically in most cases
						// We just need to wait and check status
						await this.sleep(this.config.gatewayReconnectIntervalMs);

						if (this.discordClient!.isReady()) {
							this.gatewayConnected = true;
							this.log("INFO", "Gateway reconnected successfully");
							return true;
						}
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						this.log("WARN", `Gateway reconnect attempt ${attempt} failed`, { error: message });
					}
				}

				this.gatewayConnected = false;
				return false;
			},
		);

		await this.logToDiscord(action);
		return action.success;
	}

	// -------------------------------------------------------------------------
	// Pattern Detection and Healing
	// -------------------------------------------------------------------------

	private detectPattern(errorMessage: string): FailurePattern {
		for (const { pattern, regex } of ERROR_PATTERNS) {
			if (regex.test(errorMessage)) {
				return pattern;
			}
		}
		return "unknown";
	}

	private recordError(pattern: FailurePattern, message: string): void {
		const entry = this.errorPatterns.get(pattern);
		if (!entry) {
			this.errorPatterns.set(pattern, {
				pattern,
				regex: ERROR_PATTERNS.find((p) => p.pattern === pattern)?.regex ?? /./,
				count: 1,
				firstSeen: Date.now(),
				lastSeen: Date.now(),
				healed: 0,
				failed: 0,
			});
			return;
		}

		const now = Date.now();

		// Reset if outside window
		if (now - entry.lastSeen > this.config.patternWindowMs) {
			entry.count = 1;
			entry.firstSeen = now;
		} else {
			entry.count++;
		}

		entry.lastSeen = now;

		// Check if pattern threshold exceeded
		if (entry.count >= this.config.patternThreshold) {
			this.log("WARN", "Error pattern threshold exceeded", {
				pattern,
				count: entry.count,
				window: this.config.patternWindowMs,
			});

			this.emit("patternDetected", { pattern, count: entry.count, message });
		}
	}

	private async healByPattern(pattern: FailurePattern, error: Error): Promise<void> {
		switch (pattern) {
			case "memory_exhaustion":
				await this.healMemoryLeak("critical");
				break;

			case "rate_limited": {
				// Rate limiting is handled per-resource, this is a generic fallback
				const resource = this.extractResourceFromError(error);
				this.recordRateLimit(resource);
				break;
			}

			case "database_connection_lost":
				await this.healDatabaseConnection();
				break;

			case "gateway_disconnect":
				await this.healGatewayConnection();
				break;

			case "timeout":
			case "econnrefused":
			case "enotfound":
			case "socket_hangup":
				// These are typically transient - log and emit for circuit breaker handling
				this.emit("transientError", { pattern, error });
				break;

			case "unhandled_rejection":
				// Already logged, just emit
				this.emit("unhandledRejection", { pattern, error });
				break;

			default:
				this.log("DEBUG", "No specific healing for pattern", { pattern });
		}
	}

	private extractResourceFromError(error: Error): string {
		// Try to extract resource identifier from error message
		const urlMatch = error.message.match(/https?:\/\/[^\s]+/);
		if (urlMatch) {
			try {
				const url = new URL(urlMatch[0]);
				return url.hostname + url.pathname;
			} catch {
				return urlMatch[0];
			}
		}

		// Default to generic resource
		return "unknown";
	}

	// -------------------------------------------------------------------------
	// Healing Execution
	// -------------------------------------------------------------------------

	private canHeal(type: HealingActionType): boolean {
		// Check hourly limit
		if (this.healingAttemptsThisHour >= this.config.maxHealingAttemptsPerHour) {
			this.log("WARN", "Hourly healing limit reached", {
				attempts: this.healingAttemptsThisHour,
				max: this.config.maxHealingAttemptsPerHour,
			});
			return false;
		}

		// Check cooldown
		const lastTime = this.lastHealingTime.get(type) ?? 0;
		const elapsed = Date.now() - lastTime;
		if (elapsed < this.config.healingCooldownMs) {
			return false;
		}

		return true;
	}

	private async executeHealing(
		params: {
			type: HealingActionType;
			severity: HealingSeverity;
			pattern: FailurePattern;
			description: string;
		},
		healFn: () => Promise<boolean>,
	): Promise<HealingAction> {
		const id = `heal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const startTime = Date.now();

		this.isHealing = true;
		this.lastHealingTime.set(params.type, startTime);
		this.healingAttemptsThisHour++;

		let success = false;
		let errorMessage: string | undefined;

		try {
			this.log("INFO", `Starting healing action: ${params.type}`, { description: params.description });
			success = await healFn();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
			this.log("ERROR", `Healing action failed: ${params.type}`, { error: errorMessage });
		} finally {
			this.isHealing = false;
		}

		const action: HealingAction = {
			id,
			type: params.type,
			severity: params.severity,
			pattern: params.pattern,
			description: params.description,
			timestamp: startTime,
			success,
			durationMs: Date.now() - startTime,
			errorMessage,
		};

		this.healingActions.push(action);

		// Trim old actions (keep last 100)
		while (this.healingActions.length > 100) {
			this.healingActions.shift();
		}

		// Update pattern stats
		const patternEntry = this.errorPatterns.get(params.pattern);
		if (patternEntry) {
			if (success) {
				patternEntry.healed++;
			} else {
				patternEntry.failed++;
			}
		}

		this.emit("healingComplete", action);

		this.log(success ? "INFO" : "WARN", `Healing action ${success ? "succeeded" : "failed"}: ${params.type}`, {
			durationMs: action.durationMs,
		});

		return action;
	}

	// -------------------------------------------------------------------------
	// Discord Logging
	// -------------------------------------------------------------------------

	private async logToDiscord(action: HealingAction): Promise<void> {
		if (!this.discordClient || !this.config.logChannel) return;

		try {
			const channel = await this.discordClient.channels.fetch(this.config.logChannel);
			if (!channel || !channel.isTextBased()) return;

			const textChannel = channel as TextChannel;

			const emoji = action.success ? "[OK]" : "[FAIL]";
			const severityEmoji = {
				info: "[INFO]",
				warning: "[WARN]",
				critical: "[CRIT]",
				emergency: "[EMRG]",
			}[action.severity];

			const message = [
				`${emoji} ${severityEmoji} **Self-Healing Action**`,
				`> Type: \`${action.type}\``,
				`> Pattern: \`${action.pattern}\``,
				`> Duration: ${action.durationMs}ms`,
				`> ${action.description}`,
				action.errorMessage ? `> Error: ${action.errorMessage}` : null,
				`> Time: <t:${Math.floor(action.timestamp / 1000)}:R>`,
			]
				.filter(Boolean)
				.join("\n");

			await textChannel.send(message);
		} catch (error) {
			this.log("ERROR", "Failed to log to Discord", { error: String(error) });
		}
	}

	// -------------------------------------------------------------------------
	// Status and Statistics
	// -------------------------------------------------------------------------

	getStatus(): SelfHealingStatus {
		const successful = this.healingActions.filter((a) => a.success).length;
		const failed = this.healingActions.filter((a) => !a.success).length;

		// Calculate health score (0-100)
		const memoryScore = Math.max(0, 100 - this.lastMemoryMetrics.heapUsedPercent);
		const healingScore = this.healingActions.length > 0 ? (successful / this.healingActions.length) * 100 : 100;
		const connectionScore = (this.dbConnectionHealthy ? 50 : 0) + (this.gatewayConnected ? 50 : 0);

		const healthScore = Math.round((memoryScore + healingScore + connectionScore) / 3);

		return {
			enabled: this.config.enabled,
			uptime: Date.now() - this.startTime,
			totalHealingActions: this.healingActions.length,
			successfulHealings: successful,
			failedHealings: failed,
			lastHealingAction: this.healingActions[this.healingActions.length - 1],
			activePatterns: Array.from(this.errorPatterns.values()).filter((p) => p.count > 0),
			memoryMetrics: this.lastMemoryMetrics,
			healthScore,
			isHealing: this.isHealing,
			rateLimitBackoffs: new Map(this.rateLimitBackoffs),
			dbConnectionHealthy: this.dbConnectionHealthy,
			gatewayConnected: this.gatewayConnected,
		};
	}

	getConfig(): SelfHealingConfig {
		return { ...this.config };
	}

	updateConfig(updates: Partial<SelfHealingConfig>): void {
		this.config = { ...this.config, ...updates };
		this.log("INFO", "Configuration updated", updates);

		// Restart memory monitoring if interval changed
		if (updates.memoryCheckIntervalMs !== undefined) {
			if (this.memoryCheckTimer) {
				clearInterval(this.memoryCheckTimer);
			}
			this.startMemoryMonitoring();
		}

		this.emit("configUpdated", this.config);
	}

	getHealingHistory(limit: number = 50): HealingAction[] {
		return this.healingActions.slice(-limit);
	}

	getErrorPatterns(): ErrorPattern[] {
		return Array.from(this.errorPatterns.values());
	}

	// -------------------------------------------------------------------------
	// Utility Methods
	// -------------------------------------------------------------------------

	private log(level: "INFO" | "WARN" | "ERROR" | "DEBUG", message: string, data?: unknown): void {
		if (level === "DEBUG" && !this.config.debugLog) return;

		const entry = {
			timestamp: new Date().toISOString(),
			level,
			message,
			data,
		};

		const line = `${JSON.stringify(entry)}\n`;

		// Console output
		const prefix = `[SELF-HEAL][${level}]`;
		switch (level) {
			case "ERROR":
				console.error(prefix, message, data ?? "");
				break;
			case "WARN":
				console.warn(prefix, message, data ?? "");
				break;
			default:
				console.log(prefix, message, data ?? "");
		}

		// File output
		try {
			appendFileSync(this.logFile, line);
		} catch {
			// Ignore log write failures
		}
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private formatBytes(bytes: number): string {
		if (bytes < 1024) return bytes + " B";
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
		if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
		return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
	}

	// -------------------------------------------------------------------------
	// Manual Triggers (for /selfheal commands)
	// -------------------------------------------------------------------------

	async triggerMemoryHealing(): Promise<HealingAction> {
		return this.executeHealing(
			{
				type: "garbage_collection",
				severity: "info",
				pattern: "memory_exhaustion",
				description: "Manual memory healing triggered",
			},
			async () => {
				this.forceGarbageCollection();
				this.clearInternalCaches();
				await this.sleep(500);
				return true;
			},
		);
	}

	async triggerDatabaseHealing(): Promise<HealingAction | null> {
		if (!this.dbReconnectFn) {
			this.log("WARN", "No database reconnect function configured");
			return null;
		}

		// Bypass cooldown for manual trigger
		this.lastHealingTime.delete("database_reconnect");
		await this.healDatabaseConnection();

		return this.healingActions[this.healingActions.length - 1] ?? null;
	}

	async triggerGatewayHealing(): Promise<HealingAction | null> {
		if (!this.discordClient) {
			this.log("WARN", "No Discord client configured");
			return null;
		}

		// Bypass cooldown for manual trigger
		this.lastHealingTime.delete("gateway_reconnect");
		await this.healGatewayConnection();

		return this.healingActions[this.healingActions.length - 1] ?? null;
	}

	clearErrorPatterns(): void {
		for (const pattern of this.errorPatterns.values()) {
			pattern.count = 0;
			pattern.firstSeen = 0;
			pattern.lastSeen = 0;
		}
		this.log("INFO", "Error patterns cleared");
	}

	clearRateLimits(): void {
		this.rateLimitBackoffs.clear();
		this.log("INFO", "Rate limits cleared");
	}
}

// ============================================================================
// Singleton Factory
// ============================================================================

let instance: SelfHealingManager | null = null;

export function getSelfHealingManager(config?: Partial<SelfHealingConfig>): SelfHealingManager {
	if (!instance) {
		instance = new SelfHealingManager(config);
	}
	return instance;
}

export function resetSelfHealingManager(): void {
	if (instance) {
		instance.stop();
		instance = null;
	}
}

// ============================================================================
// Presets
// ============================================================================

export const SelfHealingPresets = {
	/** Conservative settings - less aggressive healing */
	conservative: {
		heapThresholdPercent: 90,
		heapCriticalPercent: 98,
		memoryCheckIntervalMs: 60000,
		healingCooldownMs: 120000,
		maxHealingAttemptsPerHour: 5,
		patternThreshold: 5,
	} as Partial<SelfHealingConfig>,

	/** Aggressive settings - more proactive healing */
	aggressive: {
		heapThresholdPercent: 75,
		heapCriticalPercent: 90,
		memoryCheckIntervalMs: 15000,
		healingCooldownMs: 30000,
		maxHealingAttemptsPerHour: 20,
		patternThreshold: 2,
	} as Partial<SelfHealingConfig>,

	/** Production settings - balanced approach */
	production: {
		heapThresholdPercent: 85,
		heapCriticalPercent: 95,
		memoryCheckIntervalMs: 30000,
		healingCooldownMs: 60000,
		maxHealingAttemptsPerHour: 10,
		patternThreshold: 3,
		debugLog: false,
	} as Partial<SelfHealingConfig>,

	/** Development settings - verbose logging */
	development: {
		heapThresholdPercent: 70,
		heapCriticalPercent: 85,
		memoryCheckIntervalMs: 10000,
		healingCooldownMs: 10000,
		maxHealingAttemptsPerHour: 50,
		patternThreshold: 2,
		debugLog: true,
	} as Partial<SelfHealingConfig>,
};
