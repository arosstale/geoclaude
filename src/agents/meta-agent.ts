/**
 * Class 3.5 Meta-Agent
 *
 * TAC Pattern: Agent that creates agents
 * "The meta-agent generates new agent definitions from natural language descriptions"
 *
 * Capabilities:
 * - Generate agent definitions from descriptions
 * - Analyze task patterns to suggest new specialists
 * - Auto-create agents based on memory insights
 * - Clone and modify existing agents
 */

import { EventEmitter } from "events";
import type { Orchestrator, AgentDefinition } from "./orchestrator.js";
import type { AgentMemorySystem, Insight } from "./agent-memory-system.js";

// =============================================================================
// Types
// =============================================================================

/** Agent generation request */
export interface AgentGenerationRequest {
	/** Natural language description of the agent */
	description: string;
	/** Suggested name (optional) */
	name?: string;
	/** Target role */
	role?: AgentRole;
	/** Base agent to clone/modify */
	baseAgentId?: string;
	/** Auto-register after creation */
	autoRegister?: boolean;
}

/** Generated agent specification */
export interface GeneratedAgentSpec {
	name: string;
	type: AgentType;
	role: AgentRole;
	description: string;
	systemPrompt: string;
	suggestedModel: string;
	capabilities: string[];
	reasoning: string;
}

/** Agent suggestion from patterns */
export interface AgentSuggestion {
	reason: string;
	suggestedSpec: GeneratedAgentSpec;
	basedOnInsights: string[];
	confidence: number;
}

type AgentType = "skill" | "mcp" | "subprocess" | "webhook" | "inline";
type AgentRole = "architect" | "builder" | "tester" | "reviewer" | "expert" | "scout" | "executor";

/** Meta-agent configuration */
export interface MetaAgentConfig {
	/** Default model for agent generation reasoning */
	reasoningModel: string;
	/** Minimum confidence to auto-suggest agents */
	autoSuggestThreshold: number;
	/** Enable automatic agent creation from patterns */
	enableAutoCreation: boolean;
	/** Maximum agents to auto-create per analysis */
	maxAutoCreate: number;
}

// =============================================================================
// Role Templates
// =============================================================================

const ROLE_TEMPLATES: Record<AgentRole, { description: string; capabilities: string[]; systemPromptPrefix: string }> = {
	architect: {
		description: "Designs systems, plans implementations, makes architectural decisions",
		capabilities: ["system design", "architecture", "planning", "trade-off analysis"],
		systemPromptPrefix: "You are an expert software architect. Focus on clean design, scalability, and maintainability.",
	},
	builder: {
		description: "Implements features, writes code, executes development tasks",
		capabilities: ["coding", "implementation", "debugging", "feature development"],
		systemPromptPrefix: "You are an expert developer. Write clean, efficient, well-tested code.",
	},
	tester: {
		description: "Creates tests, validates implementations, ensures quality",
		capabilities: ["testing", "QA", "validation", "edge case analysis"],
		systemPromptPrefix: "You are an expert QA engineer. Focus on comprehensive testing and quality assurance.",
	},
	reviewer: {
		description: "Reviews code, provides feedback, identifies issues",
		capabilities: ["code review", "feedback", "security analysis", "best practices"],
		systemPromptPrefix: "You are an expert code reviewer. Focus on quality, security, and best practices.",
	},
	expert: {
		description: "Provides domain-specific expertise and guidance",
		capabilities: ["domain expertise", "consultation", "specialized knowledge"],
		systemPromptPrefix: "You are a domain expert. Provide specialized knowledge and guidance.",
	},
	scout: {
		description: "Explores codebases, gathers information, researches solutions",
		capabilities: ["exploration", "research", "information gathering", "analysis"],
		systemPromptPrefix: "You are a research specialist. Explore, gather information, and provide comprehensive analysis.",
	},
	executor: {
		description: "Executes tasks, runs commands, handles DevOps operations",
		capabilities: ["execution", "DevOps", "automation", "operations"],
		systemPromptPrefix: "You are a DevOps engineer. Handle infrastructure, automation, and system operations.",
	},
};

// =============================================================================
// Meta-Agent
// =============================================================================

export class MetaAgent extends EventEmitter {
	private orchestrator: Orchestrator;
	private memory: AgentMemorySystem | null;
	private config: MetaAgentConfig;

	constructor(
		orchestrator: Orchestrator,
		memory: AgentMemorySystem | null = null,
		config: Partial<MetaAgentConfig> = {},
	) {
		super();
		this.orchestrator = orchestrator;
		this.memory = memory;
		this.config = {
			reasoningModel: config.reasoningModel ?? "GLM-4.7",
			autoSuggestThreshold: config.autoSuggestThreshold ?? 0.7,
			enableAutoCreation: config.enableAutoCreation ?? false,
			maxAutoCreate: config.maxAutoCreate ?? 3,
		};
	}

	// =========================================================================
	// Agent Generation
	// =========================================================================

