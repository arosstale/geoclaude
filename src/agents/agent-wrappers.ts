/**
 * Class 3.19: Agent Wrapper System
 *
 * Composable wrappers for agent augmentation based on AgentJo patterns.
 * Wrappers extend base agent behavior without modifying core logic.
 *
 * Available Wrappers:
 * - ReflectionWrapper: Self-critique before finalizing
 * - PlannerWrapper: Multi-step planning before execution
 * - MemoryWrapper: Persistent memory across sessions
 * - BudgetWrapper: Tool call limits enforcement
 * - ThoughtsWrapper: Visible reasoning trace
 * - ConversationWrapper: Multi-turn context management
 *
 * Usage:
 *   const agent = compose(baseAgent, ReflectionWrapper, PlannerWrapper);
 *   const result = await agent.run(task);
 *
 * @module agent-wrappers
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export interface AgentInput {
	task: string;
	context?: Record<string, unknown>;
	history?: AgentMessage[];
}

export interface AgentOutput {
	result: string;
	thoughts?: string[];
	actions?: AgentAction[];
	metadata?: Record<string, unknown>;
}

export interface AgentMessage {
	role: "user" | "assistant" | "system" | "tool";
	content: string;
	timestamp: number;
}

export interface AgentAction {
	type: string;
	tool?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	duration?: number;
}

export interface BaseAgent {
	run(input: AgentInput): Promise<AgentOutput>;
	getName(): string;
}

export interface WrapperConfig {
	enabled?: boolean;
	priority?: number;
	[key: string]: unknown;
}

export type AgentWrapper = (agent: BaseAgent, config?: WrapperConfig) => BaseAgent;

// =============================================================================
// Wrapper Implementations
// =============================================================================

/**
 * ReflectionWrapper: Self-critique and improve output
 *
 * Pattern from AgentJo:
 * 1. Generate initial response
 * 2. Critique the response
 * 3. Improve based on critique
 * 4. Return improved response
 */
export function ReflectionWrapper(agent: BaseAgent, config?: WrapperConfig): BaseAgent {
	const reflectionConfig = {
		enabled: true,
		maxReflections: 2,
		minConfidence: 0.7,
		...config,
	};

	return {
		getName: () => `Reflection(${agent.getName()})`,

		async run(input: AgentInput): Promise<AgentOutput> {
			if (!reflectionConfig.enabled) {
				return agent.run(input);
			}

			const thoughts: string[] = [];
			let currentOutput = await agent.run(input);
			thoughts.push(`Initial: ${currentOutput.result.slice(0, 100)}...`);

			for (let i = 0; i < reflectionConfig.maxReflections; i++) {
				// Critique phase
				const critiqueInput: AgentInput = {
					task: `Critique this response for task "${input.task}":\n\n${currentOutput.result}\n\nIdentify weaknesses, errors, or improvements needed. Be specific.`,
					context: { ...input.context, phase: "critique", iteration: i },
				};

				const critique = await agent.run(critiqueInput);
				thoughts.push(`Critique ${i + 1}: ${critique.result.slice(0, 100)}...`);

				// Check if critique indicates high quality
				const isGood =
					critique.result.toLowerCase().includes("no major issues") ||
					critique.result.toLowerCase().includes("looks good") ||
					critique.result.toLowerCase().includes("well done");

				if (isGood) {
					thoughts.push("Reflection complete: Quality threshold met");
					break;
				}

				// Improve phase
				const improveInput: AgentInput = {
					task: `Improve this response based on the critique:\n\nOriginal: ${currentOutput.result}\n\nCritique: ${critique.result}\n\nProvide an improved response.`,
					context: { ...input.context, phase: "improve", iteration: i },
				};

				currentOutput = await agent.run(improveInput);
				thoughts.push(`Improved ${i + 1}: ${currentOutput.result.slice(0, 100)}...`);
			}

			return {
				...currentOutput,
				thoughts: [...(currentOutput.thoughts || []), ...thoughts],
				metadata: {
					...currentOutput.metadata,
					wrapper: "Reflection",
					reflections: thoughts.length,
				},
			};
		},
	};
}

/**
 * PlannerWrapper: Multi-step planning before execution
 *
 * Pattern from AgentJo/TaskGen:
 * 1. Decompose task into subtasks
 * 2. Order subtasks by dependencies
 * 3. Execute each subtask
 * 4. Synthesize final result
 */
