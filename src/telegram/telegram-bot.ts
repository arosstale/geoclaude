/**
 * Pi Remote Agent - Telegram Bot
 * Professional expert agent system for Telegram
 * Shares capabilities with Discord bot
 *
 * Supports both polling mode and webhook mode (for VPS with Telegram blocked)
 */

import type { Request, Response } from "express";
import { type Context, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { runSharedAgent } from "../agents/shared-agent.js";
import { createCloudflareDocsTool, isCloudflareConfigured } from "../cloudflare-mcp.js";
import { hfSkills } from "../hf-skills.js";

// Environment flag for tool mode
const USE_AGENT_TOOLS = process.env.TELEGRAM_USE_TOOLS !== "false"; // Default: true

// Webhook configuration
const TELEGRAM_WEBHOOK_DOMAIN = process.env.TELEGRAM_WEBHOOK_DOMAIN || "api.n-art.io";
const TELEGRAM_WEBHOOK_PATH = "/telegram/webhook";
const TELEGRAM_USE_WEBHOOK = process.env.TELEGRAM_USE_WEBHOOK === "true";

// ============================================================================
// Types
// ============================================================================

interface TelegramSession {
	chatId: number;
	lastActivity: number;
	messageHistory: Array<{ role: "user" | "assistant"; content: string }>;
	expertMode: string;
}

interface ExpertMode {
	name: string;
	description: string;
	systemPrompt: string;
	tools: string[];
}

// ============================================================================
// Expert Modes
// ============================================================================

export const EXPERT_MODES: Record<string, ExpertMode> = {
	general: {
		name: "General Assistant",
		description: "Multi-purpose AI assistant with full tool access",
		systemPrompt: `You are Pi, a professional AI assistant operating via Telegram.
You have access to powerful tools including web search, code execution, file operations, and AI models.
Be concise but thorough. Use tools proactively to help users.`,
		tools: ["*"],
	},
	developer: {
		name: "Developer Expert",
		description: "Software development, code review, debugging",
		systemPrompt: `You are Pi Developer, an expert software engineer.
Specialize in: code review, debugging, architecture, best practices.
Languages: Python, TypeScript, Rust, Go, and more.
Use code execution and file tools to demonstrate solutions.`,
		tools: ["bash", "read_file", "write_file", "github_*", "codebase_*"],
	},
	researcher: {
		name: "Research Expert",
		description: "Deep research, analysis, fact-checking",
		systemPrompt: `You are Pi Researcher, an expert research analyst.
Specialize in: deep research, fact-checking, synthesis, analysis.
Use web search and multiple sources to verify information.
Always cite sources and provide evidence-based answers.`,
		tools: ["web_search", "web_fetch", "brave_*", "hf_*"],
	},
	trader: {
		name: "Trading Expert",
		description: "Crypto/stock analysis, market insights",
		systemPrompt: `You are Pi Trader, an expert market analyst.
Specialize in: technical analysis, market sentiment, trading strategies.
Focus on: crypto, stocks, DeFi, on-chain analysis.
Provide actionable insights with risk warnings.`,
		tools: ["price_*", "trading_*", "web_search", "hf_trading_*"],
	},
	creative: {
		name: "Creative Expert",
		description: "Image, video, music, content generation",
		systemPrompt: `You are Pi Creative, an expert in AI-generated content.
Specialize in: image generation, video, music, writing.
Use HuggingFace skills and Suno for media creation.
Focus on quality and artistic direction.`,
		tools: ["hf_*", "suno_*", "fal_*", "generate_*"],
	},
	security: {
		name: "Security Expert",
		description: "Security analysis, vulnerability scanning",
		systemPrompt: `You are Pi Security, a cybersecurity expert.
Specialize in: vulnerability analysis, code security, threat assessment.
Focus on: OWASP Top 10, secure coding, penetration testing concepts.
Provide actionable security recommendations.`,
		tools: ["bash", "read_file", "github_*", "web_search"],
	},
};

// ============================================================================
// Session Management
// ============================================================================

const sessions = new Map<number, TelegramSession>();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

function getSession(chatId: number): TelegramSession {
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
	for (const [chatId, session] of sessions) {
		if (now - session.lastActivity > SESSION_TIMEOUT) {
			sessions.delete(chatId);
		}
	}
}

// Cleanup every 10 minutes
setInterval(cleanupSessions, 10 * 60 * 1000);

// ============================================================================
// Agent Integration
// ============================================================================

async function runAgent(
	session: TelegramSession,
	userMessage: string,
	_onChunk: (text: string) => void,
): Promise<string> {
	const mode = EXPERT_MODES[session.expertMode] || EXPERT_MODES.general;

	// Add user message to history
	session.messageHistory.push({ role: "user", content: userMessage });

	// Keep last 20 messages for context
	if (session.messageHistory.length > 20) {
		session.messageHistory = session.messageHistory.slice(-20);
	}

	try {
		// Use shared agent with tools if enabled
		if (USE_AGENT_TOOLS) {
			console.log(`[TELEGRAM] Running with tools enabled for chat ${session.chatId}`);

			const result = await runSharedAgent(
				{
					platform: "telegram",
					sessionId: String(session.chatId),
					userId: String(session.chatId),
					systemPrompt: mode.systemPrompt,
					model: "glm-4.5-air", // Fast model for Telegram
					timeout: 180000, // 3 minutes
					toolFilter: mode.tools[0] === "*" ? undefined : mode.tools,
				},
				userMessage,
			);

			if (result.success) {
				const toolInfo = result.toolsUsed.length > 0 ? `\n\n_Tools: ${result.toolsUsed.join(", ")}_` : "";
				const assistantMessage = result.response + toolInfo;
				session.messageHistory.push({ role: "assistant", content: assistantMessage });
				console.log(`[TELEGRAM] Response (${result.duration}ms, ${result.toolsUsed.length} tools)`);
				return assistantMessage;
			} else {
				console.error(`[TELEGRAM] Agent error: ${result.error}`);
				// Fall back to simple chat on error
			}
		}

		// Fallback: Simple chat without tools
		console.log(`[TELEGRAM] Running simple chat mode for chat ${session.chatId}`);

		const messages = session.messageHistory.map((m) => ({
			role: m.role as "user" | "assistant",
			content: m.content,
		}));

		const response = await fetch("https://api.z.ai/api/coding/paas/v4/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${process.env.ZAI_API_KEY}`,
			},
			body: JSON.stringify({
				model: "glm-4.5-air",
				messages: [{ role: "system", content: mode.systemPrompt }, ...messages],
				max_tokens: 4096,
				stream: false,
			}),
		});

		const result = await response.json();
		const assistantMessage = result.choices?.[0]?.message?.content || "I apologize, I couldn't generate a response.";

		session.messageHistory.push({ role: "assistant", content: assistantMessage });
		return assistantMessage;
	} catch (error) {
		const errorMsg = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
		return errorMsg;
	}
}

