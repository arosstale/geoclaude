/**
 * VERIFICATION PREPROCESSOR
 * ==========================
 * Test-time compute verification for tool execution
 *
 * Based on arXiv:2408.03314 - Scaling test-time compute:
 * - Pre-execution confidence scoring
 * - Performance context injection
 * - Automatic retry with alternative tools
 *
 * Integrates with:
 * - MetricsTracker for historical performance
 * - SmitheryCatalog for alternative tool discovery
 * - Agent preprocessor hook for context enhancement
 */

import type { Message } from "@mariozechner/pi-ai";
import { getMetricsTracker, type MetricsTracker, type ToolPerformance } from "./metrics-tracker.js";
import { getSmitheryCatalog } from "./progressive-discovery.js";

export interface VerificationConfig {
	/** Minimum confidence threshold for tool execution */
	minConfidenceThreshold: number;

	/** Inject performance context into messages */
	injectPerformanceContext: boolean;

	/** Maximum alternatives to suggest */
	maxAlternatives: number;

	/** Enable automatic retries with alternatives */
	enableAutoRetry: boolean;

	/** Token budget for verification context */
	verificationTokenBudget: number;

	/** Warn on low-performing tools */
	warnOnLowPerformance: boolean;

	/** Low performance threshold */
	lowPerformanceThreshold: number;
}

export const DEFAULT_VERIFICATION_CONFIG: VerificationConfig = {
	minConfidenceThreshold: 0.3,
	injectPerformanceContext: true,
	maxAlternatives: 3,
	enableAutoRetry: true,
	verificationTokenBudget: 500,
	warnOnLowPerformance: true,
	lowPerformanceThreshold: 0.7,
};

export interface ToolVerification {
	toolName: string;
	serverName: string;
	confidence: number;
	historicalSuccessRate: number;
	avgLatencyMs: number;
	recommendation: "proceed" | "caution" | "avoid";
	alternatives: Array<{
		toolName: string;
		serverName: string;
		confidence: number;
		reason: string;
	}>;
	warning?: string;
}

export interface VerificationContext {
	/** Tools verified in this session */
	verifiedTools: Map<string, ToolVerification>;

	/** Low-performing tools encountered */
	lowPerformingTools: string[];

	/** Total verification time (ms) */
	totalVerificationTimeMs: number;

	/** Number of verifications performed */
	verificationCount: number;
}

/**
 * Verification preprocessor for agent messages
 */
class VerificationPreprocessor {
	private config: VerificationConfig;
	private metricsTracker: MetricsTracker;
	private catalog: ReturnType<typeof getSmitheryCatalog>;
	private context: VerificationContext;

	constructor(
		metricsTracker?: MetricsTracker,
		catalog?: ReturnType<typeof getSmitheryCatalog>,
		config: Partial<VerificationConfig> = {},
	) {
		this.config = { ...DEFAULT_VERIFICATION_CONFIG, ...config };
		this.metricsTracker = metricsTracker || getMetricsTracker();
		this.catalog = catalog || getSmitheryCatalog();
		this.context = {
			verifiedTools: new Map(),
			lowPerformingTools: [],
			totalVerificationTimeMs: 0,
			verificationCount: 0,
		};
	}

	/**
	 * Get verification for a specific tool
	 */
	verifyTool(toolName: string, serverName: string): ToolVerification {
		const startTime = Date.now();
		const key = `${serverName}:${toolName}`;

		// Check cache
		const cached = this.context.verifiedTools.get(key);
		if (cached) {
			return cached;
		}

		// Get historical performance
		const performance = this.metricsTracker.getToolPerformance(toolName, serverName);
		const confidence = this.metricsTracker.getToolConfidence(toolName, serverName);

		// Determine recommendation
		let recommendation: ToolVerification["recommendation"] = "proceed";
		let warning: string | undefined;

		if (performance) {
			if (performance.successRate < 0.5) {
				recommendation = "avoid";
				warning = `Tool has low success rate (${(performance.successRate * 100).toFixed(1)}%)`;
			} else if (performance.successRate < this.config.lowPerformanceThreshold) {
				recommendation = "caution";
				warning = `Tool has moderate success rate (${(performance.successRate * 100).toFixed(1)}%)`;
			}
		} else {
			recommendation = "caution";
			warning = "No historical performance data available";
		}

		// Find alternatives
		const alternatives = this.findAlternatives(toolName, serverName);

		const verification: ToolVerification = {
			toolName,
			serverName,
			confidence,
			historicalSuccessRate: performance?.successRate ?? 0.5,
			avgLatencyMs: performance?.avgLatencyMs ?? 1000,
			recommendation,
			alternatives,
			warning,
		};

		// Track low-performing tools
		if (recommendation === "avoid" && !this.context.lowPerformingTools.includes(key)) {
			this.context.lowPerformingTools.push(key);
		}

		// Cache and update stats
		this.context.verifiedTools.set(key, verification);
		this.context.verificationCount++;
		this.context.totalVerificationTimeMs += Date.now() - startTime;

		return verification;
	}