export function PlannerWrapper(agent: BaseAgent, config?: WrapperConfig): BaseAgent {
	const plannerConfig = {
		enabled: true,
		maxSteps: 10,
		parallelExecution: false,
		...config,
	};

	interface PlanStep {
		id: number;
		task: string;
		dependencies: number[];
		status: "pending" | "running" | "complete" | "failed";
		result?: string;
	}

	return {
		getName: () => `Planner(${agent.getName()})`,

		async run(input: AgentInput): Promise<AgentOutput> {
			if (!plannerConfig.enabled) {
				return agent.run(input);
			}

			const thoughts: string[] = [];
			const actions: AgentAction[] = [];

			// Step 1: Generate plan
			const planInput: AgentInput = {
				task: `Break down this task into ${plannerConfig.maxSteps} or fewer atomic steps. Return as numbered list with dependencies in brackets.\n\nTask: ${input.task}\n\nFormat:\n1. [deps: none] First step\n2. [deps: 1] Second step (depends on first)\n3. [deps: 1,2] Third step (depends on first and second)`,
				context: { ...input.context, phase: "planning" },
			};

			const planOutput = await agent.run(planInput);
			thoughts.push(`Plan generated: ${planOutput.result.slice(0, 200)}...`);

			// Parse plan
			const steps: PlanStep[] = [];
			const lines = planOutput.result.split("\n").filter((l) => /^\d+\./.test(l.trim()));

			for (const line of lines) {
				const match = line.match(/^(\d+)\.\s*\[deps?:\s*([^\]]*)\]\s*(.+)$/i);
				if (match) {
					const [, idStr, depsStr, task] = match;
					const deps = depsStr
						.toLowerCase()
						.replace("none", "")
						.split(",")
						.map((d) => parseInt(d.trim(), 10))
						.filter((d) => !Number.isNaN(d));

					steps.push({
						id: parseInt(idStr, 10),
						task: task.trim(),
						dependencies: deps,
						status: "pending",
					});
				}
			}

			if (steps.length === 0) {
				// No plan parsed, run directly
				return agent.run(input);
			}

			thoughts.push(`Parsed ${steps.length} steps`);

			// Step 2: Execute steps in order
			const results: Map<number, string> = new Map();

			for (const step of steps) {
				// Check dependencies
				const depsReady = step.dependencies.every((d) => results.has(d));
				if (!depsReady) {
					step.status = "failed";
					thoughts.push(`Step ${step.id} skipped: dependencies not met`);
					continue;
				}

				step.status = "running";
				const depContext = step.dependencies.map((d) => `Step ${d} result: ${results.get(d)}`).join("\n");

				const stepInput: AgentInput = {
					task: `${step.task}\n\nContext from previous steps:\n${depContext || "None"}`,
					context: { ...input.context, phase: "execution", stepId: step.id },
				};

				const startTime = Date.now();
				try {
					const stepOutput = await agent.run(stepInput);
					step.status = "complete";
					step.result = stepOutput.result;
					results.set(step.id, stepOutput.result);
					actions.push({
						type: "step",
						params: { id: step.id, task: step.task },
						result: stepOutput.result.slice(0, 100),
						duration: Date.now() - startTime,
					});
				} catch (error) {
					step.status = "failed";
					thoughts.push(`Step ${step.id} failed: ${error}`);
				}
			}

			// Step 3: Synthesize
			const completedSteps = steps.filter((s) => s.status === "complete");
			const synthesisInput: AgentInput = {
				task: `Synthesize the final answer for: ${input.task}\n\nCompleted steps:\n${completedSteps.map((s) => `${s.id}. ${s.task}: ${s.result}`).join("\n")}`,
				context: { ...input.context, phase: "synthesis" },
			};

			const finalOutput = await agent.run(synthesisInput);

			return {
				...finalOutput,
				thoughts: [...thoughts, ...(finalOutput.thoughts || [])],
				actions: [...actions, ...(finalOutput.actions || [])],
				metadata: {
					...finalOutput.metadata,
					wrapper: "Planner",
					stepsTotal: steps.length,
					stepsCompleted: completedSteps.length,
				},
			};
		},
	};
}

/**
 * MemoryWrapper: Persistent memory across sessions
 *
 * Pattern from AgentJo (Memory on Demand):
 * - Query relevant memories before execution
 * - Store important information after execution
 * - Prune old/irrelevant memories
 */
