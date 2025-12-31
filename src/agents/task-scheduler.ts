/**
 * Class 3.47: Task Scheduler System
 * TAC Pattern: Cron-based task scheduling with persistence
 *
 * Features:
 * - Cron expression scheduling
 * - One-time and recurring tasks
 * - Task history and execution logs
 * - Retry on failure with backoff
 * - Concurrency limits
 * - Timezone support
 * - Task dependencies and ordering
 * - Task groups and priorities
 */

import Database from "better-sqlite3";
import { EventEmitter } from "events";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export type TaskStatus = "pending" | "scheduled" | "running" | "completed" | "failed" | "cancelled" | "paused";
export type TaskType = "one-time" | "recurring" | "cron";
export type TaskPriority = "low" | "normal" | "high" | "critical";
export type RetryStrategy = "fixed" | "exponential" | "linear";

export interface TaskDefinition {
	id: string;
	name: string;
	description: string;
	type: TaskType;
	cronExpression?: string; // For cron tasks
	scheduledAt?: Date; // For one-time tasks
	intervalMs?: number; // For recurring tasks
	timezone: string;
	handler: string; // Handler function identifier
	payload: Record<string, unknown>;
	priority: TaskPriority;
	maxRetries: number;
	retryStrategy: RetryStrategy;
	retryDelayMs: number;
	timeoutMs: number;
	dependencies: string[]; // Task IDs that must complete first
	tags: string[];
	metadata: Record<string, unknown>;
	enabled: boolean;
	createdAt: Date;
	createdBy: string;
	updatedAt: Date;
}

export interface TaskExecution {
	id: string;
	taskId: string;
	status: TaskStatus;
	startedAt: Date;
	completedAt?: Date;
	duration?: number; // Milliseconds
	result?: unknown;
	error?: string;
	retryCount: number;
	executedBy: string; // Worker/instance ID
	metadata?: Record<string, unknown>;
}

export interface TaskHistory {
	taskId: string;
	executions: TaskExecution[];
	totalRuns: number;
	successCount: number;
	failureCount: number;
	avgDuration: number;
	lastRun?: Date;
	lastSuccess?: Date;
	lastFailure?: Date;
}

export interface TaskGroup {
	id: string;
	name: string;
	description: string;
	tasks: string[];
	maxConcurrency: number;
	priority: TaskPriority;
	enabled: boolean;
	createdAt: Date;
}

export interface SchedulerConfig {
	dataDir: string;
	defaultTimezone: string;
	maxConcurrentTasks: number;
	defaultTimeoutMs: number;
	defaultMaxRetries: number;
	defaultRetryDelayMs: number;
	cleanupRetentionDays: number;
	tickIntervalMs: number; // How often to check for due tasks
	instanceId: string; // Unique identifier for this scheduler instance
}

export interface SchedulerStats {
	totalTasks: number;
	enabledTasks: number;
	runningTasks: number;
	pendingTasks: number;
	completedToday: number;
	failedToday: number;
	avgExecutionTime: number;
	uptime: number;
	lastTick: Date;
}

export interface CronNextRun {
	taskId: string;
	taskName: string;
	nextRun: Date;
	cronExpression: string;
	timezone: string;
}

export type TaskHandler = (payload: Record<string, unknown>, context: TaskContext) => Promise<unknown>;

export interface TaskContext {
	taskId: string;
	executionId: string;
	retryCount: number;
	startTime: Date;
	logger: TaskLogger;
	signal: AbortSignal;
}

export interface TaskLogger {
	info: (message: string, data?: Record<string, unknown>) => void;
	warn: (message: string, data?: Record<string, unknown>) => void;
	error: (message: string, data?: Record<string, unknown>) => void;
}

// ============================================================================
// Cron Parser Utilities
// ============================================================================

interface CronParts {
	minute: number[];
	hour: number[];
	dayOfMonth: number[];
	month: number[];
	dayOfWeek: number[];
}

function parseCronExpression(expression: string): CronParts | null {
	const parts = expression.trim().split(/\s+/);
	if (parts.length < 5 || parts.length > 6) return null;

	// Handle 6-part expression (with seconds) by ignoring seconds
	const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.length === 6 ? parts.slice(1) : parts;

	try {
		return {
			minute: parseCronField(minute, 0, 59),
			hour: parseCronField(hour, 0, 23),
			dayOfMonth: parseCronField(dayOfMonth, 1, 31),
			month: parseCronField(month, 1, 12),
			dayOfWeek: parseCronField(dayOfWeek, 0, 6),
		};
	} catch {
		return null;
	}
}

