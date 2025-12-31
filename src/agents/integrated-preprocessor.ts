/**
 * INTEGRATED PREPROCESSOR
 * ========================
 * Combines all Track enhancements into a single agent-loop preprocessor:
 *
 * Track A: Learning Activation - Trigger learning from agent outputs
 * Track B: Metrics & Verification - Performance context injection
 * Track C: MCTS Exploration - (Used by agent directly, not preprocessor)
 * Track D: Context Compression - Compress when context exceeds threshold
 *
 * This preprocessor is designed to be passed to AgentLoopConfig.preprocessor
 */

import type { Message } from "@mariozechner/pi-ai";
import {
	createVerificationPreprocessor,
	getMetricsTracker,
	getVerificationPreprocessor,
} from "../mcp-catalog/index.js";
import { getSmitheryCatalog } from "../mcp-catalog/progressive-discovery.js";
import { getLearningActivationService } from "./learning-activation.js";

// Note: Compression and MCTS types are exported from @mariozechner/pi-ai directly
// Import them from there when needed:
//   import { compressContext, createAnchoredCompressor, ... } from "@mariozechner/pi-ai";
//   import { createMCTSExplorer, runMCTSSearch, ... } from "@mariozechner/pi-ai";

export interface IntegratedPreprocessorConfig {
	/** Enable verification context injection (Track B) */
	enableVerification: boolean;

	/** Enable context compression when threshold exceeded (Track D) */
	enableCompression: boolean;

	/** Token threshold to trigger compression */
	compressionThreshold: number;

	/** Minimum confidence threshold for tool execution warnings */
	minConfidenceThreshold: number;

	/** Enable low-performance tool warnings */
	warnOnLowPerformance: boolean;

	/** Enable learning activation (Track A) */
	enableLearning: boolean;
}

export const DEFAULT_INTEGRATED_CONFIG: IntegratedPreprocessorConfig = {
	enableVerification: true,
	enableCompression: true,
	compressionThreshold: 80000, // ~80k tokens before compression
	minConfidenceThreshold: 0.3,
	warnOnLowPerformance: true,
	enableLearning: true,
};

/**
 * Estimate token count from messages (rough approximation)
 */
function estimateTokens(messages: Message[]): number {
	let total = 0;
	for (const msg of messages) {
		// Handle both string and array content formats
		const content = msg.content;
		if (typeof content === "string") {
			// String content: estimate directly
			total += Math.ceil(content.length / 4);
		} else if (Array.isArray(content)) {
			// Array content: iterate over content blocks
			for (const block of content) {
				if (typeof block === "object" && "type" in block && block.type === "text" && "text" in block) {
					// Rough estimate: 4 chars per token
					total += Math.ceil((block as { type: "text"; text: string }).text.length / 4);
				}
			}
		}
	}
	return total;
}

/**
 * Create an integrated preprocessor for agent-loop
 *
 * This combines:
 * - Track B: Performance/verification context injection
 * - Track D: Context compression when threshold exceeded
 *
 * Track A (Learning) is handled post-response via processAgentOutput()
 * Track C (MCTS) is used directly by the agent, not through preprocessor
 *
 * Usage:
 * ```typescript
 * import { createIntegratedPreprocessor } from "./agents/integrated-preprocessor.js";
 *
 * const agentConfig: AgentLoopConfig = {
 *   model,
 *   preprocessor: createIntegratedPreprocessor(),
 *   // ...
 * };
 * ```
 */