export function MemoryWrapper(agent: BaseAgent, config?: WrapperConfig): BaseAgent {
	const memoryConfig = {
		enabled: true,
		maxMemories: 100,
		retrieveK: 5,
		memoryStore: new Map<string, { content: string; timestamp: number; relevance: number }>(),
		...config,
	};

	return {
		getName: () => `Memory(${agent.getName()})`,

		async run(input: AgentInput): Promise<AgentOutput> {
			if (!memoryConfig.enabled) {
				return agent.run(input);
			}

			const thoughts: string[] = [];

			// Retrieve relevant memories (simple keyword matching for now)
			const keywords = input.task.toLowerCase().split(/\s+/);
			const relevantMemories: string[] = [];

			for (const [key, memory] of memoryConfig.memoryStore.entries()) {
				const matches = keywords.filter((kw) => memory.content.toLowerCase().includes(kw)).length;
				if (matches > 0) {
					relevantMemories.push(`[Memory: ${key}] ${memory.content}`);
					if (relevantMemories.length >= memoryConfig.retrieveK) break;
				}
			}

			thoughts.push(`Retrieved ${relevantMemories.length} relevant memories`);

			// Augment input with memories
			const augmentedInput: AgentInput = {
				...input,
				task:
					relevantMemories.length > 0
						? `${input.task}\n\nRelevant memories:\n${relevantMemories.join("\n")}`
						: input.task,
				context: {
					...input.context,
					memoriesRetrieved: relevantMemories.length,
				},
			};

			const output = await agent.run(augmentedInput);

			// Store new memory if output contains important information
			const memoryKey = `mem_${Date.now()}`;
			const summary = output.result.slice(0, 200);
			memoryConfig.memoryStore.set(memoryKey, {
				content: `Task: ${input.task.slice(0, 100)} | Result: ${summary}`,
				timestamp: Date.now(),
				relevance: 1.0,
			});

			// Prune old memories
			if (memoryConfig.memoryStore.size > memoryConfig.maxMemories) {
				const entries = Array.from(memoryConfig.memoryStore.entries());
				entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
				const toRemove = entries.slice(0, entries.length - memoryConfig.maxMemories);
				for (const [key] of toRemove) {
					memoryConfig.memoryStore.delete(key);
				}
				thoughts.push(`Pruned ${toRemove.length} old memories`);
			}

			return {
				...output,
				thoughts: [...thoughts, ...(output.thoughts || [])],
				metadata: {
					...output.metadata,
					wrapper: "Memory",
					memoriesUsed: relevantMemories.length,
					memoriesStored: memoryConfig.memoryStore.size,
				},
			};
		},
	};
}

/**
 * BudgetWrapper: Tool call limits enforcement
 *
 * Based on Anthropic research_subagent tool budgeting
 */
export function BudgetWrapper(agent: BaseAgent, config?: WrapperConfig): BaseAgent {
	const budgetConfig = {
		enabled: true,
		maxCalls: 10,
		currentCalls: 0,
		warnThreshold: 0.8,
		...config,
	};

	return {
		getName: () => `Budget(${agent.getName()})`,

		async run(input: AgentInput): Promise<AgentOutput> {
			if (!budgetConfig.enabled) {
				return agent.run(input);
			}

			budgetConfig.currentCalls++;
			const remaining = budgetConfig.maxCalls - budgetConfig.currentCalls;
			const usageRatio = budgetConfig.currentCalls / budgetConfig.maxCalls;

			const thoughts: string[] = [];

			if (budgetConfig.currentCalls > budgetConfig.maxCalls) {
				thoughts.push("Budget exhausted - synthesizing from available information");
				return {
					result: `Budget exhausted after ${budgetConfig.maxCalls} calls. Please synthesize from gathered information.`,
					thoughts,
					metadata: { wrapper: "Budget", exhausted: true },
				};
			}

			if (usageRatio >= budgetConfig.warnThreshold) {
				thoughts.push(`Budget warning: ${remaining} calls remaining`);
			}

			// Augment input with budget info
			const augmentedInput: AgentInput = {
				...input,
				context: {
					...input.context,
					budget: {
						used: budgetConfig.currentCalls,
						remaining,
						total: budgetConfig.maxCalls,
					},
				},
			};

			const output = await agent.run(augmentedInput);

			return {
				...output,
				thoughts: [...thoughts, ...(output.thoughts || [])],
				metadata: {
					...output.metadata,
					wrapper: "Budget",
					budgetUsed: budgetConfig.currentCalls,
					budgetRemaining: remaining,
				},
			};
		},
	};
}

/**
 * ThoughtsWrapper: Visible reasoning trace
 *
 * Captures inner monologue for debugging and transparency
 */
export function ThoughtsWrapper(agent: BaseAgent, config?: WrapperConfig): BaseAgent {
	const thoughtsConfig = {
		enabled: true,
		capturePrompts: true,
		captureResults: true,
		maxThoughts: 50,
		...config,
	};

	const thoughtLog: string[] = [];

	return {
		getName: () => `Thoughts(${agent.getName()})`,

		async run(input: AgentInput): Promise<AgentOutput> {
			if (!thoughtsConfig.enabled) {
				return agent.run(input);
			}

			if (thoughtsConfig.capturePrompts) {
				thoughtLog.push(`[INPUT] ${input.task.slice(0, 100)}...`);
			}

			const output = await agent.run(input);

			if (thoughtsConfig.captureResults) {
				thoughtLog.push(`[OUTPUT] ${output.result.slice(0, 100)}...`);
			}

			// Trim log
			while (thoughtLog.length > thoughtsConfig.maxThoughts) {
				thoughtLog.shift();
			}

			return {
				...output,
				thoughts: [...thoughtLog, ...(output.thoughts || [])],
				metadata: {
					...output.metadata,
					wrapper: "Thoughts",
					thoughtsRecorded: thoughtLog.length,
				},
			};
		},
	};
}