	/** Generate agent specification from description */
	generateAgentSpec(request: AgentGenerationRequest): GeneratedAgentSpec {
		const { description, name, role, baseAgentId } = request;

		// If cloning an existing agent
		if (baseAgentId) {
			return this.generateFromBase(baseAgentId, description);
		}

		// Infer role from description
		const inferredRole = role || this.inferRole(description);
		const template = ROLE_TEMPLATES[inferredRole];

		// Generate name if not provided
		const agentName = name || this.generateName(description, inferredRole);

		// Build system prompt
		const systemPrompt = this.buildSystemPrompt(description, template);

		// Determine capabilities
		const capabilities = this.extractCapabilities(description, template);

		// Select model based on role complexity
		const suggestedModel = this.selectModel(inferredRole);

		const spec: GeneratedAgentSpec = {
			name: agentName,
			type: this.inferType(description),
			role: inferredRole,
			description: description.slice(0, 200),
			systemPrompt,
			suggestedModel,
			capabilities,
			reasoning: `Generated ${inferredRole} agent based on description. Using ${suggestedModel} for ${template.description.toLowerCase()}.`,
		};

		this.emit("specGenerated", spec);
		return spec;
	}

	/** Create and register agent from specification */
	createAgent(spec: GeneratedAgentSpec): AgentDefinition {
		const agent = this.orchestrator.createAgent({
			name: spec.name,
			type: spec.type,
			role: spec.role,
			description: spec.description,
			systemPrompt: spec.systemPrompt,
			config: {
				model: spec.suggestedModel,
				capabilities: spec.capabilities,
				generatedByMeta: true,
			},
			status: "active",
		});

		this.emit("agentCreated", agent);
		return agent;
	}

	/** Generate and create agent in one step */
	generateAndCreate(request: AgentGenerationRequest): { spec: GeneratedAgentSpec; agent: AgentDefinition } {
		const spec = this.generateAgentSpec(request);
		const agent = this.createAgent(spec);
		return { spec, agent };
	}

	// =========================================================================
	// Pattern-Based Suggestions
	// =========================================================================

	/** Analyze patterns and suggest new agents */
	suggestAgents(): AgentSuggestion[] {
		if (!this.memory) {
			return [];
		}

		const suggestions: AgentSuggestion[] = [];
		const insights = this.memory.getActiveInsights();
		const globalStats = this.memory.getGlobalStats();

		// Look for failure patterns that might need specialists
		const failureInsights = insights.filter((i) => i.type === "failure" && i.confidence > 0.6);
		for (const insight of failureInsights.slice(0, 3)) {
			const suggestion = this.suggestFromFailure(insight);
			if (suggestion && suggestion.confidence >= this.config.autoSuggestThreshold) {
				suggestions.push(suggestion);
			}
		}

		// Look for task types without good agents
		const patternInsights = insights.filter((i) => i.type === "pattern");
		for (const insight of patternInsights.slice(0, 3)) {
			const suggestion = this.suggestFromPattern(insight);
			if (suggestion && suggestion.confidence >= this.config.autoSuggestThreshold) {
				suggestions.push(suggestion);
			}
		}

		// Suggest based on volume - high-volume task types might need dedicated agents
		if (globalStats.totalTasks > 50) {
			const volumeSuggestion = this.suggestFromVolume();
			if (volumeSuggestion) {
				suggestions.push(volumeSuggestion);
			}
		}

		this.emit("suggestionsGenerated", suggestions);
		return suggestions;
	}

	/** Auto-create suggested agents if enabled */
	autoCreateFromSuggestions(): AgentDefinition[] {
		if (!this.config.enableAutoCreation) {
			return [];
		}

		const suggestions = this.suggestAgents();
		const created: AgentDefinition[] = [];

		for (const suggestion of suggestions.slice(0, this.config.maxAutoCreate)) {
			if (suggestion.confidence >= this.config.autoSuggestThreshold) {
				const agent = this.createAgent(suggestion.suggestedSpec);
				created.push(agent);
			}
		}

		if (created.length > 0) {
			this.emit("autoCreated", created);
		}

		return created;
	}

	// =========================================================================
	// Helper Methods
	// =========================================================================

	private inferRole(description: string): AgentRole {
		const lower = description.toLowerCase();

		if (lower.includes("architect") || lower.includes("design") || lower.includes("plan")) {
			return "architect";
		}
		if (lower.includes("test") || lower.includes("qa") || lower.includes("quality")) {
			return "tester";
		}
		if (lower.includes("review") || lower.includes("feedback") || lower.includes("check")) {
			return "reviewer";
		}
		if (lower.includes("research") || lower.includes("explore") || lower.includes("find")) {
			return "scout";
		}
		if (lower.includes("expert") || lower.includes("specialist") || lower.includes("domain")) {
			return "expert";
		}
		if (lower.includes("devops") || lower.includes("deploy") || lower.includes("execute")) {
			return "executor";
		}

		return "builder"; // Default
	}

