/**
 * Agent-to-Agent Messaging System
 *
 * Enables multi-agent coordination with async/sync messaging patterns.
 * Superior to Letta: Integrated with cross-platform hub, no external API.
 *
 * Enhanced with MCP Agent Mail patterns:
 * - Email-like semantics (subject, threading, importance, ack)
 * - To/Cc/Bcc recipients
 * - Attachments with hash-based deduplication
 * - Contact policy enforcement
 * - Thread summarization
 * - Git-based audit trail (optional)
 *
 * Features:
 * - Asynchronous messaging (fire-and-forget)
 * - Synchronous messaging (wait for response)
 * - Broadcast to tagged agents
 * - Message queue with persistence
 * - Agent discovery by tags
 */

import { EventEmitter } from "events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..", "..");

const DEFAULT_DATA_DIR = join(packageRoot, "data");

// ============================================================================
// Types
// ============================================================================

export interface AgentMessage {
	id: string;
	from: string;
	to: string;
	content: string;
	timestamp: string;
	replyTo?: string;
	metadata?: Record<string, unknown>;
}

// ============================================================================
// Enhanced Email-Like Types (MCP Agent Mail patterns)
// ============================================================================

export type MessageImportance = "low" | "normal" | "high" | "urgent";
export type RecipientType = "to" | "cc" | "bcc";
export type ContactPolicy = "open" | "auto" | "contacts_only" | "block_all";

export interface MessageRecipient {
	agentId: string;
	type: RecipientType;
	readAt?: string;
	ackAt?: string;
}

export interface MessageAttachment {
	id: string;
	filename: string;
	contentType: string;
	size: number;
	hash: string; // SHA-256 for deduplication
	url?: string; // Local path or URL
}

export interface EnhancedAgentMessage extends AgentMessage {
	subject: string;
	threadId?: string;
	importance: MessageImportance;
	ackRequired: boolean;
	recipients: MessageRecipient[];
	attachments: MessageAttachment[];
	projectId?: string;
	isHumanOverseer?: boolean; // High-priority from human
}

export interface ThreadSummary {
	threadId: string;
	subject: string;
	participants: string[];
	messageCount: number;
	lastMessage: string;
	summary?: string;
	keyDecisions?: string[];
}

export interface ContactRequest {
	id: string;
	fromAgentId: string;
	fromProjectId: string;
	toAgentId: string;
	toProjectId: string;
	status: "pending" | "approved" | "blocked";
	reason: string;
	createdAt: string;
	updatedAt: string;
}

export interface AgentInfo {
	id: string;
	name: string;
	tags: string[];
	status: "online" | "offline" | "busy";
	lastSeen: string;
	capabilities?: string[];
	projectId?: string;
	contactPolicy?: ContactPolicy;
	taskDescription?: string;
}

export interface MessageResult {
	success: boolean;
	messageId: string;
	delivered: boolean;
	response?: string;
	error?: string;
}

export interface BroadcastResult {
	success: boolean;
	sent: number;
	delivered: number;
	responses: Array<{
		agentId: string;
		response?: string;
		error?: string;
	}>;
}

type MessageHandler = (message: AgentMessage) => Promise<string | undefined>;

// ============================================================================
// Agent Message Bus
// ============================================================================

export class AgentMessageBus extends EventEmitter {
	private agents: Map<string, AgentInfo> = new Map();
	private handlers: Map<string, MessageHandler> = new Map();
	private messageQueue: Map<string, AgentMessage[]> = new Map();
	private pendingResponses: Map<string, { resolve: (value: string) => void; timeout: NodeJS.Timeout }> = new Map();
	private dataDir: string;

	// Enhanced storage (MCP Agent Mail patterns)
	private enhancedMessages: Map<string, EnhancedAgentMessage> = new Map();
	private threads: Map<string, string[]> = new Map(); // threadId -> messageIds
	private contactRequests: Map<string, ContactRequest> = new Map();
	private gitEnabled: boolean = false;

	constructor(dataDir: string = DEFAULT_DATA_DIR, options: { enableGit?: boolean } = {}) {
		super();
		this.dataDir = dataDir;
		this.gitEnabled = options.enableGit || false;
		this.loadState();
	}

