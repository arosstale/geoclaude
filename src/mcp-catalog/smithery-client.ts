/**
 * SMITHERY MCP CLIENT
 * ====================
 * Dynamic connection to any Smithery-hosted MCP server
 *
 * All Smithery servers use OAuth and are accessible via:
 * https://server.smithery.ai/{server-path}/mcp
 *
 * This client enables on-demand tool execution without pre-loading all 13k tools.
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { getSmitheryCatalog, type MCPServer, type MCPTool } from "./progressive-discovery.js";

interface SmitheryToolResult {
	success: boolean;
	data?: unknown;
	error?: string;
}

interface SmitherySession {
	server: MCPServer;
	connected: boolean;
	lastUsed: Date;
}

class SmitheryClient {
	private sessions: Map<string, SmitherySession> = new Map();
	private apiKey?: string;

	constructor(apiKey?: string) {
		this.apiKey = apiKey || process.env.SMITHERY_API_KEY;
	}

	/**
	 * Connect to a Smithery MCP server
	 */
	async connect(serverName: string): Promise<SmitherySession> {
		const catalog = getSmitheryCatalog();
		const server = catalog.getServer(serverName);

		if (!server) {
			throw new Error(`Server "${serverName}" not found in Smithery catalog`);
		}

		const session: SmitherySession = {
			server,
			connected: true,
			lastUsed: new Date(),
		};

		this.sessions.set(serverName, session);
		return session;
	}

	/**
	 * Execute a tool on a Smithery server
	 */
	async executeTool(
		serverName: string,
		toolName: string,
		params: Record<string, unknown>,
	): Promise<SmitheryToolResult> {
		let session = this.sessions.get(serverName);

		if (!session) {
			session = await this.connect(serverName);
		}

		session.lastUsed = new Date();

		try {
			// Smithery uses JSON-RPC over HTTP with SSE responses
			const response = await fetch(session.server.connection_url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
					...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: Date.now(),
					method: "tools/call",
					params: {
						name: toolName,
						arguments: params,
					},
				}),
			});

			if (!response.ok) {
				return {
					success: false,
					error: `HTTP ${response.status}: ${response.statusText}`,
				};
			}

			const contentType = response.headers.get("content-type") || "";
			const text = await response.text();

			// Handle SSE response format
			if (contentType.includes("text/event-stream") || text.startsWith("event:")) {
				const lines = text.split("\n");
				for (const line of lines) {
					if (line.startsWith("data:")) {
						const jsonStr = line.slice(5).trim();
						if (jsonStr) {
							try {
								const parsed = JSON.parse(jsonStr);
								return {
									success: true,
									data: parsed.result || parsed,
								};
							} catch {
								// Continue to next line
							}
						}
					}
				}
				return { success: false, error: "No valid data in SSE response" };
			}

			// Handle regular JSON response
			const result = JSON.parse(text);
			return {
				success: true,
				data: result.result || result,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * List tools available on a server
	 */
	async listTools(serverName: string): Promise<MCPTool[]> {
		const catalog = getSmitheryCatalog();
		const server = catalog.getServer(serverName);
		return server?.tools || [];
	}

	/**
	 * Get active sessions
	 */
	getActiveSessions(): SmitherySession[] {
		return Array.from(this.sessions.values());
	}

	/**
	 * Disconnect from a server
	 */
	disconnect(serverName: string): void {
		this.sessions.delete(serverName);
	}

	/**
	 * Disconnect all
	 */
	disconnectAll(): void {
		this.sessions.clear();
	}
}

// Singleton
let clientInstance: SmitheryClient | null = null;

export function getSmitheryClient(): SmitheryClient {
	if (!clientInstance) {
		clientInstance = new SmitheryClient();
	}
	return clientInstance;
}

// Schema for smithery execute tool
const smitheryExecuteSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	serverName: Type.String({ description: "MCP server name from discover_mcp_servers" }),
	toolName: Type.String({ description: "Tool name to execute on the server" }),
	toolParams: Type.String({ description: "JSON string of parameters for the tool" }),
});

/**
 * Create dynamic Smithery tool execution tool
 */
export function createSmitheryExecuteTool(): AgentTool<typeof smitheryExecuteSchema> {
	return {
		name: "smithery_execute",
		label: "smithery_execute",
		description: `Execute any tool from a Smithery MCP server.
First use discover_mcp_servers to find relevant servers, then use this to execute their tools.
Requires: serverName, toolName, and toolParams (JSON string).`,
		parameters: smitheryExecuteSchema,
		execute: async (_toolCallId, { serverName, toolName, toolParams, label }) => {
			console.log(`[MCP:SmitheryExecute] ${label}`);
			const client = getSmitheryClient();

			try {
				const parsedParams = typeof toolParams === "string" ? JSON.parse(toolParams) : toolParams;
				const result = await client.executeTool(serverName, toolName, parsedParams);

				if (result.success) {
					return {
						content: [
							{
								type: "text" as const,
								text: `## Smithery Tool Executed: ${toolName}\n\n\`\`\`json\n${JSON.stringify(result.data, null, 2)}\n\`\`\``,
							},
						],
						details: undefined,
					};
				} else {
					return {
						content: [
							{
								type: "text" as const,
								text: `## Error executing ${toolName}\n\n${result.error}`,
							},
						],
						details: undefined,
					};
				}
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `## Connection Error\n\n${error instanceof Error ? error.message : "Unknown error"}`,
						},
					],
					details: undefined,
				};
			}
		},
	};
}

export default {
	getSmitheryClient,
	createSmitheryExecuteTool,
};
