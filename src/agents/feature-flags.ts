/**
 * Class 3.51: Feature Flags
 * TAC Pattern: Runtime feature toggle system with targeting
 *
 * Features:
 * - Boolean, percentage, and variant flags
 * - User and group targeting
 * - Gradual rollout with percentage-based activation
 * - A/B testing with variant distribution
 * - Flag dependencies and prerequisites
 * - Override support for testing
 * - Comprehensive audit logging
 */

import { EventEmitter } from "events";

// ============================================================================
// Types
// ============================================================================

export type FlagType = "boolean" | "percentage" | "variant";
export type FlagStatus = "active" | "inactive" | "archived";
export type TargetType = "user" | "group" | "channel" | "agent" | "percentage" | "all";
export type AuditAction =
	| "flag_created"
	| "flag_updated"
	| "flag_deleted"
	| "flag_enabled"
	| "flag_disabled"
	| "flag_evaluated"
	| "override_set"
	| "override_removed"
	| "target_added"
	| "target_removed"
	| "variant_added"
	| "variant_removed";

export interface FeatureFlag {
	id: string;
	key: string;
	name: string;
	description: string;
	type: FlagType;
	status: FlagStatus;
	defaultValue: boolean | string;
	percentage?: number; // For percentage-based rollout (0-100)
	variants?: FlagVariant[];
	targets: FlagTarget[];
	dependencies: string[]; // Flag keys this depends on
	tags: string[];
	metadata: Record<string, unknown>;
	createdAt: Date;
	createdBy: string;
	updatedAt: Date;
	updatedBy?: string;
	expiresAt?: Date;
}

export interface FlagVariant {
	key: string;
	name: string;
	description?: string;
	weight: number; // Relative weight for distribution (0-100)
	payload?: Record<string, unknown>;
}

export interface FlagTarget {
	id: string;
	type: TargetType;
	identifier: string; // userId, groupId, channelId, etc.
	value: boolean | string; // Override value or variant key
	priority: number; // Higher priority wins
	enabled: boolean;
	createdAt: Date;
}

export interface FlagOverride {
	id: string;
	flagKey: string;
	targetType: TargetType;
	targetId: string;
	value: boolean | string;
	reason?: string;
	expiresAt?: Date;
	createdAt: Date;
	createdBy: string;
}

export interface EvaluationContext {
	userId?: string;
	groupId?: string;
	channelId?: string;
	agentId?: string;
	attributes?: Record<string, unknown>;
}

export interface EvaluationResult {
	flagKey: string;
	value: boolean | string;
	variant?: FlagVariant;
	reason: EvaluationReason;
	matchedTarget?: FlagTarget;
	override?: FlagOverride;
	timestamp: Date;
}

export type EvaluationReason =
	| "default"
	| "target_match"
	| "percentage_rollout"
	| "variant_distribution"
	| "override"
	| "dependency_not_met"
	| "flag_disabled"
	| "flag_not_found"
	| "flag_expired";

export interface AuditLogEntry {
	id: string;
	action: AuditAction;
	flagKey: string;
	userId: string;
	previousValue?: unknown;
	newValue?: unknown;
	context?: Record<string, unknown>;
	timestamp: Date;
	ipAddress?: string;
	userAgent?: string;
}

export interface FlagStats {
	flagKey: string;
	totalEvaluations: number;
	trueCount: number;
	falseCount: number;
	variantCounts: Record<string, number>;
	uniqueUsers: number;
	lastEvaluatedAt?: Date;
}

export interface FeatureFlagsConfig {
	enableAuditLogging: boolean;
	auditRetentionDays: number;
	enableCaching: boolean;
	cacheTtlMs: number;
	evaluationSampleRate: number; // 0-1, rate to log evaluations
	maxOverridesPerFlag: number;
	maxTargetsPerFlag: number;
	maxFlagsPerGroup: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: FeatureFlagsConfig = {
	enableAuditLogging: true,
	auditRetentionDays: 90,
	enableCaching: true,
	cacheTtlMs: 60000, // 1 minute cache
	evaluationSampleRate: 0.1, // Log 10% of evaluations
	maxOverridesPerFlag: 1000,
	maxTargetsPerFlag: 500,
	maxFlagsPerGroup: 100,
};

// ============================================================================
// Feature Flags System
// ============================================================================

export class FeatureFlagsSystem extends EventEmitter {
	private config: FeatureFlagsConfig;
	private flags: Map<string, FeatureFlag> = new Map();
	private overrides: Map<string, FlagOverride[]> = new Map(); // flagKey -> overrides
	private auditLog: AuditLogEntry[] = [];
	private evaluationCache: Map<string, { result: EvaluationResult; expiresAt: number }> = new Map();
	private stats: Map<string, FlagStats> = new Map();
	private cleanupInterval: NodeJS.Timeout | null = null;

