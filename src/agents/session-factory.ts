/**
 * SDK-Compatible Session Factory
 *
 * This module provides an abstraction layer that mirrors the upcoming pi SDK's
 * `createAgentSession()` API. When the SDK releases, this can be swapped out
 * with minimal changes to consuming code.
 *
 * Current: Uses @mariozechner/pi-agent-core directly
 * Future: Will use @mariozechner/pi-coding-agent SDK
 *
 * Key SDK concepts implemented:
 * - "Omit to discover, provide to override" philosophy
 * - Event-based streaming (message_update, tool_execution_*, etc.)
 * - Session management (in-memory, persistent)
 * - Custom tools/hooks support
 */

import { Agent, type AgentEvent, ProviderTransport } from "@mariozechner/pi-agent-core";
import type { AgentTool, Model } from "@mariozechner/pi-ai";
import { EventEmitter } from "events";

// ============================================================================
// TYPES (Aligned with SDK)
// ============================================================================

/** Session event types matching SDK patterns */
export type SessionFactoryEventType =
	| "message_start"
	| "message_update"
	| "message_end"
	| "tool_execution_start"
	| "tool_execution_update"
	| "tool_execution_end"
	| "agent_start"
	| "agent_end"
	| "turn_start"
	| "turn_end"
	| "error";

/** Session event payload */
export interface SessionFactoryEvent {
	type: SessionFactoryEventType;
	timestamp: number;
	data: unknown;
}

/** Session manager modes */
export type SessionMode = "in-memory" | "persistent" | "continue-recent";

/** Session manager configuration */
export interface SessionManagerConfig {
	mode: SessionMode;
	sessionDir?: string;
	sessionId?: string;
}

/** Session options (mirrors SDK's CreateAgentSessionOptions) */
export interface CreateSessionOptions {
	/** Working directory */
	cwd?: string;

	/** Model configuration */
	model?: Model<"openai-completions">;

	/** Thinking level */
	thinkingLevel?: "off" | "low" | "medium" | "high";

	/** System prompt (string or modifier function) */
	systemPrompt?: string | ((defaultPrompt: string) => string);

	/** Tools to use */
	tools?: AgentTool[];

	/** API key resolver */
	getApiKey?: (model: Model<"openai-completions">) => Promise<string | undefined>;

	/** Session manager */
	sessionManager?: SessionManagerConfig;

	/** Custom message transformer */
	messageTransformer?: (messages: unknown[]) => Promise<unknown[]>;

	/** Enable debug logging */
	debug?: boolean;
}

/** Session instance (mirrors SDK's AgentSession) */
export interface AgentSession {
	/** Send a prompt and wait for completion */
	prompt(text: string): Promise<void>;

	/** Subscribe to events (returns unsubscribe function) */
	subscribe(listener: (event: SessionFactoryEvent) => void): () => void;

	/** Session ID */
	sessionId: string;

	/** Access underlying agent */
	agent: Agent;

	/** Abort current operation */
	abort(): void;

	/** Reset session */
	reset(): void;

	/** Get collected output text */
	getOutput(): string;

	/** Get token usage */
	getUsage(): { prompt: number; completion: number; total: number } | undefined;
}

/** Result from createSession */
export interface CreateSessionResult {
	session: AgentSession;
	sessionId: string;
}

// ============================================================================
// SESSION MANAGER (Simplified version of SDK's SessionManager)
// ============================================================================

export const SessionManager = {
	/** In-memory session (no persistence) */
	inMemory(): SessionManagerConfig {
		return { mode: "in-memory" };
	},

	/** Create new persistent session */
	create(cwd: string, sessionDir?: string): SessionManagerConfig {
		return { mode: "persistent", sessionDir: sessionDir || `${cwd}/.sessions` };
	},

	/** Continue most recent session */
	continueRecent(cwd: string, sessionDir?: string): SessionManagerConfig {
		return { mode: "continue-recent", sessionDir: sessionDir || `${cwd}/.sessions` };
	},
};

// ============================================================================
// DEFAULT SYSTEM PROMPT
// ============================================================================

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with expertise in software development, trading analysis, and general problem-solving. You provide clear, concise, and accurate responses.

