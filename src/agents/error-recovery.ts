/**
 * Class 3.39: Error Recovery System
 * TAC Pattern: Automatic error handling, retry logic, and recovery strategies
 *
 * Features:
 * - Retry with exponential backoff
 * - Error classification by type and severity
 * - Recovery strategies (retry/skip/fallback/abort)
 * - Circuit breaker integration
 * - Error history tracking and analysis
 * - Automatic recovery triggers
 */

import { EventEmitter } from "events";

// ============================================================================
// Types
// ============================================================================

export type ErrorSeverity = "low" | "medium" | "high" | "critical";

export type ErrorCategory =
	| "network"
	| "timeout"
	| "validation"
	| "authentication"
	| "authorization"
	| "rate_limit"
	| "resource"
	| "dependency"
	| "internal"
	| "unknown";

export type RecoveryStrategy = "retry" | "skip" | "fallback" | "abort";

export type CircuitState = "closed" | "open" | "half_open";

export interface ErrorClassification {
	category: ErrorCategory;
	severity: ErrorSeverity;
	retryable: boolean;
	suggestedStrategy: RecoveryStrategy;
}

export interface ErrorRecord {
	id: string;
	operationId: string;
	componentId: string;
	error: Error;
	classification: ErrorClassification;
	context: Record<string, unknown>;
	attemptNumber: number;
	timestamp: number;
	recovered: boolean;
	recoveryStrategy?: RecoveryStrategy;
	recoveryResult?: "success" | "failure";
}

export interface RetryConfig {
	maxAttempts: number;
	initialDelayMs: number;
	maxDelayMs: number;
	backoffMultiplier: number;
	jitterEnabled: boolean;
	jitterFactor: number;
	retryableErrors: ErrorCategory[];
}

export interface CircuitBreakerConfig {
	failureThreshold: number;
	successThreshold: number;
	timeout: number;
	halfOpenMaxAttempts: number;
}

export interface CircuitBreaker {
	id: string;
	componentId: string;
	state: CircuitState;
	failureCount: number;
	successCount: number;
	lastFailureAt?: number;
	lastSuccessAt?: number;
	openedAt?: number;
	halfOpenAttempts: number;
}

export interface RecoveryResult<T> {
	success: boolean;
	value?: T;
	error?: Error;
	attempts: number;
	totalTimeMs: number;
	strategy: RecoveryStrategy;
	recovered: boolean;
}

export interface FallbackHandler<T> {
	id: string;
	priority: number;
	condition?: (error: Error, context: Record<string, unknown>) => boolean;
	handler: (error: Error, context: Record<string, unknown>) => Promise<T> | T;
}

export interface ErrorStats {
	totalErrors: number;
	errorsLast24h: number;
	errorsLast1h: number;
	byCategory: Record<string, number>;
	bySeverity: Record<string, number>;
	byComponent: Record<string, number>;
	recoveryRate: number;
	avgRetryAttempts: number;
	circuitBreakersTripped: number;
}

export interface ErrorRecoveryConfig {
	defaultRetry: RetryConfig;
	defaultCircuitBreaker: CircuitBreakerConfig;
	errorHistoryLimit: number;
	errorHistoryRetentionMs: number;
	enableCircuitBreakers: boolean;
	enableAutoClassification: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxAttempts: 3,
	initialDelayMs: 1000,
	maxDelayMs: 30000,
	backoffMultiplier: 2,
	jitterEnabled: true,
	jitterFactor: 0.1,
	retryableErrors: ["network", "timeout", "rate_limit", "dependency"],
};

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
	failureThreshold: 5,
	successThreshold: 3,
	timeout: 60000,
	halfOpenMaxAttempts: 3,
};

const DEFAULT_CONFIG: ErrorRecoveryConfig = {
	defaultRetry: DEFAULT_RETRY_CONFIG,
	defaultCircuitBreaker: DEFAULT_CIRCUIT_BREAKER_CONFIG,
	errorHistoryLimit: 1000,
	errorHistoryRetentionMs: 24 * 60 * 60 * 1000, // 24 hours
	enableCircuitBreakers: true,
	enableAutoClassification: true,
};

// ============================================================================
// Error Patterns for Classification
// ============================================================================