	constructor(config: Partial<FeatureFlagsConfig> = {}) {
		super();
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.startBackgroundTasks();
	}

	private startBackgroundTasks(): void {
		// Cleanup old audit logs and expired overrides
		this.cleanupInterval = setInterval(() => {
			this.cleanup();
		}, 3600000); // Every hour
	}

	private cleanup(): void {
		const now = new Date();

		// Clean old audit logs
		if (this.config.enableAuditLogging) {
			const cutoff = new Date();
			cutoff.setDate(cutoff.getDate() - this.config.auditRetentionDays);
			this.auditLog = this.auditLog.filter((entry) => entry.timestamp >= cutoff);
		}

		// Clean expired overrides
		Array.from(this.overrides.entries()).forEach(([flagKey, flagOverrides]) => {
			const validOverrides = flagOverrides.filter((o) => !o.expiresAt || o.expiresAt > now);
			if (validOverrides.length !== flagOverrides.length) {
				this.overrides.set(flagKey, validOverrides);
			}
		});

		// Clean expired flags
		Array.from(this.flags.entries()).forEach(([key, flag]) => {
			if (flag.expiresAt && flag.expiresAt <= now) {
				flag.status = "archived";
				this.emit("flag:expired", { flagKey: key });
			}
		});

		// Clean evaluation cache
		Array.from(this.evaluationCache.entries()).forEach(([cacheKey, cached]) => {
			if (cached.expiresAt <= Date.now()) {
				this.evaluationCache.delete(cacheKey);
			}
		});

		this.emit("cleanup:completed");
	}

	// ============================================================================
	// Flag Management
	// ============================================================================

