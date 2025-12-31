/**
 * Cloudflare MCP Integration for Pi Discord Bot
 * Connects to Cloudflare's remote MCP servers for browser rendering, radar insights, and docs
 *
 * Server Status & Requirements:
 * ┌─────────────────┬──────────┬─────────────────────────────────────────────────────────┐
 * │ Server          │ Status   │ Requirements                                            │
 * ├─────────────────┼──────────┼─────────────────────────────────────────────────────────┤
 * │ docs            │ ✅ WORKS │ Any valid Cloudflare API token                          │
 * │ browser         │ ❌ ERROR │ Workers project with Browser Rendering binding enabled  │
 * │ radar           │ ❌ ERROR │ Cloudflare Radar API access (enterprise feature)        │
 * │ bindings        │ ❓ N/A   │ Account-level API token with Workers permissions        │
 * │ observability   │ ❓ N/A   │ Account-level API token with Analytics permissions      │
 * └─────────────────┴──────────┴─────────────────────────────────────────────────────────┘
 *
 * Available Tools (docs server):
 * - search_cloudflare_documentation: Search Workers, Pages, R2, D1, AI docs
 * - migrate_pages_to_workers_guide: Get Pages to Workers migration guide
 *
 * Setup:
 * 1. Create API token at https://dash.cloudflare.com/profile/api-tokens
 * 2. Set CLOUDFLARE_API_TOKEN in .env
 *
 * Workers Limits (Paid):
 * - CPU Time: 5 min (HTTP), 15 min (Cron)
 * - Memory: 128 MB
 * - Subrequests: 1,000/request
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

// =============================================================================
// Configuration
// =============================================================================

const CF_MCP_SERVERS = {
	browser: "https://browser.mcp.cloudflare.com",
	radar: "https://radar.mcp.cloudflare.com",
	docs: "https://docs.mcp.cloudflare.com",
	bindings: "https://bindings.mcp.cloudflare.com",
	observability: "https://observability.mcp.cloudflare.com",
} as const;

// Get API token from environment
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

// =============================================================================
// MCP Client Helper
// =============================================================================

interface McpToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

interface McpResponse {
	content?: Array<{ type: string; text?: string }>;
	error?: { message: string };
}

/**
 * Call a Cloudflare MCP server tool
 */
async function callMcpTool(server: keyof typeof CF_MCP_SERVERS, tool: McpToolCall): Promise<McpResponse> {
	const baseUrl = CF_MCP_SERVERS[server];

	if (!CLOUDFLARE_API_TOKEN) {
		return {
			error: { message: "CLOUDFLARE_API_TOKEN not configured. Set it in .env" },
		};
	}

	try {
		// MCP uses JSON-RPC over HTTP with SSE support
		const response = await fetch(`${baseUrl}/mcp`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: Date.now(),
				method: "tools/call",
				params: {
					name: tool.name,
					arguments: tool.arguments,
				},
			}),
		});

		if (!response.ok) {
			const text = await response.text();
			return {
				error: { message: `HTTP ${response.status}: ${text.slice(0, 200)}` },
			};
		}

		// Handle SSE response format
		const text = await response.text();
		const contentType = response.headers.get("content-type") || "";

		if (contentType.includes("text/event-stream") || text.startsWith("event:")) {
			// Parse SSE: extract data from "data: {...}" lines
			const lines = text.split("\n");
			for (const line of lines) {
				if (line.startsWith("data:")) {
					const jsonStr = line.slice(5).trim();
					if (jsonStr) {
						try {
							const parsed = JSON.parse(jsonStr);
							return parsed.result || parsed;
						} catch {
							// Continue to next data line
						}
					}
				}
			}
			return { error: { message: "No valid JSON in SSE response" } };
		}

		// Regular JSON response
		const result = JSON.parse(text);
		return result.result || result;
	} catch (error) {
		return {
			error: { message: error instanceof Error ? error.message : String(error) },
		};
	}
}

/**
 * List available tools from a Cloudflare MCP server
 */