const ERROR_PATTERNS: Array<{
	pattern: RegExp;
	category: ErrorCategory;
	severity: ErrorSeverity;
	retryable: boolean;
}> = [
	// Network errors
	{
		pattern: /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT/i,
		category: "network",
		severity: "medium",
		retryable: true,
	},
	{ pattern: /network|socket|connection/i, category: "network", severity: "medium", retryable: true },
	{ pattern: /fetch failed|request failed/i, category: "network", severity: "medium", retryable: true },

	// Timeout errors
	{ pattern: /timeout|timed out|deadline exceeded/i, category: "timeout", severity: "medium", retryable: true },

	// Rate limiting
	{ pattern: /rate limit|too many requests|429/i, category: "rate_limit", severity: "low", retryable: true },
	{ pattern: /throttl|quota exceeded/i, category: "rate_limit", severity: "low", retryable: true },

	// Authentication
	{
		pattern: /unauthorized|401|invalid token|expired token/i,
		category: "authentication",
		severity: "high",
		retryable: false,
	},
	{ pattern: /auth.*fail|invalid credentials/i, category: "authentication", severity: "high", retryable: false },

	// Authorization
	{
		pattern: /forbidden|403|permission denied|access denied/i,
		category: "authorization",
		severity: "high",
		retryable: false,
	},

	// Validation
	{
		pattern: /validation|invalid|malformed|bad request|400/i,
		category: "validation",
		severity: "low",
		retryable: false,
	},
	{ pattern: /schema|type error|parse error/i, category: "validation", severity: "low", retryable: false },

	// Resource errors
	{ pattern: /not found|404|does not exist|no such/i, category: "resource", severity: "medium", retryable: false },
	{ pattern: /already exists|conflict|409/i, category: "resource", severity: "low", retryable: false },

	// Dependency errors
	{ pattern: /service unavailable|503|bad gateway|502/i, category: "dependency", severity: "high", retryable: true },
	{ pattern: /upstream|downstream|external service/i, category: "dependency", severity: "high", retryable: true },

	// Internal errors
	{ pattern: /internal|500|server error/i, category: "internal", severity: "high", retryable: true },
];

// ============================================================================
// Error Recovery System
// ============================================================================

export class ErrorRecoverySystem extends EventEmitter {
	private config: ErrorRecoveryConfig;
	private errorHistory: ErrorRecord[] = [];
	private circuitBreakers: Map<string, CircuitBreaker> = new Map();
	private fallbackHandlers: Map<string, FallbackHandler<unknown>[]> = new Map();
	private cleanupTimer?: NodeJS.Timeout;

	constructor(config: Partial<ErrorRecoveryConfig> = {}) {
		super();
		this.config = {
			...DEFAULT_CONFIG,
			...config,
			defaultRetry: { ...DEFAULT_RETRY_CONFIG, ...config.defaultRetry },
			defaultCircuitBreaker: { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config.defaultCircuitBreaker },
		};

		// Start cleanup timer
		this.cleanupTimer = setInterval(
			() => {
				this.cleanupErrorHistory();
			},
			60 * 60 * 1000,
		); // Every hour
	}

	// ============================================================================
	// Error Classification
	// ============================================================================

	/**
	 * Classify an error by analyzing its message and properties
	 */
	classifyError(error: Error): ErrorClassification {
		const errorString = `${error.name} ${error.message} ${(error as NodeJS.ErrnoException).code ?? ""}`;

		// Check against known patterns
		for (const pattern of ERROR_PATTERNS) {
			if (pattern.pattern.test(errorString)) {
				return {
					category: pattern.category,
					severity: pattern.severity,
					retryable: pattern.retryable,
					suggestedStrategy: pattern.retryable ? "retry" : "abort",
				};
			}
		}

		// Default classification for unknown errors
		return {
			category: "unknown",
			severity: "medium",
			retryable: false,
			suggestedStrategy: "abort",
		};
	}

	/**
	 * Manually classify an error with specific category
	 */
	classifyAs(category: ErrorCategory, severity?: ErrorSeverity, retryable?: boolean): ErrorClassification {
		const defaultRetryable = ["network", "timeout", "rate_limit", "dependency"].includes(category);

		return {
			category,
			severity: severity ?? "medium",
			retryable: retryable ?? defaultRetryable,
			suggestedStrategy: (retryable ?? defaultRetryable) ? "retry" : "abort",
		};
	}

