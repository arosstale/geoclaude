/**
 * Metrics Tracker Integration Tests
 * ===================================
 * Comprehensive tests for MCP-Bench aligned tool performance tracking
 *
 * Tests cover:
 * - Metric recording and retrieval
 * - Server/tool performance aggregation
 * - Confidence scoring
 * - wrapToolWithMetrics wrapper
 * - Reliability calculations
 *
 * Run with: npx vitest run metrics-tracker.test.ts
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMetricsWrapper, getMetricsTracker, MetricsTracker, wrapToolWithMetrics } from "./metrics-tracker.js";

describe("MetricsTracker", () => {
	let tracker: MetricsTracker;

	beforeEach(() => {
		// Create fresh tracker for each test
		tracker = new MetricsTracker({
			maxHistorySize: 100,
			persistInterval: 60000,
			timeoutThreshold: 5000,
			minCallsForReliability: 5,
		});
	});

	describe("Metric Recording", () => {
		it("should record a successful metric", async () => {
			const metric = await tracker.recordMetric({
				toolName: "test_tool",
				serverName: "test_server",
				timestamp: Date.now(),
				latencyMs: 150,
				status: "success",
				confidenceScore: 1.0,
			});

			expect(metric.id).toBeTruthy();
			expect(metric.toolName).toBe("test_tool");
			expect(metric.status).toBe("success");
			expect(metric.confidenceScore).toBe(1.0);
		});

		it("should record an error metric", async () => {
			const metric = await tracker.recordMetric({
				toolName: "failing_tool",
				serverName: "test_server",
				timestamp: Date.now(),
				latencyMs: 500,
				status: "error",
				confidenceScore: 0,
				errorMessage: "Connection timeout",
			});

			expect(metric.status).toBe("error");
			expect(metric.errorMessage).toBe("Connection timeout");
			expect(metric.confidenceScore).toBe(0);
		});

		it("should record a timeout metric", async () => {
			const metric = await tracker.recordMetric({
				toolName: "slow_tool",
				serverName: "test_server",
				timestamp: Date.now(),
				latencyMs: 6000,
				status: "timeout",
				confidenceScore: 0,
			});

			expect(metric.status).toBe("timeout");
			expect(metric.latencyMs).toBeGreaterThan(5000);
		});

		it("should generate unique metric IDs", async () => {
			const metric1 = await tracker.recordMetric({
				toolName: "tool1",
				serverName: "server1",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "success",
				confidenceScore: 1.0,
			});

			const metric2 = await tracker.recordMetric({
				toolName: "tool1",
				serverName: "server1",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "success",
				confidenceScore: 1.0,
			});

			expect(metric1.id).not.toBe(metric2.id);
		});

		it("should include optional input/output tokens", async () => {
			const metric = await tracker.recordMetric({
				toolName: "llm_tool",
				serverName: "ai_server",
				timestamp: Date.now(),
				latencyMs: 2000,
				status: "success",
				confidenceScore: 0.9,
				inputTokens: 500,
				outputTokens: 300,
			});

			expect(metric.inputTokens).toBe(500);
			expect(metric.outputTokens).toBe(300);
		});
	});

	describe("Start Tracking", () => {
		it("should track successful execution", async () => {
			const finish = tracker.startTracking("test_tool", "test_server");

			// Simulate some work
			await new Promise((resolve) => setTimeout(resolve, 50));

			const metric = await finish({ success: true, confidence: 0.9 });

			expect(metric.status).toBe("success");
			expect(metric.latencyMs).toBeGreaterThanOrEqual(50);
			expect(metric.confidenceScore).toBe(0.9);
		});

		it("should track failed execution", async () => {
			const finish = tracker.startTracking("test_tool", "test_server");

			const metric = await finish({
				success: false,
				error: "Test error",
				confidence: 0.2,
			});

			expect(metric.status).toBe("error");
			expect(metric.errorMessage).toBe("Test error");
			expect(metric.confidenceScore).toBe(0.2);
		});

		it("should detect timeouts", async () => {
			const customTracker = new MetricsTracker({
				timeoutThreshold: 100,
			});

			const finish = customTracker.startTracking("slow_tool", "test_server");

			// Simulate slow work (200ms to avoid timing flakiness)
			await new Promise((resolve) => setTimeout(resolve, 200));

			const metric = await finish({ success: true });

			expect(metric.status).toBe("timeout");
			// Should exceed threshold (100ms) - use threshold as minimum to avoid flakiness
			expect(metric.latencyMs).toBeGreaterThanOrEqual(100);
		});

		it("should use default confidence for success without explicit value", async () => {
			const finish = tracker.startTracking("test_tool", "test_server");
			const metric = await finish({ success: true });

			expect(metric.confidenceScore).toBe(1.0);
		});

		it("should use zero confidence for errors without explicit value", async () => {
			const finish = tracker.startTracking("test_tool", "test_server");
			const metric = await finish({ success: false });

			expect(metric.confidenceScore).toBe(0.0);
		});
	});

	describe("Server Metrics", () => {
		it("should aggregate server metrics correctly", async () => {
			// Record multiple calls for same server
			for (let i = 0; i < 5; i++) {
				await tracker.recordMetric({
					toolName: `tool${i}`,
					serverName: "test_server",
					timestamp: Date.now(),
					latencyMs: 100 + i * 50,
					status: i < 4 ? "success" : "error",
					confidenceScore: i < 4 ? 1.0 : 0.0,
				});
			}

			const serverMetrics = tracker.getServerMetrics("test_server");

			expect(serverMetrics).toBeDefined();
			expect(serverMetrics!.totalCalls).toBe(5);
			expect(serverMetrics!.successCount).toBe(4);
			expect(serverMetrics!.errorCount).toBe(1);
			expect(serverMetrics!.successRate).toBe(0.8);
		});

		it("should calculate average latency", async () => {
			await tracker.recordMetric({
				toolName: "tool1",
				serverName: "server1",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "success",
				confidenceScore: 1.0,
			});

			await tracker.recordMetric({
				toolName: "tool2",
				serverName: "server1",
				timestamp: Date.now(),
				latencyMs: 300,
				status: "success",
				confidenceScore: 1.0,
			});

			const metrics = tracker.getServerMetrics("server1");
			expect(metrics!.avgLatencyMs).toBe(200);
		});

		it("should track reliability score with timeout penalty", async () => {
			await tracker.recordMetric({
				toolName: "tool1",
				serverName: "server1",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "success",
				confidenceScore: 1.0,
			});

			await tracker.recordMetric({
				toolName: "tool2",
				serverName: "server1",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "timeout",
				confidenceScore: 0.0,
			});

			const metrics = tracker.getServerMetrics("server1");

			// Success rate is 0.5, but timeout penalty reduces reliability
			expect(metrics!.successRate).toBe(0.5);
			expect(metrics!.reliabilityScore).toBeLessThan(0.5);
		});

		it("should get all server metrics sorted by reliability", async () => {
			// Create metrics for multiple servers
			await tracker.recordMetric({
				toolName: "tool",
				serverName: "reliable_server",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "success",
				confidenceScore: 1.0,
			});

			await tracker.recordMetric({
				toolName: "tool",
				serverName: "unreliable_server",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "error",
				confidenceScore: 0.0,
			});

			const allMetrics = tracker.getAllServerMetrics();

			expect(allMetrics.length).toBe(2);
			expect(allMetrics[0].reliabilityScore).toBeGreaterThan(allMetrics[1].reliabilityScore);
		});
	});

	describe("Tool Performance", () => {
		it("should track tool performance", async () => {
			await tracker.recordMetric({
				toolName: "test_tool",
				serverName: "test_server",
				timestamp: 1000,
				latencyMs: 150,
				status: "success",
				confidenceScore: 0.9,
			});

			const perf = tracker.getToolPerformance("test_tool", "test_server");

			expect(perf).toBeDefined();
			expect(perf!.toolName).toBe("test_tool");
			expect(perf!.serverName).toBe("test_server");
			expect(perf!.totalCalls).toBe(1);
			expect(perf!.successRate).toBe(1);
			expect(perf!.lastSuccess).toBe(1000);
		});

		it("should track last error", async () => {
			await tracker.recordMetric({
				toolName: "test_tool",
				serverName: "test_server",
				timestamp: 1000,
				latencyMs: 150,
				status: "error",
				confidenceScore: 0.0,
			});

			const perf = tracker.getToolPerformance("test_tool", "test_server");

			expect(perf!.lastError).toBe(1000);
			expect(perf!.lastSuccess).toBeNull();
		});

		it("should calculate average confidence", async () => {
			await tracker.recordMetric({
				toolName: "tool",
				serverName: "server",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "success",
				confidenceScore: 0.8,
			});

			await tracker.recordMetric({
				toolName: "tool",
				serverName: "server",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "success",
				confidenceScore: 1.0,
			});

			const perf = tracker.getToolPerformance("tool", "server");
			expect(perf!.confidenceAvg).toBe(0.9);
		});

		it("should get all tool performance sorted by success rate", async () => {
			await tracker.recordMetric({
				toolName: "good_tool",
				serverName: "server",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "success",
				confidenceScore: 1.0,
			});

			await tracker.recordMetric({
				toolName: "bad_tool",
				serverName: "server",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "error",
				confidenceScore: 0.0,
			});

			const allPerf = tracker.getAllToolPerformance();

			expect(allPerf.length).toBe(2);
			expect(allPerf[0].successRate).toBeGreaterThan(allPerf[1].successRate);
		});
	});

	describe("Tool Confidence Calculation", () => {
		it("should return 0.5 for unknown tools", () => {
			const confidence = tracker.getToolConfidence("unknown_tool");
			expect(confidence).toBe(0.5);
		});

		it("should return 0.5 for tools with insufficient calls", async () => {
			await tracker.recordMetric({
				toolName: "new_tool",
				serverName: "server",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "success",
				confidenceScore: 1.0,
			});

			// Only 1 call, below minCallsForReliability (5)
			const confidence = tracker.getToolConfidence("new_tool", "server");
			expect(confidence).toBe(0.5);
		});

		it("should calculate weighted confidence for established tools", async () => {
			// Record 6 successful calls
			for (let i = 0; i < 6; i++) {
				await tracker.recordMetric({
					toolName: "established_tool",
					serverName: "server",
					timestamp: Date.now(),
					latencyMs: 200,
					status: "success",
					confidenceScore: 0.9,
				});
			}

			const confidence = tracker.getToolConfidence("established_tool", "server");

			// Should be high confidence due to good performance
			expect(confidence).toBeGreaterThan(0.5);
			expect(confidence).toBeLessThanOrEqual(1.0);
		});

		it("should penalize slow tools in confidence", async () => {
			for (let i = 0; i < 6; i++) {
				await tracker.recordMetric({
					toolName: "slow_tool",
					serverName: "server",
					timestamp: Date.now(),
					latencyMs: 15000, // Very slow
					status: "success",
					confidenceScore: 1.0,
				});
			}

			const confidence = tracker.getToolConfidence("slow_tool", "server");

			// Should be lower due to high latency
			expect(confidence).toBeLessThan(0.8);
		});
	});

	describe("Low-Performing Tools", () => {
		it("should identify low-performing tools", async () => {
			// Create good tool
			for (let i = 0; i < 6; i++) {
				await tracker.recordMetric({
					toolName: "good_tool",
					serverName: "server",
					timestamp: Date.now(),
					latencyMs: 100,
					status: "success",
					confidenceScore: 1.0,
				});
			}

			// Create bad tool
			for (let i = 0; i < 6; i++) {
				await tracker.recordMetric({
					toolName: "bad_tool",
					serverName: "server",
					timestamp: Date.now(),
					latencyMs: 100,
					status: i < 3 ? "success" : "error",
					confidenceScore: i < 3 ? 1.0 : 0.0,
				});
			}

			const lowPerforming = tracker.getLowPerformingTools(0.7);

			expect(lowPerforming.length).toBe(1);
			expect(lowPerforming[0].toolName).toBe("bad_tool");
			expect(lowPerforming[0].successRate).toBeLessThan(0.7);
		});

		it("should exclude tools with insufficient calls", async () => {
			await tracker.recordMetric({
				toolName: "new_bad_tool",
				serverName: "server",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "error",
				confidenceScore: 0.0,
			});

			const lowPerforming = tracker.getLowPerformingTools();
			expect(lowPerforming).toHaveLength(0); // Not enough calls
		});
	});

	describe("Unreliable Servers", () => {
		it("should identify unreliable servers", async () => {
			// Unreliable server
			for (let i = 0; i < 6; i++) {
				await tracker.recordMetric({
					toolName: `tool${i}`,
					serverName: "unreliable_server",
					timestamp: Date.now(),
					latencyMs: 100,
					status: i < 2 ? "success" : "error",
					confidenceScore: i < 2 ? 1.0 : 0.0,
				});
			}

			const unreliable = tracker.getUnreliableServers(0.8);

			expect(unreliable.length).toBe(1);
			expect(unreliable[0].serverName).toBe("unreliable_server");
			expect(unreliable[0].reliabilityScore).toBeLessThan(0.8);
		});
	});

	describe("Summary Statistics", () => {
		it("should provide comprehensive summary", async () => {
			await tracker.recordMetric({
				toolName: "tool1",
				serverName: "server1",
				timestamp: 1000,
				latencyMs: 100,
				status: "success",
				confidenceScore: 1.0,
			});

			await tracker.recordMetric({
				toolName: "tool2",
				serverName: "server2",
				timestamp: 2000,
				latencyMs: 200,
				status: "error",
				confidenceScore: 0.0,
			});

			const summary = tracker.getSummary();

			expect(summary.totalMetrics).toBe(2);
			expect(summary.totalServers).toBe(2);
			expect(summary.totalTools).toBe(2);
			expect(summary.overallSuccessRate).toBe(0.5);
			expect(summary.avgLatencyMs).toBe(150);
			expect(summary.lastUpdated).toBe(2000);
		});

		it("should handle empty tracker", () => {
			const summary = tracker.getSummary();

			expect(summary.totalMetrics).toBe(0);
			expect(summary.overallSuccessRate).toBe(0);
			expect(summary.avgLatencyMs).toBe(0);
		});
	});

	describe("History Management", () => {
		it("should trim history when exceeding max size", async () => {
			const smallTracker = new MetricsTracker({ maxHistorySize: 5 });

			// Record 10 metrics
			for (let i = 0; i < 10; i++) {
				await smallTracker.recordMetric({
					toolName: `tool${i}`,
					serverName: "server",
					timestamp: Date.now(),
					latencyMs: 100,
					status: "success",
					confidenceScore: 1.0,
				});
			}

			const recent = smallTracker.getRecentMetrics(100);
			expect(recent.length).toBe(5); // Only keeps last 5
		});

		it("should get recent metrics", async () => {
			for (let i = 0; i < 10; i++) {
				await tracker.recordMetric({
					toolName: `tool${i}`,
					serverName: "server",
					timestamp: Date.now(),
					latencyMs: 100,
					status: "success",
					confidenceScore: 1.0,
				});
			}

			const recent = tracker.getRecentMetrics(5);
			expect(recent.length).toBe(5);
		});
	});

	describe("Clear Functionality", () => {
		it("should clear all metrics and caches", async () => {
			await tracker.recordMetric({
				toolName: "tool",
				serverName: "server",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "success",
				confidenceScore: 1.0,
			});

			expect(tracker.getSummary().totalMetrics).toBe(1);

			tracker.clear();

			expect(tracker.getSummary().totalMetrics).toBe(0);
			expect(tracker.getAllServerMetrics()).toHaveLength(0);
			expect(tracker.getAllToolPerformance()).toHaveLength(0);
		});
	});

	describe("Singleton Instance", () => {
		it("should return same instance", () => {
			const instance1 = getMetricsTracker();
			const instance2 = getMetricsTracker();

			expect(instance1).toBe(instance2);
		});
	});

	describe("Tool Wrapper", () => {
		it("should wrap tool and track metrics", async () => {
			const mockTool: AgentTool<any, any> = {
				name: "test_tool",
				label: "Test Tool",
				description: "Test tool",
				parameters: Type.Object({}),
				execute: vi.fn(async () => ({
					toolCallId: "call1",
					content: [{ type: "text" as const, text: "Success" }],
					details: {},
				})),
			};

			const wrapped = wrapToolWithMetrics(mockTool, "test_server");

			const result = await wrapped.execute("call1", {}, new AbortController().signal);

			expect(result.content[0]).toEqual({ type: "text", text: "Success" });

			const summary = getMetricsTracker().getSummary();
			expect(summary.totalMetrics).toBeGreaterThan(0);
		});

		it("should track errors in wrapped tools", async () => {
			const mockTool: AgentTool<any, any> = {
				name: "failing_tool",
				label: "Failing Tool",
				description: "Failing tool",
				parameters: Type.Object({}),
				execute: vi.fn(async () => {
					throw new Error("Tool failed");
				}),
			};

			const wrapped = wrapToolWithMetrics(mockTool, "test_server");

			await expect(wrapped.execute("call1", {}, new AbortController().signal)).rejects.toThrow("Tool failed");

			const perf = getMetricsTracker().getToolPerformance("failing_tool", "test_server");
			expect(perf?.lastError).toBeTruthy();
		});

		it("should detect errors in tool output", async () => {
			const mockTool: AgentTool<any, any> = {
				name: "error_tool",
				label: "Error Tool",
				description: "Tool with error output",
				parameters: Type.Object({}),
				execute: vi.fn(async () => ({
					toolCallId: "call1",
					content: [{ type: "text" as const, text: "error: something went wrong" }],
					details: {},
				})),
			};

			const wrapped = wrapToolWithMetrics(mockTool, "test_server");

			await wrapped.execute("call1", {}, new AbortController().signal);

			// Should record lower confidence due to error in output
			const perf = getMetricsTracker().getToolPerformance("error_tool", "test_server");
			expect(perf?.confidenceAvg).toBeLessThan(1.0);
		});
	});

	describe("Metrics Wrapper Factory", () => {
		it("should create wrapper function", () => {
			const wrapperFn = createMetricsWrapper("test_server");

			const mockTool: AgentTool<any, any> = {
				name: "tool",
				label: "Test",
				description: "Test",
				parameters: Type.Object({}),
				execute: vi.fn(async () => ({
					toolCallId: "call1",
					content: [{ type: "text" as const, text: "OK" }],
					details: {},
				})),
			};

			const wrapped = wrapperFn(mockTool);

			expect(wrapped.name).toBe("tool");
			expect(wrapped.execute).toBeDefined();
		});
	});

	describe("Persistence Callback", () => {
		it("should call persist callback when interval elapsed", async () => {
			const persistCallback = vi.fn(async () => {});
			const fastTracker = new MetricsTracker({ persistInterval: 10 });
			fastTracker.setPersistCallback(persistCallback);

			await fastTracker.recordMetric({
				toolName: "tool1",
				serverName: "server",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "success",
				confidenceScore: 1.0,
			});

			// Wait for persist interval
			await new Promise((resolve) => setTimeout(resolve, 50));

			await fastTracker.recordMetric({
				toolName: "tool2",
				serverName: "server",
				timestamp: Date.now(),
				latencyMs: 100,
				status: "success",
				confidenceScore: 1.0,
			});

			// Should have persisted by now
			expect(persistCallback).toHaveBeenCalled();
		});
	});
});