async function listMcpTools(server: keyof typeof CF_MCP_SERVERS): Promise<string[]> {
	const baseUrl = CF_MCP_SERVERS[server];

	if (!CLOUDFLARE_API_TOKEN) {
		return [];
	}

	try {
		const response = await fetch(`${baseUrl}/mcp`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: Date.now(),
				method: "tools/list",
			}),
		});

		if (!response.ok) return [];

		const result = await response.json();
		return (result.result?.tools || []).map((t: { name: string }) => t.name);
	} catch {
		return [];
	}
}

// =============================================================================
// Logging
// =============================================================================

function logCfTool(tool: string, message: string): void {
	const timestamp = new Date().toLocaleTimeString();
	console.log(`[${timestamp}] [CF:${tool}] ${message}`);
}

// =============================================================================
// Tool Schemas
// =============================================================================

const browserFetchSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	url: Type.String({ description: "URL to fetch and convert to markdown" }),
	screenshot: Type.Optional(Type.Boolean({ description: "Also take a screenshot (default: false)" })),
});

const radarScanSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	url: Type.String({ description: "URL to scan for security/content analysis" }),
});

const radarTrendsSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	metric: Type.Optional(
		Type.Union([Type.Literal("traffic"), Type.Literal("attacks"), Type.Literal("protocols"), Type.Literal("bots")]),
	),
	location: Type.Optional(Type.String({ description: "Country code (e.g., US, GB)" })),
});

const docsSearchSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	query: Type.String({ description: "Search query for Cloudflare documentation" }),
});

const workersDeploySchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	name: Type.String({ description: "Worker name" }),
	code: Type.String({ description: "Worker JavaScript/TypeScript code" }),
});

// =============================================================================
// Tool Implementations
// =============================================================================

/**
 * Cloudflare Browser Rendering - Fetch webpage and convert to markdown
 */
export function createCloudflareBrowserTool(): AgentTool<typeof browserFetchSchema> {
	return {
		name: "cloudflare_browser",
		label: "cloudflare_browser",
		description:
			"Fetch a webpage using Cloudflare's browser rendering and convert to markdown. Can also take screenshots. Bypasses bot detection.",
		parameters: browserFetchSchema,
		execute: async (_toolCallId, { label, url, screenshot }) => {
			logCfTool("browser", label);

			// Try fetch_url tool first
			const result = await callMcpTool("browser", {
				name: "fetch_url",
				arguments: { url, format: "markdown" },
			});

			if (result.error) {
				return {
					content: [{ type: "text", text: `Error: ${result.error.message}` }],
					details: undefined,
				};
			}

			let output = "";
			if (result.content) {
				for (const item of result.content) {
					if (item.type === "text" && item.text) {
						output += `${item.text}\n`;
					}
				}
			}

			// Take screenshot if requested
			if (screenshot) {
				const screenshotResult = await callMcpTool("browser", {
					name: "take_screenshot",
					arguments: { url },
				});

				if (!screenshotResult.error && screenshotResult.content) {
					output += "\n[Screenshot captured successfully]";
				}
			}

			return {
				content: [{ type: "text", text: output || "No content returned from browser rendering" }],
				details: undefined,
			};
		},
	};
}

/**
 * Cloudflare Radar URL Scan - Analyze URL for security/content
 */
export function createCloudflareRadarScanTool(): AgentTool<typeof radarScanSchema> {
	return {
		name: "cloudflare_radar_scan",
		label: "cloudflare_radar_scan",
		description:
			"Scan a URL using Cloudflare Radar for security analysis, content categorization, and threat detection.",
		parameters: radarScanSchema,
		execute: async (_toolCallId, { label, url }) => {
			logCfTool("radar_scan", label);

			const result = await callMcpTool("radar", {
				name: "url_scan",
				arguments: { url },
			});

			if (result.error) {
				return {
					content: [{ type: "text", text: `Error: ${result.error.message}` }],
					details: undefined,
				};
			}

			let output = `## Cloudflare Radar Scan: ${url}\n\n`;
			if (result.content) {
				for (const item of result.content) {
					if (item.type === "text" && item.text) {
						output += `${item.text}\n`;
					}
				}
			}

			return {
				content: [{ type: "text", text: output || "No scan results returned" }],
				details: undefined,
			};
		},
	};
}

/**
 * Cloudflare Radar Trends - Get global internet traffic insights
 */