Guidelines:
- Be direct and focused
- Provide code examples when relevant
- Explain your reasoning
- Ask clarifying questions if needed`;

// ============================================================================
// SESSION IMPLEMENTATION
// ============================================================================

class AgentSessionImpl extends EventEmitter implements AgentSession {
	public readonly agent: Agent;
	public readonly sessionId: string;

	private output = "";
	private usage?: { prompt: number; completion: number; total: number };
	private abortController?: AbortController;
	private eventListeners: Array<(event: SessionFactoryEvent) => void> = [];

	constructor(agent: Agent, sessionId: string) {
		super();
		this.agent = agent;
		this.sessionId = sessionId;

		// Wire up agent events to session events
		this.agent.subscribe((event: AgentEvent) => {
			this.handleAgentEvent(event);
		});
	}

	private handleAgentEvent(event: AgentEvent): void {
		const sessionEvent = this.mapAgentEvent(event);
		if (sessionEvent) {
			this.emitSessionEvent(sessionEvent);
		}
	}

	private mapAgentEvent(event: AgentEvent): SessionFactoryEvent | null {
		const timestamp = Date.now();
		// Cast to string to handle all possible event types from the agent
		const eventType = event.type as string;

		if (eventType === "message_start") {
			return { type: "message_start", timestamp, data: event };
		}

		if (eventType === "message_update") {
			// Extract text content for output collection
			if ((event as any).assistantMessageEvent?.type === "text_delta") {
				this.output += (event as any).assistantMessageEvent.delta || "";
			}
			return { type: "message_update", timestamp, data: event };
		}

		if (eventType === "message_end") {
			// Extract usage from message
			const msg = (event as any).message;
			if (msg?.usage) {
				this.usage = {
					prompt: msg.usage.input || 0,
					completion: msg.usage.output || 0,
					total: (msg.usage.input || 0) + (msg.usage.output || 0),
				};
			}
			return { type: "message_end", timestamp, data: event };
		}

		if (eventType === "tool_start") {
			return { type: "tool_execution_start", timestamp, data: event };
		}

		if (eventType === "tool_result") {
			return { type: "tool_execution_end", timestamp, data: event };
		}

		if (eventType === "turn_start") {
			return { type: "turn_start", timestamp, data: event };
		}

		if (eventType === "turn_end") {
			return { type: "turn_end", timestamp, data: event };
		}

		if (eventType === "error") {
			return { type: "error", timestamp, data: event };
		}

		return null;
	}

	private emitSessionEvent(event: SessionFactoryEvent): void {
		for (const listener of this.eventListeners) {
			try {
				listener(event);
			} catch (err) {
				console.error("[Session] Listener error:", err);
			}
		}
		this.emit(event.type, event);
	}

	async prompt(text: string): Promise<void> {
		this.output = "";
		this.usage = undefined;

		this.emitSessionEvent({
			type: "agent_start",
			timestamp: Date.now(),
			data: { prompt: text },
		});

		try {
			await this.agent.prompt(text);
		} finally {
			this.emitSessionEvent({
				type: "agent_end",
				timestamp: Date.now(),
				data: { output: this.output },
			});
		}
	}

	subscribe(listener: (event: SessionFactoryEvent) => void): () => void {
		this.eventListeners.push(listener);
		return () => {
			const index = this.eventListeners.indexOf(listener);
			if (index >= 0) {
				this.eventListeners.splice(index, 1);
			}
		};
	}

	abort(): void {
		this.abortController?.abort();
	}

	reset(): void {
		this.output = "";
		this.usage = undefined;
		// Note: Full reset would require recreating the agent
	}

	getOutput(): string {
		return this.output;
	}

	getUsage(): { prompt: number; completion: number; total: number } | undefined {
		return this.usage;
	}
}

// ============================================================================
// FACTORY FUNCTION (Mirrors SDK's createAgentSession)
// ============================================================================

/**
 * Create an agent session with SDK-compatible API.
 *
 * Philosophy: "Omit to discover, provide to override"
 * - Omit an option → uses sensible defaults
 * - Provide an option → your value is used
 *
 * @example
 * ```typescript
 * // Minimal usage
 * const { session } = await createSession({
 *   model: myModel,
 *   getApiKey: async () => process.env.API_KEY,
 * });
 *
 * session.subscribe((event) => {
 *   if (event.type === "message_update") {
 *     console.log(event.data);
 *   }
 * });
 *
 * await session.prompt("Hello!");
 * console.log(session.getOutput());
 * ```
 */
export async function createSession(options: CreateSessionOptions): Promise<CreateSessionResult> {
	const {
		cwd = process.cwd(),
		model,
		thinkingLevel = "off",
		systemPrompt,
		tools = [],
		getApiKey,
		messageTransformer,
		debug = false,
	} = options;

	// Validate required options
	if (!model) {
		throw new Error("Model is required");
	}

	if (!getApiKey) {
		throw new Error("getApiKey function is required");
	}

	// Build system prompt
	let finalSystemPrompt: string;
	if (typeof systemPrompt === "function") {
		finalSystemPrompt = systemPrompt(DEFAULT_SYSTEM_PROMPT);
	} else if (typeof systemPrompt === "string") {
		finalSystemPrompt = systemPrompt;
	} else {
		finalSystemPrompt = DEFAULT_SYSTEM_PROMPT;
	}

	// Generate session ID
	const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

	if (debug) {
		console.log(`[Session] Creating session: ${sessionId}`);
		console.log(`[Session] CWD: ${cwd}`);
		console.log(`[Session] Model: ${(model as any).name || "unknown"}`);
		console.log(`[Session] Tools: ${tools.length}`);
	}

	// Create agent
	const agentConfig: any = {
		initialState: {
			systemPrompt: finalSystemPrompt,
			model,
			thinkingLevel,
			tools,
		},
		transport: new ProviderTransport({
			getApiKey: async () => {
				const key = await getApiKey(model);
				return key || "";
			},
		}),
	};

	// Add message transformer if provided
	if (messageTransformer) {
		agentConfig.messageTransformer = messageTransformer;
	}

	const agent = new Agent(agentConfig);

	// Create session wrapper
	const session = new AgentSessionImpl(agent, sessionId);

	return {
		session,
		sessionId,
	};
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Run a single prompt and return the output.
 *
 * @example
 * ```typescript
 * const output = await runPrompt({
 *   model: myModel,
 *   getApiKey: async () => "key",
 *   prompt: "What is 2 + 2?",
 * });
 * console.log(output); // "4"
 * ```
 */
export async function runPrompt(options: CreateSessionOptions & { prompt: string; timeout?: number }): Promise<string> {
	const { prompt, timeout = 60000, ...sessionOptions } = options;

	const { session } = await createSession(sessionOptions);

	// Set up timeout
	const timeoutPromise = new Promise<never>((_, reject) => {
		setTimeout(() => reject(new Error("Prompt timed out")), timeout);
	});

	// Run prompt with timeout
	await Promise.race([session.prompt(prompt), timeoutPromise]);

	return session.getOutput();
}

/**
 * Create a streaming session that yields text chunks.
 *
 * @example
 * ```typescript
 * for await (const chunk of streamPrompt({
 *   model: myModel,
 *   getApiKey: async () => "key",
 *   prompt: "Tell me a story",
 * })) {
 *   process.stdout.write(chunk);
 * }
 * ```
 */
export async function* streamPrompt(
	options: CreateSessionOptions & { prompt: string },
): AsyncGenerator<string, void, unknown> {
	const { prompt, ...sessionOptions } = options;

	const { session } = await createSession(sessionOptions);

	const chunks: string[] = [];
	let resolveNext: ((value: string | null) => void) | null = null;
	let done = false;

	// Subscribe to text deltas
	session.subscribe((event) => {
		if (event.type === "message_update") {
			const data = event.data as any;
			if (data?.assistantMessageEvent?.type === "text_delta") {
				const delta = data.assistantMessageEvent.delta;
				if (delta && resolveNext) {
					resolveNext(delta);
					resolveNext = null;
				} else if (delta) {
					chunks.push(delta);
				}
			}
		} else if (event.type === "agent_end") {
			done = true;
			if (resolveNext) {
				resolveNext(null);
			}
		}
	});

	// Start the prompt (don't await - we stream)
	session.prompt(prompt).catch(() => {
		done = true;
		if (resolveNext) {
			resolveNext(null);
		}
	});

	// Yield chunks as they arrive
	while (!done || chunks.length > 0) {
		if (chunks.length > 0) {
			yield chunks.shift()!;
		} else if (!done) {
			const chunk = await new Promise<string | null>((resolve) => {
				resolveNext = resolve;
			});
			if (chunk === null) break;
			yield chunk;
		}
	}
}