	/**
	 * Load persisted state
	 */
	private loadState(): void {
		const statePath = join(this.dataDir, "agent_bus_state.json");
		if (existsSync(statePath)) {
			try {
				const data = JSON.parse(readFileSync(statePath, "utf-8"));
				if (data.agents) {
					for (const [id, info] of Object.entries(data.agents)) {
						this.agents.set(id, info as AgentInfo);
					}
				}
				if (data.messageQueue) {
					for (const [id, messages] of Object.entries(data.messageQueue)) {
						this.messageQueue.set(id, messages as AgentMessage[]);
					}
				}
			} catch {
				// Ignore corrupt state
			}
		}
	}

	/**
	 * Persist state
	 */
	private saveState(): void {
		const dir = dirname(join(this.dataDir, "agent_bus_state.json"));
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		const state = {
			agents: Object.fromEntries(this.agents),
			messageQueue: Object.fromEntries(this.messageQueue),
			enhancedMessages: Object.fromEntries(this.enhancedMessages),
			threads: Object.fromEntries(this.threads),
			contactRequests: Object.fromEntries(this.contactRequests),
		};

		writeFileSync(join(this.dataDir, "agent_bus_state.json"), JSON.stringify(state, null, 2));
	}

	/**
	 * Generate unique message ID
	 */
	private generateMessageId(): string {
		return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
	}

	// ========================================================================
	// Agent Registration
	// ========================================================================

	/**
	 * Register an agent with the message bus
	 */
	registerAgent(info: AgentInfo, handler: MessageHandler): void {
		this.agents.set(info.id, {
			...info,
			status: "online",
			lastSeen: new Date().toISOString(),
		});
		this.handlers.set(info.id, handler);

		// Deliver any queued messages
		this.deliverQueuedMessages(info.id);

		this.emit("agent:registered", info);
		this.saveState();
	}

	/**
	 * Unregister an agent
	 */
	unregisterAgent(agentId: string): void {
		const info = this.agents.get(agentId);
		if (info) {
			info.status = "offline";
			info.lastSeen = new Date().toISOString();
		}
		this.handlers.delete(agentId);

		this.emit("agent:unregistered", agentId);
		this.saveState();
	}

	/**
	 * Update agent status
	 */
	updateAgentStatus(agentId: string, status: AgentInfo["status"]): void {
		const info = this.agents.get(agentId);
		if (info) {
			info.status = status;
			info.lastSeen = new Date().toISOString();
			this.saveState();
		}
	}

	/**
	 * Get all registered agents
	 */
	getAgents(): AgentInfo[] {
		return Array.from(this.agents.values());
	}

	/**
	 * Find agents by tags
	 */
	findAgentsByTags(tags: string[], matchAll = true): AgentInfo[] {
		return Array.from(this.agents.values()).filter((agent) => {
			if (matchAll) {
				return tags.every((tag) => agent.tags.includes(tag));
			}
			return tags.some((tag) => agent.tags.includes(tag));
		});
	}

	// ========================================================================
	// Messaging
	// ========================================================================

	/**
	 * Send asynchronous message (fire-and-forget)
	 */
	async sendAsync(
		from: string,
		to: string,
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<MessageResult> {
		const message: AgentMessage = {
			id: this.generateMessageId(),
			from,
			to,
			content,
			timestamp: new Date().toISOString(),
			metadata,
		};

		const handler = this.handlers.get(to);

		if (handler) {
			// Agent is online, deliver immediately
			try {
				handler(message).catch((err) => {
					console.error(`Error handling message ${message.id}:`, err);
				});

				this.emit("message:sent", message);

				return {
					success: true,
					messageId: message.id,
					delivered: true,
				};
			} catch (error) {
				return {
					success: false,
					messageId: message.id,
					delivered: false,
					error: error instanceof Error ? error.message : "Unknown error",
				};
			}
		} else {
			// Agent offline, queue message
			if (!this.messageQueue.has(to)) {
				this.messageQueue.set(to, []);
			}
			this.messageQueue.get(to)!.push(message);
			this.saveState();

			this.emit("message:queued", message);

			return {
				success: true,
				messageId: message.id,
				delivered: false,
			};
		}
	}

	/**
	 * Send synchronous message and wait for response
	 */
	async sendAndWait(
		from: string,
		to: string,
		content: string,
		timeoutMs = 30000,
		metadata?: Record<string, unknown>,
	): Promise<MessageResult> {
		const message: AgentMessage = {
			id: this.generateMessageId(),
			from,
			to,
			content,
			timestamp: new Date().toISOString(),
			metadata,
		};

		const handler = this.handlers.get(to);

		if (!handler) {
			return {
				success: false,
				messageId: message.id,
				delivered: false,
				error: `Agent "${to}" is not online`,
			};
		}

		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				this.pendingResponses.delete(message.id);
				resolve({
					success: false,
					messageId: message.id,
					delivered: true,
					error: "Response timeout",
				});
			}, timeoutMs);

