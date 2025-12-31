/**
 * Agent Mail MCP Server
 *
 * Exposes the agent messaging system via MCP protocol for external tool integration.
 * Compatible with MCP Agent Mail patterns while maintaining local-first architecture.
 *
 * Tools exposed:
 * - send_message: Send email-like message
 * - reply: Reply to thread
 * - get_inbox: Get inbox messages
 * - list_threads: List message threads
 * - get_thread: Get specific thread
 * - search_messages: Search messages
 * - request_contact: Request cross-project contact
 * - reserve_file: Reserve file for exclusive access
 * - release_file: Release file reservation
 *
 * Usage:
 *   Add to MCP configuration with stdio transport
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getAgentMessageBus, type MessageImportance } from "./agent-messaging.js";
import { getFileReservationManager } from "./file-reservations.js";

// Tool definitions
const TOOLS = [
	{
		name: "send_message",
		description: "Send an email-like message to one or more agents with subject, threading, and importance levels",
		inputSchema: {
			type: "object",
			properties: {
				to: {
					type: "array",
					items: { type: "string" },
					description: "Primary recipient agent IDs",
				},
				cc: {
					type: "array",
					items: { type: "string" },
					description: "CC recipient agent IDs (optional)",
				},
				subject: {
					type: "string",
					description: "Message subject line",
				},
				content: {
					type: "string",
					description: "Message body content",
				},
				thread_id: {
					type: "string",
					description: "Thread ID to continue existing conversation (optional)",
				},
				importance: {
					type: "string",
					enum: ["low", "normal", "high", "urgent"],
					description: "Message importance level (default: normal)",
				},
				ack_required: {
					type: "boolean",
					description: "Whether recipients must acknowledge (default: false)",
				},
				project_id: {
					type: "string",
					description: "Associated project ID (optional)",
				},
			},
			required: ["to", "subject", "content"],
		},
	},
	{
		name: "reply",
		description: "Reply to an existing message thread. Automatically includes original participants.",
		inputSchema: {
			type: "object",
			properties: {
				thread_id: {
					type: "string",
					description: "ID of the thread to reply to",
				},
				content: {
					type: "string",
					description: "Reply content",
				},
				importance: {
					type: "string",
					enum: ["low", "normal", "high", "urgent"],
					description: "Message importance (default: normal)",
				},
			},
			required: ["thread_id", "content"],
		},
	},
	{
		name: "get_inbox",
		description: "Get inbox messages sorted by importance then timestamp",
		inputSchema: {
			type: "object",
			properties: {
				unread_only: {
					type: "boolean",
					description: "Only show unread messages (default: false)",
				},
				importance: {
					type: "string",
					enum: ["low", "normal", "high", "urgent"],
					description: "Filter by importance level (optional)",
				},
				limit: {
					type: "number",
					description: "Maximum messages to return (default: 50)",
				},
			},
		},
	},
	{
		name: "list_threads",
		description: "List all message threads the current agent is participating in",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "get_thread",
		description: "Get all messages in a specific thread",
		inputSchema: {
			type: "object",
			properties: {
				thread_id: {
					type: "string",
					description: "Thread ID to retrieve",
				},
			},
			required: ["thread_id"],
		},
	},
	{
		name: "search_messages",
		description: "Search messages by content or subject",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Search query (searches subject and content)",
				},
				thread_id: {
					type: "string",
					description: "Limit search to specific thread (optional)",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "acknowledge",
		description: "Acknowledge receipt of a message",
		inputSchema: {
			type: "object",
			properties: {
				message_id: {
					type: "string",
					description: "ID of the message to acknowledge",
				},
			},
			required: ["message_id"],
		},
	},
	{
		name: "mark_read",
		description: "Mark a message as read",
		inputSchema: {
			type: "object",
			properties: {
				message_id: {
					type: "string",
					description: "ID of the message to mark as read",
				},
			},
			required: ["message_id"],
		},
	},
	{
		name: "request_contact",
		description: "Request permission to contact an agent from another project",
		inputSchema: {
			type: "object",
			properties: {
				target_agent: {
					type: "string",
					description: "Agent ID to request contact with",
				},
				target_project: {
					type: "string",
					description: "Project ID the target agent belongs to",
				},
				reason: {
					type: "string",
					description: "Reason for contact request",
				},
			},
			required: ["target_agent", "target_project", "reason"],
		},
	},
	{
		name: "list_agents",
		description: "List all registered agents and their status",
		inputSchema: {
			type: "object",
			properties: {
				online_only: {
					type: "boolean",
					description: "Only show online agents (default: false)",
				},
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Filter by tags (optional)",
				},
			},
		},
	},
	{
		name: "reserve_file",
		description: "Reserve a file for exclusive or shared access. Prevents conflicts in multi-agent scenarios.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "File path or glob pattern to reserve",
				},
				mode: {
					type: "string",
					enum: ["exclusive", "shared"],
					description: "Reservation mode (default: exclusive)",
				},
				ttl_minutes: {
					type: "number",
					description: "Time-to-live in minutes (default: 30)",
				},
				reason: {
					type: "string",
					description: "Reason for reservation (optional)",
				},
			},
			required: ["path"],
		},
	},
	{
		name: "release_file",
		description: "Release a file reservation",
		inputSchema: {
			type: "object",
			properties: {
				reservation_id: {
					type: "string",
					description: "Reservation ID to release",
				},
			},
			required: ["reservation_id"],
		},
	},
	{
		name: "list_reservations",
		description: "List all active file reservations",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Filter by path (optional)",
				},
			},
		},
	},
];

export interface AgentMailMCPOptions {
	agentId: string;
	projectId?: string;
	dataDir?: string;
	enableGitPersistence?: boolean;
}

/**
 * Create and run the Agent Mail MCP Server
 */
