/**
 * PROGRESSIVE TOOL DISCOVERY
 * ===========================
 * Inspired by Arseny Shatokhin's "2000 Tools" experiment
 *
 * Instead of loading all 13,000+ tools, this system:
 * 1. Searches the Smithery catalog by natural language query
 * 2. Returns relevant MCP servers with their tools
 * 3. Enables on-demand connection to discovered servers
 *
 * "The agent discovers which servers it needs based on the task"
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface MCPTool {
	name: string;
	description: string;
	inputSchema?: Record<string, unknown>;
}

export interface MCPServer {
	server_name: string;
	server_url: string;
	connection_url: string;
	homepage?: string;
	source_code?: string;
	authentication_method: string;
	description: string;
	total_tools: number;
	tools: MCPTool[];
}

export interface DiscoveryResult {
	server: MCPServer;
	relevanceScore: number;
	matchedKeywords: string[];
}

// Categories for quick filtering
export const SERVER_CATEGORIES = {
	crypto: [
		"crypto",
		"bitcoin",
		"ethereum",
		"defi",
		"blockchain",
		"token",
		"wallet",
		"dex",
		"trading",
		"coinmarketcap",
		"binance",
	],
	finance: ["stock", "market", "trading", "finance", "investment", "portfolio", "forex", "equity"],
	productivity: ["notion", "calendar", "gmail", "email", "task", "todo", "schedule", "project"],
	communication: ["slack", "discord", "telegram", "message", "chat", "email", "sms"],
	development: ["github", "git", "code", "api", "developer", "programming", "debug"],
	ai: ["ai", "llm", "machine learning", "openai", "anthropic", "model"],
	search: ["search", "web", "browse", "scrape", "crawl"],
	database: ["database", "sql", "postgres", "mysql", "mongo", "redis"],
	cloud: ["aws", "azure", "gcp", "cloud", "kubernetes", "docker"],
} as const;

class SmitheryCatalog {
	private servers: MCPServer[] = [];
	private loaded = false;
	private catalogPath: string;

	constructor() {
		this.catalogPath = join(__dirname, "smithery-servers.json");
	}

	/**
	 * Load the catalog lazily on first use
	 */
	private ensureLoaded(): void {
		if (this.loaded) return;

		if (!existsSync(this.catalogPath)) {
			console.warn(`Smithery catalog not found at ${this.catalogPath}. Run fetch to download.`);
			this.servers = [];
			this.loaded = true;
			return;
		}

		try {
			const data = readFileSync(this.catalogPath, "utf-8");
			this.servers = JSON.parse(data);
			this.loaded = true;
			console.log(`Loaded ${this.servers.length} MCP servers with ${this.getTotalTools()} tools`);
		} catch (error) {
			console.error("Failed to load Smithery catalog:", error);
			this.servers = [];
			this.loaded = true;
		}
	}

	/**
	 * Get total tool count
	 */
	getTotalTools(): number {
		return this.servers.reduce((sum, s) => sum + (s.total_tools || 0), 0);
	}

	/**
	 * Search for relevant MCP servers by query
	 */
	discover(
		query: string,
		options: {
			limit?: number;
			category?: keyof typeof SERVER_CATEGORIES;
			minTools?: number;
		} = {},
	): DiscoveryResult[] {
		this.ensureLoaded();

		const { limit = 10, category, minTools = 1 } = options;
		const queryLower = query.toLowerCase();
		const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);

		// Get category keywords if specified
		const categoryKeywords = category ? SERVER_CATEGORIES[category] : [];

		const results: DiscoveryResult[] = [];

		for (const server of this.servers) {
			if (server.total_tools < minTools) continue;

			const searchText =
				`${server.server_name} ${server.description} ${server.tools.map((t) => `${t.name} ${t.description}`).join(" ")}`.toLowerCase();

			// Calculate relevance score
			let score = 0;
			const matchedKeywords: string[] = [];

			// Query word matching
			for (const word of queryWords) {
				if (searchText.includes(word)) {
					score += 10;
					matchedKeywords.push(word);
				}
			}

			// Exact phrase matching (higher weight)
			if (searchText.includes(queryLower)) {
				score += 50;
			}

			// Category matching
			if (categoryKeywords.length > 0) {
				for (const keyword of categoryKeywords) {
					if (searchText.includes(keyword)) {
						score += 5;
						if (!matchedKeywords.includes(keyword)) {
							matchedKeywords.push(keyword);
						}
					}
				}
			}

			// Tool count bonus (more tools = more capable)
			score += Math.min(server.total_tools * 0.5, 25);

			// Name match bonus
			if (server.server_name.toLowerCase().includes(queryLower)) {
				score += 30;
			}

			if (score > 0) {
				results.push({
					server,
					relevanceScore: score,
					matchedKeywords,
				});
			}
		}

		// Sort by relevance and return top results
		return results.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, limit);
	}

	/**
	 * Get servers by category
	 */
	getByCategory(category: keyof typeof SERVER_CATEGORIES, limit = 20): MCPServer[] {
		this.ensureLoaded();

		const keywords = SERVER_CATEGORIES[category];
		const results: { server: MCPServer; score: number }[] = [];

		for (const server of this.servers) {
			const searchText = `${server.server_name} ${server.description}`.toLowerCase();
			let score = 0;

			for (const keyword of keywords) {
				if (searchText.includes(keyword)) {
					score += 1;
				}
			}

			if (score > 0) {
				results.push({ server, score });
			}
		}

		return results
			.sort((a, b) => b.score - a.score)
			.slice(0, limit)
			.map((r) => r.server);
	}

	/**
	 * Get a specific server by name
	 */
	getServer(name: string): MCPServer | undefined {
		this.ensureLoaded();
		return this.servers.find((s) => s.server_name.toLowerCase() === name.toLowerCase());
	}

	/**
	 * Get all servers (use sparingly - large dataset)
	 */
	getAllServers(): MCPServer[] {
		this.ensureLoaded();
		return this.servers;
	}

	/**
	 * Get catalog statistics
	 */
	getStats(): {
		totalServers: number;
		totalTools: number;
		byCategory: Record<string, number>;
	} {
		this.ensureLoaded();

		const byCategory: Record<string, number> = {};

		for (const category of Object.keys(SERVER_CATEGORIES) as Array<keyof typeof SERVER_CATEGORIES>) {
			byCategory[category] = this.getByCategory(category, 1000).length;
		}

		return {
			totalServers: this.servers.length,
			totalTools: this.getTotalTools(),
			byCategory,
		};
	}
}