			this.pendingResponses.set(message.id, {
				resolve: (response: string) => {
					clearTimeout(timeout);
					this.pendingResponses.delete(message.id);
					resolve({
						success: true,
						messageId: message.id,
						delivered: true,
						response,
					});
				},
				timeout,
			});

			// Execute handler and resolve with response
			handler(message)
				.then((response) => {
					const pending = this.pendingResponses.get(message.id);
					if (pending) {
						pending.resolve(response || "");
					}
				})
				.catch((error) => {
					const pending = this.pendingResponses.get(message.id);
					if (pending) {
						clearTimeout(pending.timeout);
						this.pendingResponses.delete(message.id);
						resolve({
							success: false,
							messageId: message.id,
							delivered: true,
							error: error instanceof Error ? error.message : "Handler error",
						});
					}
				});

			this.emit("message:sent", message);
		});
	}

	/**
	 * Broadcast message to agents matching tags
	 */
	async broadcast(
		from: string,
		tags: string[],
		content: string,
		waitForResponses = false,
		metadata?: Record<string, unknown>,
	): Promise<BroadcastResult> {
		const targetAgents = this.findAgentsByTags(tags, true);

		if (targetAgents.length === 0) {
			return {
				success: false,
				sent: 0,
				delivered: 0,
				responses: [],
			};
		}

		const results: BroadcastResult["responses"] = [];
		let delivered = 0;

		for (const agent of targetAgents) {
			if (waitForResponses) {
				const result = await this.sendAndWait(from, agent.id, content, 30000, metadata);
				results.push({
					agentId: agent.id,
					response: result.response,
					error: result.error,
				});
				if (result.delivered) delivered++;
			} else {
				const result = await this.sendAsync(from, agent.id, content, metadata);
				results.push({
					agentId: agent.id,
					error: result.error,
				});
				if (result.delivered) delivered++;
			}
		}

		return {
			success: true,
			sent: targetAgents.length,
			delivered,
			responses: results,
		};
	}

	/**
	 * Deliver queued messages to an agent
	 */
	private async deliverQueuedMessages(agentId: string): Promise<void> {
		const queue = this.messageQueue.get(agentId);
		const handler = this.handlers.get(agentId);

		if (!queue || queue.length === 0 || !handler) {
			return;
		}

		// Deliver all queued messages
		for (const message of queue) {
			try {
				await handler(message);
				this.emit("message:delivered", message);
			} catch (error) {
				console.error(`Error delivering queued message ${message.id}:`, error);
			}
		}

		// Clear queue
		this.messageQueue.delete(agentId);
		this.saveState();
	}

	/**
	 * Get pending messages for an agent
	 */
	getPendingMessages(agentId: string): AgentMessage[] {
		return this.messageQueue.get(agentId) || [];
	}

	// ========================================================================
	// Enhanced Email-Like Messaging (MCP Agent Mail patterns)
	// ========================================================================

	/**
	 * Send enhanced message with email semantics
	 */
	async sendEnhanced(options: {
		from: string;
		to: string[];
		cc?: string[];
		bcc?: string[];
		subject: string;
		content: string;
		threadId?: string;
		importance?: MessageImportance;
		ackRequired?: boolean;
		attachments?: MessageAttachment[];
		projectId?: string;
		isHumanOverseer?: boolean;
	}): Promise<{ success: boolean; messageId: string; threadId: string; error?: string }> {
		const {
			from,
			to,
			cc = [],
			bcc = [],
			subject,
			content,
			threadId = this.generateThreadId(),
			importance = "normal",
			ackRequired = false,
			attachments = [],
			projectId,
			isHumanOverseer = false,
		} = options;

		// Build recipients list
		const recipients: MessageRecipient[] = [
			...to.map((id) => ({ agentId: id, type: "to" as RecipientType })),
			...cc.map((id) => ({ agentId: id, type: "cc" as RecipientType })),
			...bcc.map((id) => ({ agentId: id, type: "bcc" as RecipientType })),
		];

		const message: EnhancedAgentMessage = {
			id: this.generateMessageId(),
			from,
			to: to[0], // Primary recipient for compatibility
			subject,
			content,
			timestamp: new Date().toISOString(),
			threadId,
			importance,
			ackRequired,
			recipients,
			attachments,
			projectId,
			isHumanOverseer,
		};

		// Store enhanced message
		this.enhancedMessages.set(message.id, message);

		// Track thread
		if (!this.threads.has(threadId)) {
			this.threads.set(threadId, []);
		}
		this.threads.get(threadId)!.push(message.id);

		// Git persistence if enabled
		if (this.gitEnabled) {
			await this.persistToGit(message);
		}

		// Deliver to all recipients (except bcc for visibility)
		const deliveryPromises = recipients
			.filter((r) => r.type !== "bcc" || r.agentId === message.from)
			.map(async (recipient) => {
				// Check contact policy
				const agent = this.agents.get(recipient.agentId);
				if (agent?.contactPolicy === "block_all" && !isHumanOverseer) {
					return { agentId: recipient.agentId, blocked: true };
				}

				const result = await this.sendAsync(from, recipient.agentId, content, {
					subject,
					threadId,
					importance,
					ackRequired,
					isEnhanced: true,
					messageId: message.id,
				});

				return { agentId: recipient.agentId, ...result };
			});

		await Promise.all(deliveryPromises);

		this.saveState();
		this.emit("enhanced:sent", message);

		return { success: true, messageId: message.id, threadId };
	}

	/**
	 * Reply to a thread
	 */
	async reply(options: {
		from: string;
		threadId: string;
		content: string;
		importance?: MessageImportance;
		attachments?: MessageAttachment[];
	}): Promise<{ success: boolean; messageId: string; error?: string }> {
		const { from, threadId, content, importance = "normal", attachments = [] } = options;

		const threadMessages = this.threads.get(threadId);
		if (!threadMessages || threadMessages.length === 0) {
			return { success: false, messageId: "", error: "Thread not found" };
		}

		// Get original message to determine recipients
		const originalId = threadMessages[0];
		const original = this.enhancedMessages.get(originalId);

		if (!original) {
			return { success: false, messageId: "", error: "Original message not found" };
		}

		// Build recipient list (reply to all except self)
		const to = original.recipients.filter((r) => r.agentId !== from && r.type !== "bcc").map((r) => r.agentId);

		// Include original sender if not self
		if (original.from !== from && !to.includes(original.from)) {
			to.unshift(original.from);
		}

		return this.sendEnhanced({
			from,
			to,
			subject: original.subject.startsWith("Re:") ? original.subject : `Re: ${original.subject}`,
			content,
			threadId,
			importance,
			attachments,
			projectId: original.projectId,
		});
	}

	/**
	 * Acknowledge a message
	 */
	acknowledge(messageId: string, agentId: string): boolean {
		const message = this.enhancedMessages.get(messageId);
		if (!message) return false;

		const recipient = message.recipients.find((r) => r.agentId === agentId);
		if (!recipient) return false;

		recipient.ackAt = new Date().toISOString();
		this.saveState();
		this.emit("message:acknowledged", { messageId, agentId });

		return true;
	}

	/**
	 * Mark message as read
	 */
	markRead(messageId: string, agentId: string): boolean {
		const message = this.enhancedMessages.get(messageId);
		if (!message) return false;

		const recipient = message.recipients.find((r) => r.agentId === agentId);
		if (!recipient) return false;

		recipient.readAt = new Date().toISOString();
		this.saveState();
		this.emit("message:read", { messageId, agentId });

		return true;
	}

	/**
	 * Get thread messages
	 */
	getThread(threadId: string): EnhancedAgentMessage[] {
		const messageIds = this.threads.get(threadId) || [];
		return messageIds
			.map((id) => this.enhancedMessages.get(id))
			.filter((m): m is EnhancedAgentMessage => m !== undefined)
			.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
	}

	/**
	 * Get thread summary
	 */
	getThreadSummary(threadId: string): ThreadSummary | null {
		const messages = this.getThread(threadId);
		if (messages.length === 0) return null;

		const participants = new Set<string>();
		messages.forEach((m) => {
			participants.add(m.from);
			m.recipients.forEach((r) => {
				participants.add(r.agentId);
			});
		});

		return {
			threadId,
			subject: messages[0].subject,
			participants: Array.from(participants),
			messageCount: messages.length,
			lastMessage: messages[messages.length - 1].timestamp,
		};
	}

	/**
	 * List threads for an agent
	 */
	listThreads(agentId: string): ThreadSummary[] {
		const summaries: ThreadSummary[] = [];

		for (const [threadId] of this.threads) {
			const messages = this.getThread(threadId);
			const isParticipant = messages.some(
				(m) => m.from === agentId || m.recipients.some((r) => r.agentId === agentId),
			);

			if (isParticipant) {
				const summary = this.getThreadSummary(threadId);
				if (summary) summaries.push(summary);
			}
		}

		return summaries.sort((a, b) => b.lastMessage.localeCompare(a.lastMessage));
	}

	/**
	 * Get inbox (unread enhanced messages)
	 */
	getInbox(
		agentId: string,
		options: { unreadOnly?: boolean; importance?: MessageImportance; limit?: number } = {},
	): EnhancedAgentMessage[] {
		const { unreadOnly = false, importance, limit = 50 } = options;

		const messages: EnhancedAgentMessage[] = [];

		for (const message of this.enhancedMessages.values()) {
			const recipient = message.recipients.find((r) => r.agentId === agentId && r.type !== "bcc");

			if (!recipient) continue;
			if (unreadOnly && recipient.readAt) continue;
			if (importance && message.importance !== importance) continue;

			messages.push(message);
		}

		return messages
			.sort((a, b) => {
				// Sort by importance first, then by timestamp
				const importanceOrder: Record<MessageImportance, number> = {
					urgent: 4,
					high: 3,
					normal: 2,
					low: 1,
				};
				const importanceDiff = importanceOrder[b.importance] - importanceOrder[a.importance];
				if (importanceDiff !== 0) return importanceDiff;
				return b.timestamp.localeCompare(a.timestamp);
			})
			.slice(0, limit);
	}

	/**
	 * Search messages
	 */
	searchMessages(query: string, options: { agentId?: string; threadId?: string } = {}): EnhancedAgentMessage[] {
		const queryLower = query.toLowerCase();
		const results: EnhancedAgentMessage[] = [];

		for (const message of this.enhancedMessages.values()) {
			// Filter by thread
			if (options.threadId && message.threadId !== options.threadId) continue;

			// Filter by agent participation
			if (options.agentId) {
				const isParticipant =
					message.from === options.agentId || message.recipients.some((r) => r.agentId === options.agentId);
				if (!isParticipant) continue;
			}

			// Search in subject and content
			if (message.subject.toLowerCase().includes(queryLower) || message.content.toLowerCase().includes(queryLower)) {
				results.push(message);
			}
		}

		return results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
	}

	// ========================================================================
	// Contact Management
	// ========================================================================

	/**
	 * Request contact with another agent (cross-project)
	 */
	requestContact(
		fromAgentId: string,
		fromProjectId: string,
		toAgentId: string,
		toProjectId: string,
		reason: string,
	): ContactRequest {
		const id = `contact_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const now = new Date().toISOString();

		const request: ContactRequest = {
			id,
			fromAgentId,
			fromProjectId,
			toAgentId,
			toProjectId,
			status: "pending",
			reason,
			createdAt: now,
			updatedAt: now,
		};

		this.contactRequests.set(id, request);
		this.saveState();
		this.emit("contact:requested", request);

		return request;
	}

	/**
	 * Respond to contact request
	 */
	respondToContact(requestId: string, approved: boolean): boolean {
		const request = this.contactRequests.get(requestId);
		if (!request) return false;

		request.status = approved ? "approved" : "blocked";
		request.updatedAt = new Date().toISOString();
		this.saveState();
		this.emit("contact:responded", request);

		return true;
	}

	/**
	 * Get pending contact requests for an agent
	 */
	getPendingContactRequests(agentId: string): ContactRequest[] {
		return Array.from(this.contactRequests.values()).filter((r) => r.toAgentId === agentId && r.status === "pending");
	}

	// ========================================================================
	// Git Persistence (Audit Trail)
	// ========================================================================

	private generateThreadId(): string {
		return `thread_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
	}

	/**
	 * Persist message to Git for audit trail
	 */
	private async persistToGit(message: EnhancedAgentMessage): Promise<void> {
		if (!this.gitEnabled) return;

		try {
			const { execSync } = await import("child_process");
			const date = new Date(message.timestamp);
			const year = date.getFullYear();
			const month = String(date.getMonth() + 1).padStart(2, "0");

			// Create directory structure: messages/YYYY/MM/
			const msgDir = join(this.dataDir, "messages", String(year), month);
			if (!existsSync(msgDir)) {
				mkdirSync(msgDir, { recursive: true });
			}

			// Create message file with JSON frontmatter and Markdown body
			const filename = `${message.id}.md`;
			const filepath = join(msgDir, filename);

			const frontmatter = {
				id: message.id,
				from: message.from,
				to: message.recipients.filter((r) => r.type === "to").map((r) => r.agentId),
				cc: message.recipients.filter((r) => r.type === "cc").map((r) => r.agentId),
				subject: message.subject,
				threadId: message.threadId,
				importance: message.importance,
				timestamp: message.timestamp,
				ackRequired: message.ackRequired,
			};

			const content = `---
${JSON.stringify(frontmatter, null, 2)}
---

# ${message.subject}

${message.content}
`;

			writeFileSync(filepath, content);

			// Git add and commit
			const gitDir = this.dataDir;
			execSync(`git -C "${gitDir}" add "${filepath}"`, { stdio: "ignore" });
			execSync(
				`git -C "${gitDir}" commit -m "agent-mail: ${message.from} -> ${message.recipients[0]?.agentId}: ${message.subject.substring(0, 50)}" --allow-empty`,
				{ stdio: "ignore" },
			);
		} catch (error) {
			// Git operations are optional, don't fail on errors
			console.warn("Git persistence failed:", error);
		}
	}

	/**
	 * Enable Git persistence
	 */
	enableGitPersistence(): void {
		this.gitEnabled = true;
	}

	/**
	 * Disable Git persistence
	 */
	disableGitPersistence(): void {
		this.gitEnabled = false;
	}
}

