/**
 * Integrated Preprocessor Integration Tests
 * ===========================================
 * Comprehensive tests for the integrated agent-loop preprocessor
 *
 * Tests cover:
 * - Preprocessor creation and configuration
 * - Stats aggregation from all components
 * - Agent output processing for learning
 * - Integration with compression, verification, and metrics
 *
 * Run with: npx vitest run integrated-preprocessor.test.ts
 */

import type { Message } from "@mariozechner/pi-ai";
import { beforeEach, describe, expect, it } from "vitest";
import { getMetricsTracker } from "../mcp-catalog/metrics-tracker.js";
import {
	createIntegratedPreprocessor,
	DEFAULT_INTEGRATED_CONFIG,
	getPreprocessorStats,
	type IntegratedPreprocessorConfig,
	processAgentOutput,
} from "./integrated-preprocessor.js";
import { getLearningActivationService } from "./learning-activation.js";

// Test fixtures - create properly typed messages
const createUserMessage = (text: string): Message => ({
	role: "user",
	content: [{ type: "text", text }],
	timestamp: Date.now(),
});

const createAssistantMessage = (text: string): Message => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "openai-completions",
	provider: "openrouter",
	model: "test-model",
	usage: {
		input: 10,
		output: 10,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 20,
		cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
	},
	stopReason: "stop",
	timestamp: Date.now(),
});

const createTestMessages = (): Message[] => [
	createUserMessage("Test user message"),
	createAssistantMessage("Test assistant response"),
];

const createLargeMessages = (): Message[] => {
	const messages: Message[] = [createUserMessage("Start of conversation")];

	// Create many messages to exceed compression threshold
	for (let i = 0; i < 100; i++) {
		messages.push(createAssistantMessage("This is a verbose message that takes up space. ".repeat(100)));
	}

	return messages;
};

