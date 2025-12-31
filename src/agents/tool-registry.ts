/**
 * Class 3.36: Tool Registry
 *
 * Centralized registry for managing tools available to agents.
 * Handles tool registration, validation, permissions, and discovery.
 *
 * Features:
 * - Tool registration and validation
 * - Permission-based access control
 * - Tool discovery and search
 * - Usage tracking and metrics
 * - Category-based organization
 *
 * @module tool-registry
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export type ToolCategory =
	| "file"
	| "search"
	| "execute"
	| "network"
	| "database"
	| "ai"
	| "trading"
	| "communication"
	| "system"
	| "custom";

export type ToolPermission = "read" | "write" | "execute" | "network" | "dangerous";

export interface ToolParameter {
	name: string;
	type: "string" | "number" | "boolean" | "object" | "array";
	description: string;
	required: boolean;
	default?: unknown;
	enum?: unknown[];
}

export interface ToolSchema {
	parameters: ToolParameter[];
	returns: {
		type: string;
		description: string;
	};
}

export interface RegisteredTool {
	id: string;
	name: string;
	description: string;
	category: ToolCategory;
	permissions: ToolPermission[];
	schema: ToolSchema;
	handler: (params: Record<string, unknown>) => Promise<unknown>;
	enabled: boolean;
	version: string;
	metadata?: Record<string, unknown>;
}

export interface ToolUsageStats {
	toolId: string;
	totalCalls: number;
	successCalls: number;
	failedCalls: number;
	avgLatencyMs: number;
	lastUsed: number;
	errors: Array<{ timestamp: number; error: string }>;
}

export interface ToolSearchQuery {
	name?: string;
	category?: ToolCategory;
	permissions?: ToolPermission[];
	enabled?: boolean;
	keyword?: string;
}

export interface ToolRegistryConfig {
	maxToolsPerCategory: number;
	enableUsageTracking: boolean;
	enablePermissionChecks: boolean;
	maxErrorHistory: number;
	defaultTimeout: number;
}

export interface ToolRegistryEvents {
	"tool:registered": { tool: RegisteredTool };
	"tool:unregistered": { toolId: string };
	"tool:enabled": { toolId: string };
	"tool:disabled": { toolId: string };
	"tool:called": { toolId: string; params: Record<string, unknown> };
	"tool:success": { toolId: string; result: unknown; latencyMs: number };
	"tool:error": { toolId: string; error: Error };
	"permission:denied": { toolId: string; required: ToolPermission[]; granted: ToolPermission[] };
}

// =============================================================================
// Tool Registry
// =============================================================================

export class ToolRegistry extends EventEmitter {
	private config: ToolRegistryConfig;
	private tools: Map<string, RegisteredTool> = new Map();
	private usage: Map<string, ToolUsageStats> = new Map();
	private aliases: Map<string, string> = new Map();

	constructor(config: Partial<ToolRegistryConfig> = {}) {
		super();
		this.config = {
			maxToolsPerCategory: 100,
			enableUsageTracking: true,
			enablePermissionChecks: true,
			maxErrorHistory: 50,
			defaultTimeout: 30000,
			...config,
		};
	}

	// ---------------------------------------------------------------------------
	// Tool Registration
	// ---------------------------------------------------------------------------

	register(tool: RegisteredTool): void {
		// Validate tool
		this.validateTool(tool);

		// Check category limit
		const categoryCount = this.getToolsByCategory(tool.category).length;
		if (categoryCount >= this.config.maxToolsPerCategory) {
			throw new Error(`Category ${tool.category} has reached max tools limit`);
		}

		this.tools.set(tool.id, tool);

		// Initialize usage stats
		if (this.config.enableUsageTracking) {
			this.usage.set(tool.id, {
				toolId: tool.id,
				totalCalls: 0,
				successCalls: 0,
				failedCalls: 0,
				avgLatencyMs: 0,
				lastUsed: 0,
				errors: [],
			});
		}

		this.emit("tool:registered", { tool });
	}

	registerAlias(alias: string, toolId: string): void {
		if (!this.tools.has(toolId)) {
			throw new Error(`Tool ${toolId} not found`);
		}
		this.aliases.set(alias, toolId);
	}

	unregister(toolId: string): boolean {
		const tool = this.tools.get(toolId);
		if (!tool) return false;

		this.tools.delete(toolId);
		this.usage.delete(toolId);

		// Remove aliases pointing to this tool
		for (const [alias, id] of this.aliases) {
			if (id === toolId) {
				this.aliases.delete(alias);
			}
		}

		this.emit("tool:unregistered", { toolId });
		return true;
	}

	private validateTool(tool: RegisteredTool): void {
		if (!tool.id || typeof tool.id !== "string") {
			throw new Error("Tool must have a valid id");
		}
		if (!tool.name || typeof tool.name !== "string") {
			throw new Error("Tool must have a valid name");
		}
		if (!tool.handler || typeof tool.handler !== "function") {
			throw new Error("Tool must have a valid handler function");
		}
		if (!tool.schema || !Array.isArray(tool.schema.parameters)) {
			throw new Error("Tool must have a valid schema");
		}
	}

	// ---------------------------------------------------------------------------
	// Tool Management
	// ---------------------------------------------------------------------------

	enable(toolId: string): boolean {
		const tool = this.tools.get(toolId);
		if (!tool) return false;

		tool.enabled = true;
		this.emit("tool:enabled", { toolId });
		return true;
	}

	disable(toolId: string): boolean {
		const tool = this.tools.get(toolId);
		if (!tool) return false;

		tool.enabled = false;
		this.emit("tool:disabled", { toolId });
		return true;
	}

	update(toolId: string, updates: Partial<RegisteredTool>): boolean {
		const tool = this.tools.get(toolId);
		if (!tool) return false;

		// Don't allow changing id
		const { id: _id, ...allowedUpdates } = updates;
		Object.assign(tool, allowedUpdates);
		return true;
	}

	// ---------------------------------------------------------------------------
	// Tool Execution
	// ---------------------------------------------------------------------------

	async call(
		toolId: string,
		params: Record<string, unknown>,
		grantedPermissions: ToolPermission[] = [],
	): Promise<unknown> {
		// Resolve alias
		const resolvedId = this.aliases.get(toolId) || toolId;
		const tool = this.tools.get(resolvedId);

		if (!tool) {
			throw new Error(`Tool ${toolId} not found`);
		}

		if (!tool.enabled) {
			throw new Error(`Tool ${toolId} is disabled`);
		}

		// Check permissions
		if (this.config.enablePermissionChecks) {
			const missingPermissions = tool.permissions.filter((p) => !grantedPermissions.includes(p));
			if (missingPermissions.length > 0) {
				this.emit("permission:denied", {
					toolId: resolvedId,
					required: tool.permissions,
					granted: grantedPermissions,
				});
				throw new Error(`Permission denied: missing ${missingPermissions.join(", ")}`);
			}
		}

		// Validate parameters
		this.validateParams(tool, params);

		this.emit("tool:called", { toolId: resolvedId, params });
		const startTime = Date.now();

		try {
			const result = await this.withTimeout(tool.handler(params), this.config.defaultTimeout);
			const latencyMs = Date.now() - startTime;

			// Update usage stats
			if (this.config.enableUsageTracking) {
				this.recordSuccess(resolvedId, latencyMs);
			}

			this.emit("tool:success", { toolId: resolvedId, result, latencyMs });
			return result;
		} catch (error) {
			// Update usage stats
			if (this.config.enableUsageTracking) {
				this.recordError(resolvedId, error as Error);
			}

			this.emit("tool:error", { toolId: resolvedId, error: error as Error });
			throw error;
		}
	}

	private validateParams(tool: RegisteredTool, params: Record<string, unknown>): void {
		for (const param of tool.schema.parameters) {
			if (param.required && !(param.name in params)) {
				throw new Error(`Missing required parameter: ${param.name}`);
			}

			if (param.name in params) {
				const value = params[param.name];
				const actualType = Array.isArray(value) ? "array" : typeof value;

				if (actualType !== param.type && value !== null && value !== undefined) {
					throw new Error(`Invalid type for ${param.name}: expected ${param.type}, got ${actualType}`);
				}

				if (param.enum && !param.enum.includes(value)) {
					throw new Error(`Invalid value for ${param.name}: must be one of ${param.enum.join(", ")}`);
				}
			}
		}
	}

	private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
		return Promise.race([
			promise,
			new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
		]);
	}

	// ---------------------------------------------------------------------------
	// Usage Tracking
	// ---------------------------------------------------------------------------

	private recordSuccess(toolId: string, latencyMs: number): void {
		const stats = this.usage.get(toolId);
		if (!stats) return;

		stats.totalCalls++;
		stats.successCalls++;
		stats.lastUsed = Date.now();

		// Update rolling average
		stats.avgLatencyMs = (stats.avgLatencyMs * (stats.successCalls - 1) + latencyMs) / stats.successCalls;
	}

	private recordError(toolId: string, error: Error): void {
		const stats = this.usage.get(toolId);
		if (!stats) return;

		stats.totalCalls++;
		stats.failedCalls++;
		stats.lastUsed = Date.now();

		// Add to error history
		stats.errors.push({
			timestamp: Date.now(),
			error: error.message,
		});

		// Trim error history
		if (stats.errors.length > this.config.maxErrorHistory) {
			stats.errors = stats.errors.slice(-this.config.maxErrorHistory);
		}
	}

	// ---------------------------------------------------------------------------
	// Tool Discovery
	// ---------------------------------------------------------------------------

	get(toolId: string): RegisteredTool | null {
		const resolvedId = this.aliases.get(toolId) || toolId;
		return this.tools.get(resolvedId) || null;
	}

	getAll(): RegisteredTool[] {
		return Array.from(this.tools.values());
	}

	getEnabled(): RegisteredTool[] {
		return Array.from(this.tools.values()).filter((t) => t.enabled);
	}

	getToolsByCategory(category: ToolCategory): RegisteredTool[] {
		return Array.from(this.tools.values()).filter((t) => t.category === category);
	}

	getToolsByPermission(permission: ToolPermission): RegisteredTool[] {
		return Array.from(this.tools.values()).filter((t) => t.permissions.includes(permission));
	}

	search(query: ToolSearchQuery): RegisteredTool[] {
		let results = Array.from(this.tools.values());

		if (query.name) {
			const namePattern = query.name.toLowerCase();
			results = results.filter((t) => t.name.toLowerCase().includes(namePattern));
		}

		if (query.category) {
			results = results.filter((t) => t.category === query.category);
		}

		if (query.permissions && query.permissions.length > 0) {
			results = results.filter((t) => query.permissions!.every((p) => t.permissions.includes(p)));
		}

		if (query.enabled !== undefined) {
			results = results.filter((t) => t.enabled === query.enabled);
		}

		if (query.keyword) {
			const keyword = query.keyword.toLowerCase();
			results = results.filter(
				(t) => t.name.toLowerCase().includes(keyword) || t.description.toLowerCase().includes(keyword),
			);
		}

		return results;
	}

	// ---------------------------------------------------------------------------
	// Statistics
	// ---------------------------------------------------------------------------

	getUsageStats(toolId: string): ToolUsageStats | null {
		return this.usage.get(toolId) || null;
	}

	getAllUsageStats(): ToolUsageStats[] {
		return Array.from(this.usage.values());
	}

	getTopTools(limit = 10, sortBy: "calls" | "success" | "latency" = "calls"): RegisteredTool[] {
		const stats = Array.from(this.usage.values());

		stats.sort((a, b) => {
			switch (sortBy) {
				case "calls":
					return b.totalCalls - a.totalCalls;
				case "success":
					return b.successCalls / (b.totalCalls || 1) - a.successCalls / (a.totalCalls || 1);
				case "latency":
					return a.avgLatencyMs - b.avgLatencyMs;
				default:
					return 0;
			}
		});

		return stats
			.slice(0, limit)
			.map((s) => this.tools.get(s.toolId))
			.filter((t): t is RegisteredTool => t !== undefined);
	}

	getFailingTools(threshold = 0.5): RegisteredTool[] {
		const failing: RegisteredTool[] = [];

		for (const stats of this.usage.values()) {
			if (stats.totalCalls > 0) {
				const failureRate = stats.failedCalls / stats.totalCalls;
				if (failureRate >= threshold) {
					const tool = this.tools.get(stats.toolId);
					if (tool) {
						failing.push(tool);
					}
				}
			}
		}

		return failing;
	}

	// ---------------------------------------------------------------------------
	// Schema Generation
	// ---------------------------------------------------------------------------

	generateOpenAPISchema(): object {
		const paths: Record<string, object> = {};

		for (const tool of this.tools.values()) {
			paths[`/tools/${tool.id}`] = {
				post: {
					summary: tool.name,
					description: tool.description,
					tags: [tool.category],
					requestBody: {
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: Object.fromEntries(
										tool.schema.parameters.map((p) => [
											p.name,
											{
												type: p.type,
												description: p.description,
												enum: p.enum,
												default: p.default,
											},
										]),
									),
									required: tool.schema.parameters.filter((p) => p.required).map((p) => p.name),
								},
							},
						},
					},
					responses: {
						200: {
							description: tool.schema.returns.description,
							content: {
								"application/json": {
									schema: {
										type: tool.schema.returns.type,
									},
								},
							},
						},
					},
				},
			};
		}

		return {
			openapi: "3.0.0",
			info: {
				title: "Tool Registry API",
				version: "1.0.0",
			},
			paths,
		};
	}

	generateToolDescriptions(): string {
		const lines: string[] = ["# Available Tools\n"];

		const byCategory = new Map<ToolCategory, RegisteredTool[]>();
		for (const tool of this.tools.values()) {
			if (!tool.enabled) continue;

			const tools = byCategory.get(tool.category) || [];
			tools.push(tool);
			byCategory.set(tool.category, tools);
		}

		for (const [category, tools] of byCategory) {
			lines.push(`\n## ${category.charAt(0).toUpperCase() + category.slice(1)}\n`);

			for (const tool of tools) {
				lines.push(`### ${tool.name}`);
				lines.push(`${tool.description}\n`);
				lines.push("**Parameters:**");

				for (const param of tool.schema.parameters) {
					const required = param.required ? " (required)" : "";
					lines.push(`- \`${param.name}\`: ${param.type}${required} - ${param.description}`);
				}

				lines.push(`\n**Returns:** ${tool.schema.returns.description}\n`);
			}
		}

		return lines.join("\n");
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	clearUsageStats(): void {
		for (const stats of this.usage.values()) {
			stats.totalCalls = 0;
			stats.successCalls = 0;
			stats.failedCalls = 0;
			stats.avgLatencyMs = 0;
			stats.errors = [];
		}
	}

	reset(): void {
		this.tools.clear();
		this.usage.clear();
		this.aliases.clear();
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: ToolRegistry | null = null;

export function getToolRegistry(config?: Partial<ToolRegistryConfig>): ToolRegistry {
	if (!instance) {
		instance = new ToolRegistry(config);
	}
	return instance;
}

export function resetToolRegistry(): void {
	if (instance) {
		instance.reset();
	}
	instance = null;
}