// Singleton instance
let catalogInstance: SmitheryCatalog | null = null;

export function getSmitheryCatalog(): SmitheryCatalog {
	if (!catalogInstance) {
		catalogInstance = new SmitheryCatalog();
	}
	return catalogInstance;
}

// Schemas for discovery tools
const discoverySchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	query: Type.String({ description: "Search query (e.g., 'crypto prices', 'email automation')" }),
	category: Type.Optional(
		Type.String({
			description:
				"Category: crypto, finance, productivity, communication, development, ai, search, database, cloud",
		}),
	),
	limit: Type.Optional(Type.Number({ description: "Max results (default 5)" })),
});

const noParamsSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
});

/**
 * Create MCP tool for progressive discovery
 */
export function createDiscoveryTool(): AgentTool<typeof discoverySchema> {
	return {
		name: "discover_mcp_servers",
		label: "discover_mcp_servers",
		description: `Search the Smithery catalog of 927 MCP servers with 13,000+ tools.
Use this to find relevant tools for any task before executing.
Categories: crypto, finance, productivity, communication, development, ai, search, database, cloud.
Returns server names, descriptions, connection URLs, and available tools.`,
		parameters: discoverySchema,
		execute: async (_toolCallId, { query, category, limit = 5, label }) => {
			console.log(`[MCP:Discovery] ${label}`);
			const catalog = getSmitheryCatalog();
			const results = catalog.discover(query, {
				limit,
				category: category as keyof typeof SERVER_CATEGORIES,
			});

			if (results.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No MCP servers found matching "${query}". Try broader keywords or a different category.`,
						},
					],
					details: undefined,
				};
			}

			const formatted = results
				.map((r, i) => {
					const tools = r.server.tools
						.slice(0, 3)
						.map((t) => `    - ${t.name}`)
						.join("\n");
					return `${i + 1}. **${r.server.server_name}** (${r.server.total_tools} tools)
   Score: ${r.relevanceScore.toFixed(1)} | Keywords: ${r.matchedKeywords.join(", ")}
   ${r.server.description.slice(0, 150)}...
   Connection: ${r.server.connection_url}
   Top tools:
${tools}`;
				})
				.join("\n\n");

			return {
				content: [
					{
						type: "text" as const,
						text: `## Discovered ${results.length} MCP Servers\n\n${formatted}`,
					},
				],
				details: undefined,
			};
		},
	};
}

/**
 * Create MCP tool for catalog stats
 */
export function createCatalogStatsTool(): AgentTool<typeof noParamsSchema> {
	return {
		name: "mcp_catalog_stats",
		label: "mcp_catalog_stats",
		description: "Get statistics about the Smithery MCP catalog - total servers, tools, and breakdown by category.",
		parameters: noParamsSchema,
		execute: async (_toolCallId, { label }) => {
			console.log(`[MCP:CatalogStats] ${label}`);
			const catalog = getSmitheryCatalog();
			const stats = catalog.getStats();

			const categoryBreakdown = Object.entries(stats.byCategory)
				.map(([cat, count]) => `  ${cat}: ${count} servers`)
				.join("\n");

			return {
				content: [
					{
						type: "text" as const,
						text: `## Smithery MCP Catalog Statistics

**Total Servers:** ${stats.totalServers}
**Total Tools:** ${stats.totalTools}

### By Category:
${categoryBreakdown}`,
					},
				],
				details: undefined,
			};
		},
	};
}

export default {
	getSmitheryCatalog,
	createDiscoveryTool,
	createCatalogStatsTool,
	SERVER_CATEGORIES,
};
