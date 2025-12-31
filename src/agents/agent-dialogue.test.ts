/**
 * Tests for Agent Dialogue System
 * Tests multi-agent dialogue, consensus building, and session management
 */

import { describe, expect, it } from "vitest";
import {
	createDialogueEngine,
	DEFAULT_DIALOGUE_AGENTS,
	type DialogueConfig,
	DialogueEngine,
	runDialogue,
	runTradingDialogue,
	TRADING_DIALOGUE_AGENTS,
} from "./agent-dialogue.js";

// Mock executor that returns predictable responses
const createMockExecutor = (responses: Record<string, string> = {}) => {
	return async (systemPrompt: string, _userPrompt: string): Promise<string> => {
		// Extract agent name from system prompt
		const nameMatch = systemPrompt.match(/You are ([^,]+)/);
		const agentName = nameMatch?.[1] || "Unknown";

		if (responses[agentName]) {
			return responses[agentName];
		}

		// Default response based on role
		if (systemPrompt.includes("synthesizer") || systemPrompt.includes("Jim Simons")) {
			return `I agree with the analysis. The key consensus points are:
1. We need statistical rigor
2. Transaction costs matter
3. Out-of-sample validation is critical

I agree with: Dr. Quant's statistical approach
Questions: What is the expected Sharpe ratio?`;
		}

		if (systemPrompt.includes("critic") || systemPrompt.includes("Devil's Advocate")) {
			return `I disagree with: the assumption that past patterns predict future behavior
However, I see merit in the systematic approach.
Questions: Have we considered regime changes?`;
		}

		return `My analysis suggests we should proceed carefully.
I agree with: the need for proper validation
Strengths identified in the proposal.`;
	};
};

describe("DialogueEngine", () => {
	describe("Session ID Generation", () => {
		it("should generate UUID-based session IDs", async () => {
			const config: DialogueConfig = {
				maxRounds: 1,
				consensusThreshold: 0.5,
				allowDissent: true,
				executor: createMockExecutor(),
			};

			const engine = new DialogueEngine(config);
			const session = await engine.runDialogue("Test topic", "Test context", [DEFAULT_DIALOGUE_AGENTS[0]]);

			expect(session.id).toMatch(/^dialogue_[0-9a-f-]{36}$/);
		});

		it("should generate unique session IDs", async () => {
			const config: DialogueConfig = {
				maxRounds: 1,
				consensusThreshold: 0.5,
				allowDissent: true,
				executor: createMockExecutor(),
			};

			const engine = new DialogueEngine(config);
			const session1 = await engine.runDialogue("Topic 1", "Context", [DEFAULT_DIALOGUE_AGENTS[0]]);
			const session2 = await engine.runDialogue("Topic 2", "Context", [DEFAULT_DIALOGUE_AGENTS[0]]);

			expect(session1.id).not.toBe(session2.id);
		});
	});

	describe("Dialogue Execution", () => {
		it("should run dialogue with multiple agents", async () => {
			const config: DialogueConfig = {
				maxRounds: 2,
				consensusThreshold: 0.6,
				allowDissent: true,
				executor: createMockExecutor(),
			};

			const engine = new DialogueEngine(config);
			const agents = DEFAULT_DIALOGUE_AGENTS.slice(0, 3);
			const session = await engine.runDialogue("Investment decision", "Should we invest in BTC?", agents);

			expect(session.topic).toBe("Investment decision");
			expect(session.context).toBe("Should we invest in BTC?");
			expect(session.agents).toHaveLength(3);
			expect(session.rounds.length).toBeGreaterThan(0);
			expect(session.startTime).toBeLessThanOrEqual(Date.now());
			expect(session.endTime).toBeDefined();
		});

		it("should collect messages from all agents each round", async () => {
			const config: DialogueConfig = {
				maxRounds: 1,
				consensusThreshold: 0.9, // High threshold to force single round
				allowDissent: true,
				executor: createMockExecutor(),
			};

			const engine = new DialogueEngine(config);
			const agents = DEFAULT_DIALOGUE_AGENTS.slice(0, 2);
			const session = await engine.runDialogue("Topic", "Context", agents);

			expect(session.rounds[0].messages).toHaveLength(2);
			expect(session.rounds[0].messages[0].agentId).toBe(agents[0].id);
			expect(session.rounds[0].messages[1].agentId).toBe(agents[1].id);
		});

		it("should emit events during dialogue", async () => {
			const config: DialogueConfig = {
				maxRounds: 1,
				consensusThreshold: 0.5,
				allowDissent: true,
				executor: createMockExecutor(),
			};

			const engine = new DialogueEngine(config);
			const events: string[] = [];

			engine.on("dialogueStarted", () => events.push("started"));
			engine.on("agentSpoke", () => events.push("spoke"));
			engine.on("roundCompleted", () => events.push("round"));
			engine.on("dialogueCompleted", () => events.push("completed"));

			await engine.runDialogue("Topic", "Context", [DEFAULT_DIALOGUE_AGENTS[0]]);

			expect(events).toContain("started");
			expect(events).toContain("spoke");
			expect(events).toContain("round");
			expect(events).toContain("completed");
		});
	});

	describe("Consensus Detection", () => {
		it("should detect consensus when agreement ratio is high", async () => {
			const agreeingExecutor = async () => `
				I completely agree with the proposed approach.
				Agreement: statistical rigor is essential
				Agreement: we should proceed
				No disagreements.
			`;

			const config: DialogueConfig = {
				maxRounds: 3,
				consensusThreshold: 0.6,
				allowDissent: true,
				executor: agreeingExecutor,
			};

			const engine = new DialogueEngine(config);
			const session = await engine.runDialogue("Topic", "Context", DEFAULT_DIALOGUE_AGENTS.slice(0, 3));

			// With high agreement, should reach consensus before max rounds
			expect(session.success).toBe(true);
		});

		it("should force synthesis when max rounds reached without consensus", async () => {
			const disagreeingExecutor = async () => `
				I disagree with: the proposed approach
				I disagree with: the timeline
				I disagree with: the methodology
				This is fundamentally flawed.
			`;

			const config: DialogueConfig = {
				maxRounds: 2,
				consensusThreshold: 0.9, // Very high threshold
				allowDissent: true,
				executor: disagreeingExecutor,
			};

			const engine = new DialogueEngine(config);
			const session = await engine.runDialogue("Topic", "Context", DEFAULT_DIALOGUE_AGENTS.slice(0, 2));

			expect(session.rounds).toHaveLength(2);
			expect(session.finalConsensus).toBeDefined();
			expect(session.success).toBe(true); // Partial success via forced synthesis
		});
	});

	describe("Message Parsing", () => {
		it("should extract agreements from agent responses", async () => {
			const executor = async () => `
				I agree with: the statistical approach
				I agree with Dr. Quant's analysis
				Agreement: we need more data
			`;

			const config: DialogueConfig = {
				maxRounds: 1,
				consensusThreshold: 0.5,
				allowDissent: true,
				executor,
			};

			const engine = new DialogueEngine(config);
			const session = await engine.runDialogue("Topic", "Context", [DEFAULT_DIALOGUE_AGENTS[0]]);

			const message = session.rounds[0].messages[0];
			expect(message.agreements).toBeDefined();
			expect(message.agreements!.length).toBeGreaterThan(0);
		});

		it("should extract disagreements from agent responses", async () => {
			const executor = async () => `
				I disagree with: the assumption
				Disagreement: the timeline is unrealistic
			`;

			const config: DialogueConfig = {
				maxRounds: 1,
				consensusThreshold: 0.5,
				allowDissent: true,
				executor,
			};

			const engine = new DialogueEngine(config);
			const session = await engine.runDialogue("Topic", "Context", [DEFAULT_DIALOGUE_AGENTS[0]]);

			const message = session.rounds[0].messages[0];
			expect(message.disagreements).toBeDefined();
			expect(message.disagreements!.length).toBeGreaterThan(0);
		});
	});

	describe("Error Handling", () => {
		it("should continue with other agents if one fails", async () => {
			let callCount = 0;
			const failingExecutor = async () => {
				callCount++;
				if (callCount === 1) {
					throw new Error("Agent failed");
				}
				return "I agree with the approach.";
			};

			const config: DialogueConfig = {
				maxRounds: 1,
				consensusThreshold: 0.5,
				allowDissent: true,
				executor: failingExecutor,
			};

			const engine = new DialogueEngine(config);
			const errorEvents: unknown[] = [];
			engine.on("agentError", (e) => errorEvents.push(e));

			const session = await engine.runDialogue("Topic", "Context", DEFAULT_DIALOGUE_AGENTS.slice(0, 2));

			expect(errorEvents).toHaveLength(1);
			expect(session.rounds[0].messages).toHaveLength(1); // Only one succeeded
		});
	});
});