	// ============================================================================
	// Retry Logic
	// ============================================================================

	/**
	 * Execute an operation with automatic retry logic
	 */
	async withRetry<T>(
		operation: () => Promise<T>,
		options: {
			operationId?: string;
			componentId?: string;
			retryConfig?: Partial<RetryConfig>;
			context?: Record<string, unknown>;
			onRetry?: (attempt: number, error: Error, delayMs: number) => void;
		} = {},
	): Promise<RecoveryResult<T>> {
		const operationId = options.operationId ?? `op-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const componentId = options.componentId ?? "default";
		const retryConfig = { ...this.config.defaultRetry, ...options.retryConfig };
		const context = options.context ?? {};

		const startTime = Date.now();
		let lastError: Error | undefined;
		let attempts = 0;

		// Check circuit breaker first
		if (this.config.enableCircuitBreakers) {
			const circuitState = this.getCircuitState(componentId);
			if (circuitState === "open") {
				return {
					success: false,
					error: new Error(`Circuit breaker open for component: ${componentId}`),
					attempts: 0,
					totalTimeMs: 0,
					strategy: "abort",
					recovered: false,
				};
			}
		}

		for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
			attempts = attempt;

			try {
				const result = await operation();

				// Record success for circuit breaker
				if (this.config.enableCircuitBreakers) {
					this.recordSuccess(componentId);
				}

				return {
					success: true,
					value: result,
					attempts,
					totalTimeMs: Date.now() - startTime,
					strategy: attempt > 1 ? "retry" : "retry",
					recovered: attempt > 1,
				};
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				const classification = this.classifyError(lastError);

				// Record error
				this.recordError({
					operationId,
					componentId,
					error: lastError,
					classification,
					context,
					attemptNumber: attempt,
				});

				// Check if error is retryable
				if (!classification.retryable || !retryConfig.retryableErrors.includes(classification.category)) {
					break;
				}

				// Last attempt - don't wait
				if (attempt === retryConfig.maxAttempts) {
					break;
				}

				// Calculate delay with exponential backoff
				let delayMs = retryConfig.initialDelayMs * retryConfig.backoffMultiplier ** (attempt - 1);
				delayMs = Math.min(delayMs, retryConfig.maxDelayMs);

				// Add jitter if enabled
				if (retryConfig.jitterEnabled) {
					const jitter = delayMs * retryConfig.jitterFactor * (Math.random() * 2 - 1);
					delayMs = Math.max(0, delayMs + jitter);
				}

				// Notify about retry
				if (options.onRetry) {
					options.onRetry(attempt, lastError, delayMs);
				}

				this.emit("retry", {
					operationId,
					componentId,
					attempt,
					error: lastError,
					delayMs,
				});

				// Wait before retry
				await this.delay(delayMs);
			}
		}

		// All retries failed
		if (this.config.enableCircuitBreakers) {
			this.recordFailure(componentId);
		}

		return {
			success: false,
			error: lastError,
			attempts,
			totalTimeMs: Date.now() - startTime,
			strategy: "retry",
			recovered: false,
		};
	}

	/**
	 * Execute with retry and fallback
	 */
	async withRetryAndFallback<T>(
		operation: () => Promise<T>,
		fallback: () => Promise<T> | T,
		options: {
			operationId?: string;
			componentId?: string;
			retryConfig?: Partial<RetryConfig>;
			context?: Record<string, unknown>;
		} = {},
	): Promise<RecoveryResult<T>> {
		const result = await this.withRetry(operation, options);

		if (result.success) {
			return result;
		}

		// Try fallback
		try {
			const fallbackResult = await fallback();
			return {
				success: true,
				value: fallbackResult,
				attempts: result.attempts,
				totalTimeMs: result.totalTimeMs + (Date.now() - Date.now()),
				strategy: "fallback",
				recovered: true,
			};
		} catch (fallbackError) {
			return {
				success: false,
				error: fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)),
				attempts: result.attempts,
				totalTimeMs: result.totalTimeMs,
				strategy: "fallback",
				recovered: false,
			};
		}
	}

	// ============================================================================
	// Circuit Breaker
	// ============================================================================

	/**
	 * Get or create circuit breaker for a component
	 */
	getOrCreateCircuitBreaker(componentId: string): CircuitBreaker {
		let breaker = this.circuitBreakers.get(componentId);

		if (!breaker) {
			breaker = {
				id: `cb-${componentId}`,
				componentId,
				state: "closed",
				failureCount: 0,
				successCount: 0,
				halfOpenAttempts: 0,
			};
			this.circuitBreakers.set(componentId, breaker);
		}

		return breaker;
	}

	/**
	 * Get circuit state for a component
	 */
	getCircuitState(componentId: string): CircuitState {
		const breaker = this.circuitBreakers.get(componentId);
		if (!breaker) return "closed";

		// Check if timeout has passed for open circuit
		if (breaker.state === "open" && breaker.openedAt) {
			const elapsed = Date.now() - breaker.openedAt;
			if (elapsed >= this.config.defaultCircuitBreaker.timeout) {
				breaker.state = "half_open";
				breaker.halfOpenAttempts = 0;
				this.emit("circuit:half_open", { componentId });
			}
		}

		return breaker.state;
	}

	/**
	 * Record a successful operation for circuit breaker
	 */
	recordSuccess(componentId: string): void {
		const breaker = this.getOrCreateCircuitBreaker(componentId);
		breaker.lastSuccessAt = Date.now();
		breaker.successCount++;

		if (breaker.state === "half_open") {
			breaker.halfOpenAttempts++;

			if (breaker.halfOpenAttempts >= this.config.defaultCircuitBreaker.successThreshold) {
				breaker.state = "closed";
				breaker.failureCount = 0;
				breaker.halfOpenAttempts = 0;
				this.emit("circuit:closed", { componentId });
			}
		} else if (breaker.state === "closed") {
			// Reset failure count on success
			breaker.failureCount = 0;
		}
	}

	/**
	 * Record a failed operation for circuit breaker
	 */
	recordFailure(componentId: string): void {
		const breaker = this.getOrCreateCircuitBreaker(componentId);
		breaker.lastFailureAt = Date.now();
		breaker.failureCount++;

		if (breaker.state === "half_open") {
			// Any failure in half-open immediately opens circuit
			breaker.state = "open";
			breaker.openedAt = Date.now();
			this.emit("circuit:open", { componentId, reason: "half_open_failure" });
		} else if (breaker.state === "closed") {
			if (breaker.failureCount >= this.config.defaultCircuitBreaker.failureThreshold) {
				breaker.state = "open";
				breaker.openedAt = Date.now();
				this.emit("circuit:open", { componentId, reason: "threshold_exceeded" });
			}
		}
	}

	/**
	 * Manually reset a circuit breaker
	 */
	resetCircuitBreaker(componentId: string): void {
		const breaker = this.circuitBreakers.get(componentId);
		if (breaker) {
			breaker.state = "closed";
			breaker.failureCount = 0;
			breaker.successCount = 0;
			breaker.halfOpenAttempts = 0;
			breaker.openedAt = undefined;
			this.emit("circuit:reset", { componentId });
		}
	}

	/**
	 * Get all circuit breaker states
	 */
	getCircuitBreakers(): CircuitBreaker[] {
		return Array.from(this.circuitBreakers.values());
	}

	// ============================================================================
	// Fallback Handlers
	// ============================================================================

	/**
	 * Register a fallback handler for a component
	 */
	registerFallback<T>(componentId: string, handler: FallbackHandler<T>): void {
		if (!this.fallbackHandlers.has(componentId)) {
			this.fallbackHandlers.set(componentId, []);
		}

		const handlers = this.fallbackHandlers.get(componentId)!;
		handlers.push(handler as FallbackHandler<unknown>);
		handlers.sort((a, b) => a.priority - b.priority);
	}

	/**
	 * Execute fallback handlers for a component
	 */
	async executeFallbacks<T>(
		componentId: string,
		error: Error,
		context: Record<string, unknown>,
	): Promise<{ success: boolean; value?: T; handlerId?: string }> {
		const handlers = this.fallbackHandlers.get(componentId);
		if (!handlers || handlers.length === 0) {
			return { success: false };
		}

		for (const handler of handlers) {
			// Check condition if specified
			if (handler.condition && !handler.condition(error, context)) {
				continue;
			}

			try {
				const result = await handler.handler(error, context);
				return {
					success: true,
					value: result as T,
					handlerId: handler.id,
				};
			} catch {}
		}

		return { success: false };
	}

	// ============================================================================
	// Error Recording and History
	// ============================================================================

	/**
	 * Record an error in history
	 */
	private recordError(params: {
		operationId: string;
		componentId: string;
		error: Error;
		classification: ErrorClassification;
		context: Record<string, unknown>;
		attemptNumber: number;
	}): ErrorRecord {
		const record: ErrorRecord = {
			id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			operationId: params.operationId,
			componentId: params.componentId,
			error: params.error,
			classification: params.classification,
			context: params.context,
			attemptNumber: params.attemptNumber,
			timestamp: Date.now(),
			recovered: false,
		};

		this.errorHistory.push(record);

		// Trim history if needed
		if (this.errorHistory.length > this.config.errorHistoryLimit) {
			this.errorHistory = this.errorHistory.slice(-this.config.errorHistoryLimit);
		}

		this.emit("error:recorded", { record });
		return record;
	}

	/**
	 * Mark an error as recovered
	 */
	markRecovered(errorId: string, strategy: RecoveryStrategy, result: "success" | "failure"): void {
		const record = this.errorHistory.find((e) => e.id === errorId);
		if (record) {
			record.recovered = result === "success";
			record.recoveryStrategy = strategy;
			record.recoveryResult = result;
			this.emit("error:recovered", { record });
		}
	}

	/**
	 * Get error history
	 */
	getErrorHistory(
		params: {
			componentId?: string;
			category?: ErrorCategory;
			severity?: ErrorSeverity;
			since?: number;
			limit?: number;
		} = {},
	): ErrorRecord[] {
		let records = [...this.errorHistory];

		if (params.componentId) {
			records = records.filter((r) => r.componentId === params.componentId);
		}

		if (params.category) {
			records = records.filter((r) => r.classification.category === params.category);
		}

		if (params.severity) {
			records = records.filter((r) => r.classification.severity === params.severity);
		}

		if (params.since) {
			const since = params.since;
			records = records.filter((r) => r.timestamp >= since);
		}

		records.sort((a, b) => b.timestamp - a.timestamp);

		if (params.limit) {
			records = records.slice(0, params.limit);
		}

		return records;
	}

	/**
	 * Clean up old error history
	 */
	private cleanupErrorHistory(): void {
		const cutoff = Date.now() - this.config.errorHistoryRetentionMs;
		const before = this.errorHistory.length;
		this.errorHistory = this.errorHistory.filter((r) => r.timestamp >= cutoff);
		const removed = before - this.errorHistory.length;

		if (removed > 0) {
			this.emit("cleanup:completed", { removed });
		}
	}

	// ============================================================================
	// Statistics
	// ============================================================================

	/**
	 * Get error statistics
	 */
	getStats(): ErrorStats {
		const now = Date.now();
		const last24h = now - 24 * 60 * 60 * 1000;
		const last1h = now - 60 * 60 * 1000;

		const all = this.errorHistory;
		const recent24h = all.filter((e) => e.timestamp >= last24h);
		const recent1h = all.filter((e) => e.timestamp >= last1h);

		const byCategory: Record<string, number> = {};
		const bySeverity: Record<string, number> = {};
		const byComponent: Record<string, number> = {};
		let totalRetryAttempts = 0;
		let recoveredCount = 0;

		for (const record of all) {
			byCategory[record.classification.category] = (byCategory[record.classification.category] ?? 0) + 1;
			bySeverity[record.classification.severity] = (bySeverity[record.classification.severity] ?? 0) + 1;
			byComponent[record.componentId] = (byComponent[record.componentId] ?? 0) + 1;
			totalRetryAttempts += record.attemptNumber;
			if (record.recovered) recoveredCount++;
		}

		const trippedBreakers = Array.from(this.circuitBreakers.values()).filter((b) => b.state === "open").length;

		return {
			totalErrors: all.length,
			errorsLast24h: recent24h.length,
			errorsLast1h: recent1h.length,
			byCategory,
			bySeverity,
			byComponent,
			recoveryRate: all.length > 0 ? (recoveredCount / all.length) * 100 : 0,
			avgRetryAttempts: all.length > 0 ? totalRetryAttempts / all.length : 0,
			circuitBreakersTripped: trippedBreakers,
		};
	}

	// ============================================================================
	// Recovery Strategies
	// ============================================================================

	/**
	 * Execute recovery based on classification
	 */
	async executeRecovery<T>(
		error: Error,
		params: {
			operationId?: string;
			componentId?: string;
			operation?: () => Promise<T>;
			fallback?: () => Promise<T> | T;
			skip?: () => T;
			context?: Record<string, unknown>;
		},
	): Promise<RecoveryResult<T>> {
		const classification = this.classifyError(error);
		const strategy = classification.suggestedStrategy;
		const componentId = params.componentId ?? "default";
		const startTime = Date.now();

		switch (strategy) {
			case "retry":
				if (params.operation) {
					return this.withRetry(params.operation, {
						operationId: params.operationId,
						componentId,
						context: params.context,
					});
				}
				break;

			case "fallback":
				if (params.fallback) {
					try {
						const result = await params.fallback();
						return {
							success: true,
							value: result,
							attempts: 1,
							totalTimeMs: Date.now() - startTime,
							strategy: "fallback",
							recovered: true,
						};
					} catch (fallbackError) {
						return {
							success: false,
							error: fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)),
							attempts: 1,
							totalTimeMs: Date.now() - startTime,
							strategy: "fallback",
							recovered: false,
						};
					}
				}
				break;

			case "skip":
				if (params.skip) {
					const result = params.skip();
					return {
						success: true,
						value: result,
						attempts: 0,
						totalTimeMs: Date.now() - startTime,
						strategy: "skip",
						recovered: true,
					};
				}
				break;
			default:
				break;
		}

		return {
			success: false,
			error,
			attempts: 0,
			totalTimeMs: Date.now() - startTime,
			strategy: "abort",
			recovered: false,
		};
	}

	// ============================================================================
	// Utility Methods
	// ============================================================================

	/**
	 * Delay execution
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Calculate delay for a specific retry attempt
	 */
	calculateDelay(attempt: number, config: Partial<RetryConfig> = {}): number {
		const retryConfig = { ...this.config.defaultRetry, ...config };
		let delayMs = retryConfig.initialDelayMs * retryConfig.backoffMultiplier ** (attempt - 1);
		delayMs = Math.min(delayMs, retryConfig.maxDelayMs);

		if (retryConfig.jitterEnabled) {
			const jitter = delayMs * retryConfig.jitterFactor * (Math.random() * 2 - 1);
			delayMs = Math.max(0, delayMs + jitter);
		}

		return Math.round(delayMs);
	}

	/**
	 * Check if an error is retryable
	 */
	isRetryable(error: Error): boolean {
		const classification = this.classifyError(error);
		return classification.retryable && this.config.defaultRetry.retryableErrors.includes(classification.category);
	}

	/**
	 * Wrap an async function with error recovery
	 */
	wrap<T, Args extends unknown[]>(
		fn: (...args: Args) => Promise<T>,
		options: {
			componentId?: string;
			retryConfig?: Partial<RetryConfig>;
			fallback?: (...args: Args) => Promise<T> | T;
		} = {},
	): (...args: Args) => Promise<RecoveryResult<T>> {
		return async (...args: Args): Promise<RecoveryResult<T>> => {
			if (options.fallback) {
				return this.withRetryAndFallback(
					() => fn(...args),
					() => options.fallback!(...args),
					{
						componentId: options.componentId,
						retryConfig: options.retryConfig,
					},
				);
			}

			return this.withRetry(() => fn(...args), {
				componentId: options.componentId,
				retryConfig: options.retryConfig,
			});
		};
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	/**
	 * Close the error recovery system
	 */
	close(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = undefined;
		}

		this.errorHistory = [];
		this.circuitBreakers.clear();
		this.fallbackHandlers.clear();

		this.emit("system:closed");
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

let instance: ErrorRecoverySystem | null = null;

export function getErrorRecovery(config?: Partial<ErrorRecoveryConfig>): ErrorRecoverySystem {
	if (!instance) {
		instance = new ErrorRecoverySystem(config);
	}
	return instance;
}

export function resetErrorRecovery(): void {
	if (instance) {
		instance.close();
		instance = null;
	}
}