export function createCloudflareRadarTrendsTool(): AgentTool<typeof radarTrendsSchema> {
	return {
		name: "cloudflare_radar_trends",
		label: "cloudflare_radar_trends",
		description:
			"Get global internet traffic trends from Cloudflare Radar - traffic patterns, attack trends, protocol usage, bot activity.",
		parameters: radarTrendsSchema,
		execute: async (_toolCallId, { label, metric = "traffic", location }) => {
			logCfTool("radar_trends", label);

			const args: Record<string, unknown> = { metric };
			if (location) args.location = location;

			const result = await callMcpTool("radar", {
				name: "get_trends",
				arguments: args,
			});

			if (result.error) {
				return {
					content: [{ type: "text", text: `Error: ${result.error.message}` }],
					details: undefined,
				};
			}

			let output = `## Cloudflare Radar ${metric} Trends${location ? ` (${location})` : ""}\n\n`;
			if (result.content) {
				for (const item of result.content) {
					if (item.type === "text" && item.text) {
						output += `${item.text}\n`;
					}
				}
			}

			return {
				content: [{ type: "text", text: output || "No trends data returned" }],
				details: undefined,
			};
		},
	};
}

/**
 * Cloudflare Documentation Search
 */
export function createCloudflareDocsTool(): AgentTool<typeof docsSearchSchema> {
	return {
		name: "cloudflare_docs",
		label: "cloudflare_docs",
		description: "Search Cloudflare documentation for Workers, Pages, R2, D1, AI, and other services.",
		parameters: docsSearchSchema,
		execute: async (_toolCallId, { label, query }) => {
			logCfTool("docs", label);

			const result = await callMcpTool("docs", {
				name: "search_cloudflare_documentation",
				arguments: { query },
			});

			if (result.error) {
				return {
					content: [{ type: "text", text: `Error: ${result.error.message}` }],
					details: undefined,
				};
			}

			let output = `## Cloudflare Docs: "${query}"\n\n`;
			if (result.content) {
				for (const item of result.content) {
					if (item.type === "text" && item.text) {
						output += `${item.text}\n`;
					}
				}
			}

			return {
				content: [{ type: "text", text: output || "No documentation found" }],
				details: undefined,
			};
		},
	};
}

/**
 * Cloudflare Workers Deploy - Deploy a Worker script
 */
export function createCloudflareWorkersTool(): AgentTool<typeof workersDeploySchema> {
	return {
		name: "cloudflare_workers_deploy",
		label: "cloudflare_workers_deploy",
		description: "Deploy a Cloudflare Worker script. Requires appropriate API permissions.",
		parameters: workersDeploySchema,
		execute: async (_toolCallId, { label, name, code }) => {
			logCfTool("workers_deploy", label);

			const result = await callMcpTool("bindings", {
				name: "deploy_worker",
				arguments: { name, script: code },
			});

			if (result.error) {
				return {
					content: [{ type: "text", text: `Error: ${result.error.message}` }],
					details: undefined,
				};
			}

			let output = `## Worker Deployed: ${name}\n\n`;
			if (result.content) {
				for (const item of result.content) {
					if (item.type === "text" && item.text) {
						output += `${item.text}\n`;
					}
				}
			}

			return {
				content: [{ type: "text", text: output || "Worker deployed successfully" }],
				details: undefined,
			};
		},
	};
}

// =============================================================================
// Export all Cloudflare tools
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAllCloudflareMcpTools(): AgentTool<any>[] {
	return [
		createCloudflareBrowserTool(),
		createCloudflareRadarScanTool(),
		createCloudflareRadarTrendsTool(),
		createCloudflareDocsTool(),
		createCloudflareWorkersTool(),
	];
}

/**
 * Check if Cloudflare MCP is configured
 */
export function isCloudflareConfigured(): boolean {
	return !!CLOUDFLARE_API_TOKEN;
}

/**
 * Get available tools from Cloudflare MCP servers
 */
export async function discoverCloudflareTools(): Promise<Record<string, string[]>> {
	const servers = Object.keys(CF_MCP_SERVERS) as Array<keyof typeof CF_MCP_SERVERS>;
	const result: Record<string, string[]> = {};

	for (const server of servers) {
		result[server] = await listMcpTools(server);
	}

	return result;
}

export default getAllCloudflareMcpTools;