export async function createAgentMailMCPServer(options: AgentMailMCPOptions): Promise<Server> {
	const { agentId, projectId = "default", dataDir, enableGitPersistence = false } = options;

	// Initialize services
	const bus = getAgentMessageBus(dataDir);
	const reservations = getFileReservationManager(dataDir);

	if (enableGitPersistence) {
		bus.enableGitPersistence();
	}

	// Create MCP server
	const server = new Server(
		{
			name: "agent-mail",
			version: "1.0.0",
		},
		{
			capabilities: {
				tools: {},
			},
		},
	);

	// List tools handler
	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: TOOLS,
	}));

	// Call tool handler
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args = {} } = request.params;

		try {
			switch (name) {
				case "send_message": {
					const result = await bus.sendEnhanced({
						from: agentId,
						to: args.to as string[],
						cc: args.cc as string[] | undefined,
						subject: args.subject as string,
						content: args.content as string,
						threadId: args.thread_id as string | undefined,
						importance: args.importance as MessageImportance | undefined,
						ackRequired: args.ack_required as boolean | undefined,
						projectId: args.project_id as string | undefined,
					});
					return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
				}

				case "reply": {
					const result = await bus.reply({
						from: agentId,
						threadId: args.thread_id as string,
						content: args.content as string,
						importance: args.importance as MessageImportance | undefined,
					});
					return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
				}

				case "get_inbox": {
					const messages = bus.getInbox(agentId, {
						unreadOnly: args.unread_only as boolean | undefined,
						importance: args.importance as MessageImportance | undefined,
						limit: args.limit as number | undefined,
					});
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										count: messages.length,
										messages: messages.map((m) => ({
											id: m.id,
											from: m.from,
											subject: m.subject,
											importance: m.importance,
											threadId: m.threadId,
											timestamp: m.timestamp,
											preview: m.content.substring(0, 100),
										})),
									},
									null,
									2,
								),
							},
						],
					};
				}

				case "list_threads": {
					const threads = bus.listThreads(agentId);
					return {
						content: [{ type: "text", text: JSON.stringify({ count: threads.length, threads }, null, 2) }],
					};
				}

				case "get_thread": {
					const messages = bus.getThread(args.thread_id as string);
					const summary = bus.getThreadSummary(args.thread_id as string);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({ summary, messages }, null, 2),
							},
						],
					};
				}

				case "search_messages": {
					const messages = bus.searchMessages(args.query as string, {
						agentId,
						threadId: args.thread_id as string | undefined,
					});
					return {
						content: [{ type: "text", text: JSON.stringify({ count: messages.length, messages }, null, 2) }],
					};
				}

				case "acknowledge": {
					const success = bus.acknowledge(args.message_id as string, agentId);
					return { content: [{ type: "text", text: JSON.stringify({ success }) }] };
				}

				case "mark_read": {
					const success = bus.markRead(args.message_id as string, agentId);
					return { content: [{ type: "text", text: JSON.stringify({ success }) }] };
				}

				case "request_contact": {
					const result = bus.requestContact(
						agentId,
						projectId,
						args.target_agent as string,
						args.target_project as string,
						args.reason as string,
					);
					return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
				}

				case "list_agents": {
					let agents = bus.getAgents();
					if (args.online_only) {
						agents = agents.filter((a) => a.status === "online");
					}
					if (args.tags && Array.isArray(args.tags)) {
						agents = bus.findAgentsByTags(args.tags as string[], false);
					}
					return { content: [{ type: "text", text: JSON.stringify({ count: agents.length, agents }, null, 2) }] };
				}

				case "reserve_file": {
					const exclusive = args.mode !== "shared";
					const result = reservations.reserve(
						agentId,
						agentId, // agentName same as agentId for MCP context
						projectId,
						args.path as string,
						{
							exclusive,
							ttlMinutes: (args.ttl_minutes as number) || 30,
							reason: args.reason as string | undefined,
						},
					);
					return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
				}

				case "release_file": {
					const success = reservations.release(args.reservation_id as string, agentId);
					return {
						content: [{ type: "text", text: JSON.stringify({ success, reservationId: args.reservation_id }) }],
					};
				}

				case "list_reservations": {
					const active = reservations.getActiveReservations({
						pathPattern: args.path as string | undefined,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify({ count: active.length, reservations: active }, null, 2) },
						],
					};
				}

				default:
					return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
			}
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
				isError: true,
			};
		}
	});

	return server;
}

/**
 * Run the Agent Mail MCP Server with stdio transport
 */
export async function runAgentMailMCPServer(options: AgentMailMCPOptions): Promise<void> {
	const server = await createAgentMailMCPServer(options);
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("[Agent Mail MCP] Server running on stdio");
}

// CLI entry point
if (process.argv[1]?.endsWith("agent-mail-mcp.ts") || process.argv[1]?.endsWith("agent-mail-mcp.js")) {
	const agentId = process.env.AGENT_ID || "mcp-agent";
	const projectId = process.env.PROJECT_ID || "default";
	const dataDir = process.env.DATA_DIR;
	const enableGit = process.env.ENABLE_GIT === "true";

	runAgentMailMCPServer({
		agentId,
		projectId,
		dataDir,
		enableGitPersistence: enableGit,
	}).catch((error) => {
		console.error("[Agent Mail MCP] Fatal error:", error);
		process.exit(1);
	});
}
