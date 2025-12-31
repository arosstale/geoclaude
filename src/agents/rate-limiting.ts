/**
 * Class 3.16: Rate Limiting System
 * TAC Pattern: API rate limiting, throttling, and quota management
 *
 * Features:
 * - Per-user, per-channel, per-agent rate limits
 * - Sliding window and token bucket algorithms
 * - Quota management with reset periods
 * - Priority-based request queuing
 * - Adaptive rate limiting based on load
 * - Rate limit sharing across instances
 */

import Database from "better-sqlite3";
import { EventEmitter } from "events";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export type RateLimitScope = "global" | "user" | "channel" | "agent" | "endpoint";
export type RateLimitAlgorithm = "sliding_window" | "token_bucket" | "fixed_window" | "leaky_bucket";
export type QuotaPeriod = "minute" | "hour" | "day" | "week" | "month";
export type RequestPriority = "low" | "normal" | "high" | "critical";

export interface RateLimitRule {
	id: string;
	name: string;
	scope: RateLimitScope;
	scopeId?: string; // Specific user/channel/agent/endpoint ID
	algorithm: RateLimitAlgorithm;
	limit: number; // Max requests
	windowMs: number; // Time window in milliseconds
	burstLimit?: number; // For token bucket: max burst size
	refillRate?: number; // For token bucket: tokens per second
	priority: number; // Rule priority (higher = evaluated first)
	enabled: boolean;
	createdAt: Date;
	metadata?: Record<string, unknown>;
}

export interface RateLimitState {
	ruleId: string;
	key: string; // Composite key: scope:scopeId:targetId
	count: number;
	windowStart: number;
	tokens?: number; // For token bucket
	lastRefill?: number; // For token bucket
	lastRequest?: number;
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	limit: number;
	resetAt: Date;
	retryAfter?: number; // Milliseconds until allowed
	rule?: RateLimitRule;
	queuePosition?: number;
}

export interface Quota {
	id: string;
	name: string;
	scope: RateLimitScope;
	scopeId?: string;
	limit: number;
	period: QuotaPeriod;
	used: number;
	resetAt: Date;
	createdAt: Date;
	enabled: boolean;
}

export interface QuotaStatus {
	quota: Quota;
	remaining: number;
	percentUsed: number;
	isExhausted: boolean;
	resetIn: number; // Milliseconds
}

export interface QueuedRequest {
	id: string;
	key: string;
	priority: RequestPriority;
	callback: () => Promise<void>;
	queuedAt: Date;
	timeoutMs: number;
	metadata?: Record<string, unknown>;
}

export interface RateLimitStats {
	totalRules: number;
	activeRules: number;
	totalQuotas: number;
	requestsAllowed: number;
	requestsDenied: number;
	queuedRequests: number;
	avgWaitTime: number;
}

export interface RateLimitConfig {
	dataDir: string;
	defaultAlgorithm: RateLimitAlgorithm;
	defaultWindowMs: number;
	defaultLimit: number;
	enableQueue: boolean;
	maxQueueSize: number;
	maxQueueWaitMs: number;
	cleanupIntervalMs: number;
}

// ============================================================================
// Rate Limiting System
// ============================================================================

export class RateLimitingSystem extends EventEmitter {
	private db: Database.Database;
	private config: RateLimitConfig;
	private rules: Map<string, RateLimitRule> = new Map();
	private states: Map<string, RateLimitState> = new Map();
	private queue: QueuedRequest[] = [];
	private cleanupInterval: NodeJS.Timeout | null = null;
	private queueInterval: NodeJS.Timeout | null = null;
	private stats = {
		requestsAllowed: 0,
		requestsDenied: 0,
		totalWaitTime: 0,
		processedRequests: 0,
	};

	constructor(config: RateLimitConfig) {
		super();
		this.config = config;
		this.db = new Database(join(config.dataDir, "rate_limiting.db"));
		this.initializeDatabase();
		this.loadRules();
		this.startCleanupScheduler();
		if (config.enableQueue) {
			this.startQueueProcessor();
		}
	}

