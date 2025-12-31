/**
 * Class 3.50: Saga Orchestrator
 * TAC Pattern: Distributed transaction coordination with compensations
 *
 * Features:
 * - Saga definition with steps and compensations
 * - Step execution with automatic rollback on failure
 * - Compensation on failure (backward recovery)
 * - Timeout handling per step and saga-wide
 * - Saga state persistence to SQLite
 * - Parallel step execution support
 * - Configurable retry policies per step
 * - Saga history and audit trail
 */

import Database from "better-sqlite3";
import { EventEmitter } from "events";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export type SagaStatus = "pending" | "running" | "completed" | "failed" | "compensating" | "compensated" | "aborted";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "compensating" | "compensated";

export interface RetryPolicy {
	maxRetries: number;
	initialDelayMs: number;
	maxDelayMs: number;
	backoffMultiplier: number;
	retryableErrors?: string[]; // Error messages or patterns that trigger retry
}

export interface StepDefinition<TContext = Record<string, unknown>> {
	id: string;
	name: string;
	description?: string;
	execute: (context: TContext, sagaId: string) => Promise<unknown>;
	compensate?: (context: TContext, sagaId: string, stepResult: unknown) => Promise<void>;
	timeoutMs?: number;
	retryPolicy?: RetryPolicy;
	dependsOn?: string[]; // Step IDs this step depends on
	parallel?: boolean; // Can run in parallel with other parallel steps
	optional?: boolean; // If true, failure doesn't trigger compensation
}

export interface StepExecution {
	stepId: string;
	status: StepStatus;
	startedAt?: Date;
	completedAt?: Date;
	result?: unknown;
	error?: string;
	retryCount: number;
	compensationResult?: unknown;
	compensationError?: string;
}

export interface SagaDefinition<TContext = Record<string, unknown>> {
	id: string;
	name: string;
	description?: string;
	steps: StepDefinition<TContext>[];
	timeoutMs?: number;
	onStart?: (context: TContext, sagaId: string) => Promise<void>;
	onComplete?: (context: TContext, sagaId: string, results: Map<string, unknown>) => Promise<void>;
	onFail?: (context: TContext, sagaId: string, error: Error, failedStep: string) => Promise<void>;
	onCompensated?: (context: TContext, sagaId: string) => Promise<void>;
}

export interface SagaInstance<TContext = Record<string, unknown>> {
	id: string;
	definitionId: string;
	status: SagaStatus;
	context: TContext;
	steps: Map<string, StepExecution>;
	currentStep?: string;
	startedAt: Date;
	completedAt?: Date;
	error?: string;
	failedStep?: string;
	metadata?: Record<string, unknown>;
}

export interface SagaHistoryEntry {
	id: string;
	sagaId: string;
	stepId?: string;
	action:
		| "saga_started"
		| "step_started"
		| "step_completed"
		| "step_failed"
		| "step_retry"
		| "compensation_started"
		| "compensation_completed"
		| "compensation_failed"
		| "saga_completed"
		| "saga_failed"
		| "saga_aborted";
	timestamp: Date;
	details?: Record<string, unknown>;
}

export interface SagaQuery {
	status?: SagaStatus | SagaStatus[];
	definitionId?: string;
	startedAfter?: Date;
	startedBefore?: Date;
	limit?: number;
	offset?: number;
}

export interface SagaStats {
	totalSagas: number;
	byStatus: Record<SagaStatus, number>;
	byDefinition: Record<string, number>;
	avgCompletionTimeMs: number;
	failureRate: number;
	compensationRate: number;
}

export interface SagaOrchestratorConfig {
	dataDir: string;
	defaultTimeoutMs: number;
	defaultRetryPolicy: RetryPolicy;
	maxConcurrentSagas: number;
	historyRetentionDays: number;
	cleanupIntervalMs: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: SagaOrchestratorConfig = {
	dataDir: "./data",
	defaultTimeoutMs: 300000, // 5 minutes
	defaultRetryPolicy: {
		maxRetries: 3,
		initialDelayMs: 1000,
		maxDelayMs: 30000,
		backoffMultiplier: 2,
	},
	maxConcurrentSagas: 10,
	historyRetentionDays: 30,
	cleanupIntervalMs: 3600000, // 1 hour
};

// ============================================================================
// Saga Orchestrator
// ============================================================================

export class SagaOrchestrator extends EventEmitter {
	private db: Database.Database;
	private config: SagaOrchestratorConfig;
	private definitions: Map<string, SagaDefinition<any>> = new Map();
	private runningSagas: Map<string, SagaInstance<any>> = new Map();
	private cleanupInterval: NodeJS.Timeout | null = null;

