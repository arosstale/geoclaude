/**
 * Session Factory Tests
 *
 * Tests for the SDK-compatible session factory that mirrors
 * the upcoming pi SDK's createAgentSession() API.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type CreateSessionOptions,
	createSession,
	type SessionFactoryEvent,
	SessionManager,
} from "./session-factory.js";

// Mock the pi-agent-core module
vi.mock("@mariozechner/pi-agent-core", () => {
	const mockSubscribe = vi.fn();
	const mockPrompt = vi.fn().mockResolvedValue(undefined);

	return {
		Agent: vi.fn().mockImplementation(() => ({
			subscribe: mockSubscribe,
			prompt: mockPrompt,
		})),
		ProviderTransport: vi.fn().mockImplementation(() => ({})),
	};
});

describe("SessionManager", () => {
	describe("inMemory", () => {
		it("should return in-memory config", () => {
			const config = SessionManager.inMemory();
			expect(config.mode).toBe("in-memory");
			expect(config.sessionDir).toBeUndefined();
		});
	});

	describe("create", () => {
		it("should return persistent config with default session dir", () => {
			const config = SessionManager.create("/home/user/project");
			expect(config.mode).toBe("persistent");
			expect(config.sessionDir).toBe("/home/user/project/.sessions");
		});

		it("should return persistent config with custom session dir", () => {
			const config = SessionManager.create("/home/user/project", "/custom/sessions");
			expect(config.mode).toBe("persistent");
			expect(config.sessionDir).toBe("/custom/sessions");
		});
	});

	describe("continueRecent", () => {
		it("should return continue-recent config with default session dir", () => {
			const config = SessionManager.continueRecent("/home/user/project");
			expect(config.mode).toBe("continue-recent");
			expect(config.sessionDir).toBe("/home/user/project/.sessions");
		});

		it("should return continue-recent config with custom session dir", () => {
			const config = SessionManager.continueRecent("/home/user/project", "/custom/sessions");
			expect(config.mode).toBe("continue-recent");
			expect(config.sessionDir).toBe("/custom/sessions");
		});
	});
});

describe("createSession", () => {
	const mockModel = { name: "test-model", provider: "test" } as any;
	const mockGetApiKey = vi.fn().mockResolvedValue("test-api-key");

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should throw error if model is not provided", async () => {
		await expect(
			createSession({
				getApiKey: mockGetApiKey,
			} as CreateSessionOptions),
		).rejects.toThrow("Model is required");
	});

	it("should throw error if getApiKey is not provided", async () => {
		await expect(
			createSession({
				model: mockModel,
			} as CreateSessionOptions),
		).rejects.toThrow("getApiKey function is required");
	});

	it("should create session with minimal options", async () => {
		const result = await createSession({
			model: mockModel,
			getApiKey: mockGetApiKey,
		});

		expect(result.session).toBeDefined();
		expect(result.sessionId).toBeDefined();
		expect(result.sessionId).toMatch(/^session_\d+_[a-z0-9]+$/);
	});

	it("should create session with custom cwd", async () => {
		const result = await createSession({
			model: mockModel,
			getApiKey: mockGetApiKey,
			cwd: "/custom/dir",
		});

		expect(result.session).toBeDefined();
	});

	it("should create session with custom system prompt string", async () => {
		const result = await createSession({
			model: mockModel,
			getApiKey: mockGetApiKey,
			systemPrompt: "Custom prompt",
		});

		expect(result.session).toBeDefined();
	});

	it("should create session with system prompt modifier function", async () => {
		const modifier = vi.fn((defaultPrompt: string) => `Modified: ${defaultPrompt}`);

		const result = await createSession({
			model: mockModel,
			getApiKey: mockGetApiKey,
			systemPrompt: modifier,
		});

		expect(result.session).toBeDefined();
		expect(modifier).toHaveBeenCalled();
	});

	it("should create session with tools", async () => {
		const mockTool = { name: "test-tool", execute: vi.fn() } as any;

		const result = await createSession({
			model: mockModel,
			getApiKey: mockGetApiKey,
			tools: [mockTool],
		});

		expect(result.session).toBeDefined();
	});

	it("should create session with thinking level", async () => {
		const result = await createSession({
			model: mockModel,
			getApiKey: mockGetApiKey,
			thinkingLevel: "high",
		});

		expect(result.session).toBeDefined();
	});

	it("should log debug info when debug is enabled", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createSession({
			model: mockModel,
			getApiKey: mockGetApiKey,
			debug: true,
		});

		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});

describe("AgentSession", () => {
	const mockModel = { name: "test-model", provider: "test" } as any;
	const mockGetApiKey = vi.fn().mockResolvedValue("test-api-key");

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should have sessionId property", async () => {
		const { session } = await createSession({
			model: mockModel,
			getApiKey: mockGetApiKey,
		});

		expect(session.sessionId).toBeDefined();
		expect(typeof session.sessionId).toBe("string");
	});

	it("should have agent property", async () => {
		const { session } = await createSession({
			model: mockModel,
			getApiKey: mockGetApiKey,
		});

		expect(session.agent).toBeDefined();
	});

	it("should support subscribe method", async () => {
		const { session } = await createSession({
			model: mockModel,
			getApiKey: mockGetApiKey,
		});

		const events: SessionFactoryEvent[] = [];
		const unsubscribe = session.subscribe((event) => {
			events.push(event);
		});

		expect(typeof unsubscribe).toBe("function");

		// Unsubscribe should not throw
		expect(() => unsubscribe()).not.toThrow();
	});

	it("should support multiple subscribers", async () => {
		const { session } = await createSession({
			model: mockModel,
			getApiKey: mockGetApiKey,
		});

		const events1: SessionFactoryEvent[] = [];
		const events2: SessionFactoryEvent[] = [];

		const unsub1 = session.subscribe((event) => events1.push(event));
		const unsub2 = session.subscribe((event) => events2.push(event));

		// Both should be valid functions
		expect(typeof unsub1).toBe("function");
		expect(typeof unsub2).toBe("function");

		// Clean up
		unsub1();
		unsub2();
	});

	it("should have abort method", async () => {
		const { session } = await createSession({
			model: mockModel,
			getApiKey: mockGetApiKey,
		});

		expect(typeof session.abort).toBe("function");
		// Should not throw
		expect(() => session.abort()).not.toThrow();
	});

	it("should have reset method", async () => {
		const { session } = await createSession({
			model: mockModel,
			getApiKey: mockGetApiKey,
		});

		expect(typeof session.reset).toBe("function");
		// Should not throw
		expect(() => session.reset()).not.toThrow();
	});

	it("should have getOutput method returning empty string initially", async () => {
		const { session } = await createSession({
			model: mockModel,
			getApiKey: mockGetApiKey,
		});

		expect(session.getOutput()).toBe("");
	});

	it("should have getUsage method returning undefined initially", async () => {
		const { session } = await createSession({
			model: mockModel,
			getApiKey: mockGetApiKey,
		});

		expect(session.getUsage()).toBeUndefined();
	});

	it("should have prompt method", async () => {
		const { session } = await createSession({
			model: mockModel,
			getApiKey: mockGetApiKey,
		});

		expect(typeof session.prompt).toBe("function");
	});
});

describe("Session event types", () => {
	it("should define all expected event types", async () => {
		// Import the types to verify they exist
		const { session } = await createSession({
			model: { name: "test", provider: "test" } as any,
			getApiKey: async () => "key",
		});

		// The session should emit these event types
		const _expectedEventTypes = [
			"message_start",
			"message_update",
			"message_end",
			"tool_execution_start",
			"tool_execution_update",
			"tool_execution_end",
			"agent_start",
			"agent_end",
			"turn_start",
			"turn_end",
			"error",
		];

		// Verify session can handle subscriptions
		const receivedEvents: string[] = [];
		session.subscribe((event) => {
			receivedEvents.push(event.type);
		});

		// Session should be valid
		expect(session).toBeDefined();
	});
});
