/**
 * Pi Remote Agent - WhatsApp Bot
 * Professional expert agent system for WhatsApp
 * Shares capabilities with Discord/Telegram/Slack bots
 *
 * Uses whatsapp-web.js (unofficial WhatsApp Web API)
 * Requires QR code scan on first run
 */

import pkg from "whatsapp-web.js";

const { Client, LocalAuth } = pkg;
type WAClient = InstanceType<typeof Client>;
type WAMessage = {
	body: string;
	from: string;
	reply: (text: string) => Promise<void>;
	getChat: () => Promise<any>;
	getMentions: () => Promise<any[]>;
	hasQuotedMsg: boolean;
};

import qrcode from "qrcode-terminal";
import { runSharedAgent } from "../agents/shared-agent.js";
import { chat } from "../ai-provider.js";

// Environment flag for tool mode
const USE_AGENT_TOOLS = process.env.WHATSAPP_USE_TOOLS !== "false"; // Default: true

// ============================================================================
// Types
// ============================================================================

interface WhatsAppSession {
	chatId: string;
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
// Expert Modes (same as Telegram/Slack)
// ============================================================================

export const WHATSAPP_EXPERT_MODES: Record<string, ExpertMode> = {
	general: {
		name: "General Assistant",
		description: "Multi-purpose AI assistant",
		systemPrompt: `You are Pi, a professional AI assistant operating via WhatsApp.
Be concise but thorough. Format responses for WhatsApp (plain text, use *bold* and _italic_).
Keep responses under 4000 characters when possible.`,
	},
	developer: {
		name: "Developer Expert",
		description: "Software development, code review, debugging",
		systemPrompt: `You are Pi Developer, an expert software engineer.
Specialize in: code review, debugging, architecture, best practices.
Languages: Python, TypeScript, Rust, Go, and more.
Format code with \`backticks\` for WhatsApp.`,
	},
	researcher: {
		name: "Research Expert",
		description: "Deep research, analysis, fact-checking",
		systemPrompt: `You are Pi Researcher, an expert research analyst.
Specialize in: deep research, fact-checking, synthesis, analysis.
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
	creative: {
		name: "Creative Expert",
		description: "Writing, content creation, brainstorming",
		systemPrompt: `You are Pi Creative, an expert content creator.
Specialize in: writing, storytelling, brainstorming, content strategy.
Help with creative projects, scripts, marketing copy, and ideation.`,
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

const sessions = new Map<string, WhatsAppSession>();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

function getSession(chatId: string): WhatsAppSession {
	let session = sessions.get(chatId);
	if (!session) {
		session = {
			chatId,
			lastActivity: Date.now(),
			messageHistory: [],
			expertMode: "general",
		};
		sessions.set(chatId, session);
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

async function runAgent(session: WhatsAppSession, userMessage: string): Promise<string> {
	const mode = WHATSAPP_EXPERT_MODES[session.expertMode] || WHATSAPP_EXPERT_MODES.general;

	// Add user message to history
	session.messageHistory.push({ role: "user", content: userMessage });

	// Keep last 20 messages for context
	if (session.messageHistory.length > 20) {
		session.messageHistory = session.messageHistory.slice(-20);
	}

	try {
		// Use shared agent with tools if enabled
		if (USE_AGENT_TOOLS) {
			console.log(`[WHATSAPP] Running with tools enabled for chat ${session.chatId}`);

			const result = await runSharedAgent(
				{
					platform: "whatsapp",
					sessionId: session.chatId,
					userId: session.chatId,
					systemPrompt: mode.systemPrompt,
					model: "glm-4.5-air", // Fast model for WhatsApp
					timeout: 180000, // 3 minutes
				},
				userMessage,
			);

			if (result.success) {
				const toolInfo = result.toolsUsed.length > 0 ? `\n\n_Tools: ${result.toolsUsed.join(", ")}_` : "";
				const assistantMessage = result.response + toolInfo;
				session.messageHistory.push({ role: "assistant", content: assistantMessage });
				console.log(`[WHATSAPP] Response (${result.duration}ms, ${result.toolsUsed.length} tools)`);
				return assistantMessage;
			} else {
				console.error(`[WHATSAPP] Agent error: ${result.error}`);
				// Fall back to simple chat on error
			}
		}

		// Fallback: Simple chat without tools
		console.log(`[WHATSAPP] Running simple chat mode for chat ${session.chatId}`);

		const messages = session.messageHistory.map((m) => ({
			role: m.role as "user" | "assistant",
			content: m.content,
		}));

		const result = await chat({
			messages: [{ role: "system", content: mode.systemPrompt }, ...messages],
			model: "glm-4.5-air",
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
// Command Handlers
// ============================================================================

function handleCommand(session: WhatsAppSession, command: string, args: string): string | null {
	switch (command) {
		case "help":
			return `*Pi WhatsApp Agent*

*How to use:*
Start message with /pi, /ai, @pi, or !pi
Example: /pi what is bitcoin?

*Commands:*
• /help - Show this help
• /mode <name> - Switch expert mode
• /modes - List expert modes
• /status - Check status
• /clear - Clear conversation

*Expert Modes:*
• general - Multi-purpose assistant
• developer - Code & software
• researcher - Deep research
• trader - Market analysis
• creative - Writing & content
• security - Security analysis`;

		case "modes":
			return Object.entries(WHATSAPP_EXPERT_MODES)
				.map(([key, mode]) => `• *${key}*: ${mode.description}`)
				.join("\n");

		case "mode":
			if (!args || !WHATSAPP_EXPERT_MODES[args]) {
				return `Available modes: ${Object.keys(WHATSAPP_EXPERT_MODES).join(", ")}\nUsage: /mode <name>`;
			}
			session.expertMode = args;
			return `Switched to *${WHATSAPP_EXPERT_MODES[args].name}* mode.`;

		case "status":
			return `*Pi WhatsApp Agent Status*
• Status: Online
• Model: GLM-4.5-air (Z.AI)
• Expert Mode: ${session.expertMode}
• History: ${session.messageHistory.length} messages`;

		case "clear":
			session.messageHistory = [];
			return "Conversation cleared.";

		default:
			return null; // Not a command
	}
}

// ============================================================================
// WhatsApp Bot Setup
// ============================================================================

let whatsappClient: WAClient | null = null;

export function createWhatsAppBot(dataPath: string): WAClient {
	const client = new Client({
		authStrategy: new LocalAuth({
			dataPath: `${dataPath}/whatsapp-session`,
		}),
		puppeteer: {
			headless: true,
			args: [
				"--no-sandbox",
				"--disable-setuid-sandbox",
				"--disable-dev-shm-usage",
				"--disable-accelerated-2d-canvas",
				"--no-first-run",
				"--no-zygote",
				"--disable-gpu",
			],
		},
	});

	// QR Code for authentication
	client.on("qr", (qr: string) => {
		console.log("[WHATSAPP] Scan this QR code to log in:");
		qrcode.generate(qr, { small: true });
	});

	// Ready event
	client.on("ready", () => {
		console.log("[INFO] [WHATSAPP] Bot is ready!");
		console.log(`[INFO] [WHATSAPP] Expert modes: ${Object.keys(WHATSAPP_EXPERT_MODES).join(", ")}`);
	});

	// Authentication events
	client.on("authenticated", () => {
		console.log("[INFO] [WHATSAPP] Authenticated successfully");
	});

	client.on("auth_failure", (msg: string) => {
		console.error("[ERROR] [WHATSAPP] Authentication failed:", msg);
	});

	client.on("disconnected", (reason: string) => {
		console.log("[WARN] [WHATSAPP] Disconnected:", reason);
	});

	// Message handler - use message_create to catch own messages too
	client.on("message_create", async (msg: WAMessage) => {
		const text = msg.body.trim();
		console.log(`[WHATSAPP][DEBUG] Message received: "${text.substring(0, 50)}..." from ${msg.from}`);

		if (!text) return;

		// TRIGGER MODE: Only respond to messages starting with /ai, @pi, or !pi
		// This makes it work like Discord bot - doesn't reply to every message
		const lowerText = text.toLowerCase();

		let triggered = false;
		let cleanedText = text;

		// Check for trigger prefixes (with or without space/text after)
		const triggerPatterns = [
			{ pattern: /^\/ai\s*/i, name: "/ai" },
			{ pattern: /^\/pi\s*/i, name: "/pi" },
			{ pattern: /^@pi\s*/i, name: "@pi" },
			{ pattern: /^!pi\s*/i, name: "!pi" },
		];

		for (const { pattern } of triggerPatterns) {
			if (pattern.test(text)) {
				triggered = true;
				cleanedText = text.replace(pattern, "").trim();
				break;
			}
		}

		// Also trigger on exact commands
		if (
			text.startsWith("/") &&
			["/help", "/mode", "/modes", "/status", "/clear"].some((cmd) => lowerText.startsWith(cmd))
		) {
			triggered = true;
			cleanedText = text;
		}

		// If just trigger with no text, show help
		if (triggered && !cleanedText) {
			cleanedText = "/help";
		}

		// If not triggered, ignore the message
		if (!triggered) {
			return;
		}

		const session = getSession(msg.from);
		const chatObj = await msg.getChat();

		// Check for commands
		if (cleanedText.startsWith("/")) {
			const [cmd, ...argParts] = cleanedText.slice(1).split(/\s+/);
			const args = argParts.join(" ");
			const response = handleCommand(session, cmd.toLowerCase(), args);
			if (response) {
				await msg.reply(response);
				return;
			}
		}

		// Process message with AI
		try {
			// Send typing indicator
			await chatObj.sendStateTyping();

			const response = await runAgent(session, cleanedText);

			// Split long messages (WhatsApp limit ~65000, but keep it readable)
			if (response.length > 4000) {
				const chunks = response.match(/[\s\S]{1,4000}/g) || [response];
				for (const chunk of chunks) {
					await msg.reply(chunk);
				}
			} else {
				await msg.reply(response);
			}
		} catch (error) {
			console.error("[ERROR] [WHATSAPP] Message handling error:", error);
			await msg.reply(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	});

	whatsappClient = client;
	return client;
}

export async function startWhatsAppBot(dataPath: string): Promise<WAClient> {
	const client = createWhatsAppBot(dataPath);
	await client.initialize();
	return client;
}

export function getWhatsAppClient(): WAClient | null {
	return whatsappClient;
}

export { WHATSAPP_EXPERT_MODES as WhatsAppExpertModes };