	/**
	 * Find alternative tools for a given tool
	 */
	private findAlternatives(toolName: string, serverName: string): ToolVerification["alternatives"] {
		const alternatives: ToolVerification["alternatives"] = [];

		// Search catalog for similar tools
		const searchTerms = toolName.replace(/_/g, " ").replace(/-/g, " ");
		const results = this.catalog.discover(searchTerms, { limit: 5 });

		for (const result of results) {
			// Skip the same server
			if (result.server.server_name === serverName) continue;

			// Find similar tool in this server
			const similarTool = result.server.tools.find((t) => {
				const similarity = this.calculateToolSimilarity(toolName, t.name);
				return similarity > 0.5;
			});

			if (similarTool) {
				const altConfidence = this.metricsTracker.getToolConfidence(similarTool.name, result.server.server_name);

				alternatives.push({
					toolName: similarTool.name,
					serverName: result.server.server_name,
					confidence: altConfidence,
					reason: `Similar tool on ${result.server.server_name}`,
				});

				if (alternatives.length >= this.config.maxAlternatives) {
					break;
				}
			}
		}

		// Sort by confidence
		return alternatives.sort((a, b) => b.confidence - a.confidence);
	}

	/**
	 * Calculate similarity between two tool names
	 */
	private calculateToolSimilarity(name1: string, name2: string): number {
		const normalize = (s: string) => s.toLowerCase().replace(/[_-]/g, " ");
		const n1 = normalize(name1);
		const n2 = normalize(name2);

		// Word overlap
		const words1 = new Set(n1.split(" "));
		const words2 = new Set(n2.split(" "));
		const intersection = [...words1].filter((w) => words2.has(w));
		const union = new Set([...words1, ...words2]);

		return intersection.length / union.size;
	}

	/**
	 * Process messages with verification context
	 * This is the main preprocessor function for agent-loop
	 */
	async process(messages: Message[], _signal?: AbortSignal): Promise<Message[]> {
		if (!this.config.injectPerformanceContext) {
			return messages;
		}

		// Get low-performing tools summary
		const lowPerformingTools = this.metricsTracker.getLowPerformingTools(this.config.lowPerformanceThreshold);

		// If no tools to warn about, return messages unchanged
		if (lowPerformingTools.length === 0) {
			return messages;
		}

		// Create verification context message
		const warningContent = this.createVerificationContextContent(lowPerformingTools);

		// Find the last system or user message to inject after
		const processedMessages = [...messages];

		// Add verification context as a system reminder
		const reminderMessage: Message = {
			role: "user",
			content: [
				{
					type: "text",
					text: `<verification-context>\n${warningContent}\n</verification-context>`,
				},
			],
			timestamp: Date.now(),
		};

		// Insert before the last user message (ES2023 findLastIndex alternative)
		let lastUserIdx = -1;
		for (let i = processedMessages.length - 1; i >= 0; i--) {
			if (processedMessages[i].role === "user") {
				lastUserIdx = i;
				break;
			}
		}
		if (lastUserIdx >= 0) {
			processedMessages.splice(lastUserIdx, 0, reminderMessage);
		}

		return processedMessages;
	}

	/**
	 * Create verification context content
	 */
	private createVerificationContextContent(lowPerformingTools: ToolPerformance[]): string {
		const lines: string[] = [
			"## Tool Performance Alerts",
			"",
			"The following tools have low historical success rates:",
			"",
		];

		for (const tool of lowPerformingTools.slice(0, 5)) {
			lines.push(
				`- **${tool.toolName}** (${tool.serverName}): ${(tool.successRate * 100).toFixed(1)}% success, ${tool.avgLatencyMs.toFixed(0)}ms avg latency`,
			);

			// Suggest alternatives
			const verification = this.verifyTool(tool.toolName, tool.serverName);
			if (verification.alternatives.length > 0) {
				const alt = verification.alternatives[0];
				lines.push(
					`  → Consider: ${alt.toolName} (${alt.serverName}) - ${(alt.confidence * 100).toFixed(0)}% confidence`,
				);
			}
		}

		lines.push("");
		lines.push("Consider using alternatives for critical operations.");

		return lines.join("\n");
	}

	/**
	 * Get verification context summary
	 */
	getContext(): VerificationContext {
		return { ...this.context };
	}

	/**
	 * Reset verification context
	 */
	resetContext(): void {
		this.context = {
			verifiedTools: new Map(),
			lowPerformingTools: [],
			totalVerificationTimeMs: 0,
			verificationCount: 0,
		};
	}

	/**
	 * Get config
	 */
	getConfig(): VerificationConfig {
		return { ...this.config };
	}

	/**
	 * Update config
	 */
	setConfig(config: Partial<VerificationConfig>): void {
		this.config = { ...this.config, ...config };
	}
}

// Singleton instance
let preprocessorInstance: VerificationPreprocessor | null = null;

export function getVerificationPreprocessor(
	metricsTracker?: MetricsTracker,
	catalog?: ReturnType<typeof getSmitheryCatalog>,
	config?: Partial<VerificationConfig>,
): VerificationPreprocessor {
	if (!preprocessorInstance) {
		preprocessorInstance = new VerificationPreprocessor(metricsTracker, catalog, config);
	}
	return preprocessorInstance;
}

/**
 * Create preprocessor function for agent-loop
 */
export function createVerificationPreprocessor(
	metricsTracker?: MetricsTracker,
	catalog?: ReturnType<typeof getSmitheryCatalog>,
	config?: Partial<VerificationConfig>,
): (messages: Message[], signal?: AbortSignal) => Promise<Message[]> {
	const preprocessor = getVerificationPreprocessor(metricsTracker, catalog, config);
	return (messages, signal) => preprocessor.process(messages, signal);
}

export default {
	getVerificationPreprocessor,
	createVerificationPreprocessor,
	DEFAULT_VERIFICATION_CONFIG,
};
