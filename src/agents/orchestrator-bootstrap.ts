/**
 * Orchestrator Bootstrap - Wires real agent handlers to Class 3 Orchestrator
 *
 * This module registers actual agent implementations as handlers for the orchestrator,
 * enabling real task delegation and execution.
 */

import { Orchestrator } from "./orchestrator.js";

// Agent imports
import { runAgent as runLightweightAgent } from "./lightweight-agent.js";
import { runAgent as runClaudeAgent } from "./claude-agent.js";
import { runOmni } from "./omni-router.js";
import { runOpenCodeAgent } from "./opencode-agent.js";

/** Agent type */
type AgentType = "skill" | "mcp" | "subprocess" | "webhook" | "inline";

/** Agent role */
type AgentRole = "architect" | "builder" | "tester" | "reviewer" | "expert" | "scout" | "executor";

/** Bootstrap configuration */
export interface BootstrapConfig {
	/** Working directory for agents */
	workingDir: string;
	/** Default model for agents */
	defaultModel?: string;
	/** Enable learning/memory */
	enableLearning?: boolean;
	/** Max tokens for responses */
	maxTokens?: number;
	/** Register all default agents */
	registerDefaults?: boolean;
}

/** Agent handler signature */
type AgentHandler = (prompt: string, context?: Record<string, unknown>) => Promise<unknown>;

/** Default agents to register */
interface DefaultAgent {
	name: string;
	type: AgentType;
	role: AgentRole;
	description: string;
	handler: (config: BootstrapConfig) => AgentHandler;
}

// ============================================================================
// Default Agent Definitions
// ============================================================================

const DEFAULT_AGENTS: DefaultAgent[] = [
	// Lightweight - Fast Z.ai GLM
	{
		name: "lightweight-builder",
		type: "inline",
		role: "builder",
		description: "Fast GLM-4.5-air agent for quick coding tasks",
		handler: (config) => async (prompt) => {
			const result = await runLightweightAgent({
				prompt,
				workingDir: config.workingDir,
				model: config.defaultModel || "glm-4.5-air",
			});
			return result.output;
		},
	},

	// GLM-4.7 - Top coding + reasoning (architect)
	{
		name: "glm-architect",
		type: "subprocess",
		role: "architect",
		description: "GLM-4.7 agent for architecture and design (top reasoning)",
		handler: (config) => async (prompt) => {
			const result = await runClaudeAgent({
				prompt,
				workingDir: config.workingDir,
				model: config.defaultModel || "GLM-4.7",
				systemPrompt:
					"You are an expert software architect. Focus on clean design, scalability, and maintainability.",
			});
			return result.output;
		},
	},

	// Omni - Multi-model router (defaults to GLM)
	{
		name: "omni-router",
		type: "inline",
		role: "builder",
		description: "Multi-model router (prefers GLM for quality)",
		handler: () => async (prompt) => {
			const result = await runOmni({
				prompt,
				preferQuality: true,
			});
			return result.output;
		},
	},

	// GLM-4.6 - Stable coding
	{
		name: "glm-coder",
		type: "inline",
		role: "builder",
		description: "GLM-4.6 stable coding agent",
		handler: (config) => async (prompt) => {
			const result = await runClaudeAgent({
				prompt,
				workingDir: config.workingDir,
				model: config.defaultModel || "GLM-4.6",
			});
			return result.output;
		},
	},

	// Tester - GLM-4.5-air (fast)
	{
		name: "test-agent",
		type: "inline",
		role: "tester",
		description: "GLM-4.5-air testing agent for validation and QA",
		handler: (config) => async (prompt) => {
			const result = await runLightweightAgent({
				prompt: `You are a QA engineer. ${prompt}`,
				workingDir: config.workingDir,
				model: config.defaultModel || "glm-4.5-air",
				systemPrompt:
					"You are an expert QA engineer. Focus on test coverage, edge cases, and validation.",
			});
			return result.output;
		},
	},

	// Reviewer - GLM-4.7 (reasoning for code review)
	{
		name: "code-reviewer",
		type: "inline",
		role: "reviewer",
		description: "GLM-4.7 code review agent for quality and security",
		handler: (config) => async (prompt) => {
			const result = await runClaudeAgent({
				prompt,
				workingDir: config.workingDir,
				model: "GLM-4.7",
				systemPrompt:
					"You are an expert code reviewer. Focus on code quality, security vulnerabilities, performance issues, and best practices. Be thorough but constructive.",
			});
			return result.output;
		},
	},

	// Scout - GLM-4.5 (research)
	{
		name: "research-scout",
		type: "inline",
		role: "scout",
		description: "GLM-4.5 research and exploration agent",
		handler: (config) => async (prompt) => {
			const result = await runLightweightAgent({
				prompt,
				workingDir: config.workingDir,
				model: "glm-4.5",
				systemPrompt:
					"You are a research specialist. Explore codebases, gather information, and provide comprehensive analysis.",
			});
			return result.output;
		},
	},

	// Expert - GLM-4.7 (domain expertise with reasoning)
	{
		name: "domain-expert",
		type: "inline",
		role: "expert",
		description: "GLM-4.7 domain-specific expert agent",
		handler: (config) => async (prompt) => {
			const result = await runClaudeAgent({
				prompt,
				workingDir: config.workingDir,
				model: config.defaultModel || "GLM-4.7",
				systemPrompt:
					"You are a domain expert. Provide specialized knowledge and guidance based on the task context.",
			});
			return result.output;
		},
	},

	// Executor - GLM-4.5-air (fast DevOps)
	{
		name: "devops-executor",
		type: "subprocess",
		role: "executor",
		description: "GLM-4.5-air DevOps and automation agent",
		handler: (config) => async (prompt) => {
			const result = await runLightweightAgent({
				prompt,
				workingDir: config.workingDir,
				model: config.defaultModel || "glm-4.5-air",
				systemPrompt:
					"You are a DevOps engineer. Handle infrastructure, automation, CI/CD, and system operations.",
			});
			return result.output;
		},
	},
];

