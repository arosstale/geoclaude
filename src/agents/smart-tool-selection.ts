/**
 * Class 3.26: Smart Tool Selection
 *
 * Intelligent tool selection based on performance history.
 * Tracks success rates, latencies, and provides alternate routing.
 *
 * Features:
 * - Tool performance tracking (success rate, avg latency)
 * - Automatic fallback to alternatives on failure
 * - Circuit breaker pattern for failing tools
 * - Usage analytics and recommendations
 *
 * @module smart-tool-selection
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export interface ToolStats {
	name: string;
	successCount: number;
	failureCount: number;
	totalCalls: number;
	avgLatency: number;
	minLatency: number;
	maxLatency: number;
	lastUsed: number;
	lastError?: string;
	circuitOpen: boolean;
	circuitOpenUntil?: number;
}

export interface ToolAlternative {
	primary: string;
	alternates: string[];
	condition?: (context: ToolSelectionContext) => boolean;
}

export interface ToolSelectionContext {
	task: string;
	previousTools: string[];
	previousErrors: string[];
	urgency: "low" | "normal" | "high" | "critical";
	budget?: {
		maxLatency?: number;
		preferReliable?: boolean;
	};
}

export interface ToolSelection {
	tool: string;
	reason: string;
	confidence: number;
	alternatives: string[];
	warning?: string;
}

export interface ToolExecutionRecord {
	tool: string;
	success: boolean;
	latency: number;
	error?: string;
	timestamp: number;
	context?: Record<string, unknown>;
}

export interface SmartToolConfig {
	circuitBreakerThreshold: number; // failures before opening circuit
	circuitBreakerResetMs: number; // time before retrying
	latencyThresholdMs: number; // warn if above this
	minSamplesForStats: number; // minimum calls before stats are meaningful
	decayFactor: number; // how quickly old stats decay (0-1)
}

export interface SmartToolEvents {
	"tool:selected": { selection: ToolSelection; context: ToolSelectionContext };
	"tool:executed": { record: ToolExecutionRecord };
	"tool:fallback": { primary: string; fallback: string; reason: string };
	"circuit:opened": { tool: string; until: number };
	"circuit:closed": { tool: string };
}

export interface ToolRecommendation {
	tool: string;
	score: number;
	successRate: number;
	avgLatency: number;
	recommendation: string;
}

// =============================================================================
// Smart Tool Selection
// =============================================================================

export class SmartToolSelection extends EventEmitter {
	private config: SmartToolConfig;
	private stats: Map<string, ToolStats> = new Map();
	private alternatives: Map<string, ToolAlternative> = new Map();
	private recentExecutions: ToolExecutionRecord[] = [];

	constructor(config: Partial<SmartToolConfig> = {}) {
		super();
		this.config = {
			circuitBreakerThreshold: 3,
			circuitBreakerResetMs: 60000,
			latencyThresholdMs: 5000,
			minSamplesForStats: 5,
			decayFactor: 0.95,
			...config,
		};
	}

	// ---------------------------------------------------------------------------
	// Tool Registration
	// ---------------------------------------------------------------------------

	registerTool(name: string, initialStats?: Partial<ToolStats>): void {
		if (!this.stats.has(name)) {
			this.stats.set(name, {
				name,
				successCount: 0,
				failureCount: 0,
				totalCalls: 0,
				avgLatency: 0,
				minLatency: Infinity,
				maxLatency: 0,
				lastUsed: 0,
				circuitOpen: false,
				...initialStats,
			});
		}
	}

	registerAlternatives(primary: string, alternates: string[], condition?: ToolAlternative["condition"]): void {
		this.alternatives.set(primary, { primary, alternates, condition });

		// Ensure all tools are registered
		this.registerTool(primary);
		for (const alt of alternates) {
			this.registerTool(alt);
		}
	}

	// ---------------------------------------------------------------------------
	// Tool Selection
	// ---------------------------------------------------------------------------

	selectTool(name: string, context: ToolSelectionContext): ToolSelection {
		this.registerTool(name);
		const stats = this.stats.get(name)!;

		// Check circuit breaker
		if (this.isCircuitOpen(name)) {
			const fallback = this.findFallback(name, context);
			if (fallback) {
				this.emit("tool:fallback", {
					primary: name,
					fallback: fallback.tool,
					reason: "Circuit breaker open",
				});
				return fallback;
			}
			return {
				tool: name,
				reason: "Circuit open but no alternative available",
				confidence: 0.1,
				alternatives: [],
				warning: `Tool ${name} circuit is open, proceeding with caution`,
			};
		}

		// Check if tool is reliable
		const successRate = this.getSuccessRate(name);
		const alternatives = this.getAlternatives(name, context);

		// Low confidence if not enough samples
		if (stats.totalCalls < this.config.minSamplesForStats) {
			return {
				tool: name,
				reason: "Insufficient data for reliable selection",
				confidence: 0.5,
				alternatives,
			};
		}

		// High success rate
		if (successRate >= 0.9) {
			return {
				tool: name,
				reason: `High reliability (${(successRate * 100).toFixed(1)}% success)`,
				confidence: 0.95,
				alternatives,
			};
		}

		// Medium success rate - consider alternatives
		if (successRate >= 0.7) {
			// Check if an alternative is better
			const betterAlt = this.findBetterAlternative(name, context);
			if (betterAlt) {
				return {
					tool: betterAlt,
					reason: `Alternative has better success rate`,
					confidence: 0.8,
					alternatives: [name, ...alternatives.filter((a) => a !== betterAlt)],
				};
			}
			return {
				tool: name,
				reason: `Moderate reliability (${(successRate * 100).toFixed(1)}% success)`,
				confidence: 0.75,
				alternatives,
			};
		}

		// Low success rate - try alternatives first
		const fallback = this.findFallback(name, context);
		if (fallback) {
			this.emit("tool:fallback", {
				primary: name,
				fallback: fallback.tool,
				reason: `Low success rate (${(successRate * 100).toFixed(1)}%)`,
			});
			return fallback;
		}

		return {
			tool: name,
			reason: `Low reliability but no alternatives (${(successRate * 100).toFixed(1)}% success)`,
			confidence: 0.3,
			alternatives: [],
			warning: `Tool ${name} has low reliability`,
		};
	}

	// ---------------------------------------------------------------------------
	// Execution Recording
	// ---------------------------------------------------------------------------

	recordExecution(record: ToolExecutionRecord): void {
		this.registerTool(record.tool);
		const stats = this.stats.get(record.tool)!;

		// Update counts
		stats.totalCalls++;
		if (record.success) {
			stats.successCount++;
			// Close circuit on success
			if (stats.circuitOpen) {
				stats.circuitOpen = false;
				stats.circuitOpenUntil = undefined;
				this.emit("circuit:closed", { tool: record.tool });
			}
		} else {
			stats.failureCount++;
			stats.lastError = record.error;

			// Check circuit breaker
			const recentFailures = this.countRecentFailures(record.tool);
			if (recentFailures >= this.config.circuitBreakerThreshold) {
				stats.circuitOpen = true;
				stats.circuitOpenUntil = Date.now() + this.config.circuitBreakerResetMs;
				this.emit("circuit:opened", { tool: record.tool, until: stats.circuitOpenUntil });
			}
		}

		// Update latency stats with exponential moving average
		if (stats.avgLatency === 0) {
			stats.avgLatency = record.latency;
		} else {
			stats.avgLatency = stats.avgLatency * this.config.decayFactor + record.latency * (1 - this.config.decayFactor);
		}
		stats.minLatency = Math.min(stats.minLatency, record.latency);
		stats.maxLatency = Math.max(stats.maxLatency, record.latency);
		stats.lastUsed = record.timestamp;

		// Keep recent executions
		this.recentExecutions.push(record);
		if (this.recentExecutions.length > 1000) {
			this.recentExecutions = this.recentExecutions.slice(-500);
		}

		this.emit("tool:executed", { record });
	}

	// ---------------------------------------------------------------------------
	// Wrapped Execution
	// ---------------------------------------------------------------------------

	async execute<T>(
		name: string,
		executor: () => Promise<T>,
		context?: ToolSelectionContext
	): Promise<{ result: T; selection: ToolSelection }> {
		const ctx = context || {
			task: "unknown",
			previousTools: [],
			previousErrors: [],
			urgency: "normal" as const,
		};

		const selection = this.selectTool(name, ctx);
		const startTime = Date.now();

		try {
			const result = await executor();
			this.recordExecution({
				tool: selection.tool,
				success: true,
				latency: Date.now() - startTime,
				timestamp: Date.now(),
			});
			return { result, selection };
		} catch (error) {
			const latency = Date.now() - startTime;
			this.recordExecution({
				tool: selection.tool,
				success: false,
				latency,
				error: error instanceof Error ? error.message : String(error),
				timestamp: Date.now(),
			});

			// Try alternatives
			for (const alt of selection.alternatives) {
				try {
					const altResult = await executor();
					this.recordExecution({
						tool: alt,
						success: true,
						latency: Date.now() - startTime - latency,
						timestamp: Date.now(),
					});
					return {
						result: altResult,
						selection: {
							...selection,
							tool: alt,
							reason: `Fallback from ${name} after failure`,
						},
					};
				} catch {
					// Continue to next alternative
				}
			}

			throw error;
		}
	}

	// ---------------------------------------------------------------------------
	// Helper Methods
	// ---------------------------------------------------------------------------

	private isCircuitOpen(name: string): boolean {
		const stats = this.stats.get(name);
		if (!stats?.circuitOpen) return false;

		// Check if circuit should be reset
		if (stats.circuitOpenUntil && Date.now() >= stats.circuitOpenUntil) {
			// Half-open state - allow one request
			stats.circuitOpen = false;
			stats.circuitOpenUntil = undefined;
			return false;
		}

		return true;
	}

	private getSuccessRate(name: string): number {
		const stats = this.stats.get(name);
		if (!stats || stats.totalCalls === 0) return 0.5; // neutral if no data
		return stats.successCount / stats.totalCalls;
	}

	private getAlternatives(name: string, context: ToolSelectionContext): string[] {
		const alt = this.alternatives.get(name);
		if (!alt) return [];

		// Check condition
		if (alt.condition && !alt.condition(context)) {
			return [];
		}

		// Filter out tools with open circuits
		return alt.alternates.filter((a) => !this.isCircuitOpen(a));
	}

	private findFallback(name: string, context: ToolSelectionContext): ToolSelection | null {
		const alternatives = this.getAlternatives(name, context);

		// Find the best alternative
		let bestAlt: string | null = null;
		let bestScore = -Infinity;

		for (const alt of alternatives) {
			const score = this.getToolScore(alt);
			if (score > bestScore) {
				bestScore = score;
				bestAlt = alt;
			}
		}

		if (bestAlt) {
			return {
				tool: bestAlt,
				reason: `Fallback from ${name}`,
				confidence: Math.min(0.9, bestScore),
				alternatives: alternatives.filter((a) => a !== bestAlt),
			};
		}

		return null;
	}

	private findBetterAlternative(name: string, context: ToolSelectionContext): string | null {
		const alternatives = this.getAlternatives(name, context);
		const currentScore = this.getToolScore(name);

		for (const alt of alternatives) {
			const altScore = this.getToolScore(alt);
			if (altScore > currentScore * 1.2) {
				// 20% better threshold
				return alt;
			}
		}

		return null;
	}

	private getToolScore(name: string): number {
		const stats = this.stats.get(name);
		if (!stats || stats.totalCalls < this.config.minSamplesForStats) {
			return 0.5; // neutral score
		}

		const successRate = stats.successCount / stats.totalCalls;
		const latencyScore = Math.max(0, 1 - stats.avgLatency / this.config.latencyThresholdMs);

		// Weighted combination
		return successRate * 0.7 + latencyScore * 0.3;
	}

	private countRecentFailures(name: string): number {
		const cutoff = Date.now() - this.config.circuitBreakerResetMs;
		return this.recentExecutions.filter(
			(e) => e.tool === name && !e.success && e.timestamp >= cutoff
		).length;
	}

	// ---------------------------------------------------------------------------
	// Query Methods
	// ---------------------------------------------------------------------------

	getStats(name?: string): ToolStats | ToolStats[] | null {
		if (name) {
			return this.stats.get(name) || null;
		}
		return Array.from(this.stats.values());
	}

	getRecommendations(context?: ToolSelectionContext): ToolRecommendation[] {
		const recommendations: ToolRecommendation[] = [];

		for (const [name, stats] of this.stats) {
			if (stats.totalCalls < this.config.minSamplesForStats) continue;

			const successRate = stats.successCount / stats.totalCalls;
			const score = this.getToolScore(name);

			let recommendation: string;
			if (successRate >= 0.95 && stats.avgLatency < this.config.latencyThresholdMs / 2) {
				recommendation = "Excellent - recommended for critical tasks";
			} else if (successRate >= 0.85) {
				recommendation = "Good - reliable for most use cases";
			} else if (successRate >= 0.7) {
				recommendation = "Fair - consider alternatives for important tasks";
			} else {
				recommendation = "Poor - avoid or investigate issues";
			}

			recommendations.push({
				tool: name,
				score,
				successRate,
				avgLatency: stats.avgLatency,
				recommendation,
			});
		}

		return recommendations.sort((a, b) => b.score - a.score);
	}

	getCircuitStatus(): Map<string, { open: boolean; until?: number }> {
		const status = new Map<string, { open: boolean; until?: number }>();
		for (const [name, stats] of this.stats) {
			status.set(name, {
				open: stats.circuitOpen,
				until: stats.circuitOpenUntil,
			});
		}
		return status;
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	reset(): void {
		this.stats.clear();
		this.alternatives.clear();
		this.recentExecutions = [];
	}

	resetTool(name: string): void {
		const stats = this.stats.get(name);
		if (stats) {
			stats.successCount = 0;
			stats.failureCount = 0;
			stats.totalCalls = 0;
			stats.avgLatency = 0;
			stats.minLatency = Infinity;
			stats.maxLatency = 0;
			stats.circuitOpen = false;
			stats.circuitOpenUntil = undefined;
		}
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: SmartToolSelection | null = null;

export function getSmartToolSelection(config?: Partial<SmartToolConfig>): SmartToolSelection {
	if (!instance) {
		instance = new SmartToolSelection(config);
	}
	return instance;
}

export function resetSmartToolSelection(): void {
	if (instance) {
		instance.reset();
	}
	instance = null;
}