function parseCronField(field: string, min: number, max: number): number[] {
	const values: number[] = [];

	for (const part of field.split(",")) {
		if (part === "*") {
			for (let i = min; i <= max; i++) values.push(i);
		} else if (part.includes("/")) {
			const [range, stepStr] = part.split("/");
			const step = parseInt(stepStr, 10);
			let start = min;
			let end = max;

			if (range !== "*") {
				if (range.includes("-")) {
					[start, end] = range.split("-").map((n) => parseInt(n, 10));
				} else {
					start = parseInt(range, 10);
				}
			}

			for (let i = start; i <= end; i += step) values.push(i);
		} else if (part.includes("-")) {
			const [start, end] = part.split("-").map((n) => parseInt(n, 10));
			for (let i = start; i <= end; i++) values.push(i);
		} else {
			values.push(parseInt(part, 10));
		}
	}

	return [...new Set(values)].sort((a, b) => a - b);
}

function getNextCronRun(cron: CronParts, after: Date, _timezone: string): Date {
	// Simple implementation - find next matching time
	const date = new Date(after.getTime() + 60000); // Start from next minute
	date.setSeconds(0, 0);

	// Try up to 366 days ahead
	for (let attempts = 0; attempts < 366 * 24 * 60; attempts++) {
		const minute = date.getMinutes();
		const hour = date.getHours();
		const dayOfMonth = date.getDate();
		const month = date.getMonth() + 1; // JS months are 0-indexed
		const dayOfWeek = date.getDay();

		if (
			cron.minute.includes(minute) &&
			cron.hour.includes(hour) &&
			cron.month.includes(month) &&
			(cron.dayOfMonth.includes(dayOfMonth) || cron.dayOfWeek.includes(dayOfWeek))
		) {
			return date;
		}

		date.setMinutes(date.getMinutes() + 1);
	}

	// Fallback - shouldn't reach here for valid cron
	return new Date(after.getTime() + 24 * 60 * 60 * 1000);
}

function validateCronExpression(expression: string): boolean {
	return parseCronExpression(expression) !== null;
}

function describeCronExpression(expression: string): string {
	const parts = expression.trim().split(/\s+/);
	if (parts.length < 5) return "Invalid cron expression";

	const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.length === 6 ? parts.slice(1) : parts;

	let description = "Runs ";

	// Time
	if (minute === "*" && hour === "*") {
		description += "every minute";
	} else if (minute === "0" && hour === "*") {
		description += "every hour";
	} else if (minute === "*") {
		description += `every minute during hour ${hour}`;
	} else if (hour === "*") {
		description += `at minute ${minute} of every hour`;
	} else {
		description += `at ${hour}:${minute.padStart(2, "0")}`;
	}

	// Day of week
	if (dayOfWeek !== "*") {
		const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
		const dayNums = dayOfWeek.split(",").map((d) => parseInt(d, 10));
		description += ` on ${dayNums.map((d) => days[d]).join(", ")}`;
	} else if (dayOfMonth !== "*") {
		description += ` on day ${dayOfMonth} of the month`;
	} else {
		description += " daily";
	}

	// Month
	if (month !== "*") {
		const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
		const monthNums = month.split(",").map((m) => parseInt(m, 10) - 1);
		description += ` in ${monthNums.map((m) => months[m]).join(", ")}`;
	}

	return description;
}

// ============================================================================
// Task Scheduler System
// ============================================================================

export class TaskSchedulerSystem extends EventEmitter {
	private db: Database.Database;
	private config: SchedulerConfig;
	private handlers: Map<string, TaskHandler> = new Map();
	private runningTasks: Map<string, AbortController> = new Map();
	private tickInterval: NodeJS.Timeout | null = null;
	private cleanupInterval: NodeJS.Timeout | null = null;
	private startTime: Date;
	private lastTick: Date;
	private executionLogs: Map<
		string,
		Array<{ level: string; message: string; data?: Record<string, unknown>; timestamp: Date }>
	> = new Map();

	constructor(config: SchedulerConfig) {
		super();
		this.config = config;
		this.startTime = new Date();
		this.lastTick = new Date();
		this.db = new Database(join(config.dataDir, "task_scheduler.db"));
		this.initializeDatabase();
		this.startScheduler();
		this.startCleanupScheduler();
	}

