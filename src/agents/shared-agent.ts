/**
 * Shared Agent - Pi-Mono Cross-Platform Agent
 *
 * Provides a unified Agent with full MCP tools for:
 * - Telegram
 * - WhatsApp
 * - Slack
 *
 * Same tools as Discord bot for consistency.
 */

import { Agent, type AgentEvent, ProviderTransport } from "@mariozechner/pi-agent-core";
import type { AgentTool, Model } from "@mariozechner/pi-ai";
import { getAllMcpTools } from "../mcp-tools.js";

// Z.ai Configuration
const ZAI_API_KEY = process.env.ZAI_API_KEY || "";
const ZAI_BASE_URL = "https://api.z.ai/api/coding/paas/v4";

// Model configurations for shared agent
const SHARED_MODELS: Record<string, Model<"openai-completions">> = {
	"glm-4.5-air": {
		id: "glm-4.5-Air",
		name: "GLM 4.5 Air (Ultra Fast)",
		api: "openai-completions",
		provider: "zai",
		baseUrl: ZAI_BASE_URL,
		reasoning: false,
		input: ["text"],
		cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 128000,
		headers: {
			Authorization: `Bearer ${ZAI_API_KEY}`,
		},
	},
	"glm-4.7": {
		id: "glm-4.7",
		name: "GLM 4.7 Orchestral (Top Coding + Reasoning)",
		api: "openai-completions",
		provider: "zai",
		baseUrl: ZAI_BASE_URL,
		reasoning: false,
		input: ["text"],
		cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 128000,
		headers: {
			Authorization: `Bearer ${ZAI_API_KEY}`,
		},
	},
	"glm-4.6": {
		id: "glm-4.6",
		name: "GLM 4.6 (Stable Fast)",
		api: "openai-completions",
		provider: "zai",
		baseUrl: ZAI_BASE_URL,
		reasoning: false,
		input: ["text"],
		cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 128000,
		headers: {
			Authorization: `Bearer ${ZAI_API_KEY}`,
		},
	},
};

// ============================================================================
// Types
// ============================================================================

export interface SharedAgentOptions {
	/** Platform identifier */
	platform: "telegram" | "whatsapp" | "slack";

	/** Session/channel ID */
	sessionId: string;

	/** User identifier */
	userId: string;

	/** System prompt override */
	systemPrompt?: string;

	/** Working directory for file operations */
	workingDir?: string;

	/** Model to use (default: glm-4.5-air for speed) */
	model?: string;

	/** Timeout in ms (default: 120000) */
	timeout?: number;

	/** Filter to specific tool names (optional) */
	toolFilter?: string[];
}

export interface SharedAgentResult {
	success: boolean;
	response: string;
	error?: string;
	toolsUsed: string[];
	duration: number;
}

// ============================================================================
// Agent Cache (per session)
// ============================================================================

interface CachedAgent {
	agent: Agent;
	lastUsed: number;
}

const agentCache = new Map<string, CachedAgent>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Cleanup stale agents periodically
setInterval(
	() => {
		const now = Date.now();
		for (const [key, cached] of agentCache.entries()) {
			if (now - cached.lastUsed > CACHE_TTL) {
				agentCache.delete(key);
			}
		}
	},
	5 * 60 * 1000,
); // Every 5 minutes

// ============================================================================
// Default System Prompts
// ============================================================================

const PLATFORM_PROMPTS: Record<string, string> = {
	telegram: `You are Pi, an AI assistant on Telegram.
You have access to powerful tools: web search, code execution, file operations, GitHub, HuggingFace, and more.
Be concise - Telegram has message limits. Use markdown formatting.
Proactively use tools to provide accurate, helpful responses.`,

	whatsapp: `You are Pi, an AI assistant on WhatsApp.
You have access to powerful tools: web search, code execution, file operations, GitHub, HuggingFace, and more.
Keep responses brief and clear - WhatsApp is mobile-first.
Use tools proactively to give accurate answers.`,

	slack: `You are Pi, a professional AI assistant on Slack.
You have access to powerful tools: web search, code execution, file operations, GitHub, HuggingFace, and more.
Format responses for Slack using mrkdwn. Be professional but friendly.
Use tools proactively to help with work tasks.`,
};

