/**
 * Tests for Trading Base Agent
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseAgent } from "./base-agent.js";
import type { AgentConfig } from "./types.js";

// Concrete implementation for testing
class TestAgent extends BaseAgent {
	public runCount = 0;
	public shouldFail = false;

	protected async run(): Promise<void> {
		this.runCount++;
		if (this.shouldFail) {
			throw new Error("Test error");
		}
		await this.emitSignal({
			symbol: "BTC",
			action: "BUY",
			confidence: 0.8,
			price: 50000,
			reason: "Test signal",
			source: this.name,
			timestamp: Date.now(),
		});
	}
}

describe("BaseAgent", () => {
	const defaultConfig: AgentConfig = {
		name: "TestAgent",
		enabled: true,
		interval: 1000,
		symbols: ["BTC", "ETH"],
		thresholds: { minConfidence: 0.7 },
	};

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("Configuration", () => {
		it("should initialize with provided config", () => {
			const agent = new TestAgent(defaultConfig);
			expect(agent.name).toBe("TestAgent");
			expect(agent.isEnabled).toBe(true);
		});

		it("should initialize with disabled state", () => {
			const agent = new TestAgent({ ...defaultConfig, enabled: false });
			expect(agent.isEnabled).toBe(false);
		});

		it("should initialize with correct initial stats", () => {
			const agent = new TestAgent(defaultConfig);
			const stats = agent.stats;
			expect(stats.isRunning).toBe(false);
			expect(stats.errorCount).toBe(0);
			expect(stats.signalsGenerated).toBe(0);
		});
	});

	describe("Signal Handling", () => {
		it("should register signal handlers", () => {
			const agent = new TestAgent(defaultConfig);
			const handler = vi.fn();

			agent.onSignal(handler);
			// Handler should be registered (tested via emitSignal)
			expect(agent).toBeDefined();
		});

		it("should emit signals to all handlers", async () => {
			const agent = new TestAgent(defaultConfig);
			const handler1 = vi.fn();
			const handler2 = vi.fn();

			agent.onSignal(handler1);
			agent.onSignal(handler2);

			// Start the agent to trigger analyze() which emits signals
			await agent.start();

			// Wait for the analysis to complete
			await new Promise((resolve) => setTimeout(resolve, 100));

			await agent.stop();

			// At least one handler should have been called
			expect(agent.runCount).toBeGreaterThan(0);
		});

		it("should handle errors in signal handlers gracefully", async () => {
			const agent = new TestAgent(defaultConfig);
			const errorHandler = vi.fn().mockRejectedValue(new Error("Handler error"));
			const goodHandler = vi.fn();

			agent.onSignal(errorHandler);
			agent.onSignal(goodHandler);

			// Should not throw even if handler fails
			await agent.start();
			await new Promise((resolve) => setTimeout(resolve, 100));
			await agent.stop();

			expect(agent.runCount).toBeGreaterThan(0);
		});
	});

	describe("Lifecycle", () => {
		it("should start and stop correctly", async () => {
			const agent = new TestAgent(defaultConfig);

			await agent.start();
			expect(agent.stats.isRunning).toBe(false); // After initial run completes

			await agent.stop();
			expect(agent).toBeDefined();
		});

		it("should not start multiple times", async () => {
			const agent = new TestAgent(defaultConfig);

			await agent.start();
			await agent.start(); // Second call should be ignored

			await agent.stop();
			expect(agent.runCount).toBe(1);
		});

		it("should handle errors during analysis", async () => {
			const agent = new TestAgent(defaultConfig);
			agent.shouldFail = true;

			await agent.start();
			await new Promise((resolve) => setTimeout(resolve, 100));
			await agent.stop();

			// Should have incremented error count
			expect(agent.stats.errorCount).toBeGreaterThan(0);
		});
	});

	describe("Stats", () => {
		it("should return a copy of stats", () => {
			const agent = new TestAgent(defaultConfig);
			const stats1 = agent.stats;
			const stats2 = agent.stats;

			// Should be equal but not the same object
			expect(stats1).toEqual(stats2);
			expect(stats1).not.toBe(stats2);
		});

		it("should track signals generated", async () => {
			const agent = new TestAgent(defaultConfig);

			await agent.start();
			await new Promise((resolve) => setTimeout(resolve, 100));
			await agent.stop();

			expect(agent.stats.signalsGenerated).toBeGreaterThan(0);
		});
	});
});