	createFlag(params: {
		key: string;
		name: string;
		description?: string;
		type: FlagType;
		defaultValue: boolean | string;
		percentage?: number;
		variants?: FlagVariant[];
		dependencies?: string[];
		tags?: string[];
		metadata?: Record<string, unknown>;
		createdBy: string;
		expiresAt?: Date;
	}): FeatureFlag {
		// Validate key uniqueness
		if (this.flags.has(params.key)) {
			throw new Error(`Flag with key "${params.key}" already exists`);
		}

		// Validate percentage
		if (
			params.type === "percentage" &&
			(params.percentage === undefined || params.percentage < 0 || params.percentage > 100)
		) {
			throw new Error("Percentage flags require a percentage value between 0 and 100");
		}

		// Validate variants
		if (params.type === "variant") {
			if (!params.variants || params.variants.length === 0) {
				throw new Error("Variant flags require at least one variant");
			}
			const totalWeight = params.variants.reduce((sum, v) => sum + v.weight, 0);
			if (totalWeight !== 100) {
				throw new Error("Variant weights must sum to 100");
			}
		}

		// Validate dependencies exist
		if (params.dependencies) {
			for (const depKey of params.dependencies) {
				if (!this.flags.has(depKey)) {
					throw new Error(`Dependency flag "${depKey}" does not exist`);
				}
			}
		}

		const id = `flag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const now = new Date();

		const flag: FeatureFlag = {
			id,
			key: params.key,
			name: params.name,
			description: params.description ?? "",
			type: params.type,
			status: "active",
			defaultValue: params.defaultValue,
			percentage: params.percentage,
			variants: params.variants,
			targets: [],
			dependencies: params.dependencies ?? [],
			tags: params.tags ?? [],
			metadata: params.metadata ?? {},
			createdAt: now,
			createdBy: params.createdBy,
			updatedAt: now,
			expiresAt: params.expiresAt,
		};

		this.flags.set(params.key, flag);
		this.overrides.set(params.key, []);
		this.stats.set(params.key, {
			flagKey: params.key,
			totalEvaluations: 0,
			trueCount: 0,
			falseCount: 0,
			variantCounts: {},
			uniqueUsers: 0,
		});

		this.logAudit("flag_created", params.key, params.createdBy, undefined, flag);
		this.emit("flag:created", flag);

		return flag;
	}

	getFlag(key: string): FeatureFlag | null {
		return this.flags.get(key) ?? null;
	}

	getAllFlags(options: { status?: FlagStatus; tags?: string[] } = {}): FeatureFlag[] {
		let flags = Array.from(this.flags.values());

		if (options.status) {
			flags = flags.filter((f) => f.status === options.status);
		}

		if (options.tags && options.tags.length > 0) {
			flags = flags.filter((f) => options.tags!.some((tag) => f.tags.includes(tag)));
		}

		return flags;
	}

	updateFlag(
		key: string,
		updates: Partial<
			Pick<
				FeatureFlag,
				| "name"
				| "description"
				| "defaultValue"
				| "percentage"
				| "variants"
				| "dependencies"
				| "tags"
				| "metadata"
				| "expiresAt"
			>
		>,
		updatedBy: string,
	): FeatureFlag | null {
		const flag = this.flags.get(key);
		if (!flag) return null;

		const previousValue = { ...flag };

		// Apply updates
		if (updates.name !== undefined) flag.name = updates.name;
		if (updates.description !== undefined) flag.description = updates.description;
		if (updates.defaultValue !== undefined) flag.defaultValue = updates.defaultValue;
		if (updates.percentage !== undefined) {
			if (updates.percentage < 0 || updates.percentage > 100) {
				throw new Error("Percentage must be between 0 and 100");
			}
			flag.percentage = updates.percentage;
		}
		if (updates.variants !== undefined) {
			if (flag.type === "variant") {
				const totalWeight = updates.variants.reduce((sum, v) => sum + v.weight, 0);
				if (totalWeight !== 100) {
					throw new Error("Variant weights must sum to 100");
				}
			}
			flag.variants = updates.variants;
		}
		if (updates.dependencies !== undefined) {
			for (const depKey of updates.dependencies) {
				if (!this.flags.has(depKey)) {
					throw new Error(`Dependency flag "${depKey}" does not exist`);
				}
			}
			flag.dependencies = updates.dependencies;
		}
		if (updates.tags !== undefined) flag.tags = updates.tags;
		if (updates.metadata !== undefined) flag.metadata = updates.metadata;
		if (updates.expiresAt !== undefined) flag.expiresAt = updates.expiresAt;

		flag.updatedAt = new Date();
		flag.updatedBy = updatedBy;

		// Invalidate cache for this flag
		this.invalidateFlagCache(key);

		this.logAudit("flag_updated", key, updatedBy, previousValue, flag);
		this.emit("flag:updated", flag);

		return flag;
	}

	deleteFlag(key: string, deletedBy: string): boolean {
		const flag = this.flags.get(key);
		if (!flag) return false;

		// Check for dependent flags
		const allFlags = Array.from(this.flags.values());
		for (const f of allFlags) {
			if (f.dependencies.includes(key)) {
				throw new Error(`Cannot delete flag "${key}": it is a dependency of flag "${f.key}"`);
			}
		}

		this.flags.delete(key);
		this.overrides.delete(key);
		this.stats.delete(key);
		this.invalidateFlagCache(key);

		this.logAudit("flag_deleted", key, deletedBy, flag, undefined);
		this.emit("flag:deleted", { flagKey: key });

		return true;
	}

	enableFlag(key: string, enabledBy: string): boolean {
		const flag = this.flags.get(key);
		if (!flag) return false;

		const previousStatus = flag.status;
		flag.status = "active";
		flag.updatedAt = new Date();
		flag.updatedBy = enabledBy;

		this.invalidateFlagCache(key);

		this.logAudit("flag_enabled", key, enabledBy, { status: previousStatus }, { status: flag.status });
		this.emit("flag:enabled", { flagKey: key });

		return true;
	}

	disableFlag(key: string, disabledBy: string): boolean {
		const flag = this.flags.get(key);
		if (!flag) return false;

		const previousStatus = flag.status;
		flag.status = "inactive";
		flag.updatedAt = new Date();
		flag.updatedBy = disabledBy;

		this.invalidateFlagCache(key);

		this.logAudit("flag_disabled", key, disabledBy, { status: previousStatus }, { status: flag.status });
		this.emit("flag:disabled", { flagKey: key });

		return true;
	}

	archiveFlag(key: string, archivedBy: string): boolean {
		const flag = this.flags.get(key);
		if (!flag) return false;

		flag.status = "archived";
		flag.updatedAt = new Date();
		flag.updatedBy = archivedBy;

		this.invalidateFlagCache(key);
		this.emit("flag:archived", { flagKey: key });

		return true;
	}

	// ============================================================================
	// Target Management
	// ============================================================================

	addTarget(
		flagKey: string,
		params: {
			type: TargetType;
			identifier: string;
			value: boolean | string;
			priority?: number;
		},
		addedBy: string,
	): FlagTarget | null {
		const flag = this.flags.get(flagKey);
		if (!flag) return null;

		if (flag.targets.length >= this.config.maxTargetsPerFlag) {
			throw new Error(`Maximum targets (${this.config.maxTargetsPerFlag}) reached for flag "${flagKey}"`);
		}

		// Check for duplicate
		const existing = flag.targets.find((t) => t.type === params.type && t.identifier === params.identifier);
		if (existing) {
			throw new Error(`Target already exists for ${params.type}:${params.identifier}`);
		}

		const target: FlagTarget = {
			id: `target_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			type: params.type,
			identifier: params.identifier,
			value: params.value,
			priority: params.priority ?? 0,
			enabled: true,
			createdAt: new Date(),
		};