// ============================================================================
// Shared Agent Functions
// ============================================================================

/**
 * Get or create an Agent for a session
 */
function getOrCreateAgent(options: SharedAgentOptions): Agent {
	const cacheKey = `${options.platform}:${options.sessionId}`;
	const cached = agentCache.get(cacheKey);

	if (cached) {
		cached.lastUsed = Date.now();
		return cached.agent;
	}

	// Get model config
	const modelId = options.model || "glm-4.5-air";
	const model = SHARED_MODELS[modelId] || SHARED_MODELS["glm-4.5-air"];

	// Get all MCP tools (synchronous)
	const allTools = getAllMcpTools();

	// Filter tools if specified
	let tools: AgentTool<any>[] = allTools;
	if (options.toolFilter && options.toolFilter.length > 0) {
		tools = allTools.filter((t) =>
			options.toolFilter!.some((filter) => {
				if (filter.endsWith("*")) {
					return t.name.startsWith(filter.slice(0, -1));
				}
				return t.name === filter;
			}),
		);
	}

	// Create transport with API key getter
	const transport = new ProviderTransport({
		getApiKey: async () => {
			const apiKey = process.env.ZAI_API_KEY;
			if (!apiKey) {
				throw new Error("ZAI_API_KEY not configured");
			}
			return apiKey;
		},
	});

	// Build system prompt
	const systemPrompt = options.systemPrompt || PLATFORM_PROMPTS[options.platform] || PLATFORM_PROMPTS.telegram;

	// Create agent with initialState (matches main.ts pattern)
	const agent = new Agent({
		initialState: {
			systemPrompt,
			model,
			thinkingLevel: "off",
			tools,
		},
		transport,
	});

	// Cache the agent
	agentCache.set(cacheKey, {
		agent,
		lastUsed: Date.now(),
	});

	return agent;
}

/**
 * Run a prompt through the shared agent
 */
export async function runSharedAgent(
	options: SharedAgentOptions,
	userMessage: string,
	onEvent?: (event: AgentEvent) => void,
): Promise<SharedAgentResult> {
	const startTime = Date.now();
	const toolsUsed: string[] = [];
	let responseText = "";

	try {
		const agent = getOrCreateAgent(options);
		const timeout = options.timeout || 120000;

		// Subscribe to events
		const unsubscribe = agent.subscribe((event: AgentEvent) => {
			// Track tools used
			if (event.type === "tool_execution_start") {
				const e = event as any;
				const toolName = e.toolName || e.args?.label || "unknown";
				toolsUsed.push(toolName);
			}

			// Collect response text
			if (event.type === "message_update") {
				const e = event as any;
				if (e.assistantMessageEvent?.type === "text_delta") {
					responseText += e.assistantMessageEvent.text || "";
				}
			}

			// Forward events if callback provided
			if (onEvent) {
				onEvent(event);
			}
		});

		// Run prompt with timeout
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => {
				agent.abort();
				reject(new Error(`Agent timeout after ${timeout / 1000}s`));
			}, timeout);
		});

		await Promise.race([agent.prompt(userMessage), timeoutPromise]);

		unsubscribe();

		// Get final response from agent state
		const messages = agent.state.messages;
		const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

		if (lastAssistant?.content) {
			const textBlocks = lastAssistant.content.filter((b: any) => b.type === "text");
			if (textBlocks.length > 0) {
				responseText = textBlocks.map((b: any) => b.text).join("\n");
			}
		}

		return {
			success: true,
			response: responseText || "Done.",
			toolsUsed,
			duration: Date.now() - startTime,
		};
	} catch (error) {
		return {
			success: false,
			response: "",
			error: error instanceof Error ? error.message : String(error),
			toolsUsed,
			duration: Date.now() - startTime,
		};
	}
}

/**
 * Clear cached agent for a session
 */
export function clearAgentCache(platform: string, sessionId: string): void {
	const cacheKey = `${platform}:${sessionId}`;
	agentCache.delete(cacheKey);
}

/**
 * Get available tool names
 */
export function getAvailableTools(): string[] {
	const tools = getAllMcpTools();
	return tools.map((t) => t.name);
}