export function createIntegratedPreprocessor(
	config: Partial<IntegratedPreprocessorConfig> = {},
): (messages: Message[], signal?: AbortSignal) => Promise<Message[]> {
	const fullConfig = { ...DEFAULT_INTEGRATED_CONFIG, ...config };

	// Initialize services
	const metricsTracker = getMetricsTracker();
	const catalog = getSmitheryCatalog();
	const verificationPreprocessor = createVerificationPreprocessor(metricsTracker, catalog, {
		minConfidenceThreshold: fullConfig.minConfidenceThreshold,
		injectPerformanceContext: fullConfig.enableVerification,
		warnOnLowPerformance: fullConfig.warnOnLowPerformance,
	});

	return async (messages: Message[], signal?: AbortSignal): Promise<Message[]> => {
		let processed = [...messages];

		// Step 1: Check if compression is needed (Track D)
		if (fullConfig.enableCompression) {
			const tokenCount = estimateTokens(processed);
			if (tokenCount > fullConfig.compressionThreshold) {
				try {
					// Import compression dynamically to avoid circular dependencies
					const piAi = await import("@mariozechner/pi-ai");
					// compressContext may not exist in all versions
					if (!("compressContext" in piAi)) {
						console.log("[Preprocessor] Compression not available in this pi-ai version");
						return processed;
					}
					const compressed = await (piAi as any).compressContext(processed);

					if (compressed.qualityMet) {
						console.log(
							`[Preprocessor] Compressed context: ${compressed.originalTokens} -> ${compressed.compressedTokens} tokens (${(compressed.compressionRatio * 100).toFixed(1)}%)`,
						);
						processed = compressed.messages;
					} else {
						console.warn(
							`[Preprocessor] Compression quality not met (${compressed.quality.overallScore.toFixed(2)}/3.5), keeping original`,
						);
					}
				} catch (error) {
					console.error("[Preprocessor] Compression failed:", error);
					// Continue with uncompressed messages
				}
			}
		}

		// Step 2: Apply verification context injection (Track B)
		if (fullConfig.enableVerification) {
			try {
				processed = await verificationPreprocessor(processed, signal);
			} catch (error) {
				console.error("[Preprocessor] Verification failed:", error);
				// Continue with current messages
			}
		}

		return processed;
	};
}

/**
 * Process agent output for learning activation (Track A)
 *
 * Call this after the agent completes a turn to extract learnings
 *
 * Usage:
 * ```typescript
 * for await (const event of agent.run(context)) {
 *   if (event.type === "turn_end") {
 *     await processAgentOutput(
 *       getTextFromMessage(event.message),
 *       originalTask,
 *       true // success
 *     );
 *   }
 * }
 * ```
 */
export async function processAgentOutput(
	output: string,
	task: string,
	success: boolean,
	sessionId?: string,
): Promise<{
	learned: boolean;
	domain: string;
	insight: string;
}> {
	const service = getLearningActivationService();
	const result = await service.processOutput(output, task, success, sessionId);

	if (result.learned) {
		console.log(`[Learning] Extracted insight from ${result.domain}: ${result.insight.slice(0, 50)}...`);
	}

	return {
		learned: result.learned,
		domain: result.domain,
		insight: result.insight,
	};
}

/**
 * Get current preprocessor statistics
 */
export function getPreprocessorStats(): {
	verification: {
		verificationCount: number;
		lowPerformingTools: string[];
		totalVerificationTimeMs: number;
	};
	metrics: {
		totalMetrics: number;
		totalServers: number;
		totalTools: number;
		overallSuccessRate: number;
	};
	learning: {
		totalDomains: number;
		activeDomains: string[];
		emptyDomains: string[];
		criticalDomainsCoverage: number;
	};
} {
	const verificationPreprocessor = getVerificationPreprocessor();
	const metricsTracker = getMetricsTracker();
	const learningService = getLearningActivationService();

	const verificationContext = verificationPreprocessor.getContext();
	const metricsSummary = metricsTracker.getSummary();
	const learningStats = learningService.getStats();

	return {
		verification: {
			verificationCount: verificationContext.verificationCount,
			lowPerformingTools: verificationContext.lowPerformingTools,
			totalVerificationTimeMs: verificationContext.totalVerificationTimeMs,
		},
		metrics: {
			totalMetrics: metricsSummary.totalMetrics,
			totalServers: metricsSummary.totalServers,
			totalTools: metricsSummary.totalTools,
			overallSuccessRate: metricsSummary.overallSuccessRate,
		},
		learning: {
			totalDomains: learningStats.totalDomains,
			activeDomains: learningStats.activeDomains,
			emptyDomains: learningStats.emptyDomains,
			criticalDomainsCoverage: learningStats.criticalDomainsCoverage,
		},
	};
}

export default {
	createIntegratedPreprocessor,
	processAgentOutput,
	getPreprocessorStats,
	DEFAULT_INTEGRATED_CONFIG,
};