		flag.targets.push(target);
		flag.targets.sort((a, b) => b.priority - a.priority); // Sort by priority descending
		flag.updatedAt = new Date();

		this.invalidateFlagCache(flagKey);

		this.logAudit("target_added", flagKey, addedBy, undefined, target);
		this.emit("target:added", { flagKey, target });

		return target;
	}

	removeTarget(flagKey: string, targetId: string, removedBy: string): boolean {
		const flag = this.flags.get(flagKey);
		if (!flag) return false;

		const targetIndex = flag.targets.findIndex((t) => t.id === targetId);
		if (targetIndex === -1) return false;

		const removed = flag.targets.splice(targetIndex, 1)[0];
		flag.updatedAt = new Date();

		this.invalidateFlagCache(flagKey);

		this.logAudit("target_removed", flagKey, removedBy, removed, undefined);
		this.emit("target:removed", { flagKey, targetId });

		return true;
	}

	getTargets(flagKey: string): FlagTarget[] {
		const flag = this.flags.get(flagKey);
		return flag?.targets ?? [];
	}

	// ============================================================================
	// Override Management
	// ============================================================================

	setOverride(params: {
		flagKey: string;
		targetType: TargetType;
		targetId: string;
		value: boolean | string;
		reason?: string;
		expiresAt?: Date;
		createdBy: string;
	}): FlagOverride {
		const flag = this.flags.get(params.flagKey);
		if (!flag) {
			throw new Error(`Flag "${params.flagKey}" not found`);
		}

		const flagOverrides = this.overrides.get(params.flagKey) ?? [];

		if (flagOverrides.length >= this.config.maxOverridesPerFlag) {
			throw new Error(`Maximum overrides (${this.config.maxOverridesPerFlag}) reached for flag "${params.flagKey}"`);
		}

		// Remove existing override for same target
		const existingIndex = flagOverrides.findIndex(
			(o) => o.targetType === params.targetType && o.targetId === params.targetId,
		);
		if (existingIndex !== -1) {
			flagOverrides.splice(existingIndex, 1);
		}

		const override: FlagOverride = {
			id: `override_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			flagKey: params.flagKey,
			targetType: params.targetType,
			targetId: params.targetId,
			value: params.value,
			reason: params.reason,
			expiresAt: params.expiresAt,
			createdAt: new Date(),
			createdBy: params.createdBy,
		};

		flagOverrides.push(override);
		this.overrides.set(params.flagKey, flagOverrides);

		this.invalidateFlagCache(params.flagKey);

		this.logAudit("override_set", params.flagKey, params.createdBy, undefined, override);
		this.emit("override:set", override);

		return override;
	}

	removeOverride(flagKey: string, overrideId: string, removedBy: string): boolean {
		const flagOverrides = this.overrides.get(flagKey);
		if (!flagOverrides) return false;

		const index = flagOverrides.findIndex((o) => o.id === overrideId);
		if (index === -1) return false;

		const removed = flagOverrides.splice(index, 1)[0];

		this.invalidateFlagCache(flagKey);

		this.logAudit("override_removed", flagKey, removedBy, removed, undefined);
		this.emit("override:removed", { flagKey, overrideId });

		return true;
	}

	getOverrides(flagKey: string): FlagOverride[] {
		return this.overrides.get(flagKey) ?? [];
	}

	clearOverrides(flagKey: string, clearedBy: string): number {
		const flagOverrides = this.overrides.get(flagKey);
		if (!flagOverrides) return 0;

		const count = flagOverrides.length;
		this.overrides.set(flagKey, []);

		this.invalidateFlagCache(flagKey);

		this.logAudit("override_removed", flagKey, clearedBy, { count }, undefined);
		this.emit("overrides:cleared", { flagKey, count });

		return count;
	}

	// ============================================================================
	// Flag Evaluation
	// ============================================================================

	evaluate(flagKey: string, context: EvaluationContext = {}): EvaluationResult {
		const cacheKey = this.getCacheKey(flagKey, context);

		// Check cache
		if (this.config.enableCaching) {
			const cached = this.evaluationCache.get(cacheKey);
			if (cached && cached.expiresAt > Date.now()) {
				return cached.result;
			}
		}

		const result = this.evaluateInternal(flagKey, context);

		// Update stats
		this.updateStats(flagKey, result, context);

		// Cache result
		if (this.config.enableCaching) {
			this.evaluationCache.set(cacheKey, {
				result,
				expiresAt: Date.now() + this.config.cacheTtlMs,
			});
		}

		// Log evaluation (sampled)
		if (this.config.enableAuditLogging && Math.random() < this.config.evaluationSampleRate) {
			this.logAudit(
				"flag_evaluated",
				flagKey,
				context.userId ?? "anonymous",
				undefined,
				{
					result: result.value,
					reason: result.reason,
				},
				{ context },
			);
		}

		this.emit("flag:evaluated", { flagKey, result, context });

		return result;
	}

	private evaluateInternal(flagKey: string, context: EvaluationContext): EvaluationResult {
		const flag = this.flags.get(flagKey);
		const now = new Date();

		// Flag not found
		if (!flag) {
			return {
				flagKey,
				value: false,
				reason: "flag_not_found",
				timestamp: now,
			};
		}

		// Flag expired
		if (flag.expiresAt && flag.expiresAt <= now) {
			return {
				flagKey,
				value: flag.defaultValue,
				reason: "flag_expired",
				timestamp: now,
			};
		}

		// Flag disabled
		if (flag.status !== "active") {
			return {
				flagKey,
				value: flag.defaultValue,
				reason: "flag_disabled",
				timestamp: now,
			};
		}

		// Check dependencies
		for (const depKey of flag.dependencies) {
			const depResult = this.evaluate(depKey, context);
			if (depResult.value === false) {
				return {
					flagKey,
					value: flag.defaultValue,
					reason: "dependency_not_met",
					timestamp: now,
				};
			}
		}

		// Check overrides
		const override = this.findMatchingOverride(flagKey, context);
		if (override) {
			return {
				flagKey,
				value: override.value,
				override,
				reason: "override",
				timestamp: now,
			};
		}

		// Check targets
		const matchedTarget = this.findMatchingTarget(flag, context);
		if (matchedTarget) {
			return {
				flagKey,
				value: matchedTarget.value,
				matchedTarget,
				reason: "target_match",
				timestamp: now,
			};
		}

		// Type-specific evaluation
		switch (flag.type) {
			case "boolean":
				return {
					flagKey,
					value: flag.defaultValue,
					reason: "default",
					timestamp: now,
				};

			case "percentage": {
				const inPercentage = this.isInPercentage(flag.percentage ?? 0, flagKey, context);
				return {
					flagKey,
					value: inPercentage,
					reason: "percentage_rollout",
					timestamp: now,
				};
			}

			case "variant": {
				const variant = this.selectVariant(flag, context);
				return {
					flagKey,
					value: variant?.key ?? flag.defaultValue,
					variant: variant ?? undefined,
					reason: "variant_distribution",
					timestamp: now,
				};
			}

			default:
				return {
					flagKey,
					value: flag.defaultValue,
					reason: "default",
					timestamp: now,
				};
		}
	}

	/**
	 * Evaluate a boolean flag (convenience method)
	 */
	isEnabled(flagKey: string, context: EvaluationContext = {}): boolean {
		const result = this.evaluate(flagKey, context);
		return result.value === true || result.value === "true";
	}

	/**
	 * Get variant for a flag (convenience method)
	 */
	getVariant(flagKey: string, context: EvaluationContext = {}): FlagVariant | null {
		const result = this.evaluate(flagKey, context);
		return result.variant ?? null;
	}

	private findMatchingOverride(flagKey: string, context: EvaluationContext): FlagOverride | null {
		const flagOverrides = this.overrides.get(flagKey) ?? [];
		const now = new Date();

		for (const override of flagOverrides) {
			// Check expiration
			if (override.expiresAt && override.expiresAt <= now) {
				continue;
			}

			// Check target match
			switch (override.targetType) {
				case "user":
					if (context.userId === override.targetId) return override;
					break;
				case "group":
					if (context.groupId === override.targetId) return override;
					break;
				case "channel":
					if (context.channelId === override.targetId) return override;
					break;
				case "agent":
					if (context.agentId === override.targetId) return override;
					break;
				case "all":
					return override;
			}
		}

		return null;
	}

	private findMatchingTarget(flag: FeatureFlag, context: EvaluationContext): FlagTarget | null {
		for (const target of flag.targets) {
			if (!target.enabled) continue;

			switch (target.type) {
				case "user":
					if (context.userId === target.identifier) return target;
					break;
				case "group":
					if (context.groupId === target.identifier) return target;
					break;
				case "channel":
					if (context.channelId === target.identifier) return target;
					break;
				case "agent":
					if (context.agentId === target.identifier) return target;
					break;
				case "all":
					return target;
			}
		}

		return null;
	}

	private isInPercentage(percentage: number, flagKey: string, context: EvaluationContext): boolean {
		// Use consistent hashing for user to ensure same result
		const identifier = context.userId ?? context.channelId ?? context.agentId ?? "anonymous";
		const hash = this.hashString(`${flagKey}:${identifier}`);
		const bucket = hash % 100;
		return bucket < percentage;
	}

	private selectVariant(flag: FeatureFlag, context: EvaluationContext): FlagVariant | null {
		if (!flag.variants || flag.variants.length === 0) return null;

		// Use consistent hashing for variant selection
		const identifier = context.userId ?? context.channelId ?? context.agentId ?? "anonymous";
		const hash = this.hashString(`${flag.key}:variant:${identifier}`);
		const bucket = hash % 100;

		let cumulative = 0;
		for (const variant of flag.variants) {
			cumulative += variant.weight;
			if (bucket < cumulative) {
				return variant;
			}
		}

		// Fallback to last variant
		return flag.variants[flag.variants.length - 1];
	}

	private hashString(str: string): number {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		return Math.abs(hash);
	}

	// ============================================================================
	// Gradual Rollout
	// ============================================================================

	/**
	 * Start gradual rollout for a percentage flag
	 */
	startGradualRollout(
		flagKey: string,
		params: {
			targetPercentage: number;
			incrementPercentage: number;
			intervalMs: number;
		},
		startedBy: string,
	): { cancel: () => void } {
		const flag = this.flags.get(flagKey);
		if (!flag) {
			throw new Error(`Flag "${flagKey}" not found`);
		}
		if (flag.type !== "percentage") {
			throw new Error(`Flag "${flagKey}" is not a percentage flag`);
		}

		let currentPercentage = flag.percentage ?? 0;
		let cancelled = false;

		const intervalId = setInterval(() => {
			if (cancelled || currentPercentage >= params.targetPercentage) {
				clearInterval(intervalId);
				return;
			}

			currentPercentage = Math.min(currentPercentage + params.incrementPercentage, params.targetPercentage);

			this.updateFlag(flagKey, { percentage: currentPercentage }, startedBy);

			this.emit("rollout:progress", {
				flagKey,
				currentPercentage,
				targetPercentage: params.targetPercentage,
			});

			if (currentPercentage >= params.targetPercentage) {
				this.emit("rollout:completed", { flagKey, percentage: currentPercentage });
				clearInterval(intervalId);
			}
		}, params.intervalMs);

		return {
			cancel: () => {
				cancelled = true;
				clearInterval(intervalId);
				this.emit("rollout:cancelled", { flagKey, percentage: currentPercentage });
			},
		};
	}

	// ============================================================================
	// A/B Testing
	// ============================================================================

	/**
	 * Get A/B test results for a variant flag
	 */
	getABTestResults(flagKey: string): {
		flagKey: string;
		variants: Array<{
			key: string;
			count: number;
			percentage: number;
		}>;
		totalEvaluations: number;
	} | null {
		const stats = this.stats.get(flagKey);
		if (!stats) return null;

		const flag = this.flags.get(flagKey);
		if (!flag || flag.type !== "variant") return null;

		const totalVariantEvals = Object.values(stats.variantCounts).reduce((a, b) => a + b, 0);

		const variants = Object.entries(stats.variantCounts).map(([key, count]) => ({
			key,
			count,
			percentage: totalVariantEvals > 0 ? (count / totalVariantEvals) * 100 : 0,
		}));

		return {
			flagKey,
			variants,
			totalEvaluations: stats.totalEvaluations,
		};
	}

	// ============================================================================
	// Statistics & Audit
	// ============================================================================

	private updateStats(flagKey: string, result: EvaluationResult, context: EvaluationContext): void {
		let stats = this.stats.get(flagKey);
		if (!stats) {
			stats = {
				flagKey,
				totalEvaluations: 0,
				trueCount: 0,
				falseCount: 0,
				variantCounts: {},
				uniqueUsers: 0,
			};
			this.stats.set(flagKey, stats);
		}

		stats.totalEvaluations++;
		stats.lastEvaluatedAt = new Date();

		if (typeof result.value === "boolean") {
			if (result.value) {
				stats.trueCount++;
			} else {
				stats.falseCount++;
			}
		}

		if (result.variant) {
			stats.variantCounts[result.variant.key] = (stats.variantCounts[result.variant.key] ?? 0) + 1;
		}

		// Track unique users (simplified - in production would use HyperLogLog)
		if (context.userId) {
			// This is a simple approximation; real implementation would use proper cardinality estimation
			stats.uniqueUsers = Math.max(stats.uniqueUsers, stats.totalEvaluations * 0.8);
		}
	}

	getStats(flagKey: string): FlagStats | null {
		return this.stats.get(flagKey) ?? null;
	}

	getAllStats(): FlagStats[] {
		return Array.from(this.stats.values());
	}

	private logAudit(
		action: AuditAction,
		flagKey: string,
		userId: string,
		previousValue?: unknown,
		newValue?: unknown,
		context?: Record<string, unknown>,
	): void {
		if (!this.config.enableAuditLogging) return;

		const entry: AuditLogEntry = {
			id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			action,
			flagKey,
			userId,
			previousValue,
			newValue,
			context,
			timestamp: new Date(),
		};

		this.auditLog.push(entry);
		this.emit("audit:logged", entry);
	}

	getAuditLog(
		params: {
			flagKey?: string;
			action?: AuditAction;
			userId?: string;
			startDate?: Date;
			endDate?: Date;
			limit?: number;
		} = {},
	): AuditLogEntry[] {
		let filtered = this.auditLog;

		if (params.flagKey) {
			filtered = filtered.filter((e) => e.flagKey === params.flagKey);
		}
		if (params.action) {
			filtered = filtered.filter((e) => e.action === params.action);
		}
		if (params.userId) {
			filtered = filtered.filter((e) => e.userId === params.userId);
		}
		if (params.startDate) {
			filtered = filtered.filter((e) => e.timestamp >= params.startDate!);
		}
		if (params.endDate) {
			filtered = filtered.filter((e) => e.timestamp <= params.endDate!);
		}

		// Sort by timestamp descending
		filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

		const limit = params.limit ?? 100;
		return filtered.slice(0, limit);
	}

	// ============================================================================
	// Cache Management
	// ============================================================================

	private getCacheKey(flagKey: string, context: EvaluationContext): string {
		const parts = [
			flagKey,
			context.userId ?? "",
			context.groupId ?? "",
			context.channelId ?? "",
			context.agentId ?? "",
		];
		return parts.join(":");
	}

	private invalidateFlagCache(flagKey: string): void {
		const keysToDelete: string[] = [];
		this.evaluationCache.forEach((_, cacheKey) => {
			if (cacheKey.startsWith(`${flagKey}:`)) {
				keysToDelete.push(cacheKey);
			}
		});
		keysToDelete.forEach((key) => this.evaluationCache.delete(key));
	}

	clearCache(): void {
		this.evaluationCache.clear();
		this.emit("cache:cleared");
	}

	// ============================================================================
	// Import/Export
	// ============================================================================

	exportFlags(): { flags: FeatureFlag[]; overrides: Record<string, FlagOverride[]> } {
		return {
			flags: Array.from(this.flags.values()),
			overrides: Object.fromEntries(this.overrides),
		};
	}

	importFlags(
		data: { flags: FeatureFlag[]; overrides?: Record<string, FlagOverride[]> },
		importedBy: string,
	): { imported: number; skipped: number; errors: string[] } {
		const result = { imported: 0, skipped: 0, errors: [] as string[] };

		for (const flag of data.flags) {
			try {
				if (this.flags.has(flag.key)) {
					result.skipped++;
					continue;
				}

				// Create a new flag with the imported data
				this.flags.set(flag.key, {
					...flag,
					createdAt: new Date(flag.createdAt),
					updatedAt: new Date(flag.updatedAt),
					expiresAt: flag.expiresAt ? new Date(flag.expiresAt) : undefined,
					targets: flag.targets.map((t) => ({
						...t,
						createdAt: new Date(t.createdAt),
					})),
				});

				// Import overrides for this flag
				if (data.overrides?.[flag.key]) {
					this.overrides.set(
						flag.key,
						data.overrides[flag.key].map((o) => ({
							...o,
							createdAt: new Date(o.createdAt),
							expiresAt: o.expiresAt ? new Date(o.expiresAt) : undefined,
						})),
					);
				} else {
					this.overrides.set(flag.key, []);
				}

				// Initialize stats
				this.stats.set(flag.key, {
					flagKey: flag.key,
					totalEvaluations: 0,
					trueCount: 0,
					falseCount: 0,
					variantCounts: {},
					uniqueUsers: 0,
				});

				result.imported++;
				this.logAudit("flag_created", flag.key, importedBy, undefined, { imported: true });
			} catch (error) {
				result.errors.push(
					`Failed to import flag "${flag.key}": ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		this.emit("flags:imported", result);
		return result;
	}

	// ============================================================================
	// Summary & Health
	// ============================================================================

	getSummary(): {
		totalFlags: number;
		activeFlags: number;
		inactiveFlags: number;
		archivedFlags: number;
		totalOverrides: number;
		totalTargets: number;
		cacheSize: number;
		auditLogSize: number;
	} {
		let totalTargets = 0;
		let totalOverrides = 0;

		const flags = Array.from(this.flags.values());
		const overrideLists = Array.from(this.overrides.values());

		for (const flag of flags) {
			totalTargets += flag.targets.length;
		}

		for (const overrideList of overrideLists) {
			totalOverrides += overrideList.length;
		}

		return {
			totalFlags: flags.length,
			activeFlags: flags.filter((f) => f.status === "active").length,
			inactiveFlags: flags.filter((f) => f.status === "inactive").length,
			archivedFlags: flags.filter((f) => f.status === "archived").length,
			totalOverrides,
			totalTargets,
			cacheSize: this.evaluationCache.size,
			auditLogSize: this.auditLog.length,
		};
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	shutdown(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		this.flags.clear();
		this.overrides.clear();
		this.evaluationCache.clear();
		this.stats.clear();
		this.auditLog = [];

		this.emit("shutdown");
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

let featureFlagsInstance: FeatureFlagsSystem | null = null;

export function getFeatureFlags(config?: Partial<FeatureFlagsConfig>): FeatureFlagsSystem {
	if (!featureFlagsInstance) {
		featureFlagsInstance = new FeatureFlagsSystem(config);
	}
	return featureFlagsInstance;
}

export function resetFeatureFlags(): void {
	if (featureFlagsInstance) {
		featureFlagsInstance.shutdown();
		featureFlagsInstance = null;
	}
}