// ============================================================================
// Bootstrap Functions
// ============================================================================

/** Bootstrap the orchestrator with default agents */
export async function bootstrapOrchestrator(
	orchestrator: Orchestrator,
	config: BootstrapConfig,
): Promise<{ registered: number; agents: string[] }> {
	const registered: string[] = [];

	if (config.registerDefaults !== false) {
		for (const agentDef of DEFAULT_AGENTS) {
			try {
				// Create agent in database
				const agent = orchestrator.createAgent({
					name: agentDef.name,
					type: agentDef.type,
					role: agentDef.role,
					description: agentDef.description,
					config: {
						workingDir: config.workingDir,
						defaultModel: config.defaultModel,
						enableLearning: config.enableLearning,
					},
					status: "active",
				});

				// Register handler
				orchestrator.registerHandler(agent.id, agentDef.handler(config));
				registered.push(agent.name);
			} catch {
				// Agent might already exist
				const existing = orchestrator.listAgents().find((a) => a.name === agentDef.name);
				if (existing) {
					orchestrator.registerHandler(existing.id, agentDef.handler(config));
					registered.push(`${existing.name} (existing)`);
				}
			}
		}
	}

	return {
		registered: registered.length,
		agents: registered,
	};
}

/** Register a custom agent handler */
export function registerCustomAgent(
	orchestrator: Orchestrator,
	options: {
		name: string;
		type: AgentType;
		role: AgentRole;
		description: string;
		handler: AgentHandler;
	},
): string {
	const agent = orchestrator.createAgent({
		name: options.name,
		type: options.type,
		role: options.role,
		description: options.description,
		config: {},
		status: "active",
	});

	orchestrator.registerHandler(agent.id, options.handler);
	return agent.id;
}

/** Get agent handler by role (returns first matching) */
export function getAgentByRole(orchestrator: Orchestrator, role: AgentRole): string | null {
	const agents = orchestrator.listAgents().filter((a) => a.role === role && a.status === "active");
	return agents.length > 0 ? agents[0].id : null;
}

/** Quick delegation helper */
export async function quickDelegate(
	orchestrator: Orchestrator,
	prompt: string,
	role?: AgentRole,
): Promise<{ success: boolean; output: unknown; agentId?: string; error?: string }> {
	const result = await orchestrator.delegate({
		id: crypto.randomUUID(),
		taskType: "quick_delegate",
		prompt,
		requiredRole: role,
		timeout: 60000,
		priority: 5,
	});

	return {
		success: result.status === "success",
		output: result.output,
		agentId: result.agentId,
		error: result.error,
	};
}

// ============================================================================
// Singleton Bootstrap
// ============================================================================

let bootstrappedOrchestrator: Orchestrator | null = null;

/** Get or create bootstrapped orchestrator */
export async function getBootstrappedOrchestrator(
	dbPath: string,
	config: BootstrapConfig,
): Promise<Orchestrator> {
	if (!bootstrappedOrchestrator) {
		const { getOrchestrator } = await import("./orchestrator.js");
		bootstrappedOrchestrator = getOrchestrator(dbPath);
		await bootstrapOrchestrator(bootstrappedOrchestrator, config);
	}
	return bootstrappedOrchestrator;
}

/** Reset bootstrapped orchestrator */
export function resetBootstrap(): void {
	bootstrappedOrchestrator = null;
}

export { DEFAULT_AGENTS };