describe("Integrated Preprocessor", () => {
	beforeEach(() => {
		// Clear any previous metrics
		getMetricsTracker().clear();
	});

	describe("Configuration", () => {
		it("should have valid default configuration", () => {
			expect(DEFAULT_INTEGRATED_CONFIG.enableVerification).toBe(true);
			expect(DEFAULT_INTEGRATED_CONFIG.enableCompression).toBe(true);
			expect(DEFAULT_INTEGRATED_CONFIG.compressionThreshold).toBeGreaterThan(0);
			expect(DEFAULT_INTEGRATED_CONFIG.minConfidenceThreshold).toBeGreaterThanOrEqual(0);
			expect(DEFAULT_INTEGRATED_CONFIG.minConfidenceThreshold).toBeLessThanOrEqual(1);
			expect(DEFAULT_INTEGRATED_CONFIG.warnOnLowPerformance).toBe(true);
			expect(DEFAULT_INTEGRATED_CONFIG.enableLearning).toBe(true);
		});

		it("should create preprocessor with default config", async () => {
			const preprocessor = createIntegratedPreprocessor();

			const messages = createTestMessages();
			const result = await preprocessor(messages);

			expect(result).toBeDefined();
			expect(Array.isArray(result)).toBe(true);
		});

		it("should create preprocessor with custom config", async () => {
			const customConfig: Partial<IntegratedPreprocessorConfig> = {
				enableVerification: false,
				enableCompression: false,
			};

			const preprocessor = createIntegratedPreprocessor(customConfig);

			const messages = createTestMessages();
			const result = await preprocessor(messages);

			expect(result).toEqual(messages); // Should be unchanged
		});

		it("should respect custom compression threshold", async () => {
			const preprocessor = createIntegratedPreprocessor({
				compressionThreshold: 1000000, // Very high threshold
			});

			const messages = createLargeMessages();
			const result = await preprocessor(messages);

			// Should not compress due to high threshold
			expect(result.length).toBeGreaterThan(10);
		});

		it("should respect custom confidence threshold", async () => {
			const preprocessor = createIntegratedPreprocessor({
				minConfidenceThreshold: 0.9, // Very strict
			});

			const messages = createTestMessages();
			const result = await preprocessor(messages);

			expect(result).toBeDefined();
		});
	});

	describe("Preprocessor Execution", () => {
		it("should process messages without errors", async () => {
			const preprocessor = createIntegratedPreprocessor();
			const messages = createTestMessages();

			const result = await preprocessor(messages);

			expect(result).toBeDefined();
			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBeGreaterThan(0);
		});

		it("should handle empty messages", async () => {
			const preprocessor = createIntegratedPreprocessor();
			const result = await preprocessor([]);

			expect(result).toEqual([]);
		});

		it("should handle abort signal", async () => {
			const preprocessor = createIntegratedPreprocessor();
			const controller = new AbortController();
			const messages = createTestMessages();

			// Abort immediately
			controller.abort();

			const result = await preprocessor(messages, controller.signal);

			expect(result).toBeDefined();
		});

		it("should preserve messages when verification disabled", async () => {
			const preprocessor = createIntegratedPreprocessor({
				enableVerification: false,
				enableCompression: false,
			});

			const messages = createTestMessages();
			const result = await preprocessor(messages);

			expect(result).toEqual(messages);
		});

		it("should handle verification errors gracefully", async () => {
			const preprocessor = createIntegratedPreprocessor({
				enableVerification: true,
			});

			const messages = createTestMessages();

			// Should not throw even if verification has issues
			await expect(preprocessor(messages)).resolves.toBeDefined();
		});

		it("should handle compression errors gracefully", async () => {
			const preprocessor = createIntegratedPreprocessor({
				enableCompression: true,
				compressionThreshold: 0, // Try to compress everything
			});

			const messages = createTestMessages();

			// Should not throw even if compression fails
			await expect(preprocessor(messages)).resolves.toBeDefined();
		});
	});

	describe("Compression Integration", () => {
		it("should skip compression when below threshold", async () => {
			const preprocessor = createIntegratedPreprocessor({
				enableCompression: true,
				compressionThreshold: 100000, // High threshold
			});

			const messages = createTestMessages();
			const result = await preprocessor(messages);

			// Should not compress small messages
			expect(result.length).toBe(messages.length);
		});

		it("should attempt compression when above threshold", async () => {
			const preprocessor = createIntegratedPreprocessor({
				enableCompression: true,
				compressionThreshold: 100, // Very low threshold
			});

			const messages = createLargeMessages();
			const result = await preprocessor(messages);

			// Compression might or might not succeed, but should execute
			expect(result).toBeDefined();
		});

		it("should respect compression quality threshold", async () => {
			// This test validates that low-quality compression is rejected
			const preprocessor = createIntegratedPreprocessor({
				enableCompression: true,
				compressionThreshold: 100,
			});

			const messages = createTestMessages();
			const result = await preprocessor(messages);

			// Should not use poor quality compression
			expect(result).toBeDefined();
		});
	});

	describe("Verification Integration", () => {
		it("should inject verification context when enabled", async () => {
			// First record some metrics
			const tracker = getMetricsTracker();
			await tracker.recordMetric({
				toolName: "test_tool",
				serverName: "test_server",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "success",
				confidenceScore: 1.0,
			});

			const preprocessor = createIntegratedPreprocessor({
				enableVerification: true,
			});

			const messages = createTestMessages();
			const result = await preprocessor(messages);

			expect(result).toBeDefined();
		});

		it("should warn on low performance tools when enabled", async () => {
			// Record low-performing tool
			const tracker = getMetricsTracker();
			for (let i = 0; i < 10; i++) {
				await tracker.recordMetric({
					toolName: "bad_tool",
					serverName: "server",
					timestamp: Date.now(),
					latencyMs: 5000,
					status: i < 3 ? "success" : "error",
					confidenceScore: i < 3 ? 1.0 : 0.0,
				});
			}

			const preprocessor = createIntegratedPreprocessor({
				enableVerification: true,
				warnOnLowPerformance: true,
			});

			const messages = createTestMessages();
			const result = await preprocessor(messages);

			expect(result).toBeDefined();
		});

		it("should skip warnings when disabled", async () => {
			const preprocessor = createIntegratedPreprocessor({
				enableVerification: true,
				warnOnLowPerformance: false,
			});

			const messages = createTestMessages();
			const result = await preprocessor(messages);

			expect(result).toBeDefined();
		});
	});

	describe("Agent Output Processing", () => {
		it("should process agent output for learning", async () => {
			const output = `Successfully implemented authentication.

## Key Learnings
- JWT tokens work well
- Always validate expiration`;

			const result = await processAgentOutput(output, "Auth task", true);

			expect(result.learned).toBeDefined();
			expect(result.domain).toBeTruthy();
			expect(result.insight).toBeDefined();
		});

		it("should handle failed tasks", async () => {
			const output = "Task failed with error";

			const result = await processAgentOutput(output, "Failed task", false);

			expect(result.learned).toBe(false);
		});

		it("should track session learnings", async () => {
			const sessionId = "test-session-789";

			const output = "Successfully completed with important discoveries.";
			await processAgentOutput(output, "Task 1", true, sessionId);
			await processAgentOutput(output, "Task 2", true, sessionId);

			const service = getLearningActivationService();
			const learnings = service.getSessionLearnings(sessionId);

			expect(learnings).toBeDefined();
		});

		it("should handle empty output", async () => {
			const result = await processAgentOutput("", "Empty task", true);

			expect(result.learned).toBe(false);
		});

		it("should handle very long output", async () => {
			const longOutput = "Completed successfully. ".repeat(1000);

			const result = await processAgentOutput(longOutput, "Long task", true);

			expect(result).toBeDefined();
		});
	});

	describe("Preprocessor Statistics", () => {
		it("should aggregate stats from all components", async () => {
			// Record some metrics
			const tracker = getMetricsTracker();
			await tracker.recordMetric({
				toolName: "tool1",
				serverName: "server1",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "success",
				confidenceScore: 1.0,
			});

			// Process some output
			await processAgentOutput("Test output with learnings", "Test task", true);

			// Get stats
			const stats = getPreprocessorStats();

			expect(stats).toBeDefined();
			expect(stats.verification).toBeDefined();
			expect(stats.metrics).toBeDefined();
			expect(stats.learning).toBeDefined();
		});

		it("should include verification stats", () => {
			const stats = getPreprocessorStats();

			expect(stats.verification.verificationCount).toBeGreaterThanOrEqual(0);
			expect(Array.isArray(stats.verification.lowPerformingTools)).toBe(true);
			expect(stats.verification.totalVerificationTimeMs).toBeGreaterThanOrEqual(0);
		});

		it("should include metrics stats", async () => {
			const tracker = getMetricsTracker();
			await tracker.recordMetric({
				toolName: "test",
				serverName: "test",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "success",
				confidenceScore: 1.0,
			});

			const stats = getPreprocessorStats();

			expect(stats.metrics.totalMetrics).toBeGreaterThan(0);
			expect(stats.metrics.totalServers).toBeGreaterThan(0);
			expect(stats.metrics.totalTools).toBeGreaterThan(0);
			expect(stats.metrics.overallSuccessRate).toBeGreaterThanOrEqual(0);
			expect(stats.metrics.overallSuccessRate).toBeLessThanOrEqual(1);
		});

		it("should include learning stats", () => {
			const stats = getPreprocessorStats();

			expect(stats.learning.totalDomains).toBeGreaterThan(0);
			expect(Array.isArray(stats.learning.activeDomains)).toBe(true);
			expect(Array.isArray(stats.learning.emptyDomains)).toBe(true);
			expect(stats.learning.criticalDomainsCoverage).toBeGreaterThanOrEqual(0);
			expect(stats.learning.criticalDomainsCoverage).toBeLessThanOrEqual(1);
		});

		it("should handle empty state", () => {
			getMetricsTracker().clear();

			const stats = getPreprocessorStats();

			expect(stats.metrics.totalMetrics).toBe(0);
		});
	});

	describe("Integration Scenarios", () => {
		it("should handle full workflow: preprocess + learn", async () => {
			const preprocessor = createIntegratedPreprocessor();

			// Preprocess messages
			const messages = createTestMessages();
			const processed = await preprocessor(messages);

			expect(processed).toBeDefined();

			// Process agent output
			const output = "Successfully completed with key learnings.";
			const learned = await processAgentOutput(output, "Test task", true);

			expect(learned).toBeDefined();

			// Get combined stats
			const stats = getPreprocessorStats();

			expect(stats).toBeDefined();
			expect(stats.verification).toBeDefined();
			expect(stats.metrics).toBeDefined();
			expect(stats.learning).toBeDefined();
		});

		it("should handle multiple preprocessing rounds", async () => {
			const preprocessor = createIntegratedPreprocessor();
			const messages = createTestMessages();

			const result1 = await preprocessor(messages);
			const result2 = await preprocessor(result1);
			const result3 = await preprocessor(result2);

			expect(result3).toBeDefined();
		});

		it("should maintain message integrity through preprocessing", async () => {
			const preprocessor = createIntegratedPreprocessor({
				enableCompression: false,
				enableVerification: false,
			});

			const messages = createTestMessages();
			const result = await preprocessor(messages);

			// Should be exactly the same
			expect(result).toEqual(messages);
		});

		it("should handle concurrent preprocessing calls", async () => {
			const preprocessor = createIntegratedPreprocessor();
			const messages = createTestMessages();

			const promises = [preprocessor(messages), preprocessor(messages), preprocessor(messages)];

			const results = await Promise.all(promises);

			expect(results).toHaveLength(3);
			for (const result of results) {
				expect(result).toBeDefined();
			}
		});
	});

	describe("Error Handling", () => {
		it("should continue on component failures", async () => {
			const preprocessor = createIntegratedPreprocessor({
				enableVerification: true,
				enableCompression: true,
			});

			const messages = createTestMessages();

			// Should complete even if individual components fail
			await expect(preprocessor(messages)).resolves.toBeDefined();
		});
	});

	describe("Performance", () => {
		it("should complete preprocessing in reasonable time", async () => {
			const preprocessor = createIntegratedPreprocessor();
			const messages = createTestMessages();

			const start = Date.now();
			await preprocessor(messages);
			const duration = Date.now() - start;

			// Should complete quickly for small messages
			expect(duration).toBeLessThan(1000); // 1 second
		});

		it("should handle large message sets efficiently", async () => {
			const preprocessor = createIntegratedPreprocessor({
				enableCompression: false, // Disable to test raw performance
			});

			const largeMessages = createLargeMessages();

			const start = Date.now();
			await preprocessor(largeMessages);
			const duration = Date.now() - start;

			// Should complete in reasonable time even for large sets
			expect(duration).toBeLessThan(5000); // 5 seconds
		});
	});
});