	constructor(config: Partial<SagaOrchestratorConfig> = {}) {
		super();
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.db = new Database(join(this.config.dataDir, "saga_orchestrator.db"));
		this.initializeDatabase();
		this.startCleanupScheduler();
		this.loadRunningSagas();
	}

	private initializeDatabase(): void {
		this.db.pragma("journal_mode = WAL");

		// Saga definitions table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS saga_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        steps TEXT NOT NULL,
        timeout_ms INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

		// Saga instances table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS saga_instances (
        id TEXT PRIMARY KEY,
        definition_id TEXT NOT NULL,
        status TEXT NOT NULL,
        context TEXT NOT NULL,
        steps TEXT NOT NULL,
        current_step TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error TEXT,
        failed_step TEXT,
        metadata TEXT,
        FOREIGN KEY (definition_id) REFERENCES saga_definitions(id)
      )
    `);

		// Saga history table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS saga_history (
        id TEXT PRIMARY KEY,
        saga_id TEXT NOT NULL,
        step_id TEXT,
        action TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        details TEXT,
        FOREIGN KEY (saga_id) REFERENCES saga_instances(id)
      )
    `);

		// Indexes
		this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_saga_instances_status ON saga_instances(status);
      CREATE INDEX IF NOT EXISTS idx_saga_instances_definition ON saga_instances(definition_id);
      CREATE INDEX IF NOT EXISTS idx_saga_instances_started ON saga_instances(started_at);
      CREATE INDEX IF NOT EXISTS idx_saga_history_saga ON saga_history(saga_id);
      CREATE INDEX IF NOT EXISTS idx_saga_history_timestamp ON saga_history(timestamp);
    `);
	}

	private startCleanupScheduler(): void {
		this.cleanupInterval = setInterval(() => {
			this.cleanupOldHistory();
		}, this.config.cleanupIntervalMs);
	}

	private loadRunningSagas(): void {
		const stmt = this.db.prepare(`
      SELECT * FROM saga_instances
      WHERE status IN ('running', 'compensating')
    `);
		const rows = stmt.all() as Record<string, unknown>[];

		for (const row of rows) {
			const saga = this.deserializeSaga(row);
			this.runningSagas.set(saga.id, saga);
		}
	}

	// ============================================================================
	// Saga Definition Management
	// ============================================================================

	registerSaga<TContext = Record<string, unknown>>(definition: SagaDefinition<TContext>): void {
		// Validate steps
		this.validateSagaDefinition(definition);

		this.definitions.set(definition.id, definition);

		// Persist definition
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO saga_definitions
      (id, name, description, steps, timeout_ms, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

		const now = new Date().toISOString();
		stmt.run(
			definition.id,
			definition.name,
			definition.description ?? null,
			JSON.stringify(
				definition.steps.map((s) => ({
					id: s.id,
					name: s.name,
					description: s.description,
					timeoutMs: s.timeoutMs,
					retryPolicy: s.retryPolicy,
					dependsOn: s.dependsOn,
					parallel: s.parallel,
					optional: s.optional,
				})),
			),
			definition.timeoutMs ?? null,
			now,
			now,
		);

		this.emit("definition:registered", definition);
	}

	private validateSagaDefinition<TContext>(definition: SagaDefinition<TContext>): void {
		if (!definition.id || !definition.name || !definition.steps.length) {
			throw new Error("Invalid saga definition: id, name, and at least one step required");
		}

		const stepIds = new Set<string>();
		for (const step of definition.steps) {
			if (stepIds.has(step.id)) {
				throw new Error(`Duplicate step ID: ${step.id}`);
			}
			stepIds.add(step.id);

			// Validate dependencies exist
			if (step.dependsOn) {
				for (const depId of step.dependsOn) {
					if (!definition.steps.find((s) => s.id === depId)) {
						throw new Error(`Step ${step.id} depends on non-existent step: ${depId}`);
					}
				}
			}
		}

		// Check for circular dependencies
		this.detectCircularDependencies(definition.steps);
	}

	private detectCircularDependencies(steps: StepDefinition<any>[]): void {
		const visited = new Set<string>();
		const recursionStack = new Set<string>();

		const hasCycle = (stepId: string): boolean => {
			if (recursionStack.has(stepId)) return true;
			if (visited.has(stepId)) return false;

			visited.add(stepId);
			recursionStack.add(stepId);

			const step = steps.find((s) => s.id === stepId);
			if (step?.dependsOn) {
				for (const depId of step.dependsOn) {
					if (hasCycle(depId)) return true;
				}
			}

			recursionStack.delete(stepId);
			return false;
		};

		for (const step of steps) {
			if (hasCycle(step.id)) {
				throw new Error(`Circular dependency detected involving step: ${step.id}`);
			}
		}
	}

	getSagaDefinition(definitionId: string): SagaDefinition<any> | null {
		return this.definitions.get(definitionId) ?? null;
	}

	getAllDefinitions(): SagaDefinition<any>[] {
		return Array.from(this.definitions.values());
	}

	unregisterSaga(definitionId: string): boolean {
		const deleted = this.definitions.delete(definitionId);
		if (deleted) {
			this.emit("definition:unregistered", { definitionId });
		}
		return deleted;
	}

	// ============================================================================
	// Saga Execution
	// ============================================================================

	async execute<TContext = Record<string, unknown>>(
		definitionId: string,
		context: TContext,
		metadata?: Record<string, unknown>,
	): Promise<SagaInstance<TContext>> {
		const definition = this.definitions.get(definitionId);
		if (!definition) {
			throw new Error(`Saga definition not found: ${definitionId}`);
		}

		// Check concurrent saga limit
		if (this.runningSagas.size >= this.config.maxConcurrentSagas) {
			throw new Error(`Maximum concurrent sagas reached: ${this.config.maxConcurrentSagas}`);
		}

		// Create saga instance
		const sagaId = `saga_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const saga: SagaInstance<TContext> = {
			id: sagaId,
			definitionId,
			status: "pending",
			context: { ...context },
			steps: new Map(),
			startedAt: new Date(),
			metadata,
		};

