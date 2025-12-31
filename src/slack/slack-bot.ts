/**
 * Pi Remote Agent - Slack Bot
 * Professional expert agent system for Slack
 * Shares capabilities with Discord/Telegram bots
 */

import { App, LogLevel } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import { runSharedAgent } from "../agents/shared-agent.js";
import { chat } from "../ai-provider.js";

// Environment flag for tool mode
const USE_AGENT_TOOLS = process.env.SLACK_USE_TOOLS !== "false"; // Default: true

// ============================================================================
// Types
// ============================================================================

interface SlackSession {
	channelId: string;
	userId: string;
	lastActivity: number;
	messageHistory: Array<{ role: "user" | "assistant"; content: string }>;
	expertMode: string;
}

interface ExpertMode {
	name: string;
	description: string;
	systemPrompt: string;
}

// ============================================================================
// Expert Modes (same as Telegram)
// ============================================================================

export const SLACK_EXPERT_MODES: Record<string, ExpertMode> = {
	general: {
		name: "General Assistant",
		description: "Multi-purpose AI assistant with full tool access",
		systemPrompt: `You are Pi, a professional AI assistant operating via Slack.
You have access to powerful tools including web search, code execution, file operations, and AI models.
Be concise but thorough. Use tools proactively to help users.
Format responses for Slack using markdown.`,
	},
	developer: {
		name: "Developer Expert",
		description: "Software development, code review, debugging",
		systemPrompt: `You are Pi Developer, an expert software engineer.
Specialize in: code review, debugging, architecture, best practices.
Languages: Python, TypeScript, Rust, Go, and more.
Format code blocks properly for Slack.`,
	},
	researcher: {
		name: "Research Expert",
		description: "Deep research, analysis, fact-checking",
		systemPrompt: `You are Pi Researcher, an expert research analyst.
Specialize in: deep research, fact-checking, synthesis, analysis.
Use web search and multiple sources to verify information.
Always cite sources and provide evidence-based answers.`,
	},
	trader: {
		name: "Trading Expert",
		description: "Crypto/stock analysis, market insights",
		systemPrompt: `You are Pi Trader, an expert market analyst.
Specialize in: technical analysis, market sentiment, trading strategies.
Focus on: crypto, stocks, DeFi, on-chain analysis.
Provide actionable insights with risk warnings.`,
	},
	security: {
		name: "Security Expert",
		description: "Security analysis, vulnerability scanning",
		systemPrompt: `You are Pi Security, a cybersecurity expert.
Specialize in: vulnerability analysis, code security, threat assessment.
Focus on: OWASP Top 10, secure coding, penetration testing concepts.`,
	},
};

// ============================================================================
// Session Management
// ============================================================================

const sessions = new Map<string, SlackSession>();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

function getSessionKey(channelId: string, userId: string): string {
	return `${channelId}:${userId}`;
}

function getSession(channelId: string, userId: string): SlackSession {
	const key = getSessionKey(channelId, userId);
	let session = sessions.get(key);
	if (!session) {
		session = {
			channelId,
			userId,
			lastActivity: Date.now(),
			messageHistory: [],
			expertMode: "general",
		};
		sessions.set(key, session);
	}
	session.lastActivity = Date.now();
	return session;
}

function cleanupSessions(): void {
	const now = Date.now();
	for (const [key, session] of sessions) {
		if (now - session.lastActivity > SESSION_TIMEOUT) {
			sessions.delete(key);
		}
	}
}

// Cleanup every 10 minutes
setInterval(cleanupSessions, 10 * 60 * 1000);

// ============================================================================
// Agent Integration
// ============================================================================

async function runAgent(session: SlackSession, userMessage: string): Promise<string> {
	const mode = SLACK_EXPERT_MODES[session.expertMode] || SLACK_EXPERT_MODES.general;

	// Add user message to history
	session.messageHistory.push({ role: "user", content: userMessage });

	// Keep last 20 messages for context
	if (session.messageHistory.length > 20) {
		session.messageHistory = session.messageHistory.slice(-20);
	}

	try {
		// Use shared agent with tools if enabled
		if (USE_AGENT_TOOLS) {
			console.log(`[SLACK] Running with tools enabled for ${session.channelId}:${session.userId}`);

			const result = await runSharedAgent(
				{
					platform: "slack",
					sessionId: `${session.channelId}:${session.userId}`,
					userId: session.userId,
					systemPrompt: mode.systemPrompt,
					model: "glm-4.5-air", // Fast model for Slack
					timeout: 180000, // 3 minutes
				},
				userMessage,
			);

			if (result.success) {
				const toolInfo = result.toolsUsed.length > 0 ? `\n\n_Tools: ${result.toolsUsed.join(", ")}_` : "";
				const assistantMessage = result.response + toolInfo;
				session.messageHistory.push({ role: "assistant", content: assistantMessage });
				console.log(`[SLACK] Response (${result.duration}ms, ${result.toolsUsed.length} tools)`);
				return assistantMessage;
			} else {
				console.error(`[SLACK] Agent error: ${result.error}`);
				// Fall back to simple chat on error
			}
		}

		// Fallback: Simple chat without tools
		console.log(`[SLACK] Running simple chat mode for ${session.channelId}:${session.userId}`);

		const messages = session.messageHistory.map((m) => ({
			role: m.role as "user" | "assistant",
			content: m.content,
		}));

		const result = await chat({
			messages: [{ role: "system", content: mode.systemPrompt }, ...messages],
			maxTokens: 4096,
		});

		const assistantMessage = result.success ? result.content : `Error: ${result.error}`;
		session.messageHistory.push({ role: "assistant", content: assistantMessage });

		return assistantMessage;
	} catch (error) {
		const errorMsg = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
		return errorMsg;
	}
}

