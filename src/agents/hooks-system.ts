/**
 * Class 3.24: Hooks System
 *
 * Pre/post processing hooks for agent operations.
 * Based on AgentJo's wrap_function() pattern.
 *
 * Hook Types:
 * - beforeTool: Run before tool execution
 * - afterTool: Run after tool execution
 * - beforeLLM: Run before LLM call
 * - afterLLM: Run after LLM response
 * - beforeTask: Run before task starts
 * - afterTask: Run after task completes
 * - onError: Run on any error
 *
 * @module hooks-system
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export type HookType = "beforeTool" | "afterTool" | "beforeLLM" | "afterLLM" | "beforeTask" | "afterTask" | "onError";

export type HookPriority = "first" | "high" | "normal" | "low" | "last";

export interface HookContext {
	type: HookType;
	name: string;
	timestamp: number;
	metadata: Record<string, unknown>;
	aborted: boolean;
	abortReason?: string;
}

export interface ToolHookContext extends HookContext {
	type: "beforeTool" | "afterTool";
	toolName: string;
	params: Record<string, unknown>;
	result?: unknown;
	error?: Error;
	duration?: number;
}

export interface LLMHookContext extends HookContext {
	type: "beforeLLM" | "afterLLM";
	model: string;
	prompt: string;
	response?: string;
	tokens?: { input: number; output: number };
	duration?: number;
}

export interface TaskHookContext extends HookContext {
	type: "beforeTask" | "afterTask";
	taskId: string;
	task: string;
	result?: unknown;
	error?: Error;
	duration?: number;
}

export interface ErrorHookContext extends HookContext {
	type: "onError";
	error: Error;
	source: string;
	recoverable: boolean;
	recovery?: () => Promise<void>;
}

export type AnyHookContext = ToolHookContext | LLMHookContext | TaskHookContext | ErrorHookContext;

export type HookHandler<T extends AnyHookContext = AnyHookContext> = (
	context: T,
) => Promise<T | undefined> | T | undefined;

export interface Hook<T extends AnyHookContext = AnyHookContext> {
	id: string;
	name: string;
	type: HookType;
	priority: HookPriority;
	enabled: boolean;
	handler: HookHandler<T>;
	filter?: (context: T) => boolean;
	timeout: number;
	metadata: Record<string, unknown>;
}

export interface HookStats {
	id: string;
	name: string;
	type: HookType;
	invocations: number;
	successes: number;
	failures: number;
	aborts: number;
	avgDuration: number;
	lastInvoked: number | null;
}

export interface HooksConfig {
	defaultTimeout: number;
	maxHooksPerType: number;
	enableStats: boolean;
	continueOnError: boolean;
}

// =============================================================================
// Priority Order
// =============================================================================

const PRIORITY_ORDER: Record<HookPriority, number> = {
	first: 0,
	high: 1,
	normal: 2,
	low: 3,
	last: 4,
};

// =============================================================================
// Hooks System
// =============================================================================

export class HooksSystem extends EventEmitter {
	private hooks: Map<string, Hook<any>> = new Map();
	private hooksByType: Map<HookType, string[]> = new Map();
	private stats: Map<string, HookStats> = new Map();
	private config: HooksConfig;

	constructor(config: Partial<HooksConfig> = {}) {
		super();
		this.config = {
			defaultTimeout: 5000,
			maxHooksPerType: 20,
			enableStats: true,
			continueOnError: true,
			...config,
		};

		// Initialize type buckets
		const types: HookType[] = [
			"beforeTool",
			"afterTool",
			"beforeLLM",
			"afterLLM",
			"beforeTask",
			"afterTask",
			"onError",
		];
		for (const type of types) {
			this.hooksByType.set(type, []);
		}
	}

	// ---------------------------------------------------------------------------
	// Hook Registration
	// ---------------------------------------------------------------------------

	register<T extends AnyHookContext>(params: {
		name: string;
		type: HookType;
		handler: HookHandler<T>;
		priority?: HookPriority;
		filter?: (context: T) => boolean;
		timeout?: number;
		metadata?: Record<string, unknown>;
	}): string {
		const id = `hook_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

		const hook: Hook<T> = {
			id,
			name: params.name,
			type: params.type,
			priority: params.priority || "normal",
			enabled: true,
			handler: params.handler,
			filter: params.filter,
			timeout: params.timeout || this.config.defaultTimeout,
			metadata: params.metadata || {},
		};

		// Check max hooks
		const typeHooks = this.hooksByType.get(params.type) || [];
		if (typeHooks.length >= this.config.maxHooksPerType) {
			throw new Error(`Max hooks (${this.config.maxHooksPerType}) reached for type ${params.type}`);
		}

		this.hooks.set(id, hook);
		typeHooks.push(id);
		this.hooksByType.set(params.type, this.sortHooksByPriority(typeHooks));

		// Initialize stats
		if (this.config.enableStats) {
			this.stats.set(id, {
				id,
				name: params.name,
				type: params.type,
				invocations: 0,
				successes: 0,
				failures: 0,
				aborts: 0,
				avgDuration: 0,
				lastInvoked: null,
			});
		}

		this.emit("hook:registered", { hook });
		return id;
	}

	unregister(hookId: string): boolean {
		const hook = this.hooks.get(hookId);
		if (!hook) return false;

		this.hooks.delete(hookId);

		const typeHooks = this.hooksByType.get(hook.type) || [];
		const index = typeHooks.indexOf(hookId);
		if (index !== -1) {
			typeHooks.splice(index, 1);
		}

		this.stats.delete(hookId);
		this.emit("hook:unregistered", { hookId });
		return true;
	}

	enable(hookId: string): boolean {
		const hook = this.hooks.get(hookId);
		if (hook) {
			hook.enabled = true;
			return true;
		}
		return false;
	}

	disable(hookId: string): boolean {
		const hook = this.hooks.get(hookId);
		if (hook) {
			hook.enabled = false;
			return true;
		}
		return false;
	}

	// ---------------------------------------------------------------------------
	// Hook Execution
	// ---------------------------------------------------------------------------

	async run<T extends AnyHookContext>(type: HookType, context: T): Promise<T> {
		const hookIds = this.hooksByType.get(type) || [];
		let currentContext = { ...context };

		for (const hookId of hookIds) {
			const hook = this.hooks.get(hookId) as Hook<T> | undefined;
			if (!hook || !hook.enabled) continue;

			// Check filter
			if (hook.filter && !hook.filter(currentContext)) continue;

			const startTime = Date.now();

			try {
				const result = await this.executeHook(hook, currentContext);

				if (result) {
					currentContext = result;
				}

				// Check if aborted
				if (currentContext.aborted) {
					this.updateStats(hookId, true, false, true, Date.now() - startTime);
					this.emit("hook:aborted", { hook, context: currentContext });
					break;
				}

				this.updateStats(hookId, true, false, false, Date.now() - startTime);
			} catch (error) {
				this.updateStats(hookId, false, true, false, Date.now() - startTime);
				this.emit("hook:error", { hook, error, context: currentContext });

				if (!this.config.continueOnError) {
					throw error;
				}
			}
		}

		return currentContext;
	}

	private async executeHook<T extends AnyHookContext>(hook: Hook<T>, context: T): Promise<T | undefined> {
		return Promise.race([
			hook.handler(context),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error(`Hook ${hook.name} timed out`)), hook.timeout),
			),
		]);
	}

	// ---------------------------------------------------------------------------
	// Convenience Methods for Wrapping
	// ---------------------------------------------------------------------------

	async wrapTool<T>(toolName: string, params: Record<string, unknown>, executor: () => Promise<T>): Promise<T> {
		// Before hook
		const beforeContext = await this.run<ToolHookContext>("beforeTool", {
			type: "beforeTool",
			name: `tool:${toolName}`,
			timestamp: Date.now(),
			metadata: {},
			aborted: false,
			toolName,
			params,
		});

		if (beforeContext.aborted) {
			throw new Error(`Tool ${toolName} aborted: ${beforeContext.abortReason}`);
		}

		const startTime = Date.now();
		let result: T;
		let error: Error | undefined;

		try {
			result = await executor();
		} catch (e) {
			error = e as Error;
			throw e;
		} finally {
			// After hook
			await this.run<ToolHookContext>("afterTool", {
				type: "afterTool",
				name: `tool:${toolName}`,
				timestamp: Date.now(),
				metadata: {},
				aborted: false,
				toolName,
				params,
				result: result!,
				error,
				duration: Date.now() - startTime,
			});
		}

		return result!;
	}

	async wrapLLM<T extends string>(model: string, prompt: string, executor: () => Promise<T>): Promise<T> {
		// Before hook
		const beforeContext = await this.run<LLMHookContext>("beforeLLM", {
			type: "beforeLLM",
			name: `llm:${model}`,
			timestamp: Date.now(),
			metadata: {},
			aborted: false,
			model,
			prompt,
		});

		if (beforeContext.aborted) {
			throw new Error(`LLM call aborted: ${beforeContext.abortReason}`);
		}

		const startTime = Date.now();
		let response: T;

		try {
			response = await executor();
		} finally {
			// After hook
			await this.run<LLMHookContext>("afterLLM", {
				type: "afterLLM",
				name: `llm:${model}`,
				timestamp: Date.now(),
				metadata: {},
				aborted: false,
				model,
				prompt,
				response: response!,
				duration: Date.now() - startTime,
			});
		}

		return response!;
	}

	async wrapTask<T>(taskId: string, task: string, executor: () => Promise<T>): Promise<T> {
		// Before hook
		const beforeContext = await this.run<TaskHookContext>("beforeTask", {
			type: "beforeTask",
			name: `task:${taskId}`,
			timestamp: Date.now(),
			metadata: {},
			aborted: false,
			taskId,
			task,
		});

		if (beforeContext.aborted) {
			throw new Error(`Task ${taskId} aborted: ${beforeContext.abortReason}`);
		}

		const startTime = Date.now();
		let result: T;
		let error: Error | undefined;

		try {
			result = await executor();
		} catch (e) {
			error = e as Error;

			// Error hook
			await this.run<ErrorHookContext>("onError", {
				type: "onError",
				name: `error:${taskId}`,
				timestamp: Date.now(),
				metadata: {},
				aborted: false,
				error,
				source: `task:${taskId}`,
				recoverable: false,
			});

			throw e;
		} finally {
			// After hook
			await this.run<TaskHookContext>("afterTask", {
				type: "afterTask",
				name: `task:${taskId}`,
				timestamp: Date.now(),
				metadata: {},
				aborted: false,
				taskId,
				task,
				result: result!,
				error,
				duration: Date.now() - startTime,
			});
		}

		return result!;
	}

	// ---------------------------------------------------------------------------
	// Built-in Hook Factories
	// ---------------------------------------------------------------------------

	static createLoggingHook(type: HookType, logger: (msg: string) => void): HookHandler {
		return (context) => {
			logger(`[${type}] ${context.name} at ${new Date(context.timestamp).toISOString()}`);
			return context;
		};
	}

	static createValidationHook<T extends AnyHookContext>(
		validator: (context: T) => boolean,
		errorMessage: string,
	): HookHandler<T> {
		return (context) => {
			if (!validator(context)) {
				context.aborted = true;
				context.abortReason = errorMessage;
			}
			return context;
		};
	}

	static createRateLimitHook(maxCalls: number, windowMs: number): { handler: HookHandler; reset: () => void } {
		const calls: number[] = [];

		return {
			handler: (context) => {
				const now = Date.now();
				const windowStart = now - windowMs;

				// Remove old calls
				while (calls.length > 0 && calls[0] < windowStart) {
					calls.shift();
				}

				if (calls.length >= maxCalls) {
					context.aborted = true;
					context.abortReason = `Rate limit exceeded: ${maxCalls} calls per ${windowMs}ms`;
					return context;
				}

				calls.push(now);
				return context;
			},
			reset: () => {
				calls.length = 0;
			},
		};
	}

	static createRetryHook(maxRetries: number, delayMs: number): HookHandler<ErrorHookContext> {
		const retryCounts = new Map<string, number>();

		return async (context) => {
			const key = context.source;
			const attempts = retryCounts.get(key) || 0;

			if (attempts < maxRetries) {
				retryCounts.set(key, attempts + 1);
				context.recoverable = true;
				context.recovery = async () => {
					await new Promise((resolve) => setTimeout(resolve, delayMs * (attempts + 1)));
				};
			} else {
				retryCounts.delete(key);
			}

			return context;
		};
	}

	static createTransformHook<T extends ToolHookContext>(
		transformer: (params: Record<string, unknown>) => Record<string, unknown>,
	): HookHandler<T> {
		return (context) => {
			context.params = transformer(context.params);
			return context;
		};
	}

	// ---------------------------------------------------------------------------
	// Stats & Queries
	// ---------------------------------------------------------------------------

	private sortHooksByPriority(hookIds: string[]): string[] {
		return hookIds.sort((a, b) => {
			const hookA = this.hooks.get(a);
			const hookB = this.hooks.get(b);
			if (!hookA || !hookB) return 0;
			return PRIORITY_ORDER[hookA.priority] - PRIORITY_ORDER[hookB.priority];
		});
	}

	private updateStats(hookId: string, success: boolean, failure: boolean, abort: boolean, duration: number): void {
		if (!this.config.enableStats) return;

		const stats = this.stats.get(hookId);
		if (!stats) return;

		stats.invocations++;
		if (success) stats.successes++;
		if (failure) stats.failures++;
		if (abort) stats.aborts++;
		stats.avgDuration = (stats.avgDuration * (stats.invocations - 1) + duration) / stats.invocations;
		stats.lastInvoked = Date.now();
	}

	getHooks(type?: HookType): Hook<any>[] {
		if (type) {
			const hookIds = this.hooksByType.get(type) || [];
			return hookIds.map((id) => this.hooks.get(id)!).filter(Boolean);
		}
		return Array.from(this.hooks.values());
	}

	getStats(hookId?: string): HookStats | HookStats[] | null {
		if (hookId) {
			return this.stats.get(hookId) || null;
		}
		return Array.from(this.stats.values());
	}

	getHooksByPriority(type: HookType): Map<HookPriority, Hook<any>[]> {
		const result = new Map<HookPriority, Hook<any>[]>();
		const priorities: HookPriority[] = ["first", "high", "normal", "low", "last"];

		for (const priority of priorities) {
			result.set(priority, []);
		}

		const hookIds = this.hooksByType.get(type) || [];
		for (const hookId of hookIds) {
			const hook = this.hooks.get(hookId);
			if (hook) {
				result.get(hook.priority)!.push(hook);
			}
		}

		return result;
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	clear(): void {
		this.hooks.clear();
		for (const [type] of this.hooksByType) {
			this.hooksByType.set(type, []);
		}
		this.stats.clear();
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: HooksSystem | null = null;

export function getHooksSystem(config?: Partial<HooksConfig>): HooksSystem {
	if (!instance) {
		instance = new HooksSystem(config);
	}
	return instance;
}

export function resetHooksSystem(): void {
	if (instance) {
		instance.clear();
	}
	instance = null;
}
