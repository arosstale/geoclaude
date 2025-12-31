/**
 * OBSERVABILITY HOOK
 * ==================
 * Streams agent events to the PAI Observability Dashboard
 *
 * Sends events to http://localhost:4100/events for real-time monitoring.
 * Compatible with ~/.claude/skills/Observability dashboard.
 */

import type {
	AgentEndEvent,
	AgentHookAPI,
	AgentHookContext,
	AgentHookFactory,
	AgentStartEvent,
	SessionEvent,
	ToolCallEvent,
	ToolResultEvent,
	TurnEndEvent,
	TurnStartEvent,
} from "./types.js";

export interface ObservabilityHookConfig {
	enabled: boolean;
	/** Observability server URL (default: http://localhost:4100) */
	serverUrl: string;
	/** Agent name for identification */
	agentName: string;
	/** Include tool input in events (default: true) */
	includeToolInput: boolean;
	/** Include tool output in events (default: true, truncated to 500 chars) */
	includeToolOutput: boolean;
	/** Log to console on send failure (default: false) */
	verbose: boolean;
}

const DEFAULT_CONFIG: ObservabilityHookConfig = {
	enabled: true,
	serverUrl: "http://localhost:4100",
	agentName: "discord-bot",
	includeToolInput: true,
	includeToolOutput: true,
	verbose: false,
};

// Session tracking
let currentSessionId = `discord-${Date.now()}`;

interface HookEvent {
	source_app: string;
	session_id: string;
	agent_name: string;
	hook_event_type: string;
	payload: Record<string, unknown>;
	timestamp: number;
}

/**
 * Send event to observability server (non-blocking)
 */
async function sendEvent(event: HookEvent, config: ObservabilityHookConfig): Promise<void> {
	try {
		const response = await fetch(`${config.serverUrl}/events`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(event),
		});

		if (!response.ok && config.verbose) {
			console.warn(`[OBSERVABILITY] Failed to send event: ${response.status}`);
		}
	} catch (err) {
		if (config.verbose) {
			console.warn("[OBSERVABILITY] Failed to send event:", err);
		}
	}
}

/**
 * Create observability hook factory
 */
export function createObservabilityHook(config: Partial<ObservabilityHookConfig> = {}): AgentHookFactory {
	const fullConfig: ObservabilityHookConfig = { ...DEFAULT_CONFIG, ...config };

	return (api: AgentHookAPI) => {
		if (!fullConfig.enabled) return;

		// Session events
		api.on("session", async (event: SessionEvent, ctx: AgentHookContext) => {
			currentSessionId = event.sessionId || `discord-${Date.now()}`;

			sendEvent(
				{
					source_app: "discord-bot",
					session_id: currentSessionId,
					agent_name: fullConfig.agentName,
					hook_event_type: "Session",
					payload: {
						reason: event.reason,
						channel_id: ctx.channelId,
						user_id: ctx.userId,
					},
					timestamp: Date.now(),
				},
				fullConfig,
			);
		});

		// Agent start
		api.on("agent_start", async (event: AgentStartEvent, ctx: AgentHookContext) => {
			sendEvent(
				{
					source_app: "discord-bot",
					session_id: currentSessionId,
					agent_name: fullConfig.agentName,
					hook_event_type: "AgentStart",
					payload: {
						turn_index: event.turnIndex,
						channel_id: ctx.channelId,
					},
					timestamp: event.timestamp || Date.now(),
				},
				fullConfig,
			);
		});

		// Agent end
		api.on("agent_end", async (event: AgentEndEvent, _ctx: AgentHookContext) => {
			sendEvent(
				{
					source_app: "discord-bot",
					session_id: currentSessionId,
					agent_name: fullConfig.agentName,
					hook_event_type: "AgentEnd",
					payload: {
						turn_index: event.turnIndex,
						success: event.success,
						output_length: event.output?.length || 0,
					},
					timestamp: Date.now(),
				},
				fullConfig,
			);
		});

		// Turn start
		api.on("turn_start", async (event: TurnStartEvent, _ctx: AgentHookContext) => {
			sendEvent(
				{
					source_app: "discord-bot",
					session_id: currentSessionId,
					agent_name: fullConfig.agentName,
					hook_event_type: "TurnStart",
					payload: {
						turn_index: event.turnIndex,
					},
					timestamp: event.timestamp || Date.now(),
				},
				fullConfig,
			);
		});

		// Turn end
		api.on("turn_end", async (event: TurnEndEvent, _ctx: AgentHookContext) => {
			sendEvent(
				{
					source_app: "discord-bot",
					session_id: currentSessionId,
					agent_name: fullConfig.agentName,
					hook_event_type: "TurnEnd",
					payload: {
						turn_index: event.turnIndex,
						has_tool_results: (event.toolResults?.length || 0) > 0,
					},
					timestamp: Date.now(),
				},
				fullConfig,
			);
		});

		// Tool call (PreToolUse equivalent)
		api.on("tool_call", async (event: ToolCallEvent, _ctx: AgentHookContext) => {
			const payload: Record<string, unknown> = {
				tool_name: event.toolName,
				tool_call_id: event.toolCallId,
			};

			if (fullConfig.includeToolInput && event.input) {
				const inputStr = JSON.stringify(event.input);
				payload.tool_input = inputStr.length > 500 ? `${inputStr.slice(0, 500)}...` : event.input;
			}

			sendEvent(
				{
					source_app: "discord-bot",
					session_id: currentSessionId,
					agent_name: fullConfig.agentName,
					hook_event_type: "PreToolUse",
					payload,
					timestamp: Date.now(),
				},
				fullConfig,
			);

			return undefined;
		});

		// Tool result (PostToolUse equivalent)
		api.on("tool_result", async (event: ToolResultEvent, _ctx: AgentHookContext) => {
			const payload: Record<string, unknown> = {
				tool_name: event.toolName,
				tool_call_id: event.toolCallId,
				is_error: event.isError,
			};

			if (fullConfig.includeToolOutput && event.result) {
				payload.tool_output = event.result.length > 500 ? `${event.result.slice(0, 500)}...` : event.result;
			}

			sendEvent(
				{
					source_app: "discord-bot",
					session_id: currentSessionId,
					agent_name: fullConfig.agentName,
					hook_event_type: "PostToolUse",
					payload,
					timestamp: Date.now(),
				},
				fullConfig,
			);

			return undefined;
		});
	};
}

export { DEFAULT_CONFIG as DEFAULT_OBSERVABILITY_CONFIG };