describe("Trading Dialogue Agents", () => {
	it("should include Jim Simons with correct expertise", () => {
		const jimSimons = TRADING_DIALOGUE_AGENTS.find((a) => a.id === "jim_simons");

		expect(jimSimons).toBeDefined();
		expect(jimSimons!.role).toBe("synthesizer");
		expect(jimSimons!.expertise).toContain("statistical arbitrage");
		expect(jimSimons!.expertise).toContain("differential geometry");
		expect(jimSimons!.systemPrompt).toContain("UC Berkeley");
		expect(jimSimons!.systemPrompt).toContain("1961");
		expect(jimSimons!.systemPrompt).toContain("IDA"); // Not NSA
	});

	it("should have all required trading roles", () => {
		const roles = TRADING_DIALOGUE_AGENTS.map((a) => a.role);

		expect(roles).toContain("synthesizer");
		expect(roles).toContain("researcher");
		expect(roles).toContain("risk_assessor");
		expect(roles).toContain("critic");
	});
});

describe("Convenience Functions", () => {
	it("runDialogue should use default agents", async () => {
		const session = await runDialogue("Topic", "Context", createMockExecutor());

		expect(session.agents).toEqual(DEFAULT_DIALOGUE_AGENTS);
	});

	it("runTradingDialogue should use trading agents", async () => {
		const session = await runTradingDialogue("BTC Analysis", "Market context", createMockExecutor());

		expect(session.agents).toEqual(TRADING_DIALOGUE_AGENTS);
	});

	it("createDialogueEngine should return configured engine", () => {
		const config: DialogueConfig = {
			maxRounds: 5,
			consensusThreshold: 0.8,
			allowDissent: false,
			executor: createMockExecutor(),
		};

		const engine = createDialogueEngine(config);

		expect(engine).toBeInstanceOf(DialogueEngine);
	});
});
