/**
 * MCP Server Configuration Loader
 * Loads MCP servers from config files and environment variables.
 *
 * Supports:
 * - Local config: ./mcp-config.json
 * - User config: ~/.claude/mcp_config.json
 * - Environment variable substitution
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

export interface McpServerConfig {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	type?: "http" | "sse" | "stdio";
	url?: string;
	headers?: Record<string, string>;
}

export interface McpConfig {
	mcpServers: Record<string, McpServerConfig>;
	skills?: {
		directories?: string[];
		enabled?: string[];
	};
}

/**
 * Substitute environment variables in a string.
 * Supports ${VAR} and $VAR syntax.
 */
function substituteEnvVars(value: string): string {
	return value
		.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || "")
		.replace(/\$(\w+)/g, (_, name) => process.env[name] || "")
		.replace(/\$\{HOME\}/g, homedir())
		.replace(/\$HOME/g, homedir());
}

/**
 * Deep substitute environment variables in an object.
 */
function substituteEnvVarsDeep<T>(obj: T): T {
	if (typeof obj === "string") {
		return substituteEnvVars(obj) as T;
	}
	if (Array.isArray(obj)) {
		return obj.map((item) => substituteEnvVarsDeep(item)) as T;
	}
	if (obj && typeof obj === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			result[key] = substituteEnvVarsDeep(value);
		}
		return result as T;
	}
	return obj;
}

/**
 * Load MCP config from a file path.
 */
function loadConfigFile(path: string): McpConfig | null {
	if (!existsSync(path)) {
		return null;
	}
	try {
		const content = readFileSync(path, "utf-8");
		const config = JSON.parse(content) as McpConfig;
		return substituteEnvVarsDeep(config);
	} catch (err) {
		console.error(`Failed to load MCP config from ${path}:`, err);
		return null;
	}
}

/**
 * Merge MCP configs, later configs override earlier ones.
 */
function mergeConfigs(...configs: (McpConfig | null)[]): McpConfig {
	const result: McpConfig = { mcpServers: {} };

	for (const config of configs) {
		if (!config) continue;

		// Merge servers
		for (const [name, server] of Object.entries(config.mcpServers || {})) {
			result.mcpServers[name] = server;
		}

		// Merge skills config
		if (config.skills) {
			result.skills = {
				directories: [...(result.skills?.directories || []), ...(config.skills.directories || [])],
				enabled: [...(result.skills?.enabled || []), ...(config.skills.enabled || [])],
			};
		}
	}

	return result;
}

/**
 * Load MCP configuration from all sources.
 * Priority: local config > user config
 */
export function loadMcpConfig(workspacePath?: string): McpConfig {
	const localConfigPath = workspacePath
		? join(workspacePath, "mcp-config.json")
		: resolve(process.cwd(), "mcp-config.json");

	const userConfigPath = join(homedir(), ".claude", "mcp_config.json");

	// Load in order of priority (later overrides earlier)
	const userConfig = loadConfigFile(userConfigPath);
	const localConfig = loadConfigFile(localConfigPath);

	const merged = mergeConfigs(userConfig, localConfig);

	console.log(`[MCP] Loaded ${Object.keys(merged.mcpServers).length} MCP servers`);

	return merged;
}

/**
 * Get list of MCP server names for Claude Code agent.
 */
export function getMcpServerNames(config: McpConfig): string[] {
	return Object.keys(config.mcpServers);
}

/**
 * Get MCP server command args for spawning.
 */
export function getMcpServerArgs(config: McpConfig, serverName: string): string[] {
	const server = config.mcpServers[serverName];
	if (!server) return [];

	if (server.type === "http" || server.type === "sse") {
		// HTTP/SSE servers are connected via URL
		return ["--mcp-url", server.url || ""];
	}

	// stdio servers need command and args
	const args: string[] = [];
	if (server.command) {
		args.push(server.command);
	}
	if (server.args) {
		args.push(...server.args);
	}
	return args;
}

/**
 * Format MCP servers for agent prompt.
 */
export function formatMcpServersForPrompt(config: McpConfig): string {
	const servers = Object.entries(config.mcpServers);
	if (servers.length === 0) return "";

	const lines = ["\n\n## Available MCP Servers\n", "The following MCP servers are available for tool execution:\n"];

	for (const [name, server] of servers) {
		const type = server.type || "stdio";
		lines.push(`- **${name}** (${type})`);
	}

	return lines.join("\n");
}

// Singleton instance
let globalConfig: McpConfig | null = null;

/**
 * Get global MCP config (cached).
 */
export function getGlobalMcpConfig(): McpConfig {
	if (!globalConfig) {
		globalConfig = loadMcpConfig();
	}
	return globalConfig;
}

/**
 * Reset global config (for testing).
 */
export function resetMcpConfig(): void {
	globalConfig = null;
}

/**
 * MCP Server Registry
 */
export const MCP_REGISTRY = {
	// Cloud/Deploy
	cloudflare: { category: "cloud", description: "Cloudflare Workers, Pages, D1, KV" },
	netlify: { category: "cloud", description: "Netlify sites, functions, deploy" },
	firebase: { category: "cloud", description: "Firebase/Firestore operations" },

	// Search/Web
	exa: { category: "search", description: "Web search, company research, deep research" },
	brightdata: { category: "search", description: "Web scraping, proxy, data collection" },

	// Browser
	playwright: { category: "browser", description: "Browser automation, testing" },
	puppeteer: { category: "browser", description: "Browser automation, screenshots" },

	// Project Management
	"taskmaster-ai": { category: "project", description: "Task planning and tracking" },
	linear: { category: "project", description: "Linear issue tracking" },

	// Code/Git
	github: { category: "code", description: "GitHub repos, issues, PRs" },
	gitlab: { category: "code", description: "GitLab repos, issues, MRs" },
	supabase: { category: "code", description: "Supabase database, auth, storage" },

	// AI/Memory
	memory: { category: "ai", description: "Persistent knowledge graph" },
	"sequential-thinking": { category: "ai", description: "Step-by-step reasoning" },
	context7: { category: "ai", description: "Context management" },

	// Hugging Face
	"hf-mcp-server": { category: "ai", description: "HuggingFace models, datasets, spaces" },

	// Payments
	stripe: { category: "payments", description: "Stripe payments, subscriptions" },

	// Filesystem
	filesystem: { category: "system", description: "File operations" },
} as const;

export type McpServerName = keyof typeof MCP_REGISTRY;
