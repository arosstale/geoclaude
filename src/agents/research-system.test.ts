/**
 * Tests for 24/7 Research System Agents
 * - CTM (Continuous Thought Machine)
 * - DGM (Darwin Gödel Machine)
 * - OpenEvolve (Evolutionary Optimization)
 * - Research Orchestrator
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	// CTM
	CTMPresets,
	// DGM
	DGMPresets,
	getImprovementHistory,
	getResearchOrchestrator,
	getResearchStatus,
	isCTMAvailable,
	isDGMAvailable,
	isOpenEvolveAvailable,
	// OpenEvolve
	OpenEvolvePresets,
	// Research Orchestrator
	ResearchOrchestrator,
	startResearch,
	stopResearch,
} from "./index.js";

// ============================================================================
// CTM TESTS
// ============================================================================
describe("CTM (Continuous Thought Machine)", () => {
	describe("Presets", () => {
		it("should have quick preset", () => {
			const preset = CTMPresets.quick("test problem");
			expect(preset.taskId).toMatch(/^quick_/);
			expect(preset.problem).toBe("test problem");
			expect(preset.maxThinkingTime).toBe(10000);
			expect(preset.maxSteps).toBe(5);
		});

		it("should have deep preset with domain", () => {
			const preset = CTMPresets.deep("complex problem", "mathematics");
			expect(preset.taskId).toMatch(/^deep_/);
			expect(preset.problem).toBe("complex problem");
			expect(preset.domain).toBe("mathematics");
			expect(preset.maxThinkingTime).toBe(120000);
			expect(preset.minSteps).toBe(10);
		});

		it("should have research preset", () => {
			const preset = CTMPresets.research("research question");
			expect(preset.taskId).toMatch(/^research_/);
			expect(preset.problem).toBe("research question");
			expect(preset.domain).toBe("research");
			expect(preset.maxThinkingTime).toBe(300000);
		});

		it("should have trading preset", () => {
			const preset = CTMPresets.trading("analyze BTC");
			expect(preset.domain).toBe("trading");
			expect(preset.maxThinkingTime).toBe(60000);
		});

		it("should have security preset", () => {
			const preset = CTMPresets.security("find vulnerabilities");
			expect(preset.domain).toBe("security");
		});

		it("should have math preset", () => {
			const preset = CTMPresets.math("prove theorem");
			expect(preset.domain).toBe("mathematics");
		});
	});

	describe("Availability", () => {
		it("should check CTM availability", async () => {
			const available = await isCTMAvailable();
			// CTM is TypeScript-native, should always be available
			expect(typeof available).toBe("boolean");
		});
	});
});

// ============================================================================
// DGM TESTS
// ============================================================================
describe("DGM (Darwin Gödel Machine)", () => {
	describe("Presets", () => {
		it("should have agentPrompt preset", () => {
			const preset = DGMPresets.agentPrompt("/path/to/expertise.md", "improve clarity");
			expect(preset.targetId).toMatch(/^prompt_/);
			expect(preset.filePath).toBe("/path/to/expertise.md");
			expect(preset.objective).toBe("improve clarity");
			expect(preset.evaluationCriteria).toBeTruthy();
		});

		it("should have tradingStrategy preset", () => {
			const preset = DGMPresets.tradingStrategy("/path/to/strategy.ts");
			expect(preset.targetId).toMatch(/^trading_/);
			expect(preset.objective).toBeTruthy();
			expect(preset.constraints?.requireTests).toBe(true);
		});

		it("should have safeMinimal preset with constraints", () => {
			const preset = DGMPresets.safeMinimal("/path/to/file.ts", "fix bug");
			expect(preset.targetId).toMatch(/^safe_/);
			expect(preset.maxIterations).toBeDefined();
			expect(preset.constraints?.maxLinesChanged).toBe(20);
		});

		it("should have errorHandling preset", () => {
			const preset = DGMPresets.errorHandling("/path/to/file.ts");
			expect(preset.objective).toContain("error handling");
		});

		it("should have utilityFunction preset", () => {
			const preset = DGMPresets.utilityFunction("/path/to/utils.ts", "parseData");
			expect(preset.objective).toContain("parseData");
			expect(preset.constraints?.preserveSignatures).toContain("parseData");
		});
	});

	describe("History", () => {
		it("should return improvement history array", () => {
			const history = getImprovementHistory();
			expect(Array.isArray(history)).toBe(true);
		});

		it("should have correct history item structure", () => {
			const history = getImprovementHistory();
			if (history.length > 0) {
				const item = history[0];
				expect(item).toHaveProperty("targetId");
				expect(item).toHaveProperty("backupPath");
				expect(item).toHaveProperty("timestamp");
			}
		});
	});

	describe("Availability", () => {
		it("should check DGM availability", async () => {
			const available = await isDGMAvailable();
			expect(typeof available).toBe("boolean");
		});
	});
});

// ============================================================================
// OPENEVOLVE TESTS
// ============================================================================
describe("OpenEvolve (Evolutionary Optimization)", () => {
	describe("Presets", () => {
		it("should have quickPrompt preset", () => {
			const preset = OpenEvolvePresets.quickPrompt("initial prompt", "maximize clarity");
			expect(preset.taskId).toMatch(/^quick_/);
			expect(preset.seed).toBe("initial prompt");
			expect(preset.evaluationCriteria).toBe("maximize clarity");
			expect(preset.maxGenerations).toBe(10);
		});

		it("should have thoroughCode preset", () => {
			const preset = OpenEvolvePresets.thoroughCode("function code", "optimize performance");
			expect(preset.taskId).toMatch(/^thorough_/);
			expect(preset.domain).toBe("coding");
			expect(preset.maxGenerations).toBe(50);
			expect(preset.numIslands).toBe(4);
		});

		it("should have tradingStrategy preset", () => {
			const preset = OpenEvolvePresets.tradingStrategy("strategy code");
			expect(preset.taskId).toMatch(/^trading_/);
			expect(preset.domain).toBe("trading");
			expect(preset.maxGenerations).toBe(100);
			expect(preset.numIslands).toBe(6);
		});

		it("should have researchHypothesis preset", () => {
			const preset = OpenEvolvePresets.researchHypothesis("hypothesis", "AI");
			expect(preset.taskId).toMatch(/^research_/);
			expect(preset.domain).toBe("research");
			expect(preset.evaluationCriteria).toContain("AI");
		});

		it("should have agentPrompt preset", () => {
			const preset = OpenEvolvePresets.agentPrompt("agent prompt", "coding");
			expect(preset.domain).toBe("coding");
			expect(preset.seed).toBe("agent prompt");
		});
	});

	describe("Availability", () => {
		it("should check OpenEvolve availability", async () => {
			const available = await isOpenEvolveAvailable();
			expect(typeof available).toBe("boolean");
		});
	});
});

// ============================================================================
// RESEARCH ORCHESTRATOR TESTS
// ============================================================================
describe("Research Orchestrator", () => {
	let orchestrator: ResearchOrchestrator;

	beforeEach(() => {
		orchestrator = getResearchOrchestrator();
	});

	afterEach(() => {
		// Ensure stopped after each test
		if (orchestrator.getState().isRunning) {
			orchestrator.stop();
		}
	});

	describe("Lifecycle", () => {
		it("should get orchestrator instance", () => {
			expect(orchestrator).toBeInstanceOf(ResearchOrchestrator);
		});

		it("should start and stop", () => {
			orchestrator.start();
			expect(orchestrator.getState().isRunning).toBe(true);

			orchestrator.stop();
			expect(orchestrator.getState().isRunning).toBe(false);
		});

		it("should handle multiple start calls", () => {
			orchestrator.start();
			orchestrator.start(); // Should not throw
			expect(orchestrator.getState().isRunning).toBe(true);
			orchestrator.stop();
		});

		it("should handle multiple stop calls", () => {
			orchestrator.start();
			orchestrator.stop();
			orchestrator.stop(); // Should not throw
			expect(orchestrator.getState().isRunning).toBe(false);
		});
	});

	describe("State", () => {
		it("should return correct state structure", () => {
			const state = orchestrator.getState();
			expect(state).toHaveProperty("isRunning");
			expect(state).toHaveProperty("cyclesCompleted");
			expect(state).toHaveProperty("topics");
			expect(Array.isArray(state.topics)).toBe(true);
		});

		it("should have default topics", () => {
			const state = orchestrator.getState();
			expect(state.topics.length).toBeGreaterThan(0);
		});

		it("should track cycle count", () => {
			const stateBefore = orchestrator.getState();
			// cyclesCompleted persists across runs, so just verify it's a valid number
			expect(typeof stateBefore.cyclesCompleted).toBe("number");
			expect(stateBefore.cyclesCompleted).toBeGreaterThanOrEqual(0);
		});
	});

	describe("Topics", () => {
		it("should add custom topic", () => {
			const uniqueId = `test-topic-${Date.now()}`;
			const topicsBefore = orchestrator.getState().topics.length;

			orchestrator.addTopic({
				id: uniqueId,
				name: "Test Topic",
				question: "What is the answer?",
				domain: "general",
				priority: 5,
				tags: ["test"],
			});

			const topicsAfter = orchestrator.getState().topics.length;
			expect(topicsAfter).toBeGreaterThanOrEqual(topicsBefore);

			// Verify the topic was added
			const addedTopic = orchestrator.getState().topics.find((t) => t.id === uniqueId);
			expect(addedTopic).toBeDefined();
		});

		it("should find topic by id", () => {
			orchestrator.addTopic({
				id: "findable-topic",
				name: "Findable",
				question: "Can you find me?",
				domain: "research",
				priority: 3,
				tags: [],
			});

			const state = orchestrator.getState();
			const topic = state.topics.find((t) => t.id === "findable-topic");
			expect(topic).toBeDefined();
			expect(topic?.name).toBe("Findable");
		});
	});

	describe("Events", () => {
		it("should emit events", () => {
			const listener = vi.fn();
			orchestrator.on("started", listener);
			orchestrator.start();
			expect(listener).toHaveBeenCalled();
			orchestrator.stop();
		});

		it("should emit stopped event", () => {
			const listener = vi.fn();
			orchestrator.on("stopped", listener);
			orchestrator.start();
			orchestrator.stop();
			expect(listener).toHaveBeenCalled();
		});
	});

	describe("Helper Functions", () => {
		it("should use startResearch helper", () => {
			const orch = startResearch({ enableNotifications: false });
			expect(orch.getState().isRunning).toBe(true);
			stopResearch();
			expect(orch.getState().isRunning).toBe(false);
		});

		it("should use getResearchStatus helper", () => {
			const status = getResearchStatus();
			expect(status).toHaveProperty("isRunning");
			expect(status).toHaveProperty("cyclesCompleted");
		});
	});
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================
describe("Research System Integration", () => {
	it("should export all required functions", () => {
		// CTM
		expect(typeof CTMPresets).toBe("object");
		expect(typeof isCTMAvailable).toBe("function");

		// DGM
		expect(typeof DGMPresets).toBe("object");
		expect(typeof isDGMAvailable).toBe("function");
		expect(typeof getImprovementHistory).toBe("function");

		// OpenEvolve
		expect(typeof OpenEvolvePresets).toBe("object");
		expect(typeof isOpenEvolveAvailable).toBe("function");

		// Research Orchestrator
		expect(typeof ResearchOrchestrator).toBe("function");
		expect(typeof getResearchOrchestrator).toBe("function");
		expect(typeof startResearch).toBe("function");
		expect(typeof stopResearch).toBe("function");
		expect(typeof getResearchStatus).toBe("function");
	});

	it("should have consistent preset structure across agents", () => {
		// All presets should generate unique task/target IDs
		const ctmTask = CTMPresets.quick("test");
		const dgmTask = DGMPresets.safeMinimal("/test.ts", "test");
		const evolveTask = OpenEvolvePresets.quickPrompt("test", "test");

		expect(ctmTask.taskId).toBeTruthy();
		expect(dgmTask.targetId).toBeTruthy();
		expect(evolveTask.taskId).toBeTruthy();

		// IDs should be unique (contain timestamps)
		expect(ctmTask.taskId).not.toBe(dgmTask.targetId);
		expect(dgmTask.targetId).not.toBe(evolveTask.taskId);
	});
});

// ============================================================================
// WEBHOOK SUBSCRIBER TESTS
// ============================================================================
describe("Research Webhook Subscribers", () => {
	let orchestrator: ResearchOrchestrator;

	beforeEach(() => {
		orchestrator = getResearchOrchestrator();
		// Clear any existing subscribers
		for (const sub of orchestrator.getWebhookSubscribers()) {
			orchestrator.removeWebhookSubscriber(sub.id);
		}
	});

	afterEach(() => {
		if (orchestrator.getState().isRunning) {
			orchestrator.stop();
		}
	});

	describe("Subscriber Management", () => {
		it("should add webhook subscriber", () => {
			const id = orchestrator.addWebhookSubscriber({
				url: "https://example.com/webhook",
				minConfidence: 0.7,
				enabled: true,
			});

			expect(id).toMatch(/^sub_/);
			const subscribers = orchestrator.getWebhookSubscribers();
			expect(subscribers.some((s) => s.id === id)).toBe(true);
		});

		it("should remove webhook subscriber", () => {
			const id = orchestrator.addWebhookSubscriber({
				url: "https://example.com/webhook",
				minConfidence: 0.5,
				enabled: true,
			});

			expect(orchestrator.getWebhookSubscribers().some((s) => s.id === id)).toBe(true);

			const removed = orchestrator.removeWebhookSubscriber(id);
			expect(removed).toBe(true);
			expect(orchestrator.getWebhookSubscribers().some((s) => s.id === id)).toBe(false);
		});

		it("should return false when removing non-existent subscriber", () => {
			const removed = orchestrator.removeWebhookSubscriber("non-existent-id");
			expect(removed).toBe(false);
		});

		it("should toggle subscriber enabled state", () => {
			const id = orchestrator.addWebhookSubscriber({
				url: "https://example.com/webhook",
				minConfidence: 0.5,
				enabled: true,
			});

			// Initially enabled
			let sub = orchestrator.getWebhookSubscribers().find((s) => s.id === id);
			expect(sub?.enabled).toBe(true);

			// Disable
			orchestrator.toggleWebhookSubscriber(id, false);
			sub = orchestrator.getWebhookSubscribers().find((s) => s.id === id);
			expect(sub?.enabled).toBe(false);

			// Enable again
			orchestrator.toggleWebhookSubscriber(id, true);
			sub = orchestrator.getWebhookSubscribers().find((s) => s.id === id);
			expect(sub?.enabled).toBe(true);
		});

		it("should return false when toggling non-existent subscriber", () => {
			const toggled = orchestrator.toggleWebhookSubscriber("non-existent-id", true);
			expect(toggled).toBe(false);
		});
	});

	describe("Subscriber Filters", () => {
		it("should store topic filter", () => {
			const id = orchestrator.addWebhookSubscriber({
				url: "https://example.com/webhook",
				topicIds: ["trading-patterns", "whale-behavior"],
				minConfidence: 0.5,
				enabled: true,
			});

			const sub = orchestrator.getWebhookSubscribers().find((s) => s.id === id);
			expect(sub?.topicIds).toEqual(["trading-patterns", "whale-behavior"]);
		});

		it("should store domain filter", () => {
			const id = orchestrator.addWebhookSubscriber({
				url: "https://example.com/webhook",
				domains: ["trading", "security"],
				minConfidence: 0.5,
				enabled: true,
			});

			const sub = orchestrator.getWebhookSubscribers().find((s) => s.id === id);
			expect(sub?.domains).toEqual(["trading", "security"]);
		});

		it("should store min confidence threshold", () => {
			const id = orchestrator.addWebhookSubscriber({
				url: "https://example.com/webhook",
				minConfidence: 0.85,
				enabled: true,
			});

			const sub = orchestrator.getWebhookSubscribers().find((s) => s.id === id);
			expect(sub?.minConfidence).toBe(0.85);
		});

		it("should store secret for HMAC signing", () => {
			const id = orchestrator.addWebhookSubscriber({
				url: "https://example.com/webhook",
				minConfidence: 0.5,
				enabled: true,
				secret: "my-secret-key",
			});

			const sub = orchestrator.getWebhookSubscribers().find((s) => s.id === id);
			expect(sub?.secret).toBe("my-secret-key");
		});
	});

	describe("Events", () => {
		it("should emit subscriberAdded event", () => {
			const listener = vi.fn();
			orchestrator.on("subscriberAdded", listener);

			orchestrator.addWebhookSubscriber({
				url: "https://example.com/webhook",
				minConfidence: 0.5,
				enabled: true,
			});

			expect(listener).toHaveBeenCalled();
			expect(listener.mock.calls[0][0]).toHaveProperty("id");
			expect(listener.mock.calls[0][0]).toHaveProperty("url");
		});

		it("should emit subscriberRemoved event", () => {
			const listener = vi.fn();
			orchestrator.on("subscriberRemoved", listener);

			const id = orchestrator.addWebhookSubscriber({
				url: "https://example.com/webhook",
				minConfidence: 0.5,
				enabled: true,
			});

			orchestrator.removeWebhookSubscriber(id);

			expect(listener).toHaveBeenCalled();
			expect(listener.mock.calls[0][0]).toEqual({ id });
		});
	});
});
