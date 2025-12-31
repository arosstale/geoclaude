/**
 * MCP Tools - Lazy Loading Category System
 * Organizes 89+ tools into logical categories with on-demand loading
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import { getAllCloudflareMcpTools, isCloudflareConfigured } from "../cloudflare-mcp.js";
import {
	createCatalogStatsTool,
	createDiscoveryTool,
	createDistillationTools,
	createSmitheryExecuteTool,
	getAllCryptoTools,
} from "../mcp-catalog/index.js";

// =============================================================================
// Core Tools (Always Loaded - Discovery & Catalog)
// =============================================================================

export function getCoreMcpTools(): AgentTool<any>[] {
	return [
		// MCP Catalog - Progressive Discovery (927 servers, 13k+ tools)
		createDiscoveryTool(),
		createCatalogStatsTool(),
		createSmitheryExecuteTool(),

		// Crypto MCP Servers (CoinMarketCap, Binance, DexScreener, Chainlink, FMP)
		...getAllCryptoTools(),

		// Skill Distillation - Auto-save workflows (10x token savings)
		...createDistillationTools(),

		// Cloudflare MCP Integration (if configured)
		...(isCloudflareConfigured() ? getAllCloudflareMcpTools() : []),
	];
}

// =============================================================================
// Tool Categories - Lazy Loading with Trigger Keywords
// =============================================================================

export interface ToolCategory {
	name: string;
	description: string;
	keywords: string[];
	load: () => Promise<AgentTool<any>[]>;
}

export const MCP_TOOL_CATEGORIES: Record<string, ToolCategory> = {
	"web-search": {
		name: "Web Search & Research",
		description: "Web search, research, and scraping tools (Exa, DuckDuckGo)",
		keywords: ["search", "web", "research", "scrape", "crawl", "url", "website", "duckduckgo", "exa"],
		load: async () => {
			const module = await import("./categories/web-search.js");
			return module.getAllWebSearchTools();
		},
	},

	github: {
		name: "GitHub Integration",
		description: "GitHub repositories, issues, PRs, files, branches",
		keywords: ["github", "repo", "repository", "issue", "pull request", "pr", "branch", "commit", "code"],
		load: async () => {
			const module = await import("./categories/github.js");
			return module.getAllGitHubTools();
		},
	},

	memory: {
		name: "Memory & Knowledge Graph",
		description: "Memory storage, recall, relationships, and knowledge graph",
		keywords: ["memory", "remember", "recall", "forget", "knowledge", "entity", "relation", "graph", "observation"],
		load: async () => {
			const module = await import("./categories/memory.js");
			return module.getAllMemoryTools();
		},
	},

	tasks: {
		name: "Task Management",
		description: "Create, list, update, and schedule tasks",
		keywords: ["task", "todo", "schedule", "scheduled", "reminder", "cron", "deadline"],
		load: async () => {
			const module = await import("./categories/tasks.js");
			return module.getAllTaskTools();
		},
	},

	knowledge: {
		name: "Knowledge & Codebase",
		description: "Codebase analysis, knowledge search, RAG, skills",
		keywords: ["codebase", "knowledge", "rag", "skill", "piMono", "read", "list", "analyze", "documentation"],
		load: async () => {
			const module = await import("./categories/knowledge.js");
			return module.getAllKnowledgeTools();
		},
	},

	admin: {
		name: "Administration & Management",
		description: "Agent management, context, hooks, plugins, slash commands",
		keywords: [
			"agent",
			"spawn",
			"delegate",
			"context",
			"compact",
			"hook",
			"plugin",
			"slash",
			"command",
			"server",
			"sync",
			"backup",
		],
		load: async () => {
			const module = await import("./categories/admin.js");
			return module.getAllAdminTools();
		},
	},

	voice: {
		name: "Voice & Audio",
		description: "TTS, STT, transcription, voice channels, audio effects",
		keywords: ["voice", "tts", "stt", "transcribe", "audio", "speak", "listen", "elevenlabs", "vibevoice", "music"],
		load: async () => {
			const module = await import("./categories/voice.js");
			return module.getAllVoiceTools();
		},
	},

	media: {
		name: "Media Generation",
		description: "Image, video, music, 3D generation and manipulation",
		keywords: [
			"image",
			"video",
			"music",
			"3d",
			"generate",
			"fal",
			"suno",
			"luma",
			"mubert",
			"gemini",
			"inpaint",
			"upscale",
			"gif",
		],
		load: async () => {
			const module = await import("./categories/media.js");
			return module.getAllMediaTools();
		},
	},

	integrations: {
		name: "External Integrations",
		description: "Twitter, YouTube, Telegram, LiveKit, HuggingFace",
		keywords: ["twitter", "youtube", "telegram", "livekit", "huggingface", "hf", "social", "platform", "bridge"],
		load: async () => {
			const module = await import("./categories/integrations.js");
			return module.getAllIntegrationTools();
		},
	},

	sandbox: {
		name: "Code Execution & Sandboxes",
		description: "Docker, Python, code sandbox, file processing",
		keywords: ["sandbox", "docker", "python", "code", "execute", "run", "compile", "container"],
		load: async () => {
			const module = await import("./categories/sandbox.js");
			return module.getAllSandboxTools();
		},
	},

	utilities: {
		name: "Utilities & Misc",
		description: "User prefs, exports, embeds, persona, threading, auto-learn",
		keywords: [
			"preference",
			"export",
			"embed",
			"persona",
			"thread",
			"threading",
			"learn",
			"autolearn",
			"api",
			"usage",
		],
		load: async () => {
			const module = await import("./categories/utilities.js");
			return module.getAllUtilityTools();
		},
	},
};

// =============================================================================
// Category Loading
// =============================================================================

const loadedCategories = new Map<string, AgentTool<any>[]>();

/**
 * Load a specific tool category
 */
