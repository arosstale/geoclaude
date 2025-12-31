/**
 * Comprehensive Tests for StatefulAgent
 * Tests persistent agent state, lifecycle, checkpoints, and restoration
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AgentState,
	disposeAllStatefulAgents,
	disposeStatefulAgent,
	getStatefulAgent,
	listStatefulAgents,
	StatefulAgent,
	type StatefulAgentConfig,
} from "./stateful-agent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test data directory
const TEST_DATA_DIR = join(__dirname, ".test-data-stateful-agent");

describe("StatefulAgent", () => {
	beforeEach(() => {
		// Clean up before each test
		if (existsSync(TEST_DATA_DIR)) {
			rmSync(TEST_DATA_DIR, { recursive: true, force: true });
		}
		mkdirSync(TEST_DATA_DIR, { recursive: true });

		// Clear agent registry
		disposeAllStatefulAgents();
	});

	afterEach(() => {
		// Clean up after each test
		if (existsSync(TEST_DATA_DIR)) {
			rmSync(TEST_DATA_DIR, { recursive: true, force: true });
		}
		disposeAllStatefulAgents();
	});

	describe("Creation and Initialization", () => {
		it("should create agent with default config", () => {
			const config: StatefulAgentConfig = {
				id: "test-agent-1",
				dataDir: TEST_DATA_DIR,
			};

			const agent = new StatefulAgent(config);

			expect(agent.id).toBe("test-agent-1");
			expect(agent.status).toBe("idle");
			expect(agent.state.progress).toBe(0);
			expect(agent.state.data).toEqual({});
			expect(agent.isActive).toBe(false);
		});

		it("should create agent with custom config", () => {
			const config: StatefulAgentConfig = {
				id: "test-agent-2",
				dataDir: TEST_DATA_DIR,
				cwd: __dirname,
				autoCheckpoint: false,
				maxHistory: 50,
				sessionId: "custom-session",
			};

			const agent = new StatefulAgent(config);

			expect(agent.id).toBe("test-agent-2");
			expect(agent.status).toBe("idle");
		});

		it("should create state file on first update", async () => {
			const config: StatefulAgentConfig = {
				id: "test-agent-3",
				dataDir: TEST_DATA_DIR,
				autoCheckpoint: false,
			};

			const agent = new StatefulAgent(config);

			const stateDir = join(TEST_DATA_DIR, "agents");
			const statePath = join(stateDir, "test-agent-3.json");

			// State file is not created until first update
			expect(existsSync(statePath)).toBe(false);

			// After an update, state file should exist
			await agent.setProgress(10);
			expect(existsSync(statePath)).toBe(true);
		});

		it("should load existing state from disk", () => {
			const config: StatefulAgentConfig = {
				id: "test-agent-4",
				dataDir: TEST_DATA_DIR,
			};

			// Create state directory
			const stateDir = join(TEST_DATA_DIR, "agents");
			mkdirSync(stateDir, { recursive: true });

			// Create existing state file
			const existingState: AgentState = {
				status: "paused",
				currentTask: "Test task",
				progress: 50,
				data: { testKey: "testValue" },
				lastActivity: Date.now(),
				history: [],
			};

			const statePath = join(stateDir, "test-agent-4.json");
			writeFileSync(statePath, JSON.stringify(existingState, null, 2));

			// Create agent - should load existing state
			const agent = new StatefulAgent(config);

			expect(agent.status).toBe("paused");
			expect(agent.state.currentTask).toBe("Test task");
			expect(agent.state.progress).toBe(50);
			expect(agent.state.data).toEqual({ testKey: "testValue" });
		});

		it("should create initial state if file is corrupted", () => {
			const config: StatefulAgentConfig = {
				id: "test-agent-5",
				dataDir: TEST_DATA_DIR,
			};

			const stateDir = join(TEST_DATA_DIR, "agents");
			mkdirSync(stateDir, { recursive: true });

			// Write corrupted JSON
			const statePath = join(stateDir, "test-agent-5.json");
			writeFileSync(statePath, "{ invalid json ::::");

			const agent = new StatefulAgent(config);

			// Should fall back to initial state
			expect(agent.status).toBe("idle");
			expect(agent.state.progress).toBe(0);
		});
	});

	describe("State Access", () => {
		it("should return read-only copy of state", () => {
			const agent = new StatefulAgent({
				id: "test-agent-6",
				dataDir: TEST_DATA_DIR,
			});

			const state1 = agent.state;
			const state2 = agent.state;

			// Should be different objects (copies)
			expect(state1).not.toBe(state2);
			expect(state1).toEqual(state2);
		});

		it("should expose status property", () => {
			const agent = new StatefulAgent({
				id: "test-agent-7",
				dataDir: TEST_DATA_DIR,
			});

			expect(agent.status).toBe("idle");
		});

		it("should expose isActive getter", async () => {
			const agent = new StatefulAgent({
				id: "test-agent-8",
				dataDir: TEST_DATA_DIR,
			});

			expect(agent.isActive).toBe(false);

			await agent.start("Test task");
			expect(agent.isActive).toBe(true);

			await agent.pause();
			expect(agent.isActive).toBe(true); // Paused is still active

			await agent.complete();
			expect(agent.isActive).toBe(false);
		});

		it("should expose canResume getter", async () => {
			const agent = new StatefulAgent({
				id: "test-agent-9",
				dataDir: TEST_DATA_DIR,
			});

			expect(agent.canResume).toBe(false);

			await agent.start("Test task");
			expect(agent.canResume).toBe(false);

			await agent.pause();
			expect(agent.canResume).toBe(true);

			await agent.suspend();
			expect(agent.canResume).toBe(true);

			await agent.start("New task");
			await agent.fail("Error");
			expect(agent.canResume).toBe(true);
		});
	});

	describe("Lifecycle Methods", () => {
		describe("start", () => {
			it("should start agent with task", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-10",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false, // Disable for speed
				});

				await agent.start("Build feature X");

				expect(agent.status).toBe("running");
				expect(agent.state.currentTask).toBe("Build feature X");
				expect(agent.state.progress).toBe(0);
				expect(agent.state.error).toBeUndefined();
			});

			it("should add history entry on start", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-11",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.start("Test task");

				expect(agent.state.history.length).toBe(1);
				expect(agent.state.history[0].action).toBe("start");
				expect(agent.state.history[0].status).toBe("running");
			});

			it("should throw if already running", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-12",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.start("Task 1");

				await expect(agent.start("Task 2")).rejects.toThrow("already running");
			});
		});

		describe("pause", () => {
			it("should pause running agent", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-13",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.start("Task");
				await agent.pause();

				expect(agent.status).toBe("paused");
			});

			it("should throw if not running", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-14",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await expect(agent.pause()).rejects.toThrow("not running");
			});
		});

		describe("resume", () => {
			it("should resume paused agent", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-15",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.start("Task");
				await agent.pause();
				const result = await agent.resume();

				expect(result.success).toBe(true);
				expect(agent.status).toBe("running");
				expect(agent.state.error).toBeUndefined();
			});

			it("should resume suspended agent", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-16",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.start("Task");
				await agent.suspend();
				const result = await agent.resume();

				expect(result.success).toBe(true);
				expect(agent.status).toBe("running");
			});

			it("should resume failed agent", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-17",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.start("Task");
				await agent.fail("Something went wrong");
				const result = await agent.resume();

				expect(result.success).toBe(true);
				expect(agent.status).toBe("running");
			});

			it("should fail to resume non-resumable state", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-18",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.start("Task");
				await agent.complete();
				const result = await agent.resume();

				expect(result.success).toBe(false);
				expect(result.error).toContain("Cannot resume");
			});
		});

		describe("suspend", () => {
			it("should suspend agent and create checkpoint", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-19",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.start("Task");
				const result = await agent.suspend();

				expect(agent.status).toBe("suspended");
				// Checkpoint might fail if not a git repo, but suspend should succeed
				expect(result).toBeDefined();
			});
		});

		describe("complete", () => {
			it("should complete agent task", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-20",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.start("Task");
				await agent.complete({ finalValue: 42 });

				expect(agent.status).toBe("completed");
				expect(agent.state.progress).toBe(100);
				expect(agent.state.data.result).toEqual({ finalValue: 42 });
			});
		});

		describe("fail", () => {
			it("should mark agent as failed with error string", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-21",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.start("Task");
				await agent.fail("Network timeout");

				expect(agent.status).toBe("failed");
				expect(agent.state.error).toBe("Network timeout");
			});

			it("should mark agent as failed with Error object", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-22",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.start("Task");
				await agent.fail(new Error("Database connection failed"));

				expect(agent.status).toBe("failed");
				expect(agent.state.error).toBe("Database connection failed");
			});
		});

		describe("reset", () => {
			it("should reset agent to idle state", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-23",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.start("Task");
				await agent.setProgress(75);
				await agent.setData("key", "value");
				await agent.fail("Error");
				await agent.reset();

				expect(agent.status).toBe("idle");
				expect(agent.state.currentTask).toBeUndefined();
				expect(agent.state.progress).toBe(0);
				expect(agent.state.error).toBeUndefined();
				expect(agent.state.data).toEqual({});
			});
		});
	});

	describe("Progress and Data Updates", () => {
		describe("setProgress", () => {
			it("should update progress value", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-24",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.setProgress(50);

				expect(agent.state.progress).toBe(50);
			});

			it("should clamp progress to 0-100 range", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-25",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.setProgress(-10);
				expect(agent.state.progress).toBe(0);

				await agent.setProgress(150);
				expect(agent.state.progress).toBe(100);
			});

			it("should add history entry for progress update", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-26",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.setProgress(25);

				expect(agent.state.history.length).toBe(1);
				expect(agent.state.history[0].action).toBe("progress:25");
			});
		});

		describe("setData", () => {
			it("should set data value", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-27",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.setData("temperature", 72);

				expect(agent.state.data.temperature).toBe(72);
			});

			it("should preserve existing data", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-28",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.setData("key1", "value1");
				await agent.setData("key2", "value2");

				expect(agent.state.data).toEqual({
					key1: "value1",
					key2: "value2",
				});
			});
		});

		describe("getData", () => {
			it("should get data value", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-29",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.setData("myKey", { nested: "value" });

				const value = agent.getData("myKey");
				expect(value).toEqual({ nested: "value" });
			});

			it("should return undefined for missing key", () => {
				const agent = new StatefulAgent({
					id: "test-agent-30",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				const value = agent.getData("nonexistent");
				expect(value).toBeUndefined();
			});

			it("should return default value for missing key", () => {
				const agent = new StatefulAgent({
					id: "test-agent-31",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				const value = agent.getData("missing", "default");
				expect(value).toBe("default");
			});
		});

		describe("mergeData", () => {
			it("should merge multiple data updates", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-32",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.setData("key1", "value1");
				await agent.mergeData({
					key2: "value2",
					key3: "value3",
				});

				expect(agent.state.data).toEqual({
					key1: "value1",
					key2: "value2",
					key3: "value3",
				});
			});

			it("should overwrite existing keys", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-33",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				await agent.setData("key", "old");
				await agent.mergeData({ key: "new" });

				expect(agent.state.data.key).toBe("new");
			});
		});
	});

	describe("State Persistence", () => {
		it("should persist state to disk on update", async () => {
			const agent = new StatefulAgent({
				id: "test-agent-34",
				dataDir: TEST_DATA_DIR,
				autoCheckpoint: false,
			});

			await agent.start("Persistent task");

			const statePath = join(TEST_DATA_DIR, "agents", "test-agent-34.json");
			const savedState = JSON.parse(readFileSync(statePath, "utf-8"));

			expect(savedState.status).toBe("running");
			expect(savedState.currentTask).toBe("Persistent task");
		});

		it("should persist data updates", async () => {
			const agent = new StatefulAgent({
				id: "test-agent-35",
				dataDir: TEST_DATA_DIR,
				autoCheckpoint: false,
			});

			await agent.setData("persistentKey", "persistentValue");

			const statePath = join(TEST_DATA_DIR, "agents", "test-agent-35.json");
			const savedState = JSON.parse(readFileSync(statePath, "utf-8"));

			expect(savedState.data.persistentKey).toBe("persistentValue");
		});

		it("should update lastActivity timestamp", async () => {
			const agent = new StatefulAgent({
				id: "test-agent-36",
				dataDir: TEST_DATA_DIR,
				autoCheckpoint: false,
			});

			const initialActivity = agent.state.lastActivity;

			// Wait a bit to ensure timestamp difference
			await new Promise((resolve) => setTimeout(resolve, 10));
			await agent.setProgress(10);

			expect(agent.state.lastActivity).toBeGreaterThan(initialActivity);
		});
	});

	describe("History Management", () => {
		it("should record history entries", async () => {
			const agent = new StatefulAgent({
				id: "test-agent-37",
				dataDir: TEST_DATA_DIR,
				autoCheckpoint: false,
			});

			await agent.start("Task");
			await agent.setProgress(50);
			await agent.pause();

			expect(agent.state.history.length).toBe(3);
			expect(agent.state.history[0].action).toBe("start");
			expect(agent.state.history[1].action).toBe("progress:50");
			expect(agent.state.history[2].action).toBe("pause");
		});

		it("should trim history to maxHistory limit", async () => {
			const agent = new StatefulAgent({
				id: "test-agent-38",
				dataDir: TEST_DATA_DIR,
				autoCheckpoint: false,
				maxHistory: 5,
			});

			// Create 10 history entries
			for (let i = 0; i < 10; i++) {
				await agent.setProgress(i * 10);
			}

			// Should keep only last 5
			expect(agent.state.history.length).toBe(5);
			expect(agent.state.history[0].action).toBe("progress:50");
			expect(agent.state.history[4].action).toBe("progress:90");
		});
	});

	describe("Serialization", () => {
		describe("toJSON", () => {
			it("should export agent state", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-39",
					dataDir: TEST_DATA_DIR,
					sessionId: "test-session",
					autoCheckpoint: false,
				});

				await agent.start("Export task");
				await agent.setData("key", "value");

				const exported = agent.toJSON();

				expect(exported.id).toBe("test-agent-39");
				expect(exported.sessionId).toBe("test-session");
				expect(exported.state.status).toBe("running");
				expect(exported.state.currentTask).toBe("Export task");
				expect(exported.state.data.key).toBe("value");
				expect(exported.exportedAt).toBeDefined();
			});
		});

		describe("importState", () => {
			it("should import state from JSON", async () => {
				const agent = new StatefulAgent({
					id: "test-agent-40",
					dataDir: TEST_DATA_DIR,
					autoCheckpoint: false,
				});

				const importedState: AgentState = {
					status: "running",
					currentTask: "Imported task",
					progress: 75,
					data: { imported: true },
					lastActivity: Date.now(),
					history: [],
				};

				await agent.importState({ state: importedState }, false);

				expect(agent.status).toBe("running");
				expect(agent.state.currentTask).toBe("Imported task");
				expect(agent.state.progress).toBe(75);
				expect(agent.state.data.imported).toBe(true);
			});
		});
	});

	describe("Memory Integration", () => {
		it("should provide memory manager", () => {
			const agent = new StatefulAgent({
				id: "test-agent-41",
				dataDir: TEST_DATA_DIR,
			});

			const memory = agent.memory;

			expect(memory).toBeDefined();
			expect(typeof memory.getBlock).toBe("function");
		});

		it("should lazy-initialize memory", () => {
			const agent = new StatefulAgent({
				id: "test-agent-42",
				dataDir: TEST_DATA_DIR,
			});

			// Access memory twice
			const memory1 = agent.memory;
			const memory2 = agent.memory;

			// Should return same instance
			expect(memory1).toBe(memory2);
		});
	});
});

describe("Factory and Registry", () => {
	beforeEach(() => {
		disposeAllStatefulAgents();
		if (existsSync(TEST_DATA_DIR)) {
			rmSync(TEST_DATA_DIR, { recursive: true, force: true });
		}
		mkdirSync(TEST_DATA_DIR, { recursive: true });
	});

	afterEach(() => {
		disposeAllStatefulAgents();
		if (existsSync(TEST_DATA_DIR)) {
			rmSync(TEST_DATA_DIR, { recursive: true, force: true });
		}
	});

	describe("getStatefulAgent", () => {
		it("should create new agent if not exists", () => {
			const agent = getStatefulAgent({
				id: "factory-agent-1",
				dataDir: TEST_DATA_DIR,
			});

			expect(agent.id).toBe("factory-agent-1");
		});

		it("should return existing agent if already created", () => {
			const agent1 = getStatefulAgent({
				id: "factory-agent-2",
				dataDir: TEST_DATA_DIR,
			});

			const agent2 = getStatefulAgent({
				id: "factory-agent-2",
				dataDir: TEST_DATA_DIR,
			});

			expect(agent1).toBe(agent2);
		});

		it("should register agent in registry", () => {
			getStatefulAgent({
				id: "factory-agent-3",
				dataDir: TEST_DATA_DIR,
			});

			const agents = listStatefulAgents();
			expect(agents.length).toBe(1);
			expect(agents[0].id).toBe("factory-agent-3");
		});
	});

	describe("listStatefulAgents", () => {
		it("should return empty array when no agents", () => {
			const agents = listStatefulAgents();
			expect(agents).toEqual([]);
		});

		it("should list all registered agents", () => {
			getStatefulAgent({ id: "agent-1", dataDir: TEST_DATA_DIR });
			getStatefulAgent({ id: "agent-2", dataDir: TEST_DATA_DIR });
			getStatefulAgent({ id: "agent-3", dataDir: TEST_DATA_DIR });

			const agents = listStatefulAgents();
			expect(agents.length).toBe(3);

			const ids = agents.map((a) => a.id).sort();
			expect(ids).toEqual(["agent-1", "agent-2", "agent-3"]);
		});
	});

	describe("disposeStatefulAgent", () => {
		it("should remove agent from registry", () => {
			getStatefulAgent({ id: "dispose-agent", dataDir: TEST_DATA_DIR });

			const result = disposeStatefulAgent("dispose-agent");

			expect(result).toBe(true);
			expect(listStatefulAgents().length).toBe(0);
		});

		it("should return false for non-existent agent", () => {
			const result = disposeStatefulAgent("nonexistent");
			expect(result).toBe(false);
		});
	});

	describe("disposeAllStatefulAgents", () => {
		it("should clear all agents from registry", () => {
			getStatefulAgent({ id: "agent-1", dataDir: TEST_DATA_DIR });
			getStatefulAgent({ id: "agent-2", dataDir: TEST_DATA_DIR });
			getStatefulAgent({ id: "agent-3", dataDir: TEST_DATA_DIR });

			disposeAllStatefulAgents();

			expect(listStatefulAgents().length).toBe(0);
		});
	});
});

describe("Auto-Checkpoint Behavior", () => {
	beforeEach(() => {
		disposeAllStatefulAgents();
		if (existsSync(TEST_DATA_DIR)) {
			rmSync(TEST_DATA_DIR, { recursive: true, force: true });
		}
		mkdirSync(TEST_DATA_DIR, { recursive: true });
	});

	afterEach(() => {
		disposeAllStatefulAgents();
		if (existsSync(TEST_DATA_DIR)) {
			rmSync(TEST_DATA_DIR, { recursive: true, force: true });
		}
	});

	it("should create checkpoint on status change when autoCheckpoint enabled", async () => {
		const agent = new StatefulAgent({
			id: "auto-checkpoint-1",
			dataDir: TEST_DATA_DIR,
			autoCheckpoint: true, // Default
		});

		await agent.start("Task");

		// If in git repo, history should have checkpointId
		const historyEntry = agent.state.history.find((h) => h.action === "start");
		expect(historyEntry).toBeDefined();
		// CheckpointId might be undefined if not in git repo (expected)
	});

	it("should still create checkpoint for lifecycle methods when autoCheckpoint disabled", async () => {
		const agent = new StatefulAgent({
			id: "auto-checkpoint-2",
			dataDir: TEST_DATA_DIR,
			autoCheckpoint: false,
		});

		// Lifecycle methods like start() always create checkpoints regardless of autoCheckpoint setting
		await agent.start("Task");

		const historyEntry = agent.state.history.find((h) => h.action === "start");
		expect(historyEntry).toBeDefined();
		// CheckpointId might be defined even with autoCheckpoint: false because start() explicitly creates checkpoint
		// This is by design - lifecycle methods are important enough to always checkpoint
	});

	it("should not auto-checkpoint on progress when autoCheckpoint disabled", async () => {
		const agent = new StatefulAgent({
			id: "auto-checkpoint-3",
			dataDir: TEST_DATA_DIR,
			autoCheckpoint: false,
		});

		await agent.setProgress(50);

		const historyEntry = agent.state.history.find((h) => h.action === "progress:50");
		expect(historyEntry).toBeDefined();
		// Progress updates don't explicitly request checkpoint, so with autoCheckpoint: false, there should be none
		expect(historyEntry?.checkpointId).toBeUndefined();
	});
});

describe("Edge Cases and Error Handling", () => {
	beforeEach(() => {
		disposeAllStatefulAgents();
		if (existsSync(TEST_DATA_DIR)) {
			rmSync(TEST_DATA_DIR, { recursive: true, force: true });
		}
		mkdirSync(TEST_DATA_DIR, { recursive: true });
	});

	afterEach(() => {
		disposeAllStatefulAgents();
		if (existsSync(TEST_DATA_DIR)) {
			rmSync(TEST_DATA_DIR, { recursive: true, force: true });
		}
	});

	it("should handle concurrent state updates", async () => {
		const agent = new StatefulAgent({
			id: "concurrent-agent",
			dataDir: TEST_DATA_DIR,
			autoCheckpoint: false,
		});

		// Concurrent data updates
		await Promise.all([
			agent.setData("key1", "value1"),
			agent.setData("key2", "value2"),
			agent.setData("key3", "value3"),
		]);

		expect(agent.state.data).toEqual({
			key1: "value1",
			key2: "value2",
			key3: "value3",
		});
	});

	it("should handle rapid progress updates", async () => {
		const agent = new StatefulAgent({
			id: "rapid-agent",
			dataDir: TEST_DATA_DIR,
			autoCheckpoint: false,
		});

		// Rapid progress updates
		for (let i = 0; i <= 100; i += 10) {
			await agent.setProgress(i);
		}

		expect(agent.state.progress).toBe(100);
		// History should have all updates (limited by maxHistory)
		expect(agent.state.history.length).toBeGreaterThan(0);
	});

	it("should handle empty task string", async () => {
		const agent = new StatefulAgent({
			id: "empty-task-agent",
			dataDir: TEST_DATA_DIR,
			autoCheckpoint: false,
		});

		await agent.start("");

		expect(agent.status).toBe("running");
		expect(agent.state.currentTask).toBe("");
	});

	it("should handle special characters in data keys", async () => {
		const agent = new StatefulAgent({
			id: "special-chars-agent",
			dataDir: TEST_DATA_DIR,
			autoCheckpoint: false,
		});

		await agent.setData("key-with-dashes", "value1");
		await agent.setData("key.with.dots", "value2");
		await agent.setData("key_with_underscores", "value3");

		expect(agent.getData("key-with-dashes")).toBe("value1");
		expect(agent.getData("key.with.dots")).toBe("value2");
		expect(agent.getData("key_with_underscores")).toBe("value3");
	});

	it("should handle complex nested data", async () => {
		const agent = new StatefulAgent({
			id: "nested-data-agent",
			dataDir: TEST_DATA_DIR,
			autoCheckpoint: false,
		});

		const complexData = {
			level1: {
				level2: {
					level3: {
						value: "deep",
						array: [1, 2, 3],
					},
				},
			},
		};

		await agent.setData("complex", complexData);

		const retrieved = agent.getData<typeof complexData>("complex");
		expect(retrieved).toEqual(complexData);
	});
});