// ============================================================================
// Agent Messaging Tools
// ============================================================================

export function createAgentMessagingTools(bus: AgentMessageBus, currentAgentId: string) {
	return {
		send_message_to_agent_async: {
			name: "send_message_to_agent_async",
			description:
				"Send a message to another agent without waiting for a response. Use for notifications or fire-and-forget communication.",
			parameters: {
				type: "object",
				properties: {
					target_agent: {
						type: "string",
						description: "ID of the agent to send message to",
					},
					message: {
						type: "string",
						description: "Message content to send",
					},
				},
				required: ["target_agent", "message"],
			},
			execute: async (args: { target_agent: string; message: string }) => {
				const result = await bus.sendAsync(currentAgentId, args.target_agent, args.message);
				return JSON.stringify(result);
			},
		},

		send_message_to_agent_and_wait: {
			name: "send_message_to_agent_and_wait",
			description:
				"Send a message to another agent and wait for their response. Use when you need information from another agent.",
			parameters: {
				type: "object",
				properties: {
					target_agent: {
						type: "string",
						description: "ID of the agent to send message to",
					},
					message: {
						type: "string",
						description: "Message content to send",
					},
					timeout_seconds: {
						type: "number",
						description: "How long to wait for response (default: 30)",
					},
				},
				required: ["target_agent", "message"],
			},
			execute: async (args: { target_agent: string; message: string; timeout_seconds?: number }) => {
				const timeoutMs = (args.timeout_seconds || 30) * 1000;
				const result = await bus.sendAndWait(currentAgentId, args.target_agent, args.message, timeoutMs);
				return JSON.stringify(result);
			},
		},

		broadcast_to_agents: {
			name: "broadcast_to_agents",
			description:
				"Send a message to all agents matching specified tags. Use for coordinating multiple worker agents.",
			parameters: {
				type: "object",
				properties: {
					tags: {
						type: "array",
						items: { type: "string" },
						description: "Tags that target agents must have (all must match)",
					},
					message: {
						type: "string",
						description: "Message content to broadcast",
					},
					wait_for_responses: {
						type: "boolean",
						description: "Whether to wait for responses from all agents (default: false)",
					},
				},
				required: ["tags", "message"],
			},
			execute: async (args: { tags: string[]; message: string; wait_for_responses?: boolean }) => {
				const result = await bus.broadcast(
					currentAgentId,
					args.tags,
					args.message,
					args.wait_for_responses || false,
				);
				return JSON.stringify(result);
			},
		},

		list_available_agents: {
			name: "list_available_agents",
			description: "List all available agents and their status.",
			parameters: {
				type: "object",
				properties: {
					tags: {
						type: "array",
						items: { type: "string" },
						description: "Optional: filter by tags",
					},
					online_only: {
						type: "boolean",
						description: "Only show online agents (default: true)",
					},
				},
			},
			execute: async (args: { tags?: string[]; online_only?: boolean }) => {
				let agents = bus.getAgents();

				if (args.tags && args.tags.length > 0) {
					agents = bus.findAgentsByTags(args.tags, false);
				}

				if (args.online_only !== false) {
					agents = agents.filter((a) => a.status === "online");
				}

				return JSON.stringify({
					count: agents.length,
					agents: agents.map((a) => ({
						id: a.id,
						name: a.name,
						tags: a.tags,
						status: a.status,
						capabilities: a.capabilities,
					})),
				});
			},
		},

		// ====================================================================
		// Enhanced Email-Like Tools (MCP Agent Mail patterns)
		// ====================================================================

		send_enhanced_message: {
			name: "send_enhanced_message",
			description:
				"Send an email-like message with subject, To/Cc/Bcc recipients, threading, and importance levels. Use for formal agent-to-agent communication.",
			parameters: {
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
					bcc: {
						type: "array",
						items: { type: "string" },
						description: "BCC recipient agent IDs (optional)",
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
			execute: async (args: {
				to: string[];
				cc?: string[];
				bcc?: string[];
				subject: string;
				content: string;
				thread_id?: string;
				importance?: MessageImportance;
				ack_required?: boolean;
				project_id?: string;
			}) => {
				const result = await bus.sendEnhanced({
					from: currentAgentId,
					to: args.to,
					cc: args.cc,
					bcc: args.bcc,
					subject: args.subject,
					content: args.content,
					threadId: args.thread_id,
					importance: args.importance,
					ackRequired: args.ack_required,
					projectId: args.project_id,
				});
				return JSON.stringify(result);
			},
		},

		reply_to_thread: {
			name: "reply_to_thread",
			description: "Reply to an existing message thread. Automatically includes original participants.",
			parameters: {
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
			execute: async (args: { thread_id: string; content: string; importance?: MessageImportance }) => {
				const result = await bus.reply({
					from: currentAgentId,
					threadId: args.thread_id,
					content: args.content,
					importance: args.importance,
				});
				return JSON.stringify(result);
			},
		},

		acknowledge_message: {
			name: "acknowledge_message",
			description: "Acknowledge receipt of a message that required acknowledgment.",
			parameters: {
				type: "object",
				properties: {
					message_id: {
						type: "string",
						description: "ID of the message to acknowledge",
					},
				},
				required: ["message_id"],
			},
			execute: async (args: { message_id: string }) => {
				const success = bus.acknowledge(args.message_id, currentAgentId);
				return JSON.stringify({ success, messageId: args.message_id });
			},
		},

		mark_message_read: {
			name: "mark_message_read",
			description: "Mark a message as read in your inbox.",
			parameters: {
				type: "object",
				properties: {
					message_id: {
						type: "string",
						description: "ID of the message to mark as read",
					},
				},
				required: ["message_id"],
			},
			execute: async (args: { message_id: string }) => {
				const success = bus.markRead(args.message_id, currentAgentId);
				return JSON.stringify({ success, messageId: args.message_id });
			},
		},

		get_inbox: {
			name: "get_inbox",
			description: "Get inbox messages. Returns messages sorted by importance then timestamp.",
			parameters: {
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
			execute: async (args: { unread_only?: boolean; importance?: MessageImportance; limit?: number }) => {
				const messages = bus.getInbox(currentAgentId, {
					unreadOnly: args.unread_only,
					importance: args.importance,
					limit: args.limit,
				});
				return JSON.stringify({
					count: messages.length,
					messages: messages.map((m) => ({
						id: m.id,
						from: m.from,
						subject: m.subject,
						importance: m.importance,
						threadId: m.threadId,
						timestamp: m.timestamp,
						ackRequired: m.ackRequired,
						preview: m.content.substring(0, 100) + (m.content.length > 100 ? "..." : ""),
					})),
				});
			},
		},

		list_threads: {
			name: "list_threads",
			description: "List all message threads you are participating in.",
			parameters: {
				type: "object",
				properties: {},
			},
			execute: async () => {
				const threads = bus.listThreads(currentAgentId);
				return JSON.stringify({
					count: threads.length,
					threads,
				});
			},
		},

		get_thread_messages: {
			name: "get_thread_messages",
			description: "Get all messages in a specific thread.",
			parameters: {
				type: "object",
				properties: {
					thread_id: {
						type: "string",
						description: "Thread ID to retrieve",
					},
				},
				required: ["thread_id"],
			},
			execute: async (args: { thread_id: string }) => {
				const messages = bus.getThread(args.thread_id);
				const summary = bus.getThreadSummary(args.thread_id);
				return JSON.stringify({
					summary,
					messages: messages.map((m) => ({
						id: m.id,
						from: m.from,
						subject: m.subject,
						content: m.content,
						timestamp: m.timestamp,
						importance: m.importance,
					})),
				});
			},
		},

		search_messages: {
			name: "search_messages",
			description: "Search messages by content or subject.",
			parameters: {
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
			execute: async (args: { query: string; thread_id?: string }) => {
				const messages = bus.searchMessages(args.query, {
					agentId: currentAgentId,
					threadId: args.thread_id,
				});
				return JSON.stringify({
					count: messages.length,
					messages: messages.map((m) => ({
						id: m.id,
						from: m.from,
						subject: m.subject,
						threadId: m.threadId,
						timestamp: m.timestamp,
						preview: m.content.substring(0, 100) + (m.content.length > 100 ? "..." : ""),
					})),
				});
			},
		},

		request_contact: {
			name: "request_contact",
			description:
				"Request permission to contact an agent from another project. Required for cross-project communication.",
			parameters: {
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
					current_project: {
						type: "string",
						description: "Your current project ID",
					},
				},
				required: ["target_agent", "target_project", "reason", "current_project"],
			},
			execute: async (args: {
				target_agent: string;
				target_project: string;
				reason: string;
				current_project: string;
			}) => {
				const request = bus.requestContact(
					currentAgentId,
					args.current_project,
					args.target_agent,
					args.target_project,
					args.reason,
				);
				return JSON.stringify(request);
			},
		},

		get_pending_contact_requests: {
			name: "get_pending_contact_requests",
			description: "Get pending contact requests awaiting your approval.",
			parameters: {
				type: "object",
				properties: {},
			},
			execute: async () => {
				const requests = bus.getPendingContactRequests(currentAgentId);
				return JSON.stringify({
					count: requests.length,
					requests,
				});
			},
		},

		respond_to_contact_request: {
			name: "respond_to_contact_request",
			description: "Approve or block a contact request.",
			parameters: {
				type: "object",
				properties: {
					request_id: {
						type: "string",
						description: "Contact request ID",
					},
					approve: {
						type: "boolean",
						description: "true to approve, false to block",
					},
				},
				required: ["request_id", "approve"],
			},
			execute: async (args: { request_id: string; approve: boolean }) => {
				const success = bus.respondToContact(args.request_id, args.approve);
				return JSON.stringify({
					success,
					requestId: args.request_id,
					action: args.approve ? "approved" : "blocked",
				});
			},
		},
	};
}

// ============================================================================
// Singleton Instance
// ============================================================================

let messageBusInstance: AgentMessageBus | null = null;

export function getAgentMessageBus(dataDir?: string): AgentMessageBus {
	if (!messageBusInstance) {
		messageBusInstance = new AgentMessageBus(dataDir);
	}
	return messageBusInstance;
}

export function disposeAgentMessageBus(): void {
	messageBusInstance = null;
}

export default AgentMessageBus;