/**
 * ConversationWrapper: Multi-turn context management
 */
export function ConversationWrapper(agent: BaseAgent, config?: WrapperConfig): BaseAgent {
	const convConfig = {
		enabled: true,
		maxHistory: 20,
		history: [] as AgentMessage[],
		...config,
	};

	return {
		getName: () => `Conversation(${agent.getName()})`,

		async run(input: AgentInput): Promise<AgentOutput> {
			if (!convConfig.enabled) {
				return agent.run(input);
			}

			// Add user message
			convConfig.history.push({
				role: "user",
				content: input.task,
				timestamp: Date.now(),
			});

			// Build context from history
			const historyContext = convConfig.history
				.slice(-convConfig.maxHistory)
				.map((m) => `${m.role}: ${m.content}`)
				.join("\n");

			const augmentedInput: AgentInput = {
				...input,
				task: `Conversation history:\n${historyContext}\n\nCurrent request: ${input.task}`,
				history: convConfig.history,
			};

			const output = await agent.run(augmentedInput);

			// Add assistant response
			convConfig.history.push({
				role: "assistant",
				content: output.result,
				timestamp: Date.now(),
			});

			// Trim history
			while (convConfig.history.length > convConfig.maxHistory * 2) {
				convConfig.history.shift();
			}

			return {
				...output,
				metadata: {
					...output.metadata,
					wrapper: "Conversation",
					historyLength: convConfig.history.length,
				},
			};
		},
	};
}

// =============================================================================
// Composition Utilities
// =============================================================================

/**
 * Compose multiple wrappers around a base agent
 *
 * Usage:
 *   const agent = compose(baseAgent, ReflectionWrapper, PlannerWrapper, MemoryWrapper);
 */
export function compose(agent: BaseAgent, ...wrappers: AgentWrapper[]): BaseAgent {
	return wrappers.reduce((wrapped, wrapper) => wrapper(wrapped), agent);
}

/**
 * Create a wrapper with custom config
 */
export function withConfig(wrapper: AgentWrapper, config: WrapperConfig): AgentWrapper {
	return (agent: BaseAgent) => wrapper(agent, config);
}

/**
 * Conditional wrapper application
 */
export function conditional(wrapper: AgentWrapper, condition: (input: AgentInput) => boolean): AgentWrapper {
	return (agent: BaseAgent, config?: WrapperConfig) => {
		const wrapped = wrapper(agent, config);
		return {
			getName: () => wrapped.getName(),
			async run(input: AgentInput): Promise<AgentOutput> {
				if (condition(input)) {
					return wrapped.run(input);
				}
				return agent.run(input);
			},
		};
	};
}

// =============================================================================
// Wrapper Manager
// =============================================================================

export class WrapperManager extends EventEmitter {
	private wrappers: Map<string, AgentWrapper> = new Map();

	constructor() {
		super();
		// Register default wrappers
		this.register("reflection", ReflectionWrapper);
		this.register("planner", PlannerWrapper);
		this.register("memory", MemoryWrapper);
		this.register("budget", BudgetWrapper);
		this.register("thoughts", ThoughtsWrapper);
		this.register("conversation", ConversationWrapper);
	}

	register(name: string, wrapper: AgentWrapper): void {
		this.wrappers.set(name, wrapper);
		this.emit("wrapper:registered", { name });
	}

	get(name: string): AgentWrapper | undefined {
		return this.wrappers.get(name);
	}

	list(): string[] {
		return Array.from(this.wrappers.keys());
	}

	wrap(agent: BaseAgent, wrapperNames: string[], configs?: Record<string, WrapperConfig>): BaseAgent {
		let wrapped = agent;
		for (const name of wrapperNames) {
			const wrapper = this.wrappers.get(name);
			if (wrapper) {
				wrapped = wrapper(wrapped, configs?.[name]);
			}
		}
		return wrapped;
	}
}

// =============================================================================
// Factory
// =============================================================================

let managerInstance: WrapperManager | null = null;

export function getWrapperManager(): WrapperManager {
	if (!managerInstance) {
		managerInstance = new WrapperManager();
	}
	return managerInstance;
}

export function resetWrapperManager(): void {
	managerInstance = null;
}