		// Initialize step executions
		for (const stepDef of definition.steps) {
			saga.steps.set(stepDef.id, {
				stepId: stepDef.id,
				status: "pending",
				retryCount: 0,
			});
		}

		// Persist and track
		this.saveSaga(saga);
		this.runningSagas.set(sagaId, saga);
		this.recordHistory(sagaId, undefined, "saga_started", { definitionId, metadata });
		this.emit("saga:started", saga);

		// Execute saga
		try {
			saga.status = "running";
			this.saveSaga(saga);

			// Call onStart hook
			if (definition.onStart) {
				await definition.onStart(saga.context, sagaId);
			}

			// Execute steps
			const results = await this.executeSteps(saga, definition);

			// Success
			saga.status = "completed";
			saga.completedAt = new Date();
			this.saveSaga(saga);
			this.runningSagas.delete(sagaId);
			this.recordHistory(sagaId, undefined, "saga_completed", {
				durationMs: saga.completedAt.getTime() - saga.startedAt.getTime(),
			});

			// Call onComplete hook
			if (definition.onComplete) {
				await definition.onComplete(saga.context, sagaId, results);
			}

			this.emit("saga:completed", saga);
			return saga;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			saga.error = err.message;
			saga.status = "failed";
			this.saveSaga(saga);
			this.recordHistory(sagaId, saga.failedStep, "saga_failed", { error: err.message });

			// Call onFail hook
			if (definition.onFail) {
				await definition.onFail(saga.context, sagaId, err, saga.failedStep ?? "unknown");
			}

			this.emit("saga:failed", { saga, error: err });

			// Trigger compensation
			await this.compensate(saga, definition);
			return saga;
		}
	}

	private async executeSteps<TContext>(
		saga: SagaInstance<TContext>,
		definition: SagaDefinition<TContext>,
	): Promise<Map<string, unknown>> {
		const results = new Map<string, unknown>();
		const completedSteps = new Set<string>();
		const timeoutMs = definition.timeoutMs ?? this.config.defaultTimeoutMs;
		const startTime = Date.now();

		// Group steps by dependency level
		const stepLevels = this.buildExecutionLevels(definition.steps);

		for (const level of stepLevels) {
			// Check saga timeout
			if (Date.now() - startTime > timeoutMs) {
				throw new Error(`Saga timeout exceeded: ${timeoutMs}ms`);
			}

			// Separate parallel and sequential steps in this level
			const parallelSteps = level.filter((s) => s.parallel);
			const sequentialSteps = level.filter((s) => !s.parallel);

			// Execute parallel steps concurrently
			if (parallelSteps.length > 0) {
				const parallelPromises = parallelSteps.map((stepDef) => this.executeStep(saga, stepDef, definition));

				const parallelResults = await Promise.allSettled(parallelPromises);

				for (let i = 0; i < parallelResults.length; i++) {
					const result = parallelResults[i];
					const stepDef = parallelSteps[i];

					if (result.status === "fulfilled") {
						results.set(stepDef.id, result.value);
						completedSteps.add(stepDef.id);
					} else if (!stepDef.optional) {
						saga.failedStep = stepDef.id;
						throw result.reason;
					}
				}
			}

			// Execute sequential steps
			for (const stepDef of sequentialSteps) {
				try {
					const result = await this.executeStep(saga, stepDef, definition);
					results.set(stepDef.id, result);
					completedSteps.add(stepDef.id);
				} catch (error) {
					if (!stepDef.optional) {
						saga.failedStep = stepDef.id;
						throw error;
					}
				}
			}
		}

		return results;
	}

	private buildExecutionLevels(steps: StepDefinition<any>[]): StepDefinition<any>[][] {
		const levels: StepDefinition<any>[][] = [];
		const assigned = new Set<string>();
		const remaining = [...steps];

		while (remaining.length > 0) {
			const currentLevel: StepDefinition<any>[] = [];

			for (let i = remaining.length - 1; i >= 0; i--) {
				const step = remaining[i];
				const deps = step.dependsOn ?? [];

				// Check if all dependencies are satisfied
				if (deps.every((d) => assigned.has(d))) {
					currentLevel.push(step);
					remaining.splice(i, 1);
				}
			}

			if (currentLevel.length === 0 && remaining.length > 0) {
				throw new Error("Unable to resolve step dependencies");
			}

			levels.push(currentLevel);
			for (const step of currentLevel) {
				assigned.add(step.id);
			}
		}

		return levels;
	}

	private async executeStep<TContext>(
		saga: SagaInstance<TContext>,
		stepDef: StepDefinition<TContext>,
		_definition: SagaDefinition<TContext>,
	): Promise<unknown> {
		const stepExec = saga.steps.get(stepDef.id)!;
		stepExec.status = "running";
		stepExec.startedAt = new Date();
		saga.currentStep = stepDef.id;
		this.saveSaga(saga);
		this.recordHistory(saga.id, stepDef.id, "step_started");
		this.emit("step:started", { saga, stepId: stepDef.id });

		const retryPolicy = stepDef.retryPolicy ?? this.config.defaultRetryPolicy;
		const stepTimeoutMs = stepDef.timeoutMs ?? this.config.defaultTimeoutMs;

		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt++) {
			try {
				// Execute with timeout
				const result = await this.executeWithTimeout(() => stepDef.execute(saga.context, saga.id), stepTimeoutMs);

				stepExec.status = "completed";
				stepExec.completedAt = new Date();
				stepExec.result = result;
				this.saveSaga(saga);
				this.recordHistory(saga.id, stepDef.id, "step_completed", {
					durationMs: stepExec.completedAt.getTime() - stepExec.startedAt!.getTime(),
				});
				this.emit("step:completed", { saga, stepId: stepDef.id, result });

				return result;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				stepExec.retryCount = attempt;
				stepExec.error = lastError.message;

				// Check if error is retryable
				const isRetryable = this.isRetryable(lastError, retryPolicy);
				const hasRetriesLeft = attempt < retryPolicy.maxRetries;

				if (isRetryable && hasRetriesLeft) {
					const delay = Math.min(
						retryPolicy.initialDelayMs * retryPolicy.backoffMultiplier ** attempt,
						retryPolicy.maxDelayMs,
					);

					this.recordHistory(saga.id, stepDef.id, "step_retry", {
						attempt: attempt + 1,
						delayMs: delay,
						error: lastError.message,
					});
					this.emit("step:retry", { saga, stepId: stepDef.id, attempt: attempt + 1, delay });

					await this.delay(delay);
				} else {
					break;
				}
			}
		}

		stepExec.status = "failed";
		stepExec.completedAt = new Date();
		this.saveSaga(saga);
		this.recordHistory(saga.id, stepDef.id, "step_failed", { error: lastError?.message });
		this.emit("step:failed", { saga, stepId: stepDef.id, error: lastError });

		throw lastError;
	}

	private isRetryable(error: Error, policy: RetryPolicy): boolean {
		if (!policy.retryableErrors || policy.retryableErrors.length === 0) {
			return true; // Retry all errors by default
		}

		return policy.retryableErrors.some((pattern) => error.message.includes(pattern) || error.name.includes(pattern));
	}

	private async executeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`Step execution timeout: ${timeoutMs}ms`));
			}, timeoutMs);

			fn()
				.then((result) => {
					clearTimeout(timer);
					resolve(result);
				})
				.catch((error) => {
					clearTimeout(timer);
					reject(error);
				});
		});
	}

	// ============================================================================
	// Compensation
	// ============================================================================

	private async compensate<TContext>(
		saga: SagaInstance<TContext>,
		definition: SagaDefinition<TContext>,
	): Promise<void> {
		saga.status = "compensating";
		this.saveSaga(saga);
		this.emit("saga:compensating", saga);

		// Get completed steps in reverse order for compensation
		const completedStepIds = Array.from(saga.steps.entries())
			.filter(([_, exec]) => exec.status === "completed")
			.map(([id]) => id)
			.reverse();

		let compensationFailed = false;

		for (const stepId of completedStepIds) {
			const stepDef = definition.steps.find((s) => s.id === stepId);
			if (!stepDef?.compensate) continue;

			const stepExec = saga.steps.get(stepId)!;
			stepExec.status = "compensating";
			this.saveSaga(saga);
			this.recordHistory(saga.id, stepId, "compensation_started");
			this.emit("compensation:started", { saga, stepId });

			try {
				await stepDef.compensate(saga.context, saga.id, stepExec.result);

				stepExec.status = "compensated";
				this.saveSaga(saga);
				this.recordHistory(saga.id, stepId, "compensation_completed");
				this.emit("compensation:completed", { saga, stepId });
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				stepExec.compensationError = err.message;
				compensationFailed = true;
				this.recordHistory(saga.id, stepId, "compensation_failed", { error: err.message });
				this.emit("compensation:failed", { saga, stepId, error: err });
				// Continue with other compensations even if one fails
			}
		}

		saga.status = compensationFailed ? "aborted" : "compensated";
		saga.completedAt = new Date();
		this.saveSaga(saga);
		this.runningSagas.delete(saga.id);

		if (definition.onCompensated) {
			await definition.onCompensated(saga.context, saga.id);
		}

		this.emit("saga:compensated", saga);
	}

	// ============================================================================
	// Saga Management
	// ============================================================================

	async abort(sagaId: string): Promise<boolean> {
		const saga = this.runningSagas.get(sagaId);
		if (!saga) {
			return false;
		}

		const definition = this.definitions.get(saga.definitionId);
		if (!definition) {
			return false;
		}

		this.recordHistory(sagaId, undefined, "saga_aborted");
		await this.compensate(saga, definition);
		return true;
	}

	getSaga(sagaId: string): SagaInstance<any> | null {
		// Check running sagas first
		const running = this.runningSagas.get(sagaId);
		if (running) return running;

		// Check database
		const stmt = this.db.prepare("SELECT * FROM saga_instances WHERE id = ?");
		const row = stmt.get(sagaId) as Record<string, unknown> | undefined;

		if (!row) return null;
		return this.deserializeSaga(row);
	}

	querySagas(query: SagaQuery = {}): SagaInstance<any>[] {
		let sql = "SELECT * FROM saga_instances WHERE 1=1";
		const params: unknown[] = [];

		if (query.status) {
			const statuses = Array.isArray(query.status) ? query.status : [query.status];
			sql += ` AND status IN (${statuses.map(() => "?").join(",")})`;
			params.push(...statuses);
		}

		if (query.definitionId) {
			sql += " AND definition_id = ?";
			params.push(query.definitionId);
		}

		if (query.startedAfter) {
			sql += " AND started_at >= ?";
			params.push(query.startedAfter.toISOString());
		}

		if (query.startedBefore) {
			sql += " AND started_at <= ?";
			params.push(query.startedBefore.toISOString());
		}

		sql += " ORDER BY started_at DESC";

		if (query.limit) {
			sql += " LIMIT ?";
			params.push(query.limit);
		}

		if (query.offset) {
			sql += " OFFSET ?";
			params.push(query.offset);
		}

		const stmt = this.db.prepare(sql);
		const rows = stmt.all(...params) as Record<string, unknown>[];

		return rows.map((row) => this.deserializeSaga(row));
	}

	getHistory(sagaId: string, limit: number = 100): SagaHistoryEntry[] {
		const stmt = this.db.prepare(`
      SELECT * FROM saga_history
      WHERE saga_id = ?
      ORDER BY timestamp ASC
      LIMIT ?
    `);

		const rows = stmt.all(sagaId, limit) as Record<string, unknown>[];

		return rows.map((row) => ({
			id: row.id as string,
			sagaId: row.saga_id as string,
			stepId: row.step_id as string | undefined,
			action: row.action as SagaHistoryEntry["action"],
			timestamp: new Date(row.timestamp as string),
			details: row.details ? JSON.parse(row.details as string) : undefined,
		}));
	}

	// ============================================================================
	// Statistics
	// ============================================================================

	getStats(): SagaStats {
		const statusStmt = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM saga_instances GROUP BY status
    `);
		const statusRows = statusStmt.all() as { status: string; count: number }[];

		const byStatus: Record<SagaStatus, number> = {
			pending: 0,
			running: 0,
			completed: 0,
			failed: 0,
			compensating: 0,
			compensated: 0,
			aborted: 0,
		};

		let totalSagas = 0;
		for (const row of statusRows) {
			byStatus[row.status as SagaStatus] = row.count;
			totalSagas += row.count;
		}

		const defStmt = this.db.prepare(`
      SELECT definition_id, COUNT(*) as count FROM saga_instances GROUP BY definition_id
    `);
		const defRows = defStmt.all() as { definition_id: string; count: number }[];

		const byDefinition: Record<string, number> = {};
		for (const row of defRows) {
			byDefinition[row.definition_id] = row.count;
		}

		const avgStmt = this.db.prepare(`
      SELECT AVG((julianday(completed_at) - julianday(started_at)) * 86400000) as avg_ms
      FROM saga_instances
      WHERE completed_at IS NOT NULL
    `);
		const avgResult = avgStmt.get() as { avg_ms: number | null };
		const avgCompletionTimeMs = avgResult.avg_ms ?? 0;

		const failureRate = totalSagas > 0 ? (byStatus.failed + byStatus.aborted) / totalSagas : 0;

		const compensationRate = totalSagas > 0 ? (byStatus.compensated + byStatus.aborted) / totalSagas : 0;

		return {
			totalSagas,
			byStatus,
			byDefinition,
			avgCompletionTimeMs: Math.round(avgCompletionTimeMs),
			failureRate: Math.round(failureRate * 10000) / 100,
			compensationRate: Math.round(compensationRate * 10000) / 100,
		};
	}

	getRunningCount(): number {
		return this.runningSagas.size;
	}

	// ============================================================================
	// Persistence Helpers
	// ============================================================================

	private saveSaga<TContext>(saga: SagaInstance<TContext>): void {
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO saga_instances
      (id, definition_id, status, context, steps, current_step, started_at,
       completed_at, error, failed_step, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		const stepsObj: Record<string, StepExecution> = {};
		for (const [id, exec] of saga.steps.entries()) {
			stepsObj[id] = exec;
		}

		stmt.run(
			saga.id,
			saga.definitionId,
			saga.status,
			JSON.stringify(saga.context),
			JSON.stringify(stepsObj),
			saga.currentStep ?? null,
			saga.startedAt.toISOString(),
			saga.completedAt?.toISOString() ?? null,
			saga.error ?? null,
			saga.failedStep ?? null,
			saga.metadata ? JSON.stringify(saga.metadata) : null,
		);
	}

	private deserializeSaga(row: Record<string, unknown>): SagaInstance<any> {
		const stepsObj = JSON.parse(row.steps as string) as Record<string, StepExecution>;
		const steps = new Map<string, StepExecution>();

		for (const [id, exec] of Object.entries(stepsObj)) {
			steps.set(id, {
				...exec,
				startedAt: exec.startedAt ? new Date(exec.startedAt as unknown as string) : undefined,
				completedAt: exec.completedAt ? new Date(exec.completedAt as unknown as string) : undefined,
			});
		}

		return {
			id: row.id as string,
			definitionId: row.definition_id as string,
			status: row.status as SagaStatus,
			context: JSON.parse(row.context as string),
			steps,
			currentStep: row.current_step as string | undefined,
			startedAt: new Date(row.started_at as string),
			completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
			error: row.error as string | undefined,
			failedStep: row.failed_step as string | undefined,
			metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
		};
	}

	private recordHistory(
		sagaId: string,
		stepId: string | undefined,
		action: SagaHistoryEntry["action"],
		details?: Record<string, unknown>,
	): void {
		const id = `hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const stmt = this.db.prepare(`
      INSERT INTO saga_history (id, saga_id, step_id, action, timestamp, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

		stmt.run(id, sagaId, stepId ?? null, action, new Date().toISOString(), details ? JSON.stringify(details) : null);
	}

	// ============================================================================
	// Cleanup
	// ============================================================================

	private cleanupOldHistory(): void {
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - this.config.historyRetentionDays);

		const stmt = this.db.prepare(`
      DELETE FROM saga_history WHERE timestamp < ?
    `);
		const result = stmt.run(cutoff.toISOString());

		if (result.changes > 0) {
			this.emit("cleanup:history", { deleted: result.changes });
		}
	}

	deleteSaga(sagaId: string): boolean {
		// Cannot delete running sagas
		if (this.runningSagas.has(sagaId)) {
			return false;
		}

		const delHistory = this.db.prepare("DELETE FROM saga_history WHERE saga_id = ?");
		delHistory.run(sagaId);

		const delSaga = this.db.prepare("DELETE FROM saga_instances WHERE id = ?");
		const result = delSaga.run(sagaId);

		return result.changes > 0;
	}

	// ============================================================================
	// Utility
	// ============================================================================

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	shutdown(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		// Note: Running sagas remain in the database and can be resumed after restart
		this.runningSagas.clear();
		this.db.close();
		this.emit("shutdown");
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

let sagaOrchestratorInstance: SagaOrchestrator | null = null;

export function getSagaOrchestrator(config?: Partial<SagaOrchestratorConfig>): SagaOrchestrator {
	if (!sagaOrchestratorInstance) {
		sagaOrchestratorInstance = new SagaOrchestrator(config);
	}
	return sagaOrchestratorInstance;
}

export function resetSagaOrchestrator(): void {
	if (sagaOrchestratorInstance) {
		sagaOrchestratorInstance.shutdown();
		sagaOrchestratorInstance = null;
	}
}

// ============================================================================
// Convenience Builders
// ============================================================================

/**
 * Saga definition builder for fluent API
 */
export class SagaBuilder<TContext = Record<string, unknown>> {
	private definition: Partial<SagaDefinition<TContext>> = {
		steps: [],
	};

	constructor(id: string, name: string) {
		this.definition.id = id;
		this.definition.name = name;
	}

	description(desc: string): this {
		this.definition.description = desc;
		return this;
	}

	timeout(ms: number): this {
		this.definition.timeoutMs = ms;
		return this;
	}

	step(step: StepDefinition<TContext>): this {
		this.definition.steps!.push(step);
		return this;
	}

	onStart(handler: (context: TContext, sagaId: string) => Promise<void>): this {
		this.definition.onStart = handler;
		return this;
	}

	onComplete(handler: (context: TContext, sagaId: string, results: Map<string, unknown>) => Promise<void>): this {
		this.definition.onComplete = handler;
		return this;
	}

	onFail(handler: (context: TContext, sagaId: string, error: Error, failedStep: string) => Promise<void>): this {
		this.definition.onFail = handler;
		return this;
	}

	onCompensated(handler: (context: TContext, sagaId: string) => Promise<void>): this {
		this.definition.onCompensated = handler;
		return this;
	}

	build(): SagaDefinition<TContext> {
		if (!this.definition.id || !this.definition.name || !this.definition.steps?.length) {
			throw new Error("Saga requires id, name, and at least one step");
		}
		return this.definition as SagaDefinition<TContext>;
	}
}

/**
 * Create a new saga builder
 */
export function saga<TContext = Record<string, unknown>>(id: string, name: string): SagaBuilder<TContext> {
	return new SagaBuilder<TContext>(id, name);
}

/**
 * Create a step definition
 */
export function step<TContext = Record<string, unknown>>(
	id: string,
	name: string,
	execute: (context: TContext, sagaId: string) => Promise<unknown>,
	options: Partial<Omit<StepDefinition<TContext>, "id" | "name" | "execute">> = {},
): StepDefinition<TContext> {
	return {
		id,
		name,
		execute,
		...options,
	};
}
