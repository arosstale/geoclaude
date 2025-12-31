/**
 * METRICS HOOK
 * =============
 * Automatic tool metrics collection for MCP-Bench aligned tracking
 *
 * Integrates with the hook system to capture:
 * - Tool execution latency
 * - Success/error/timeout status
 * - Confidence scoring based on result analysis
 *
 * Works with MetricsTracker for aggregation and persistence.
 */

import { getMetricsTracker } from "../../mcp-catalog/metrics-tracker.js";
import type {
	AgentHookAPI,
	AgentHookContext,
	AgentHookFactory,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
} from "./types.js";

export interface MetricsHookConfig {
	enabled: boolean;
	/** Timeout threshold in ms (default: 30000) */
	timeoutThreshold: number;
	/** Minimum confidence for successful result (default: 0.7) */
	minSuccessConfidence: number;
	/** Server name to use for metrics (default: "discord-bot") */
	serverName: string;
	/** Log metrics to console (default: false) */
	verbose: boolean;
}

const DEFAULT_METRICS_CONFIG: MetricsHookConfig = {
	enabled: true,
	timeoutThreshold: 30000,
	minSuccessConfidence: 0.7,
	serverName: "discord-bot",
	verbose: false,
};

// Track active tool calls for latency calculation
const activeToolCalls = new Map<string, { toolName: string; startTime: number }>();

/**
 * Calculate confidence score from tool result
 * Based on result length, error indicators, and content quality
 */
function calculateConfidence(result: string, isError: boolean): number {
	if (isError) return 0.0;

	let confidence = 0.5; // Base confidence

	// Longer results generally indicate more useful output
	if (result.length > 100) confidence += 0.1;
	if (result.length > 500) confidence += 0.1;
	if (result.length > 1000) confidence += 0.1;

	// Error patterns reduce confidence
	const errorPatterns = [/error/i, /failed/i, /exception/i, /timeout/i, /not found/i, /undefined/i, /null/i];
	for (const pattern of errorPatterns) {
		if (pattern.test(result)) {
			confidence -= 0.1;
		}
	}

	// Success patterns increase confidence
	const successPatterns = [/success/i, /completed/i, /created/i, /updated/i, /found/i, /returned/i];
	for (const pattern of successPatterns) {
		if (pattern.test(result)) {
			confidence += 0.05;
		}
	}

	// Clamp to valid range
	return Math.max(0, Math.min(1, confidence));
}

/**
 * Determine status from result analysis
 * Note: _result is kept for future enhancement (content-based error detection)
 */
function determineStatus(
	_result: string,
	isError: boolean,
	latencyMs: number,
	config: MetricsHookConfig,
): "success" | "error" | "timeout" {
	if (latencyMs >= config.timeoutThreshold) {
		return "timeout";
	}
	if (isError) {
		return "error";
	}
	return "success";
}

/**
 * Create metrics hook factory
 */
export function createMetricsHook(config: Partial<MetricsHookConfig> = {}): AgentHookFactory {
	const fullConfig: MetricsHookConfig = { ...DEFAULT_METRICS_CONFIG, ...config };

	return (api: AgentHookAPI) => {
		if (!fullConfig.enabled) return;

		const tracker = getMetricsTracker();

		// Track tool call start
		api.on(
			"tool_call",
			async (event: ToolCallEvent, _ctx: AgentHookContext): Promise<ToolCallEventResult | undefined> => {
				activeToolCalls.set(event.toolCallId, {
					toolName: event.toolName,
					startTime: Date.now(),
				});

				if (fullConfig.verbose) {
					console.log(`[METRICS] Tool call started: ${event.toolName} (${event.toolCallId})`);
				}
				return undefined;
			},
		);

		// Track tool result and record metrics
		api.on(
			"tool_result",
			async (event: ToolResultEvent, _ctx: AgentHookContext): Promise<ToolResultEventResult | undefined> => {
				const callData = activeToolCalls.get(event.toolCallId);
				if (!callData) {
					// Tool call not tracked (might have been started before hook registration)
					return undefined;
				}

				const latencyMs = Date.now() - callData.startTime;
				const status = determineStatus(event.result, event.isError, latencyMs, fullConfig);
				const confidence = calculateConfidence(event.result, event.isError);

				// Clean up
				activeToolCalls.delete(event.toolCallId);

				// Record metric
				try {
					await tracker.recordMetric({
						toolName: event.toolName,
						serverName: fullConfig.serverName,
						timestamp: Date.now(),
						latencyMs,
						status,
						confidenceScore: confidence,
						errorMessage: event.isError ? event.result.slice(0, 500) : undefined,
					});

					if (fullConfig.verbose) {
						console.log(
							`[METRICS] Recorded: ${event.toolName} ` +
								`status=${status} latency=${latencyMs}ms confidence=${confidence.toFixed(2)}`,
						);
					}
				} catch (err) {
					console.warn("[METRICS] Failed to record metric:", err);
				}

				return undefined;
			},
		);
	};
}

/**
 * Get active tool call count
 */
export function getActiveToolCallCount(): number {
	return activeToolCalls.size;
}

/**
 * Clear stale tool calls (older than timeout threshold)
 */
export function clearStaleToolCalls(timeoutThreshold: number = 60000): number {
	const now = Date.now();
	let cleared = 0;

	for (const [id, data] of activeToolCalls.entries()) {
		if (now - data.startTime > timeoutThreshold) {
			activeToolCalls.delete(id);
			cleared++;
		}
	}

	return cleared;
}

export { DEFAULT_METRICS_CONFIG };