// ============================================================================
// Slack Bot Setup
// ============================================================================

let slackApp: App | null = null;
let slackWebClient: WebClient | null = null;

export function createSlackBot(): { app: App; webClient: WebClient } {
	const token = process.env.SLACK_BOT_TOKEN;
	const signingSecret = process.env.SLACK_SIGNING_SECRET;
	const appToken = process.env.SLACK_APP_TOKEN;

	if (!token) {
		throw new Error("SLACK_BOT_TOKEN not set");
	}

	// Socket mode requires appToken, HTTP mode requires signingSecret
	const useSocketMode = !!appToken;
	if (!useSocketMode && !signingSecret) {
		throw new Error("SLACK_SIGNING_SECRET required for HTTP mode (or provide SLACK_APP_TOKEN for socket mode)");
	}

	// Create Slack app - socket mode doesn't need signingSecret
	const app = new App({
		token,
		...(signingSecret && { signingSecret }), // Only include if present
		appToken,
		socketMode: useSocketMode,
		logLevel: LogLevel.INFO,
	});

	const webClient = new WebClient(token);

	// ==================== Event Handlers ====================

	// Handle direct messages and mentions
	app.event("app_mention", async ({ event, say }) => {
		if (!event.user) return; // Ignore events without user
		const session = getSession(event.channel, event.user);
		const text = (event.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();

		if (!text) {
			await say("Hi! How can I help you? Send a message or use `/pi help` for commands.");
			return;
		}

		try {
			// Show typing indicator
			await say({ text: "_Thinking..._", thread_ts: event.ts });

			const response = await runAgent(session, text);

			// Send response in thread
			await say({ text: response, thread_ts: event.ts });
		} catch (error) {
			await say({
				text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
				thread_ts: event.ts,
			});
		}
	});

	// Handle direct messages
	app.event("message", async ({ event, say }) => {
		// Only handle DMs (channel type 'im')
		if ((event as any).channel_type !== "im") return;
		if ((event as any).bot_id) return; // Ignore bot messages

		const msg = event as any;
		if (!msg.user || !msg.channel) return; // Ignore events without user/channel
		const session = getSession(msg.channel as string, msg.user as string);

		try {
			const text = (msg.text as string) || "";
			if (!text.trim()) return; // Ignore empty messages
			const response = await runAgent(session, text);
			await say(response);
		} catch (error) {
			await say(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	});

	// ==================== Slash Commands ====================

	// /pi - Main command
	app.command("/pi", async ({ command, ack, respond }) => {
		await ack();

		const args = command.text.trim().split(/\s+/);
		const subcommand = args[0]?.toLowerCase() || "help";
		const rest = args.slice(1).join(" ");

		const session = getSession(command.channel_id, command.user_id);

		switch (subcommand) {
			case "help":
				await respond({
					text: `*Pi Remote Agent - Slack*

*Commands:*
\`/pi help\` - Show this help
\`/pi ask <question>\` - Ask anything
\`/pi mode <name>\` - Switch expert mode
\`/pi status\` - Check bot status
\`/pi modes\` - List expert modes

*Expert Modes:*
• general - Multi-purpose assistant
• developer - Code & software
• researcher - Deep research
• trader - Market analysis
• security - Security analysis

*Usage:*
Mention @Pi or send a DM to chat!`,
				});
				break;

			case "ask": {
				if (!rest) {
					await respond("Please provide a question: `/pi ask <your question>`");
					return;
				}
				const response = await runAgent(session, rest);
				await respond(response);
				break;
			}

			case "mode":
				if (!rest || !SLACK_EXPERT_MODES[rest]) {
					await respond(
						`Available modes: ${Object.keys(SLACK_EXPERT_MODES).join(", ")}\nUsage: \`/pi mode <name>\``,
					);
					return;
				}
				session.expertMode = rest;
				await respond(`Switched to *${SLACK_EXPERT_MODES[rest].name}* mode.`);
				break;

			case "modes": {
				const modeList = Object.entries(SLACK_EXPERT_MODES)
					.map(([key, mode]) => `• *${key}*: ${mode.description}`)
					.join("\n");
				await respond(`*Available Expert Modes:*\n${modeList}`);
				break;
			}

			case "status":
				await respond({
					text: `*Pi Slack Agent Status*
• Status: Online
• Model: Claude Sonnet 4
• Expert Mode: ${session.expertMode}
• Session History: ${session.messageHistory.length} messages`,
				});
				break;

			default: {
				// Treat unknown subcommand as a question
				const answer = await runAgent(session, command.text);
				await respond(answer);
			}
		}
	});

	slackApp = app;
	slackWebClient = webClient;

	return { app, webClient };
}

export function getSlackApp(): App | null {
	return slackApp;
}

export function getSlackWebClient(): WebClient | null {
	return slackWebClient;
}

export { SLACK_EXPERT_MODES as SlackExpertModes };