// ============================================================================
// Telegram Bot Setup
// ============================================================================

export function createTelegramBot(): Telegraf {
	const token = process.env.TELEGRAM_BOT_TOKEN;
	if (!token) {
		throw new Error("TELEGRAM_BOT_TOKEN not set");
	}

	const bot = new Telegraf(token, {
		handlerTimeout: 90000, // 90 second timeout for handlers
	});

	// Handle network errors gracefully (ECONNRESET, timeouts, etc.)
	bot.catch((err, ctx) => {
		const errorMsg = err instanceof Error ? err.message : String(err);
		// Don't crash on network errors - Telegraf will retry polling
		if (errorMsg.includes("ECONNRESET") || errorMsg.includes("ETIMEDOUT") || errorMsg.includes("ENOTFOUND")) {
			console.log(`[TELEGRAM] Network error (will retry): ${errorMsg.substring(0, 50)}`);
			return;
		}
		console.error(`[TELEGRAM] Error for ${ctx?.updateType}:`, errorMsg);
	});

	// ==================== Debug Middleware ====================
	// Log ALL incoming updates to debug message reception
	bot.use(async (ctx, next) => {
		console.log(`[TELEGRAM][DEBUG] Update received:`, {
			updateType: ctx.updateType,
			chatId: ctx.chat?.id,
			from: ctx.from?.username || ctx.from?.first_name,
			messageText: ctx.message && "text" in ctx.message ? ctx.message.text?.slice(0, 50) : undefined,
		});
		return next();
	});

	// ==================== Commands ====================

	// /start - Welcome message
	bot.start(async (ctx) => {
		const welcomeMsg = `
*Welcome to Pi Remote Agent*

I'm your professional AI assistant with expert capabilities:

*Expert Modes:*
/mode general - Multi-purpose assistant
/mode developer - Code & software
/mode researcher - Deep research
/mode trader - Market analysis
/mode creative - AI content creation
/mode security - Security analysis

*Quick Commands:*
/ask <question> - Ask anything
/image <prompt> - Generate image
/code <task> - Code assistance
/research <topic> - Deep research
/price <token> - Crypto prices
/status - Check bot status
/help - Full help

Just send a message to chat with me!
`;
		await ctx.reply(welcomeMsg, { parse_mode: "Markdown" });
	});

	// /help - Full help
	bot.help(async (ctx) => {
		const helpMsg = `
*Pi Remote Agent - Commands*

*Chat:*
Just send any message to chat with me.

*Expert Modes:*
\`/mode <mode>\` - Switch expert mode
Available: general, developer, researcher, trader, creative, security

*AI Tools:*
\`/ask <question>\` - Ask anything
\`/image <prompt>\` - Generate image
\`/code <description>\` - Code help
\`/research <topic>\` - Research
\`/analyze <url>\` - Analyze content
\`/cloudflare <query>\` - Search CF docs

*Crypto:*
\`/price <token>\` - Get price
\`/chart <token>\` - Price chart

*Media:*
\`/tts <text>\` - Text to speech
\`/music <prompt>\` - Generate music

*System:*
\`/status\` - Bot status
\`/clear\` - Clear history
\`/mode\` - Current mode

*Tips:*
- I remember our conversation
- Use /clear to start fresh
- Switch modes for specialized help
`;
		await ctx.reply(helpMsg, { parse_mode: "Markdown" });
	});

	// /status - Bot status
	bot.command("status", async (ctx) => {
		const session = getSession(ctx.chat.id);
		const mode = EXPERT_MODES[session.expertMode];
		const statusMsg = `
*Pi Remote Agent Status*

Bot: @Pi_discordbot
Mode: ${mode.name}
History: ${session.messageHistory.length} messages
Uptime: Active

*Capabilities:*
- 93+ MCP Tools
- 39 HuggingFace Skills
- Multi-model AI
- Cross-platform sync
`;
		await ctx.reply(statusMsg, { parse_mode: "Markdown" });
	});

	// /mode - Switch expert mode
	bot.command("mode", async (ctx) => {
		const args = ctx.message.text.split(" ").slice(1);
		const session = getSession(ctx.chat.id);

		if (args.length === 0) {
			// Show current mode and options
			const currentMode = EXPERT_MODES[session.expertMode];
			let modesMsg = `*Current Mode:* ${currentMode.name}\n\n*Available Modes:*\n`;
			for (const [key, mode] of Object.entries(EXPERT_MODES)) {
				modesMsg += `\`/mode ${key}\` - ${mode.description}\n`;
			}
			await ctx.reply(modesMsg, { parse_mode: "Markdown" });
			return;
		}

		const newMode = args[0].toLowerCase();
		if (EXPERT_MODES[newMode]) {
			session.expertMode = newMode;
			const mode = EXPERT_MODES[newMode];
			await ctx.reply(`Switched to *${mode.name}*\n\n${mode.description}`, { parse_mode: "Markdown" });
		} else {
			await ctx.reply(`Unknown mode: ${newMode}\n\nUse /mode to see available modes.`);
		}
	});

	// /clear - Clear conversation history
	bot.command("clear", async (ctx) => {
		const session = getSession(ctx.chat.id);
		session.messageHistory = [];
		await ctx.reply("Conversation history cleared. Starting fresh!");
	});

	// /ask - Direct question
	bot.command("ask", async (ctx) => {
		const question = ctx.message.text.replace(/^\/ask\s*/, "").trim();
		if (!question) {
			await ctx.reply("Usage: /ask <your question>");
			return;
		}

		const session = getSession(ctx.chat.id);
		await ctx.sendChatAction("typing");

		try {
			const response = await runAgent(session, question, () => {});
			await sendLongMessage(ctx, response);
		} catch (error) {
			await ctx.reply(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	});

	// /image - Generate image
	bot.command("image", async (ctx) => {
		const prompt = ctx.message.text.replace(/^\/image\s*/, "").trim();
		if (!prompt) {
			await ctx.reply("Usage: /image <description of image>");
			return;
		}

		await ctx.sendChatAction("upload_photo");
		await ctx.reply(`Generating: "${prompt}"...`);

		try {
			const result = await hfSkills.generateImage({ prompt }, "QWEN_FAST");
			if (result.success && result.data) {
				// Extract image URL from result
				const data = result.data as unknown;
				let imageUrl: string | undefined;
				if (typeof data === "string") {
					imageUrl = data;
				} else if (Array.isArray(data) && data.length > 0) {
					imageUrl = String(data[0]);
				} else if (data && typeof data === "object" && "url" in data) {
					imageUrl = String((data as { url: string }).url);
				}
				if (imageUrl) {
					await ctx.replyWithPhoto({ url: imageUrl }, { caption: prompt });
				} else {
					await ctx.reply("Image generated but URL not available.");
				}
			} else {
				await ctx.reply(`Failed to generate image: ${result.error || "Unknown error"}`);
			}
		} catch (error) {
			await ctx.reply(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	});

	// /code - Code assistance
	bot.command("code", async (ctx) => {
		const task = ctx.message.text.replace(/^\/code\s*/, "").trim();
		if (!task) {
			await ctx.reply("Usage: /code <describe what you need>");
			return;
		}

		const session = getSession(ctx.chat.id);
		session.expertMode = "developer"; // Auto-switch to developer mode
		await ctx.sendChatAction("typing");

		try {
			const response = await runAgent(session, `Help me with this coding task: ${task}`, () => {});
			await sendLongMessage(ctx, response);
		} catch (error) {
			await ctx.reply(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	});

	// /research - Deep research
	bot.command("research", async (ctx) => {
		const topic = ctx.message.text.replace(/^\/research\s*/, "").trim();
		if (!topic) {
			await ctx.reply("Usage: /research <topic to research>");
			return;
		}

		const session = getSession(ctx.chat.id);
		session.expertMode = "researcher";
		await ctx.sendChatAction("typing");
		await ctx.reply(`Researching: "${topic}"...`);

		try {
			const response = await runAgent(
				session,
				`Conduct deep research on this topic and provide a comprehensive analysis: ${topic}`,
				() => {},
			);
			await sendLongMessage(ctx, response);
		} catch (error) {
			await ctx.reply(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	});

	// /price - Crypto price
	bot.command("price", async (ctx) => {
		const token =
			ctx.message.text
				.replace(/^\/price\s*/, "")
				.trim()
				.toUpperCase() || "BTC";

		try {
			const response = await fetch(
				`https://api.coingecko.com/api/v3/simple/price?ids=${token.toLowerCase()}&vs_currencies=usd&include_24hr_change=true`,
			);
			const data = await response.json();

			if (data[token.toLowerCase()]) {
				const price = data[token.toLowerCase()].usd;
				const change = data[token.toLowerCase()].usd_24h_change?.toFixed(2) || "N/A";
				const emoji = parseFloat(change) >= 0 ? "+" : "";
				await ctx.reply(`*${token}*\nPrice: $${price.toLocaleString()}\n24h: ${emoji}${change}%`, {
					parse_mode: "Markdown",
				});
			} else {
				// Try CoinGecko search
				const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${token}`);
				const searchData = await searchRes.json();
				if (searchData.coins?.length > 0) {
					const coin = searchData.coins[0];
					await ctx.reply(`Did you mean *${coin.name}* (${coin.symbol})?\nTry: /price ${coin.id}`, {
						parse_mode: "Markdown",
					});
				} else {
					await ctx.reply(`Token not found: ${token}`);
				}
			}
		} catch (error) {
			await ctx.reply(`Error fetching price: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	});

	// /tts - Text to speech
	bot.command("tts", async (ctx) => {
		const text = ctx.message.text.replace(/^\/tts\s*/, "").trim();
		if (!text) {
			await ctx.reply("Usage: /tts <text to speak>");
			return;
		}

		await ctx.sendChatAction("record_voice");

		try {
			const result = await hfSkills.textToSpeech({ text }, "EDGE_TTS");
			if (result.success && result.data) {
				await ctx.reply(`TTS generated for: "${text.slice(0, 50)}..."`);
			} else {
				await ctx.reply(`TTS failed: ${result.error || "Unknown error"}`);
			}
		} catch (error) {
			await ctx.reply(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	});

	// ==================== Message Handler ====================

	bot.on(message("text"), async (ctx) => {
		const userMessage = ctx.message.text;

		// Skip if it's a command
		if (userMessage.startsWith("/")) return;

		console.log(
			`[TELEGRAM][MSG] Processing message from ${ctx.from?.username || ctx.from?.first_name}: "${userMessage.slice(0, 50)}..."`,
		);

		const session = getSession(ctx.chat.id);
		await ctx.sendChatAction("typing");

		try {
			console.log(`[TELEGRAM][MSG] Calling AI agent...`);
			const response = await runAgent(session, userMessage, () => {});
			console.log(`[TELEGRAM][MSG] AI response (${response.length} chars): "${response.slice(0, 100)}..."`);
			await sendLongMessage(ctx, response);
			console.log(`[TELEGRAM][MSG] Response sent successfully`);
		} catch (error) {
			console.error(`[TELEGRAM][MSG] Error:`, error);
			await ctx.reply(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	});

	// ==================== Photo Handler ====================

	bot.on(message("photo"), async (ctx) => {
		const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Get highest resolution
		const caption = ctx.message.caption || "Analyze this image";

		await ctx.sendChatAction("typing");
		await ctx.reply("Analyzing image...");

		try {
			const fileLink = await ctx.telegram.getFileLink(photo.file_id);
			const session = getSession(ctx.chat.id);
			const response = await runAgent(session, `[Image attached: ${fileLink.href}] ${caption}`, () => {});
			await sendLongMessage(ctx, response);
		} catch (error) {
			await ctx.reply(`Error analyzing image: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	});

	// ==================== Inline Query Handler ====================

	bot.on("inline_query", async (ctx) => {
		const query = ctx.inlineQuery.query;

		if (!query || query.length < 3) {
			await ctx.answerInlineQuery([
				{
					type: "article",
					id: "help",
					title: "Type your question (min 3 chars)",
					description: "Ask Pi anything from any chat!",
					input_message_content: {
						message_text: "Use @Pi_discordbot followed by your question to get AI responses inline.",
					},
				},
			]);
			return;
		}

		try {
			// Quick AI response for inline queries - Z.AI GLM-4.5-air (fast)
			const response = await fetch("https://api.z.ai/api/coding/paas/v4/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${process.env.ZAI_API_KEY}`,
				},
				body: JSON.stringify({
					model: "glm-4.5-air",
					messages: [
						{
							role: "system",
							content: "You are Pi, a helpful AI assistant. Provide concise, accurate answers. Max 200 words.",
						},
						{ role: "user", content: query },
					],
					max_tokens: 500,
				}),
			});

			const result = await response.json();
			const answer = result.choices?.[0]?.message?.content || "I couldn't generate a response.";

			await ctx.answerInlineQuery(
				[
					{
						type: "article",
						id: `answer-${Date.now()}`,
						title: `Pi's Answer`,
						description: answer.slice(0, 100) + (answer.length > 100 ? "..." : ""),
						input_message_content: {
							message_text: `*Question:* ${query}\n\n*Pi:* ${answer}`,
							parse_mode: "Markdown",
						},
					},
				],
				{ cache_time: 10 },
			);
		} catch (_error) {
			await ctx.answerInlineQuery([
				{
					type: "article",
					id: "error",
					title: "Error",
					description: "Failed to get response",
					input_message_content: {
						message_text: "Sorry, I couldn't process your query. Please try again.",
					},
				},
			]);
		}
	});

	// ==================== Browse Command ====================

	bot.command("browse", async (ctx) => {
		const args = ctx.message.text.replace(/^\/browse\s*/, "").trim();
		if (!args) {
			await ctx.reply("Usage: /browse <url> [screenshot|scrape|extract <query>]");
			return;
		}

		const parts = args.split(" ");
		const url = parts[0];
		const action = parts[1] || "scrape";

		await ctx.sendChatAction("typing");
		await ctx.reply(`Browsing ${url}...`);

		try {
			// Dynamic import to avoid circular dependency
			const { browserAutomation } = await import("../browser/index.js");

			if (action === "screenshot") {
				const result = await browserAutomation.screenshot(url);
				if (result.success && result.data?.screenshot) {
					await ctx.replyWithPhoto({ source: result.data.screenshot });
					await browserAutomation.cleanup(result.data.screenshot);
				} else {
					await ctx.reply(`Screenshot failed: ${result.error}`);
				}
			} else if (action === "extract") {
				const extractQuery = parts.slice(2).join(" ") || "main content";
				const result = await browserAutomation.extract(url, extractQuery);
				if (result.success) {
					await sendLongMessage(ctx, `*${result.data?.title || url}*\n\n${result.data?.content}`);
				} else {
					await ctx.reply(`Extract failed: ${result.error}`);
				}
			} else {
				const result = await browserAutomation.scrape(url);
				if (result.success) {
					let response = `*${result.data?.title || url}*\n\n`;
					response += result.data?.content?.slice(0, 2000) || "No content";
					if (result.data?.links?.length) {
						response += `\n\n*Links (${result.data.links.length}):*\n`;
						response += result.data.links
							.slice(0, 5)
							.map((l) => `• ${l.text}`)
							.join("\n");
					}
					await sendLongMessage(ctx, response);
				} else {
					await ctx.reply(`Scrape failed: ${result.error}`);
				}
			}
		} catch (error) {
			await ctx.reply(`Browse error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	});

	// ==================== Search Command ====================

	bot.command("search", async (ctx) => {
		const query = ctx.message.text.replace(/^\/search\s*/, "").trim();
		if (!query) {
			await ctx.reply("Usage: /search <query>");
			return;
		}

		await ctx.sendChatAction("typing");

		try {
			const { browserAutomation } = await import("../browser/index.js");
			const result = await browserAutomation.search(query);

			if (result.success && result.data?.links?.length) {
				let response = `*Search: ${query}*\n\n`;
				response += result.data.links.map((l, i) => `${i + 1}. [${l.text}](${l.href})`).join("\n");
				await ctx.reply(response, { parse_mode: "Markdown", link_preview_options: { is_disabled: true } });
			} else {
				await ctx.reply(`No results found for: ${query}`);
			}
		} catch (error) {
			await ctx.reply(`Search error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	});

	// ==================== Cloudflare Docs Command ====================

	bot.command("cloudflare", async (ctx) => {
		const query = ctx.message.text.replace(/^\/cloudflare\s*/, "").trim();
		if (!query) {
			await ctx.reply(
				"Usage: /cloudflare <query>\n\nSearch Cloudflare documentation for Workers, Pages, R2, D1, AI, etc.",
			);
			return;
		}

		if (!isCloudflareConfigured()) {
			await ctx.reply("Cloudflare MCP not configured. Set CLOUDFLARE_API_TOKEN in .env");
			return;
		}

		await ctx.sendChatAction("typing");

		try {
			const docsTool = createCloudflareDocsTool();
			const result = await docsTool.execute("tg-cf", { label: query, query });
			const text = result.content?.[0]?.type === "text" ? result.content[0].text : "No results";
			await sendLongMessage(ctx, text);
		} catch (error) {
			await ctx.reply(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	});

	// ==================== Bridge to Discord Command ====================

	bot.command("discord", async (ctx) => {
		const message = ctx.message.text.replace(/^\/discord\s*/, "").trim();
		if (!message) {
			await ctx.reply("Usage: /discord <message to send to Discord>");
			return;
		}

		try {
			const result = await bridgeToDiscord({
				chatId: ctx.chat.id,
				username: ctx.from?.username || ctx.from?.first_name || "Telegram User",
				message,
			});

			if (result.success) {
				await ctx.reply(`Message sent to Discord channel.`);
			} else {
				await ctx.reply(`Failed to send to Discord: ${result.error}`);
			}
		} catch (error) {
			await ctx.reply(`Bridge error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	});

	return bot;
}

// ============================================================================
// Bi-directional Bridge
// ============================================================================

interface DiscordBridgeMessage {
	chatId: number;
	username: string;
	message: string;
}

interface BridgeResult {
	success: boolean;
	error?: string;
}

// Discord client reference (set from main.ts)
let discordClientRef: { channels: { cache: Map<string, unknown> } } | null = null;

export function setDiscordClient(client: unknown): void {
	discordClientRef = client as { channels: { cache: Map<string, unknown> } };
}

async function bridgeToDiscord(msg: DiscordBridgeMessage): Promise<BridgeResult> {
	const REPORT_CHANNEL_ID = process.env.REPORT_CHANNEL_ID;

	if (!REPORT_CHANNEL_ID) {
		return { success: false, error: "REPORT_CHANNEL_ID not configured" };
	}

	if (!discordClientRef) {
		// Fallback: Use Discord webhook if available
		const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
		if (webhookUrl) {
			try {
				const response = await fetch(webhookUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						content: `**[From Telegram - @${msg.username}]**\n${msg.message}`,
					}),
				});
				return { success: response.ok };
			} catch {
				return { success: false, error: "Webhook failed" };
			}
		}
		return { success: false, error: "Discord client not connected" };
	}

	try {
		const channel = discordClientRef.channels.cache.get(REPORT_CHANNEL_ID) as {
			send?: (content: string) => Promise<void>;
		};
		if (channel?.send) {
			await channel.send(`**[From Telegram - @${msg.username}]**\n${msg.message}`);
			return { success: true };
		}
		return { success: false, error: "Channel not found" };
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
	}
}

// ============================================================================
// Utilities
// ============================================================================

async function sendLongMessage(ctx: Context, text: string): Promise<void> {
	const MAX_LENGTH = 4096;

	if (text.length <= MAX_LENGTH) {
		await ctx.reply(text, { parse_mode: "Markdown" }).catch(() => ctx.reply(text));
		return;
	}

	// Split into chunks
	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > 0) {
		if (remaining.length <= MAX_LENGTH) {
			chunks.push(remaining);
			break;
		}

		// Find a good break point
		let breakPoint = remaining.lastIndexOf("\n\n", MAX_LENGTH);
		if (breakPoint === -1 || breakPoint < MAX_LENGTH / 2) {
			breakPoint = remaining.lastIndexOf("\n", MAX_LENGTH);
		}
		if (breakPoint === -1 || breakPoint < MAX_LENGTH / 2) {
			breakPoint = remaining.lastIndexOf(" ", MAX_LENGTH);
		}
		if (breakPoint === -1) {
			breakPoint = MAX_LENGTH;
		}

		chunks.push(remaining.slice(0, breakPoint));
		remaining = remaining.slice(breakPoint).trim();
	}

	for (const chunk of chunks) {
		await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() => ctx.reply(chunk));
	}
}

// ============================================================================
// Cross-Platform Bridge
// ============================================================================

export interface CrossPlatformMessage {
	source: "discord" | "telegram";
	sourceId: string;
	targetPlatform: "discord" | "telegram";
	targetId: string;
	message: string;
	attachments?: string[];
}

export async function bridgeMessage(msg: CrossPlatformMessage): Promise<boolean> {
	try {
		if (msg.targetPlatform === "telegram") {
			const token = process.env.TELEGRAM_BOT_TOKEN;
			if (!token) return false;

			const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: msg.targetId,
					text: `[From ${msg.source}]\n\n${msg.message}`,
					parse_mode: "Markdown",
				}),
			});

			return (await response.json()).ok;
		}
		// Discord bridge handled by Discord bot
		return false;
	} catch {
		return false;
	}
}

// ============================================================================
// Webhook Support
// ============================================================================

let telegramBot: Telegraf | null = null;

/**
 * Get webhook handler for Express
 */
export function getTelegramWebhookHandler(): (req: Request, res: Response) => Promise<void> {
	return async (req: Request, res: Response) => {
		if (!telegramBot) {
			res.status(503).json({ error: "Bot not initialized" });
			return;
		}
		try {
			await telegramBot.handleUpdate(req.body);
			res.status(200).json({ ok: true });
		} catch (error) {
			console.error("[TELEGRAM] Webhook error:", error);
			res.status(500).json({ error: "Failed to process update" });
		}
	};
}

/**
 * Set up webhook with Telegram API (call this instead of launch() for webhook mode)
 */
export async function setupTelegramWebhook(bot: Telegraf): Promise<boolean> {
	const token = process.env.TELEGRAM_BOT_TOKEN;
	if (!token) return false;

	const webhookUrl = `https://${TELEGRAM_WEBHOOK_DOMAIN}${TELEGRAM_WEBHOOK_PATH}`;

	try {
		// Set webhook via direct API call (bypasses local network issues)
		const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				url: webhookUrl,
				allowed_updates: ["message", "callback_query", "inline_query"],
				drop_pending_updates: true,
			}),
		});

		const result = await response.json();
		if (result.ok) {
			telegramBot = bot;
			console.log(`[TELEGRAM] Webhook set to: ${webhookUrl}`);
			return true;
		} else {
			console.error("[TELEGRAM] Failed to set webhook:", result.description);
			return false;
		}
	} catch (error) {
		console.error("[TELEGRAM] Webhook setup error:", error);
		return false;
	}
}

/**
 * Check if webhook mode should be used
 */
export function shouldUseWebhook(): boolean {
	return TELEGRAM_USE_WEBHOOK;
}

/**
 * Get webhook path for Express routing
 */
export function getWebhookPath(): string {
	return TELEGRAM_WEBHOOK_PATH;
}

// ============================================================================
// Export
// ============================================================================

export { getSession, sessions, EXPERT_MODES as ExpertModes, TELEGRAM_USE_WEBHOOK, TELEGRAM_WEBHOOK_PATH };