	private inferType(description: string): AgentType {
		const lower = description.toLowerCase();

		if (lower.includes("mcp") || lower.includes("tool")) {
			return "mcp";
		}
		if (lower.includes("webhook") || lower.includes("api")) {
			return "webhook";
		}
		if (lower.includes("subprocess") || lower.includes("process")) {
			return "subprocess";
		}
		if (lower.includes("skill")) {
			return "skill";
		}

		return "inline"; // Default
	}

	private generateName(description: string, role: AgentRole): string {
		// Extract key words from description
		const words = description.toLowerCase().split(/\s+/);
		const keywords = words.filter((w) => w.length > 4 && !["agent", "that", "which", "should", "would"].includes(w));

		const prefix = keywords[0] || role;
		return `${prefix}-${role}`;
	}

	private buildSystemPrompt(description: string, template: { systemPromptPrefix: string }): string {
		return `${template.systemPromptPrefix}\n\nSpecialization: ${description}`;
	}

	private extractCapabilities(description: string, template: { capabilities: string[] }): string[] {
		const caps = [...template.capabilities];

		// Add description-specific capabilities
		const lower = description.toLowerCase();
		if (lower.includes("typescript") || lower.includes("ts")) caps.push("typescript");
		if (lower.includes("python") || lower.includes("py")) caps.push("python");
		if (lower.includes("sql") || lower.includes("database")) caps.push("database");
		if (lower.includes("api")) caps.push("api");
		if (lower.includes("trading")) caps.push("trading");
		if (lower.includes("security")) caps.push("security");

		return [...new Set(caps)];
	}

	private selectModel(role: AgentRole): string {
		// GLM model selection based on role
		switch (role) {
			case "architect":
			case "reviewer":
			case "expert":
				return "GLM-4.7"; // Best reasoning
			case "builder":
				return "GLM-4.6"; // Stable coding
			case "tester":
			case "executor":
			case "scout":
				return "glm-4.5-air"; // Fast
			default:
				return "GLM-4.6";
		}
	}

	private generateFromBase(baseAgentId: string, modifications: string): GeneratedAgentSpec {
		const agents = this.orchestrator.listAgents();
		const base = agents.find((a) => a.id === baseAgentId);

		if (!base) {
			throw new Error(`Base agent not found: ${baseAgentId}`);
		}

		return {
			name: `${base.name}-variant`,
			type: base.type,
			role: base.role,
			description: `${base.description}. Modified: ${modifications}`,
			systemPrompt: base.systemPrompt || ROLE_TEMPLATES[base.role].systemPromptPrefix,
			suggestedModel: this.selectModel(base.role),
			capabilities: ROLE_TEMPLATES[base.role].capabilities,
			reasoning: `Cloned from ${base.name} with modifications: ${modifications}`,
		};
	}

	private suggestFromFailure(insight: Insight): AgentSuggestion | null {
		if (!insight.taskTypes || insight.taskTypes.length === 0) {
			return null;
		}

		const taskType = insight.taskTypes[0];
		const role = this.inferRole(taskType);

		return {
			reason: `High failure rate detected for ${taskType} tasks. A specialized agent might improve success.`,
			suggestedSpec: {
				name: `${taskType}-specialist`,
				type: "inline",
				role,
				description: `Specialist for ${taskType} tasks to improve success rate`,
				systemPrompt: `${ROLE_TEMPLATES[role].systemPromptPrefix}\n\nYou specialize in ${taskType} tasks. Focus on avoiding common failure patterns.`,
				suggestedModel: this.selectModel(role),
				capabilities: [...ROLE_TEMPLATES[role].capabilities, taskType],
				reasoning: `Generated to address failure pattern: ${insight.title}`,
			},
			basedOnInsights: [insight.id],
			confidence: insight.confidence,
		};
	}

	private suggestFromPattern(insight: Insight): AgentSuggestion | null {
		if (!insight.description.includes("excels") && !insight.description.includes("best")) {
			return null;
		}

		// Pattern suggests a successful specialization - might want more like it
		return null; // TODO: Implement pattern-based suggestions
	}

	private suggestFromVolume(): AgentSuggestion | null {
		// TODO: Analyze task type volume and suggest dedicated agents
		return null;
	}

	// =========================================================================
	// Accessors
	// =========================================================================

	getConfig(): MetaAgentConfig {
		return { ...this.config };
	}

	updateConfig(updates: Partial<MetaAgentConfig>): void {
		this.config = { ...this.config, ...updates };
	}
}

// =============================================================================
// Factory
// =============================================================================

let metaAgentInstance: MetaAgent | null = null;

export function getMetaAgent(
	orchestrator: Orchestrator,
	memory?: AgentMemorySystem,
	config?: Partial<MetaAgentConfig>,
): MetaAgent {
	if (!metaAgentInstance) {
		metaAgentInstance = new MetaAgent(orchestrator, memory || null, config);
	}
	return metaAgentInstance;
}

export function resetMetaAgent(): void {
	metaAgentInstance = null;
}
