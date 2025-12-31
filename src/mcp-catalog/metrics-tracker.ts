/**
 * METRICS TRACKER
 * ================
 * MCP-Bench aligned tool performance tracking
 *
 * Based on arXiv:2508.20453 - MCP-Bench: A Comprehensive Benchmark for MCP Servers
 *
 * Tracks:
 * - Tool execution latency
 * - Success/error/timeout rates
 * - Confidence scoring
 * - Server reliability
 *
 * Integration with skill-distillation for workflow optimization
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import type { TSchema } from "@sinclair/typebox";
import { createHash } from "crypto";

export interface ToolMetric {
	id: string;
	toolName: string;
	serverName: string;
	timestamp: number;
	latencyMs: number;
	status: "success" | "error" | "timeout";
	confidenceScore: number;
	inputTokens?: number;
	outputTokens?: number;
	errorMessage?: string;
}

export interface ServerMetrics {
	serverName: string;
	totalCalls: number;
	successCount: number;
	errorCount: number;
	timeoutCount: number;
	avgLatencyMs: number;
	p95LatencyMs: number;
	successRate: number;
	reliabilityScore: number; // 0-1
	lastUpdated: number;
}

export interface ToolPerformance {
	toolName: string;
	serverName: string;
	totalCalls: number;
	successRate: number;
	avgLatencyMs: number;
	p95LatencyMs: number;
	confidenceAvg: number;
	lastSuccess: number | null;
	lastError: number | null;
}

export interface MetricsConfig {
	maxHistorySize: number; // Max metrics to keep in memory
	persistInterval: number; // How often to persist to DB (ms)
	timeoutThreshold: number; // ms before considering a call timed out
	minCallsForReliability: number; // Min calls before calculating reliability
}

// Default configuration
const DEFAULT_CONFIG: MetricsConfig = {
	maxHistorySize: 10000,
	persistInterval: 60000, // 1 minute
	timeoutThreshold: 30000, // 30 seconds
	minCallsForReliability: 10,
};

export class MetricsTracker {
	private config: MetricsConfig;
	private metrics: ToolMetric[] = [];
	private serverCache: Map<string, ServerMetrics> = new Map();
	private toolCache: Map<string, ToolPerformance> = new Map();
	private persistCallback?: (metrics: ToolMetric[]) => Promise<void>;
	private lastPersist: number = Date.now();

	constructor(config: Partial<MetricsConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Set persistence callback (to SQLite or other storage)
	 */
	setPersistCallback(callback: (metrics: ToolMetric[]) => Promise<void>): void {
		this.persistCallback = callback;
	}

	/**
	 * Record a tool execution metric
	 */
	async recordMetric(metric: Omit<ToolMetric, "id">): Promise<ToolMetric> {
		const id = createHash("md5")
			.update(`${metric.toolName}-${metric.timestamp}-${Math.random()}`)
			.digest("hex")
			.slice(0, 16);

		const fullMetric: ToolMetric = { id, ...metric };

		// Add to in-memory store
		this.metrics.push(fullMetric);

		// Trim if exceeds max size
		if (this.metrics.length > this.config.maxHistorySize) {
			this.metrics = this.metrics.slice(-this.config.maxHistorySize);
		}

		// Update caches
		this.updateServerCache(fullMetric);
		this.updateToolCache(fullMetric);

		// Persist if interval elapsed
		await this.maybePersist();

		return fullMetric;
	}

	/**
	 * Start tracking a tool call (returns a finish function)
	 */
	startTracking(
		toolName: string,
		serverName: string,
	): (result: { success: boolean; error?: string; confidence?: number }) => Promise<ToolMetric> {
		const startTime = Date.now();

		return async (result) => {
			const latencyMs = Date.now() - startTime;
			const isTimeout = latencyMs >= this.config.timeoutThreshold;

			let status: ToolMetric["status"];
			if (isTimeout) {
				status = "timeout";
			} else if (result.success) {
				status = "success";
			} else {
				status = "error";
			}

			return this.recordMetric({
				toolName,
				serverName,
				timestamp: startTime,
				latencyMs,
				status,
				confidenceScore: result.confidence ?? (result.success ? 1.0 : 0.0),
				errorMessage: result.error,
			});
		};
	}

	/**
	 * Get metrics for a specific server
	 */
	getServerMetrics(serverName: string): ServerMetrics | undefined {
		return this.serverCache.get(serverName);
	}

	/**
	 * Get metrics for a specific tool
	 */
	getToolPerformance(toolName: string, serverName?: string): ToolPerformance | undefined {
		const key = serverName ? `${serverName}:${toolName}` : toolName;
		return this.toolCache.get(key);
	}

	/**
	 * Get all server metrics sorted by reliability
	 */
	getAllServerMetrics(): ServerMetrics[] {
		return Array.from(this.serverCache.values()).sort((a, b) => b.reliabilityScore - a.reliabilityScore);
	}

	/**
	 * Get all tool performance stats
	 */
	getAllToolPerformance(): ToolPerformance[] {
		return Array.from(this.toolCache.values()).sort((a, b) => b.successRate - a.successRate);
	}

	/**
	 * Calculate confidence score for a tool based on historical performance
	 */
	getToolConfidence(toolName: string, serverName?: string): number {
		const perf = this.getToolPerformance(toolName, serverName);
		if (!perf || perf.totalCalls < this.config.minCallsForReliability) {
			return 0.5; // Unknown confidence
		}

		// Weighted confidence based on:
		// - Success rate (40%)
		// - Latency (30%) - lower is better
		// - Historical confidence (30%)
		const successWeight = perf.successRate * 0.4;

		// Normalize latency (assume 1000ms as baseline)
		const latencyScore = Math.max(0, 1 - perf.avgLatencyMs / 10000);
		const latencyWeight = latencyScore * 0.3;

		const confidenceWeight = perf.confidenceAvg * 0.3;

		return Math.min(1, successWeight + latencyWeight + confidenceWeight);
	}

	/**
	 * Get low-performing tools that need attention
	 */
	getLowPerformingTools(threshold: number = 0.7): ToolPerformance[] {
		return this.getAllToolPerformance().filter(
			(t) => t.totalCalls >= this.config.minCallsForReliability && t.successRate < threshold,
		);
	}

	/**
	 * Get unreliable servers
	 */
	getUnreliableServers(threshold: number = 0.8): ServerMetrics[] {
		return this.getAllServerMetrics().filter(
			(s) => s.totalCalls >= this.config.minCallsForReliability && s.reliabilityScore < threshold,
		);
	}

	/**
	 * Get recent metrics
	 */
	getRecentMetrics(count: number = 100): ToolMetric[] {
		return this.metrics.slice(-count);
	}

	/**
	 * Get metrics summary
	 */
	getSummary(): {
		totalMetrics: number;
		totalServers: number;
		totalTools: number;
		overallSuccessRate: number;
		avgLatencyMs: number;
		lastUpdated: number;
	} {
		const successCount = this.metrics.filter((m) => m.status === "success").length;
		const totalLatency = this.metrics.reduce((sum, m) => sum + m.latencyMs, 0);

		return {
			totalMetrics: this.metrics.length,
			totalServers: this.serverCache.size,
			totalTools: this.toolCache.size,
			overallSuccessRate: this.metrics.length > 0 ? successCount / this.metrics.length : 0,
			avgLatencyMs: this.metrics.length > 0 ? totalLatency / this.metrics.length : 0,
			lastUpdated: this.metrics.length > 0 ? this.metrics[this.metrics.length - 1].timestamp : 0,
		};
	}

	/**
	 * Clear all metrics
	 */
	clear(): void {
		this.metrics = [];
		this.serverCache.clear();
		this.toolCache.clear();
	}

	// ========================================================================
	// Private methods
	// ========================================================================

	private updateServerCache(metric: ToolMetric): void {
		const existing = this.serverCache.get(metric.serverName);

		if (!existing) {
			this.serverCache.set(metric.serverName, {
				serverName: metric.serverName,
				totalCalls: 1,
				successCount: metric.status === "success" ? 1 : 0,
				errorCount: metric.status === "error" ? 1 : 0,
				timeoutCount: metric.status === "timeout" ? 1 : 0,
				avgLatencyMs: metric.latencyMs,
				p95LatencyMs: metric.latencyMs,
				successRate: metric.status === "success" ? 1 : 0,
				reliabilityScore: metric.status === "success" ? 1 : 0,
				lastUpdated: metric.timestamp,
			});
			return;
		}

		// Update existing
		existing.totalCalls++;
		if (metric.status === "success") existing.successCount++;
		if (metric.status === "error") existing.errorCount++;
		if (metric.status === "timeout") existing.timeoutCount++;

		// Recalculate averages
		existing.avgLatencyMs =
			(existing.avgLatencyMs * (existing.totalCalls - 1) + metric.latencyMs) / existing.totalCalls;
		existing.successRate = existing.successCount / existing.totalCalls;

		// Calculate reliability score (success rate with penalty for timeouts)
		const timeoutPenalty = existing.timeoutCount * 0.1;
		existing.reliabilityScore = Math.max(0, existing.successRate - timeoutPenalty);

		existing.lastUpdated = metric.timestamp;

		// P95 calculation would require keeping all latencies - approximate for now
		if (metric.latencyMs > existing.p95LatencyMs) {
			existing.p95LatencyMs = metric.latencyMs;
		}
	}

	private updateToolCache(metric: ToolMetric): void {
		const key = `${metric.serverName}:${metric.toolName}`;
		const existing = this.toolCache.get(key);

		if (!existing) {
			this.toolCache.set(key, {
				toolName: metric.toolName,
				serverName: metric.serverName,
				totalCalls: 1,
				successRate: metric.status === "success" ? 1 : 0,
				avgLatencyMs: metric.latencyMs,
				p95LatencyMs: metric.latencyMs,
				confidenceAvg: metric.confidenceScore,
				lastSuccess: metric.status === "success" ? metric.timestamp : null,
				lastError: metric.status !== "success" ? metric.timestamp : null,
			});
			return;
		}

		// Update existing
		existing.totalCalls++;
		const successCount = existing.successRate * (existing.totalCalls - 1) + (metric.status === "success" ? 1 : 0);
		existing.successRate = successCount / existing.totalCalls;

		existing.avgLatencyMs =
			(existing.avgLatencyMs * (existing.totalCalls - 1) + metric.latencyMs) / existing.totalCalls;

		existing.confidenceAvg =
			(existing.confidenceAvg * (existing.totalCalls - 1) + metric.confidenceScore) / existing.totalCalls;

		if (metric.status === "success") {
			existing.lastSuccess = metric.timestamp;
		} else {
			existing.lastError = metric.timestamp;
		}

		if (metric.latencyMs > existing.p95LatencyMs) {
			existing.p95LatencyMs = metric.latencyMs;
		}
	}

	private async maybePersist(): Promise<void> {
		if (!this.persistCallback) return;

		const now = Date.now();
		if (now - this.lastPersist < this.config.persistInterval) return;

		// Get metrics since last persist
		const toPersist = this.metrics.filter((m) => m.timestamp > this.lastPersist);
		if (toPersist.length === 0) return;

		try {
			await this.persistCallback(toPersist);
			this.lastPersist = now;
		} catch (error) {
			console.error("[MetricsTracker] Persist failed:", error);
		}
	}
}