	private initializeDatabase(): void {
		this.db.pragma("journal_mode = WAL");

		// Tasks table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        cron_expression TEXT,
        scheduled_at TEXT,
        interval_ms INTEGER,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        handler TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        priority TEXT NOT NULL DEFAULT 'normal',
        max_retries INTEGER NOT NULL DEFAULT 3,
        retry_strategy TEXT NOT NULL DEFAULT 'exponential',
        retry_delay_ms INTEGER NOT NULL DEFAULT 1000,
        timeout_ms INTEGER NOT NULL DEFAULT 300000,
        dependencies TEXT NOT NULL DEFAULT '[]',
        tags TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        next_run TEXT
      )
    `);

		// Task executions table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_executions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration INTEGER,
        result TEXT,
        error TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        executed_by TEXT NOT NULL,
        metadata TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `);

		// Task groups table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tasks TEXT NOT NULL DEFAULT '[]',
        max_concurrency INTEGER NOT NULL DEFAULT 5,
        priority TEXT NOT NULL DEFAULT 'normal',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      )
    `);

		// Task locks table (for distributed locking)
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_locks (
        task_id TEXT PRIMARY KEY,
        locked_by TEXT NOT NULL,
        locked_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `);

		// Indexes
		this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_enabled ON tasks(enabled);
      CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
      CREATE INDEX IF NOT EXISTS idx_tasks_next_run ON tasks(next_run);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_executions_task ON task_executions(task_id);
      CREATE INDEX IF NOT EXISTS idx_executions_status ON task_executions(status);
      CREATE INDEX IF NOT EXISTS idx_executions_started ON task_executions(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_locks_expires ON task_locks(expires_at);
    `);
	}

	private startScheduler(): void {
		this.tickInterval = setInterval(() => {
			this.tick();
		}, this.config.tickIntervalMs);

		// Run initial tick
		this.tick();
	}

	private startCleanupScheduler(): void {
		// Run cleanup daily
		this.cleanupInterval = setInterval(
			() => {
				this.cleanupOldExecutions();
				this.cleanupExpiredLocks();
			},
			24 * 60 * 60 * 1000,
		);
	}

	private async tick(): Promise<void> {
		this.lastTick = new Date();

		try {
			// Clean expired locks first
			this.cleanupExpiredLocks();

			// Get due tasks
			const dueTasks = this.getDueTasks();

			for (const task of dueTasks) {
				// Check concurrency limit
				if (this.runningTasks.size >= this.config.maxConcurrentTasks) {
					break;
				}

				// Try to acquire lock
				if (!this.acquireLock(task.id)) {
					continue;
				}

				// Check dependencies
				if (!this.areDependenciesMet(task)) {
					this.releaseLock(task.id);
					continue;
				}

				// Execute task
				this.executeTask(task).catch((error) => {
					this.emit("task:error", { taskId: task.id, error });
				});
			}
		} catch (error) {
			this.emit("scheduler:error", { error });
		}
	}

	private getDueTasks(): TaskDefinition[] {
		const now = new Date().toISOString();

		const rows = this.db
			.prepare(`
      SELECT * FROM tasks
      WHERE enabled = 1
        AND (next_run IS NOT NULL AND next_run <= ?)
        AND id NOT IN (SELECT task_id FROM task_locks)
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
        END,
        next_run ASC
      LIMIT ?
    `)
			.all(now, this.config.maxConcurrentTasks * 2) as DbTaskRow[];

		return rows.map((row) => this.rowToTask(row));
	}

	private areDependenciesMet(task: TaskDefinition): boolean {
		if (task.dependencies.length === 0) return true;

		// Check if all dependencies completed successfully in last execution
		for (const depId of task.dependencies) {
			const lastExecution = this.db
				.prepare(`
        SELECT status FROM task_executions
        WHERE task_id = ?
        ORDER BY started_at DESC
        LIMIT 1
      `)
				.get(depId) as { status: string } | undefined;

			if (!lastExecution || lastExecution.status !== "completed") {
				return false;
			}
		}

		return true;
	}

	private acquireLock(taskId: string): boolean {
		const now = new Date();
		const expires = new Date(now.getTime() + this.config.defaultTimeoutMs + 60000);

		try {
			this.db
				.prepare(`
        INSERT INTO task_locks (task_id, locked_by, locked_at, expires_at)
        VALUES (?, ?, ?, ?)
      `)
				.run(taskId, this.config.instanceId, now.toISOString(), expires.toISOString());
			return true;
		} catch {
			// Lock already exists
			return false;
		}
	}

	private releaseLock(taskId: string): void {
		this.db.prepare(`DELETE FROM task_locks WHERE task_id = ?`).run(taskId);
	}

	private cleanupExpiredLocks(): void {
		const now = new Date().toISOString();
		this.db.prepare(`DELETE FROM task_locks WHERE expires_at < ?`).run(now);
	}

	private cleanupOldExecutions(): void {
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - this.config.cleanupRetentionDays);

		const result = this.db
			.prepare(`
      DELETE FROM task_executions WHERE started_at < ?
    `)
			.run(cutoff.toISOString());

		if (result.changes > 0) {
			this.emit("cleanup", { deletedExecutions: result.changes });
		}
	}

	private async executeTask(task: TaskDefinition): Promise<void> {
		const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const startTime = new Date();
		const abortController = new AbortController();

		this.runningTasks.set(task.id, abortController);
		this.executionLogs.set(executionId, []);

		// Create execution record
		this.db
			.prepare(`
      INSERT INTO task_executions (id, task_id, status, started_at, retry_count, executed_by)
      VALUES (?, ?, 'running', ?, 0, ?)
    `)
			.run(executionId, task.id, startTime.toISOString(), this.config.instanceId);

		this.emit("task:started", { taskId: task.id, executionId });

		// Set up timeout
		const timeoutId = setTimeout(() => {
			abortController.abort();
		}, task.timeoutMs);

		const logger: TaskLogger = {
			info: (message, data) => this.logExecution(executionId, "info", message, data),
			warn: (message, data) => this.logExecution(executionId, "warn", message, data),
			error: (message, data) => this.logExecution(executionId, "error", message, data),
		};

		const context: TaskContext = {
			taskId: task.id,
			executionId,
			retryCount: 0,
			startTime,
			logger,
			signal: abortController.signal,
		};

		try {
			const handler = this.handlers.get(task.handler);
			if (!handler) {
				throw new Error(`Handler not found: ${task.handler}`);
			}

			const result = await handler(task.payload, context);

			// Success
			clearTimeout(timeoutId);
			const completedAt = new Date();
			const duration = completedAt.getTime() - startTime.getTime();

			this.db
				.prepare(`
        UPDATE task_executions
        SET status = 'completed', completed_at = ?, duration = ?, result = ?
        WHERE id = ?
      `)
				.run(completedAt.toISOString(), duration, JSON.stringify(result), executionId);

			// Update next run time
			this.updateNextRun(task);

			this.emit("task:completed", { taskId: task.id, executionId, result, duration });
		} catch (error) {
			clearTimeout(timeoutId);
			const completedAt = new Date();
			const duration = completedAt.getTime() - startTime.getTime();
			const errorMessage = error instanceof Error ? error.message : String(error);

			// Check if we should retry
			const retryCount = await this.getRetryCount(task.id, executionId);

			if (retryCount < task.maxRetries && !abortController.signal.aborted) {
				// Schedule retry
				const delay = this.calculateRetryDelay(task, retryCount);
				this.scheduleRetry(task, retryCount + 1, delay);

				this.db
					.prepare(`
          UPDATE task_executions
          SET status = 'failed', completed_at = ?, duration = ?, error = ?, retry_count = ?
          WHERE id = ?
        `)
					.run(completedAt.toISOString(), duration, errorMessage, retryCount, executionId);

				this.emit("task:retry", { taskId: task.id, executionId, retryCount: retryCount + 1, delay });
			} else {
				// Final failure
				this.db
					.prepare(`
          UPDATE task_executions
          SET status = 'failed', completed_at = ?, duration = ?, error = ?, retry_count = ?
          WHERE id = ?
        `)
					.run(completedAt.toISOString(), duration, errorMessage, retryCount, executionId);

				// Update next run time even on failure
				this.updateNextRun(task);

				this.emit("task:failed", { taskId: task.id, executionId, error: errorMessage });
			}
		} finally {
			this.runningTasks.delete(task.id);
			this.releaseLock(task.id);
			this.executionLogs.delete(executionId);
		}
	}

	private async getRetryCount(taskId: string, currentExecutionId: string): Promise<number> {
		// Count recent executions for this task that are part of the same retry chain
		const result = this.db
			.prepare(`
      SELECT COUNT(*) as count FROM task_executions
      WHERE task_id = ? AND id != ? AND status = 'failed'
        AND started_at >= datetime('now', '-1 hour')
    `)
			.get(taskId, currentExecutionId) as { count: number };

		return result.count;
	}

	private calculateRetryDelay(task: TaskDefinition, retryCount: number): number {
		switch (task.retryStrategy) {
			case "fixed":
				return task.retryDelayMs;
			case "linear":
				return task.retryDelayMs * (retryCount + 1);
			case "exponential":
				return task.retryDelayMs * 2 ** retryCount;
			default:
				return task.retryDelayMs;
		}
	}

	private scheduleRetry(task: TaskDefinition, _retryCount: number, delayMs: number): void {
		const nextRun = new Date(Date.now() + delayMs);

		this.db
			.prepare(`
      UPDATE tasks SET next_run = ? WHERE id = ?
    `)
			.run(nextRun.toISOString(), task.id);
	}

	private updateNextRun(task: TaskDefinition): void {
		let nextRun: Date | null = null;

		switch (task.type) {
			case "cron":
				if (task.cronExpression) {
					const cronParts = parseCronExpression(task.cronExpression);
					if (cronParts) {
						nextRun = getNextCronRun(cronParts, new Date(), task.timezone);
					}
				}
				break;

			case "recurring":
				if (task.intervalMs) {
					nextRun = new Date(Date.now() + task.intervalMs);
				}
				break;

			case "one-time":
				// One-time tasks don't get rescheduled
				nextRun = null;
				break;
		}

		this.db
			.prepare(`
      UPDATE tasks SET next_run = ? WHERE id = ?
    `)
			.run(nextRun?.toISOString() ?? null, task.id);
	}

	private logExecution(executionId: string, level: string, message: string, data?: Record<string, unknown>): void {
		const logs = this.executionLogs.get(executionId);
		if (logs) {
			logs.push({ level, message, data, timestamp: new Date() });
		}
	}

	// ============================================================================
	// Task Management
	// ============================================================================

	registerHandler(name: string, handler: TaskHandler): void {
		this.handlers.set(name, handler);
		this.emit("handler:registered", { name });
	}

	unregisterHandler(name: string): boolean {
		const removed = this.handlers.delete(name);
		if (removed) {
			this.emit("handler:unregistered", { name });
		}
		return removed;
	}

	getRegisteredHandlers(): string[] {
		return Array.from(this.handlers.keys());
	}

	createTask(params: {
		name: string;
		description?: string;
		type: TaskType;
		cronExpression?: string;
		scheduledAt?: Date;
		intervalMs?: number;
		timezone?: string;
		handler: string;
		payload?: Record<string, unknown>;
		priority?: TaskPriority;
		maxRetries?: number;
		retryStrategy?: RetryStrategy;
		retryDelayMs?: number;
		timeoutMs?: number;
		dependencies?: string[];
		tags?: string[];
		metadata?: Record<string, unknown>;
		createdBy: string;
	}): TaskDefinition {
		const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const now = new Date();

		// Validate handler exists
		if (!this.handlers.has(params.handler)) {
			throw new Error(`Handler not registered: ${params.handler}`);
		}

		// Validate cron expression
		if (params.type === "cron" && params.cronExpression) {
			if (!validateCronExpression(params.cronExpression)) {
				throw new Error(`Invalid cron expression: ${params.cronExpression}`);
			}
		}

		// Calculate initial next_run
		let nextRun: Date | null = null;

		switch (params.type) {
			case "cron":
				if (params.cronExpression) {
					const cronParts = parseCronExpression(params.cronExpression);
					if (cronParts) {
						nextRun = getNextCronRun(cronParts, now, params.timezone ?? this.config.defaultTimezone);
					}
				}
				break;
			case "one-time":
				nextRun = params.scheduledAt ?? now;
				break;
			case "recurring":
				nextRun = new Date(now.getTime() + (params.intervalMs ?? 60000));
				break;
		}

		const task: TaskDefinition = {
			id,
			name: params.name,
			description: params.description ?? "",
			type: params.type,
			cronExpression: params.cronExpression,
			scheduledAt: params.scheduledAt,
			intervalMs: params.intervalMs,
			timezone: params.timezone ?? this.config.defaultTimezone,
			handler: params.handler,
			payload: params.payload ?? {},
			priority: params.priority ?? "normal",
			maxRetries: params.maxRetries ?? this.config.defaultMaxRetries,
			retryStrategy: params.retryStrategy ?? "exponential",
			retryDelayMs: params.retryDelayMs ?? this.config.defaultRetryDelayMs,
			timeoutMs: params.timeoutMs ?? this.config.defaultTimeoutMs,
			dependencies: params.dependencies ?? [],
			tags: params.tags ?? [],
			metadata: params.metadata ?? {},
			enabled: true,
			createdAt: now,
			createdBy: params.createdBy,
			updatedAt: now,
		};

		this.db
			.prepare(`
      INSERT INTO tasks (id, name, description, type, cron_expression, scheduled_at, interval_ms,
        timezone, handler, payload, priority, max_retries, retry_strategy, retry_delay_ms,
        timeout_ms, dependencies, tags, metadata, enabled, created_at, created_by, updated_at, next_run)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
			.run(
				task.id,
				task.name,
				task.description,
				task.type,
				task.cronExpression ?? null,
				task.scheduledAt?.toISOString() ?? null,
				task.intervalMs ?? null,
				task.timezone,
				task.handler,
				JSON.stringify(task.payload),
				task.priority,
				task.maxRetries,
				task.retryStrategy,
				task.retryDelayMs,
				task.timeoutMs,
				JSON.stringify(task.dependencies),
				JSON.stringify(task.tags),
				JSON.stringify(task.metadata),
				1,
				task.createdAt.toISOString(),
				task.createdBy,
				task.updatedAt.toISOString(),
				nextRun?.toISOString() ?? null,
			);

		this.emit("task:created", task);
		return task;
	}

	getTask(taskId: string): TaskDefinition | null {
		const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId) as DbTaskRow | undefined;
		if (!row) return null;
		return this.rowToTask(row);
	}

	updateTask(
		taskId: string,
		updates: Partial<Omit<TaskDefinition, "id" | "createdAt" | "createdBy">>,
	): TaskDefinition | null {
		const task = this.getTask(taskId);
		if (!task) return null;

		const updatedTask = { ...task, ...updates, updatedAt: new Date() };

		// Recalculate next_run if schedule changed
		if (
			updates.cronExpression !== undefined ||
			updates.intervalMs !== undefined ||
			updates.scheduledAt !== undefined
		) {
			let nextRun: Date | null = null;

			switch (updatedTask.type) {
				case "cron":
					if (updatedTask.cronExpression) {
						const cronParts = parseCronExpression(updatedTask.cronExpression);
						if (cronParts) {
							nextRun = getNextCronRun(cronParts, new Date(), updatedTask.timezone);
						}
					}
					break;
				case "one-time":
					nextRun = updatedTask.scheduledAt ?? null;
					break;
				case "recurring":
					if (updatedTask.intervalMs) {
						nextRun = new Date(Date.now() + updatedTask.intervalMs);
					}
					break;
			}

			this.db.prepare(`UPDATE tasks SET next_run = ? WHERE id = ?`).run(nextRun?.toISOString() ?? null, taskId);
		}

		this.db
			.prepare(`
      UPDATE tasks SET
        name = ?, description = ?, type = ?, cron_expression = ?, scheduled_at = ?,
        interval_ms = ?, timezone = ?, handler = ?, payload = ?, priority = ?,
        max_retries = ?, retry_strategy = ?, retry_delay_ms = ?, timeout_ms = ?,
        dependencies = ?, tags = ?, metadata = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `)
			.run(
				updatedTask.name,
				updatedTask.description,
				updatedTask.type,
				updatedTask.cronExpression ?? null,
				updatedTask.scheduledAt?.toISOString() ?? null,
				updatedTask.intervalMs ?? null,
				updatedTask.timezone,
				updatedTask.handler,
				JSON.stringify(updatedTask.payload),
				updatedTask.priority,
				updatedTask.maxRetries,
				updatedTask.retryStrategy,
				updatedTask.retryDelayMs,
				updatedTask.timeoutMs,
				JSON.stringify(updatedTask.dependencies),
				JSON.stringify(updatedTask.tags),
				JSON.stringify(updatedTask.metadata),
				updatedTask.enabled ? 1 : 0,
				updatedTask.updatedAt.toISOString(),
				taskId,
			);

		this.emit("task:updated", updatedTask);
		return updatedTask;
	}

	deleteTask(taskId: string): boolean {
		// Cancel if running
		this.cancelTask(taskId);

		const result = this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);

		if (result.changes > 0) {
			this.emit("task:deleted", { taskId });
		}

		return result.changes > 0;
	}

	enableTask(taskId: string): boolean {
		const result = this.db
			.prepare(`UPDATE tasks SET enabled = 1, updated_at = ? WHERE id = ?`)
			.run(new Date().toISOString(), taskId);

		if (result.changes > 0) {
			// Recalculate next run
			const task = this.getTask(taskId);
			if (task) {
				this.updateNextRun(task);
			}
			this.emit("task:enabled", { taskId });
		}

		return result.changes > 0;
	}

	disableTask(taskId: string): boolean {
		const result = this.db
			.prepare(`UPDATE tasks SET enabled = 0, updated_at = ? WHERE id = ?`)
			.run(new Date().toISOString(), taskId);

		if (result.changes > 0) {
			this.emit("task:disabled", { taskId });
		}

		return result.changes > 0;
	}

	cancelTask(taskId: string): boolean {
		const controller = this.runningTasks.get(taskId);
		if (controller) {
			controller.abort();
			this.runningTasks.delete(taskId);
			this.releaseLock(taskId);
			this.emit("task:cancelled", { taskId });
			return true;
		}
		return false;
	}

	runTaskNow(taskId: string): boolean {
		const task = this.getTask(taskId);
		if (!task || !task.enabled) return false;

		if (this.runningTasks.has(taskId)) return false;

		// Update next_run to now
		this.db.prepare(`UPDATE tasks SET next_run = ? WHERE id = ?`).run(new Date().toISOString(), taskId);

		return true;
	}

	getAllTasks(enabledOnly: boolean = false): TaskDefinition[] {
		const query = enabledOnly
			? `SELECT * FROM tasks WHERE enabled = 1 ORDER BY created_at DESC`
			: `SELECT * FROM tasks ORDER BY created_at DESC`;

		const rows = this.db.prepare(query).all() as DbTaskRow[];
		return rows.map((row) => this.rowToTask(row));
	}

	getTasksByTag(tag: string): TaskDefinition[] {
		const rows = this.db
			.prepare(`
      SELECT * FROM tasks WHERE tags LIKE ? ORDER BY created_at DESC
    `)
			.all(`%"${tag}"%`) as DbTaskRow[];

		return rows.map((row) => this.rowToTask(row));
	}

	getTasksByHandler(handler: string): TaskDefinition[] {
		const rows = this.db
			.prepare(`
      SELECT * FROM tasks WHERE handler = ? ORDER BY created_at DESC
    `)
			.all(handler) as DbTaskRow[];

		return rows.map((row) => this.rowToTask(row));
	}

	// ============================================================================
	// Task History
	// ============================================================================

	getTaskHistory(taskId: string, limit: number = 50): TaskHistory {
		const executions = this.db
			.prepare(`
      SELECT * FROM task_executions
      WHERE task_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `)
			.all(taskId, limit) as DbExecutionRow[];

		const stats = this.db
			.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failure,
        AVG(duration) as avg_duration,
        MAX(CASE WHEN status = 'completed' THEN started_at END) as last_success,
        MAX(CASE WHEN status = 'failed' THEN started_at END) as last_failure
      FROM task_executions
      WHERE task_id = ?
    `)
			.get(taskId) as DbHistoryStats;

		return {
			taskId,
			executions: executions.map((row) => this.rowToExecution(row)),
			totalRuns: stats.total ?? 0,
			successCount: stats.success ?? 0,
			failureCount: stats.failure ?? 0,
			avgDuration: stats.avg_duration ?? 0,
			lastRun: executions[0] ? new Date(executions[0].started_at) : undefined,
			lastSuccess: stats.last_success ? new Date(stats.last_success) : undefined,
			lastFailure: stats.last_failure ? new Date(stats.last_failure) : undefined,
		};
	}

	getExecution(executionId: string): TaskExecution | null {
		const row = this.db.prepare(`SELECT * FROM task_executions WHERE id = ?`).get(executionId) as
			| DbExecutionRow
			| undefined;
		if (!row) return null;
		return this.rowToExecution(row);
	}

	getRecentExecutions(limit: number = 100): TaskExecution[] {
		const rows = this.db
			.prepare(`
      SELECT * FROM task_executions ORDER BY started_at DESC LIMIT ?
    `)
			.all(limit) as DbExecutionRow[];

		return rows.map((row) => this.rowToExecution(row));
	}

	// ============================================================================
	// Task Groups
	// ============================================================================

	createGroup(params: {
		name: string;
		description?: string;
		tasks?: string[];
		maxConcurrency?: number;
		priority?: TaskPriority;
	}): TaskGroup {
		const id = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		const group: TaskGroup = {
			id,
			name: params.name,
			description: params.description ?? "",
			tasks: params.tasks ?? [],
			maxConcurrency: params.maxConcurrency ?? 5,
			priority: params.priority ?? "normal",
			enabled: true,
			createdAt: new Date(),
		};

		this.db
			.prepare(`
      INSERT INTO task_groups (id, name, description, tasks, max_concurrency, priority, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
			.run(
				group.id,
				group.name,
				group.description,
				JSON.stringify(group.tasks),
				group.maxConcurrency,
				group.priority,
				1,
				group.createdAt.toISOString(),
			);

		this.emit("group:created", group);
		return group;
	}

	getGroup(groupId: string): TaskGroup | null {
		const row = this.db.prepare(`SELECT * FROM task_groups WHERE id = ?`).get(groupId) as DbGroupRow | undefined;
		if (!row) return null;
		return this.rowToGroup(row);
	}

	getAllGroups(): TaskGroup[] {
		const rows = this.db.prepare(`SELECT * FROM task_groups ORDER BY created_at DESC`).all() as DbGroupRow[];
		return rows.map((row) => this.rowToGroup(row));
	}

	addTaskToGroup(groupId: string, taskId: string): boolean {
		const group = this.getGroup(groupId);
		if (!group) return false;

		if (!group.tasks.includes(taskId)) {
			group.tasks.push(taskId);
			this.db.prepare(`UPDATE task_groups SET tasks = ? WHERE id = ?`).run(JSON.stringify(group.tasks), groupId);
			return true;
		}
		return false;
	}

	removeTaskFromGroup(groupId: string, taskId: string): boolean {
		const group = this.getGroup(groupId);
		if (!group) return false;

		const index = group.tasks.indexOf(taskId);
		if (index > -1) {
			group.tasks.splice(index, 1);
			this.db.prepare(`UPDATE task_groups SET tasks = ? WHERE id = ?`).run(JSON.stringify(group.tasks), groupId);
			return true;
		}
		return false;
	}

	deleteGroup(groupId: string): boolean {
		const result = this.db.prepare(`DELETE FROM task_groups WHERE id = ?`).run(groupId);
		return result.changes > 0;
	}

	// ============================================================================
	// Cron Utilities
	// ============================================================================

	validateCron(expression: string): { valid: boolean; description?: string; error?: string } {
		const valid = validateCronExpression(expression);
		if (valid) {
			return {
				valid: true,
				description: describeCronExpression(expression),
			};
		}
		return {
			valid: false,
			error: "Invalid cron expression format",
		};
	}

	getNextRuns(limit: number = 10): CronNextRun[] {
		const rows = this.db
			.prepare(`
      SELECT id, name, cron_expression, next_run, timezone
      FROM tasks
      WHERE enabled = 1 AND next_run IS NOT NULL
      ORDER BY next_run ASC
      LIMIT ?
    `)
			.all(limit) as Array<{
			id: string;
			name: string;
			cron_expression: string | null;
			next_run: string;
			timezone: string;
		}>;

		return rows.map((row) => ({
			taskId: row.id,
			taskName: row.name,
			nextRun: new Date(row.next_run),
			cronExpression: row.cron_expression ?? "",
			timezone: row.timezone,
		}));
	}

	// ============================================================================
	// Statistics
	// ============================================================================

	getStats(): SchedulerStats {
		const taskCounts = this.db
			.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled
      FROM tasks
    `)
			.get() as { total: number; enabled: number };

		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const todayStats = this.db
			.prepare(`
      SELECT
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        AVG(duration) as avg_duration
      FROM task_executions
      WHERE started_at >= ?
    `)
			.get(today.toISOString()) as { completed: number | null; failed: number | null; avg_duration: number | null };

		const pendingCount = this.db
			.prepare(`
      SELECT COUNT(*) as count FROM tasks
      WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= datetime('now')
    `)
			.get() as { count: number };

		return {
			totalTasks: taskCounts.total,
			enabledTasks: taskCounts.enabled,
			runningTasks: this.runningTasks.size,
			pendingTasks: pendingCount.count,
			completedToday: todayStats.completed ?? 0,
			failedToday: todayStats.failed ?? 0,
			avgExecutionTime: todayStats.avg_duration ?? 0,
			uptime: Date.now() - this.startTime.getTime(),
			lastTick: this.lastTick,
		};
	}

	// ============================================================================
	// Private Helpers
	// ============================================================================

	private rowToTask(row: DbTaskRow): TaskDefinition {
		return {
			id: row.id,
			name: row.name,
			description: row.description,
			type: row.type as TaskType,
			cronExpression: row.cron_expression ?? undefined,
			scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : undefined,
			intervalMs: row.interval_ms ?? undefined,
			timezone: row.timezone,
			handler: row.handler,
			payload: JSON.parse(row.payload),
			priority: row.priority as TaskPriority,
			maxRetries: row.max_retries,
			retryStrategy: row.retry_strategy as RetryStrategy,
			retryDelayMs: row.retry_delay_ms,
			timeoutMs: row.timeout_ms,
			dependencies: JSON.parse(row.dependencies),
			tags: JSON.parse(row.tags),
			metadata: JSON.parse(row.metadata),
			enabled: Boolean(row.enabled),
			createdAt: new Date(row.created_at),
			createdBy: row.created_by,
			updatedAt: new Date(row.updated_at),
		};
	}

	private rowToExecution(row: DbExecutionRow): TaskExecution {
		return {
			id: row.id,
			taskId: row.task_id,
			status: row.status as TaskStatus,
			startedAt: new Date(row.started_at),
			completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
			duration: row.duration ?? undefined,
			result: row.result ? JSON.parse(row.result) : undefined,
			error: row.error ?? undefined,
			retryCount: row.retry_count,
			executedBy: row.executed_by,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		};
	}

	private rowToGroup(row: DbGroupRow): TaskGroup {
		return {
			id: row.id,
			name: row.name,
			description: row.description,
			tasks: JSON.parse(row.tasks),
			maxConcurrency: row.max_concurrency,
			priority: row.priority as TaskPriority,
			enabled: Boolean(row.enabled),
			createdAt: new Date(row.created_at),
		};
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	shutdown(): void {
		// Cancel all running tasks
		for (const [taskId, controller] of this.runningTasks) {
			controller.abort();
			this.releaseLock(taskId);
		}
		this.runningTasks.clear();

		if (this.tickInterval) {
			clearInterval(this.tickInterval);
			this.tickInterval = null;
		}
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		this.db.close();
		this.emit("shutdown");
	}
}

// ============================================================================
// Internal Types
// ============================================================================

interface DbTaskRow {
	id: string;
	name: string;
	description: string;
	type: string;
	cron_expression: string | null;
	scheduled_at: string | null;
	interval_ms: number | null;
	timezone: string;
	handler: string;
	payload: string;
	priority: string;
	max_retries: number;
	retry_strategy: string;
	retry_delay_ms: number;
	timeout_ms: number;
	dependencies: string;
	tags: string;
	metadata: string;
	enabled: number;
	created_at: string;
	created_by: string;
	updated_at: string;
	next_run: string | null;
}

interface DbExecutionRow {
	id: string;
	task_id: string;
	status: string;
	started_at: string;
	completed_at: string | null;
	duration: number | null;
	result: string | null;
	error: string | null;
	retry_count: number;
	executed_by: string;
	metadata: string | null;
}

interface DbGroupRow {
	id: string;
	name: string;
	description: string;
	tasks: string;
	max_concurrency: number;
	priority: string;
	enabled: number;
	created_at: string;
}

interface DbHistoryStats {
	total: number | null;
	success: number | null;
	failure: number | null;
	avg_duration: number | null;
	last_success: string | null;
	last_failure: string | null;
}

// ============================================================================
// Factory Functions
// ============================================================================

let taskSchedulerInstance: TaskSchedulerSystem | null = null;

export function getTaskScheduler(config?: SchedulerConfig): TaskSchedulerSystem {
	if (!taskSchedulerInstance) {
		if (!config) {
			throw new Error("TaskSchedulerSystem requires config on first initialization");
		}
		taskSchedulerInstance = new TaskSchedulerSystem(config);
	}
	return taskSchedulerInstance;
}

export function resetTaskScheduler(): void {
	if (taskSchedulerInstance) {
		taskSchedulerInstance.shutdown();
		taskSchedulerInstance = null;
	}
}
