/**
 * Bot Configuration
 *
 * SRP: Only handles configuration
 * DIP: Abstracts environment variables
 */

import { config } from "dotenv";

// Load environment variables
config();

/**
 * Bot configuration interface
 */
export interface BotConfig {
	/** Discord bot token */
	token: string;

	/** Data directory for persistent storage */
	dataDir: string;

	/** Allowed user IDs (comma-separated in env) */
	allowedUserIds: string[];

	/** Default AI model */
	defaultModel: string;

	/** API keys */
	apiKeys: {
		openRouter?: string;
		groq?: string;
		cerebras?: string;
		zai?: string;
		openCode?: string;
	};

	/** Server ports */
	ports: {
		webhook: number;
		dashboard: number;
	};
}

/**
 * Load configuration from environment
 */
export function loadConfig(): BotConfig {
	const token = process.env.DISCORD_BOT_TOKEN;
	if (!token) {
		throw new Error("DISCORD_BOT_TOKEN is required");
	}

	return {
		token,
		dataDir: process.argv[2] || process.env.DATA_DIR || "./data",
		allowedUserIds: (process.env.ALLOWED_USER_IDS || "")
			.split(",")
			.map((id) => id.trim())
			.filter(Boolean),
		defaultModel: process.env.DEFAULT_MODEL || "glm-4.7",
		apiKeys: {
			openRouter: process.env.OPENROUTER_API_KEY,
			groq: process.env.GROQ_API_KEY,
			cerebras: process.env.CEREBRAS_API_KEY,
			zai: process.env.ZAI_API_KEY,
			openCode: process.env.OPENCODE_API_KEY,
		},
		ports: {
			webhook: parseInt(process.env.WEBHOOK_PORT || "3333", 10),
			dashboard: parseInt(process.env.DASHBOARD_PORT || "9090", 10),
		},
	};
}

/**
 * Validate configuration
 */
export function validateConfig(cfg: BotConfig): string[] {
	const errors: string[] = [];

	if (!cfg.token) {
		errors.push("Missing DISCORD_BOT_TOKEN");
	}

	// Check for at least one API key
	const hasApiKey = Object.values(cfg.apiKeys).some(Boolean);
	if (!hasApiKey) {
		errors.push("No API keys configured (need at least one: OPENROUTER, GROQ, CEREBRAS, ZAI)");
	}

	return errors;
}