// Singleton instance
let trackerInstance: MetricsTracker | null = null;

export function getMetricsTracker(config?: Partial<MetricsConfig>): MetricsTracker {
	if (!trackerInstance) {
		trackerInstance = new MetricsTracker(config);
	}
	return trackerInstance;
}

/**
 * Wrap an AgentTool with metrics tracking
 */
export function wrapToolWithMetrics<T extends TSchema, D>(tool: AgentTool<T, D>, serverName: string): AgentTool<T, D> {
	const tracker = getMetricsTracker();

	return {
		...tool,
		execute: async (toolCallId, args, signal, onUpdate) => {
			const finish = tracker.startTracking(tool.name, serverName);

			try {
				const result = await tool.execute(toolCallId, args, signal, onUpdate);

				// Calculate confidence from result
				const confidence = result.content.some((c) => c.type === "text" && c.text.includes("error")) ? 0.5 : 1.0;

				await finish({ success: true, confidence });
				return result;
			} catch (error) {
				await finish({
					success: false,
					error: error instanceof Error ? error.message : String(error),
					confidence: 0,
				});
				throw error;
			}
		},
	};
}

/**
 * Create metrics-aware tool wrapper factory
 */
export function createMetricsWrapper(serverName: string) {
	return <T extends TSchema, D>(tool: AgentTool<T, D>): AgentTool<T, D> => wrapToolWithMetrics(tool, serverName);
}

export default {
	getMetricsTracker,
	wrapToolWithMetrics,
	createMetricsWrapper,
};