export async function loadCategory(categoryName: string): Promise<AgentTool<any>[]> {
	// Check cache first
	if (loadedCategories.has(categoryName)) {
		return loadedCategories.get(categoryName)!;
	}

	const category = MCP_TOOL_CATEGORIES[categoryName];
	if (!category) {
		throw new Error(`Unknown category: ${categoryName}`);
	}

	// Load and cache
	const tools = await category.load();
	loadedCategories.set(categoryName, tools);
	return tools;
}

/**
 * Load multiple categories at once
 */
export async function loadCategories(categoryNames: string[]): Promise<AgentTool<any>[]> {
	const toolArrays = await Promise.all(categoryNames.map((name) => loadCategory(name)));
	return toolArrays.flat();
}

/**
 * Load all tool categories
 */
export async function loadAllCategories(): Promise<AgentTool<any>[]> {
	const categoryNames = Object.keys(MCP_TOOL_CATEGORIES);
	return loadCategories(categoryNames);
}

/**
 * Get all MCP tools (core + all categories)
 * For backward compatibility with original getAllMcpTools()
 */
export async function getAllMcpToolsAsync(): Promise<AgentTool<any>[]> {
	const core = getCoreMcpTools();
	const allCategories = await loadAllCategories();
	return [...core, ...allCategories];
}

/**
 * Get all MCP tools synchronously (imports from original file)
 * This maintains full backward compatibility
 */
export { getAllMcpTools } from "../mcp-tools.js";

/**
 * Detect relevant categories based on message content
 */
export function detectCategories(message: string): string[] {
	const lowerMessage = message.toLowerCase();
	const detected: string[] = [];

	for (const [categoryName, category] of Object.entries(MCP_TOOL_CATEGORIES)) {
		for (const keyword of category.keywords) {
			if (lowerMessage.includes(keyword)) {
				detected.push(categoryName);
				break; // Only add category once
			}
		}
	}

	return detected;
}

/**
 * Get tools based on message context (smart loading)
 */
export async function getRelevantTools(message: string): Promise<AgentTool<any>[]> {
	const core = getCoreMcpTools();
	const categories = detectCategories(message);

	if (categories.length === 0) {
		// No specific categories detected - load all
		const allCategories = await loadAllCategories();
		return [...core, ...allCategories];
	}

	// Load only detected categories
	const categoryTools = await loadCategories(categories);
	return [...core, ...categoryTools];
}

/**
 * Clear category cache (useful for testing/development)
 */
export function clearCategoryCache(): void {
	loadedCategories.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { loaded: number; total: number; categories: string[] } {
	return {
		loaded: loadedCategories.size,
		total: Object.keys(MCP_TOOL_CATEGORIES).length,
		categories: Array.from(loadedCategories.keys()),
	};
}