	private initializeDatabase(): void {
		this.db.pragma("journal_mode = WAL");

		// Rate limit rules table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS rate_limit_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_id TEXT,
        algorithm TEXT NOT NULL,
        limit_count INTEGER NOT NULL,
        window_ms INTEGER NOT NULL,
        burst_limit INTEGER,
        refill_rate REAL,
        priority INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        metadata TEXT
      )
    `);

		// Rate limit states table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS rate_limit_states (
        rule_id TEXT NOT NULL,
        key TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        window_start INTEGER NOT NULL,
        tokens REAL,
        last_refill INTEGER,
        last_request INTEGER,
        PRIMARY KEY (rule_id, key),
        FOREIGN KEY (rule_id) REFERENCES rate_limit_rules(id)
      )
    `);

		// Quotas table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS quotas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_id TEXT,
        limit_count INTEGER NOT NULL,
        period TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        reset_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1
      )
    `);

		// Rate limit events log
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS rate_limit_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        rule_id TEXT,
        key TEXT NOT NULL,
        action TEXT NOT NULL,
        allowed INTEGER NOT NULL,
        remaining INTEGER,
        wait_time INTEGER,
        metadata TEXT
      )
    `);

		// Indexes
		this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_rules_scope ON rate_limit_rules(scope, scope_id);
      CREATE INDEX IF NOT EXISTS idx_states_key ON rate_limit_states(key);
      CREATE INDEX IF NOT EXISTS idx_quotas_scope ON quotas(scope, scope_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON rate_limit_events(timestamp);
    `);
	}

	private loadRules(): void {
		const stmt = this.db.prepare("SELECT * FROM rate_limit_rules WHERE enabled = 1 ORDER BY priority DESC");
		const rows = stmt.all() as Record<string, unknown>[];

		for (const row of rows) {
			const rule: RateLimitRule = {
				id: row.id as string,
				name: row.name as string,
				scope: row.scope as RateLimitScope,
				scopeId: row.scope_id as string | undefined,
				algorithm: row.algorithm as RateLimitAlgorithm,
				limit: row.limit_count as number,
				windowMs: row.window_ms as number,
				burstLimit: row.burst_limit as number | undefined,
				refillRate: row.refill_rate as number | undefined,
				priority: row.priority as number,
				enabled: Boolean(row.enabled),
				createdAt: new Date(row.created_at as string),
				metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
			};
			this.rules.set(rule.id, rule);
		}
	}

	private startCleanupScheduler(): void {
		this.cleanupInterval = setInterval(() => {
			this.cleanupExpiredStates();
		}, this.config.cleanupIntervalMs);
	}

	private startQueueProcessor(): void {
		this.queueInterval = setInterval(() => {
			this.processQueue();
		}, 100); // Check queue every 100ms
	}

	private cleanupExpiredStates(): void {
		const now = Date.now();

		// Clean up in-memory states
		for (const [key, state] of this.states) {
			const rule = this.rules.get(state.ruleId);
			if (!rule) {
				this.states.delete(key);
				continue;
			}

			if (now - state.windowStart > rule.windowMs * 2) {
				this.states.delete(key);
			}
		}

		// Clean up database states
		const stmt = this.db.prepare(`
      DELETE FROM rate_limit_states
      WHERE last_request < ?
    `);
		const cutoff = now - 24 * 60 * 60 * 1000; // 24 hours ago
		stmt.run(cutoff);

		// Clean up old events
		const eventCutoff = new Date();
		eventCutoff.setDate(eventCutoff.getDate() - 7);
		const eventStmt = this.db.prepare("DELETE FROM rate_limit_events WHERE timestamp < ?");
		eventStmt.run(eventCutoff.toISOString());
	}

	// ============================================================================
	// Rule Management
	// ============================================================================

	createRule(params: {
		name: string;
		scope: RateLimitScope;
		scopeId?: string;
		algorithm?: RateLimitAlgorithm;
		limit: number;
		windowMs: number;
		burstLimit?: number;
		refillRate?: number;
		priority?: number;
		metadata?: Record<string, unknown>;
	}): RateLimitRule {
		const id = `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		const rule: RateLimitRule = {
			id,
			name: params.name,
			scope: params.scope,
			scopeId: params.scopeId,
			algorithm: params.algorithm ?? this.config.defaultAlgorithm,
			limit: params.limit,
			windowMs: params.windowMs,
			burstLimit: params.burstLimit,
			refillRate: params.refillRate,
			priority: params.priority ?? 0,
			enabled: true,
			createdAt: new Date(),
			metadata: params.metadata,
		};

		const stmt = this.db.prepare(`
      INSERT INTO rate_limit_rules
      (id, name, scope, scope_id, algorithm, limit_count, window_ms, burst_limit, refill_rate, priority, enabled, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			rule.id,
			rule.name,
			rule.scope,
			rule.scopeId ?? null,
			rule.algorithm,
			rule.limit,
			rule.windowMs,
			rule.burstLimit ?? null,
			rule.refillRate ?? null,
			rule.priority,
			1,
			rule.createdAt.toISOString(),
			rule.metadata ? JSON.stringify(rule.metadata) : null,
		);

		this.rules.set(rule.id, rule);
		this.emit("rule:created", rule);
		return rule;
	}

	getRule(ruleId: string): RateLimitRule | null {
		return this.rules.get(ruleId) ?? null;
	}

	getAllRules(enabledOnly: boolean = true): RateLimitRule[] {
		if (enabledOnly) {
			return Array.from(this.rules.values()).filter((r) => r.enabled);
		}

		const stmt = this.db.prepare("SELECT * FROM rate_limit_rules ORDER BY priority DESC");
		const rows = stmt.all() as Record<string, unknown>[];

		return rows.map((row) => ({
			id: row.id as string,
			name: row.name as string,
			scope: row.scope as RateLimitScope,
			scopeId: row.scope_id as string | undefined,
			algorithm: row.algorithm as RateLimitAlgorithm,
			limit: row.limit_count as number,
			windowMs: row.window_ms as number,
			burstLimit: row.burst_limit as number | undefined,
			refillRate: row.refill_rate as number | undefined,
			priority: row.priority as number,
			enabled: Boolean(row.enabled),
			createdAt: new Date(row.created_at as string),
			metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
		}));
	}

	updateRule(ruleId: string, updates: Partial<Omit<RateLimitRule, "id" | "createdAt">>): RateLimitRule | null {
		const rule = this.rules.get(ruleId);
		if (!rule) return null;

		const updatedRule = { ...rule, ...updates };

		const stmt = this.db.prepare(`
      UPDATE rate_limit_rules
      SET name = ?, scope = ?, scope_id = ?, algorithm = ?, limit_count = ?,
          window_ms = ?, burst_limit = ?, refill_rate = ?, priority = ?,
          enabled = ?, metadata = ?
      WHERE id = ?
    `);

		stmt.run(
			updatedRule.name,
			updatedRule.scope,
			updatedRule.scopeId ?? null,
			updatedRule.algorithm,
			updatedRule.limit,
			updatedRule.windowMs,
			updatedRule.burstLimit ?? null,
			updatedRule.refillRate ?? null,
			updatedRule.priority,
			updatedRule.enabled ? 1 : 0,
			updatedRule.metadata ? JSON.stringify(updatedRule.metadata) : null,
			ruleId,
		);

		this.rules.set(ruleId, updatedRule);
		this.emit("rule:updated", updatedRule);
		return updatedRule;
	}

	disableRule(ruleId: string): boolean {
		const result = this.updateRule(ruleId, { enabled: false });
		if (result) {
			this.rules.delete(ruleId);
			return true;
		}
		return false;
	}

	// ============================================================================
	// Rate Limiting Core
	// ============================================================================

	check(params: { scope: RateLimitScope; targetId: string; scopeId?: string }): RateLimitResult {
		const { scope, targetId, scopeId } = params;
		const now = Date.now();

		// Find matching rules (sorted by priority)
		const matchingRules = this.findMatchingRules(scope, scopeId);

		if (matchingRules.length === 0) {
			// No rules, allow by default
			return {
				allowed: true,
				remaining: Infinity,
				limit: Infinity,
				resetAt: new Date(now + this.config.defaultWindowMs),
			};
		}

		// Check against each rule
		for (const rule of matchingRules) {
			const key = this.buildKey(rule, targetId);
			const result = this.checkRule(rule, key, now);

			if (!result.allowed) {
				this.logEvent(rule.id, key, "denied", false, result.remaining, result.retryAfter);
				this.stats.requestsDenied++;
				return result;
			}
		}

		// All rules passed - use the most restrictive remaining
		const strictestRule = matchingRules[0];
		const key = this.buildKey(strictestRule, targetId);
		const state = this.getOrCreateState(strictestRule, key, now);

		// Consume a token/increment counter
		this.consumeRequest(strictestRule, state, now);

		const result: RateLimitResult = {
			allowed: true,
			remaining: this.getRemainingRequests(strictestRule, state, now),
			limit: strictestRule.limit,
			resetAt: new Date(state.windowStart + strictestRule.windowMs),
			rule: strictestRule,
		};

		this.logEvent(strictestRule.id, key, "allowed", true, result.remaining);
		this.stats.requestsAllowed++;

		return result;
	}

	private findMatchingRules(scope: RateLimitScope, scopeId?: string): RateLimitRule[] {
		const rules = Array.from(this.rules.values())
			.filter((r) => r.enabled)
			.filter((r) => {
				// Global rules match everything
				if (r.scope === "global") return true;

				// Scope must match
				if (r.scope !== scope) return false;

				// If rule has specific scopeId, it must match
				if (r.scopeId && r.scopeId !== scopeId) return false;

				return true;
			})
			.sort((a, b) => b.priority - a.priority);

		return rules;
	}

	private buildKey(rule: RateLimitRule, targetId: string): string {
		if (rule.scopeId) {
			return `${rule.scope}:${rule.scopeId}:${targetId}`;
		}
		return `${rule.scope}:*:${targetId}`;
	}

	private getOrCreateState(rule: RateLimitRule, key: string, now: number): RateLimitState {
		const stateKey = `${rule.id}:${key}`;
		let state = this.states.get(stateKey);

		if (!state) {
			// Try to load from database
			const stmt = this.db.prepare("SELECT * FROM rate_limit_states WHERE rule_id = ? AND key = ?");
			const row = stmt.get(rule.id, key) as Record<string, unknown> | undefined;

			if (row) {
				state = {
					ruleId: row.rule_id as string,
					key: row.key as string,
					count: row.count as number,
					windowStart: row.window_start as number,
					tokens: row.tokens as number | undefined,
					lastRefill: row.last_refill as number | undefined,
					lastRequest: row.last_request as number | undefined,
				};
			} else {
				state = {
					ruleId: rule.id,
					key,
					count: 0,
					windowStart: now,
					tokens: rule.burstLimit ?? rule.limit,
					lastRefill: now,
					lastRequest: now,
				};
			}

			this.states.set(stateKey, state);
		}

		// Check if window has expired
		if (rule.algorithm === "fixed_window" && now - state.windowStart >= rule.windowMs) {
			state.count = 0;
			state.windowStart = now;
		}

		return state;
	}

	private checkRule(rule: RateLimitRule, key: string, now: number): RateLimitResult {
		const state = this.getOrCreateState(rule, key, now);

		switch (rule.algorithm) {
			case "sliding_window":
				return this.checkSlidingWindow(rule, state, now);
			case "fixed_window":
				return this.checkFixedWindow(rule, state, now);
			case "token_bucket":
				return this.checkTokenBucket(rule, state, now);
			case "leaky_bucket":
				return this.checkLeakyBucket(rule, state, now);
			default:
				return this.checkSlidingWindow(rule, state, now);
		}
	}

	private checkSlidingWindow(rule: RateLimitRule, state: RateLimitState, now: number): RateLimitResult {
		const windowStart = now - rule.windowMs;
		const effectiveCount = state.windowStart >= windowStart ? state.count : 0;

		if (effectiveCount >= rule.limit) {
			const retryAfter = state.windowStart + rule.windowMs - now;
			return {
				allowed: false,
				remaining: 0,
				limit: rule.limit,
				resetAt: new Date(state.windowStart + rule.windowMs),
				retryAfter: Math.max(0, retryAfter),
				rule,
			};
		}

		return {
			allowed: true,
			remaining: rule.limit - effectiveCount - 1,
			limit: rule.limit,
			resetAt: new Date(state.windowStart + rule.windowMs),
			rule,
		};
	}

	private checkFixedWindow(rule: RateLimitRule, state: RateLimitState, now: number): RateLimitResult {
		if (state.count >= rule.limit) {
			const retryAfter = state.windowStart + rule.windowMs - now;
			return {
				allowed: false,
				remaining: 0,
				limit: rule.limit,
				resetAt: new Date(state.windowStart + rule.windowMs),
				retryAfter: Math.max(0, retryAfter),
				rule,
			};
		}

		return {
			allowed: true,
			remaining: rule.limit - state.count - 1,
			limit: rule.limit,
			resetAt: new Date(state.windowStart + rule.windowMs),
			rule,
		};
	}

	private checkTokenBucket(rule: RateLimitRule, state: RateLimitState, now: number): RateLimitResult {
		const refillRate = rule.refillRate ?? rule.limit / (rule.windowMs / 1000);
		const maxTokens = rule.burstLimit ?? rule.limit;

		// Refill tokens
		const timeSinceRefill = (now - (state.lastRefill ?? now)) / 1000;
		const newTokens = Math.min(maxTokens, (state.tokens ?? 0) + timeSinceRefill * refillRate);

		if (newTokens < 1) {
			const tokensNeeded = 1 - newTokens;
			const retryAfter = (tokensNeeded / refillRate) * 1000;
			return {
				allowed: false,
				remaining: 0,
				limit: maxTokens,
				resetAt: new Date(now + retryAfter),
				retryAfter,
				rule,
			};
		}

		// Update state with refilled tokens
		state.tokens = newTokens;
		state.lastRefill = now;

		return {
			allowed: true,
			remaining: Math.floor(newTokens) - 1,
			limit: maxTokens,
			resetAt: new Date(now + ((maxTokens - newTokens + 1) / refillRate) * 1000),
			rule,
		};
	}

	private checkLeakyBucket(rule: RateLimitRule, state: RateLimitState, now: number): RateLimitResult {
		const leakRate = rule.refillRate ?? rule.limit / (rule.windowMs / 1000);
		const maxBucket = rule.burstLimit ?? rule.limit;

		// Leak out requests
		const timeSinceLast = (now - (state.lastRequest ?? now)) / 1000;
		const leaked = Math.floor(timeSinceLast * leakRate);
		const currentLevel = Math.max(0, state.count - leaked);

		if (currentLevel >= maxBucket) {
			const overflow = currentLevel - maxBucket + 1;
			const retryAfter = (overflow / leakRate) * 1000;
			return {
				allowed: false,
				remaining: 0,
				limit: maxBucket,
				resetAt: new Date(now + retryAfter),
				retryAfter,
				rule,
			};
		}

		return {
			allowed: true,
			remaining: maxBucket - currentLevel - 1,
			limit: maxBucket,
			resetAt: new Date(now + ((maxBucket - currentLevel) / leakRate) * 1000),
			rule,
		};
	}

	private consumeRequest(rule: RateLimitRule, state: RateLimitState, now: number): void {
		switch (rule.algorithm) {
			case "token_bucket":
				state.tokens = (state.tokens ?? rule.limit) - 1;
				state.lastRefill = now;
				break;
			case "leaky_bucket": {
				const leakRate = rule.refillRate ?? rule.limit / (rule.windowMs / 1000);
				const timeSinceLast = (now - (state.lastRequest ?? now)) / 1000;
				const leaked = Math.floor(timeSinceLast * leakRate);
				state.count = Math.max(0, state.count - leaked) + 1;
				break;
			}
			default:
				state.count++;
		}

		state.lastRequest = now;
		this.saveState(state);
	}

	private getRemainingRequests(rule: RateLimitRule, state: RateLimitState, now: number): number {
		switch (rule.algorithm) {
			case "token_bucket":
				return Math.max(0, Math.floor(state.tokens ?? 0) - 1);
			case "leaky_bucket": {
				const leakRate = rule.refillRate ?? rule.limit / (rule.windowMs / 1000);
				const maxBucket = rule.burstLimit ?? rule.limit;
				const timeSinceLast = (now - (state.lastRequest ?? now)) / 1000;
				const leaked = Math.floor(timeSinceLast * leakRate);
				const currentLevel = Math.max(0, state.count - leaked);
				return Math.max(0, maxBucket - currentLevel);
			}
			default:
				return Math.max(0, rule.limit - state.count);
		}
	}

	private saveState(state: RateLimitState): void {
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO rate_limit_states
      (rule_id, key, count, window_start, tokens, last_refill, last_request)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			state.ruleId,
			state.key,
			state.count,
			state.windowStart,
			state.tokens ?? null,
			state.lastRefill ?? null,
			state.lastRequest ?? null,
		);
	}

	private logEvent(
		ruleId: string | undefined,
		key: string,
		action: string,
		allowed: boolean,
		remaining?: number,
		waitTime?: number,
	): void {
		const stmt = this.db.prepare(`
      INSERT INTO rate_limit_events (id, timestamp, rule_id, key, action, allowed, remaining, wait_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			`evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			new Date().toISOString(),
			ruleId ?? null,
			key,
			action,
			allowed ? 1 : 0,
			remaining ?? null,
			waitTime ?? null,
		);
	}

	// ============================================================================
	// Request Queue
	// ============================================================================

	async enqueue(params: {
		scope: RateLimitScope;
		targetId: string;
		scopeId?: string;
		priority?: RequestPriority;
		callback: () => Promise<void>;
		timeoutMs?: number;
		metadata?: Record<string, unknown>;
	}): Promise<RateLimitResult> {
		if (!this.config.enableQueue) {
			return this.check({
				scope: params.scope,
				targetId: params.targetId,
				scopeId: params.scopeId,
			});
		}

		const result = this.check({
			scope: params.scope,
			targetId: params.targetId,
			scopeId: params.scopeId,
		});

		if (result.allowed) {
			await params.callback();
			return result;
		}

		// Check queue capacity
		if (this.queue.length >= this.config.maxQueueSize) {
			return {
				...result,
				queuePosition: -1, // Queue full
			};
		}

		// Add to queue
		const queuedRequest: QueuedRequest = {
			id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			key: `${params.scope}:${params.scopeId ?? "*"}:${params.targetId}`,
			priority: params.priority ?? "normal",
			callback: params.callback,
			queuedAt: new Date(),
			timeoutMs: params.timeoutMs ?? this.config.maxQueueWaitMs,
			metadata: params.metadata,
		};

		// Insert in priority order
		const priorityOrder: Record<RequestPriority, number> = {
			critical: 4,
			high: 3,
			normal: 2,
			low: 1,
		};

		const insertIndex = this.queue.findIndex(
			(r) => priorityOrder[r.priority] < priorityOrder[queuedRequest.priority],
		);

		if (insertIndex === -1) {
			this.queue.push(queuedRequest);
		} else {
			this.queue.splice(insertIndex, 0, queuedRequest);
		}

		this.emit("request:queued", queuedRequest);

		return {
			...result,
			queuePosition: insertIndex === -1 ? this.queue.length : insertIndex + 1,
		};
	}

	private async processQueue(): Promise<void> {
		if (this.queue.length === 0) return;

		const now = Date.now();
		const toRemove: number[] = [];

		for (let i = 0; i < this.queue.length; i++) {
			const request = this.queue[i];

			// Check timeout
			if (now - request.queuedAt.getTime() > request.timeoutMs) {
				toRemove.push(i);
				this.emit("request:timeout", request);
				continue;
			}

			// Try to process
			const [scope, scopeId, targetId] = request.key.split(":");
			const result = this.check({
				scope: scope as RateLimitScope,
				targetId,
				scopeId: scopeId === "*" ? undefined : scopeId,
			});

			if (result.allowed) {
				toRemove.push(i);
				const waitTime = now - request.queuedAt.getTime();
				this.stats.totalWaitTime += waitTime;
				this.stats.processedRequests++;

				try {
					await request.callback();
					this.emit("request:processed", { request, waitTime });
				} catch (error) {
					this.emit("request:error", { request, error });
				}
			}
		}

		// Remove processed/timed out requests (in reverse order to preserve indices)
		for (let i = toRemove.length - 1; i >= 0; i--) {
			this.queue.splice(toRemove[i], 1);
		}
	}

	getQueueStatus(): { length: number; requests: QueuedRequest[] } {
		return {
			length: this.queue.length,
			requests: [...this.queue],
		};
	}

	// ============================================================================
	// Quota Management
	// ============================================================================

	createQuota(params: {
		name: string;
		scope: RateLimitScope;
		scopeId?: string;
		limit: number;
		period: QuotaPeriod;
	}): Quota {
		const id = `quota_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const resetAt = this.calculateQuotaReset(params.period);

		const quota: Quota = {
			id,
			name: params.name,
			scope: params.scope,
			scopeId: params.scopeId,
			limit: params.limit,
			period: params.period,
			used: 0,
			resetAt,
			createdAt: new Date(),
			enabled: true,
		};

		const stmt = this.db.prepare(`
      INSERT INTO quotas
      (id, name, scope, scope_id, limit_count, period, used, reset_at, created_at, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			quota.id,
			quota.name,
			quota.scope,
			quota.scopeId ?? null,
			quota.limit,
			quota.period,
			quota.used,
			quota.resetAt.toISOString(),
			quota.createdAt.toISOString(),
			1,
		);

		this.emit("quota:created", quota);
		return quota;
	}

	private calculateQuotaReset(period: QuotaPeriod): Date {
		const now = new Date();
		const reset = new Date(now);

		switch (period) {
			case "minute":
				reset.setMinutes(reset.getMinutes() + 1, 0, 0);
				break;
			case "hour":
				reset.setHours(reset.getHours() + 1, 0, 0, 0);
				break;
			case "day":
				reset.setDate(reset.getDate() + 1);
				reset.setHours(0, 0, 0, 0);
				break;
			case "week": {
				const daysUntilMonday = (8 - reset.getDay()) % 7 || 7;
				reset.setDate(reset.getDate() + daysUntilMonday);
				reset.setHours(0, 0, 0, 0);
				break;
			}
			case "month":
				reset.setMonth(reset.getMonth() + 1, 1);
				reset.setHours(0, 0, 0, 0);
				break;
		}

		return reset;
	}

	checkQuota(quotaId: string): QuotaStatus | null {
		const stmt = this.db.prepare("SELECT * FROM quotas WHERE id = ? AND enabled = 1");
		const row = stmt.get(quotaId) as Record<string, unknown> | undefined;

		if (!row) return null;

		const quota: Quota = {
			id: row.id as string,
			name: row.name as string,
			scope: row.scope as RateLimitScope,
			scopeId: row.scope_id as string | undefined,
			limit: row.limit_count as number,
			period: row.period as QuotaPeriod,
			used: row.used as number,
			resetAt: new Date(row.reset_at as string),
			createdAt: new Date(row.created_at as string),
			enabled: Boolean(row.enabled),
		};

		// Check if quota needs reset
		const now = new Date();
		if (now >= quota.resetAt) {
			quota.used = 0;
			quota.resetAt = this.calculateQuotaReset(quota.period);

			const updateStmt = this.db.prepare(`
        UPDATE quotas SET used = 0, reset_at = ? WHERE id = ?
      `);
			updateStmt.run(quota.resetAt.toISOString(), quota.id);
		}

		return {
			quota,
			remaining: Math.max(0, quota.limit - quota.used),
			percentUsed: (quota.used / quota.limit) * 100,
			isExhausted: quota.used >= quota.limit,
			resetIn: quota.resetAt.getTime() - Date.now(),
		};
	}

	consumeQuota(quotaId: string, amount: number = 1): QuotaStatus | null {
		const status = this.checkQuota(quotaId);
		if (!status) return null;

		if (status.isExhausted) {
			return status;
		}

		const newUsed = Math.min(status.quota.limit, status.quota.used + amount);
		const stmt = this.db.prepare("UPDATE quotas SET used = ? WHERE id = ?");
		stmt.run(newUsed, quotaId);

		status.quota.used = newUsed;
		status.remaining = Math.max(0, status.quota.limit - newUsed);
		status.percentUsed = (newUsed / status.quota.limit) * 100;
		status.isExhausted = newUsed >= status.quota.limit;

		this.emit("quota:consumed", { quotaId, amount, status });
		return status;
	}

	getAllQuotas(enabledOnly: boolean = true): Quota[] {
		const query = enabledOnly
			? "SELECT * FROM quotas WHERE enabled = 1 ORDER BY created_at DESC"
			: "SELECT * FROM quotas ORDER BY created_at DESC";

		const stmt = this.db.prepare(query);
		const rows = stmt.all() as Record<string, unknown>[];

		return rows.map((row) => ({
			id: row.id as string,
			name: row.name as string,
			scope: row.scope as RateLimitScope,
			scopeId: row.scope_id as string | undefined,
			limit: row.limit_count as number,
			period: row.period as QuotaPeriod,
			used: row.used as number,
			resetAt: new Date(row.reset_at as string),
			createdAt: new Date(row.created_at as string),
			enabled: Boolean(row.enabled),
		}));
	}

	// ============================================================================
	// Statistics
	// ============================================================================

	getStats(): RateLimitStats {
		const avgWaitTime =
			this.stats.processedRequests > 0 ? this.stats.totalWaitTime / this.stats.processedRequests : 0;

		return {
			totalRules: this.getAllRules(false).length,
			activeRules: this.rules.size,
			totalQuotas: this.getAllQuotas(false).length,
			requestsAllowed: this.stats.requestsAllowed,
			requestsDenied: this.stats.requestsDenied,
			queuedRequests: this.queue.length,
			avgWaitTime,
		};
	}

	resetStats(): void {
		this.stats = {
			requestsAllowed: 0,
			requestsDenied: 0,
			totalWaitTime: 0,
			processedRequests: 0,
		};
		this.emit("stats:reset");
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	shutdown(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		if (this.queueInterval) {
			clearInterval(this.queueInterval);
			this.queueInterval = null;
		}
		this.db.close();
		this.emit("shutdown");
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

let rateLimitingInstance: RateLimitingSystem | null = null;

export function getRateLimiting(config?: RateLimitConfig): RateLimitingSystem {
	if (!rateLimitingInstance) {
		if (!config) {
			throw new Error("RateLimitingSystem requires config on first initialization");
		}
		rateLimitingInstance = new RateLimitingSystem(config);
	}
	return rateLimitingInstance;
}

export function resetRateLimiting(): void {
	if (rateLimitingInstance) {
		rateLimitingInstance.shutdown();
		rateLimitingInstance = null;
	}
}
