/**
 * Command Handler Types
 *
 * SRP: Types separated from implementation
 * OCP: New commands extend without modifying core
 */

import type {
	ChatInputCommandInteraction,
	SlashCommandBuilder,
	SlashCommandOptionsOnlyBuilder,
	SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

/**
 * Command definition type - flexible to support all builder patterns
 */
export type CommandDefinition =
	| SlashCommandBuilder
	| SlashCommandSubcommandsOnlyBuilder
	| SlashCommandOptionsOnlyBuilder;

/**
 * Command handler interface - each command implements this
 */
export interface CommandHandler {
	/** Command name (matches slash command) */
	name: string;

	/** Command definition for Discord */
	definition: CommandDefinition;

	/** Execute the command */
	execute: (interaction: ChatInputCommandInteraction, context: CommandContext) => Promise<void>;

	/** Optional: Check if command is available */
	isAvailable?: () => boolean;

	/** Optional: Command category for organization */
	category?: CommandCategory;
}

/**
 * Bot statistics interface
 */
export interface BotStats {
	startTime: number;
	commandsProcessed: number;
}

/**
 * Services interface - DIP: depend on abstractions
 */
export interface CommandServices {
	/** Execute shell command */
	execCommand: (
		command: string,
		options?: { timeout?: number },
	) => Promise<{ stdout: string; stderr: string; code: number }>;

	/** Handle AI agent request */
	handleAgentRequest?: (
		channelId: string,
		channelName: string,
		username: string,
		userId: string,
		message: string,
		workingDir: string,
		onUpdate: (content: string) => Promise<void>,
		onComplete: (content: string) => Promise<void>,
		sourceMessage: unknown,
	) => Promise<void>;

	/** Get current model ID for user */
	getCurrentModelId?: (userId: string) => string;

	/** Global model ID */
	globalModelId?: string;

	/** Get bot statistics */
	getBotStats?: () => BotStats;

	/** Get active channel count */
	getActiveChannelCount?: () => number;
}

/**
 * Context passed to command handlers
 */
export interface CommandContext {
	/** Data directory for bot */
	dataDir: string;

	/** Channel-specific data directory */
	channelDir: string;

	/** Database instance */
	db: unknown; // Will be typed properly when integrated

	/** User ID */
	userId: string;

	/** Channel ID */
	channelId: string;

	/** Guild ID (if in a server) */
	guildId?: string;

	/** Services for command execution */
	services: CommandServices;
}

/**
 * Command categories for organization
 */
export type CommandCategory =
	| "core" // ask, bash, read, etc.
	| "memory" // remember, forget, memory
	| "trading" // trading, papertrade, signals
	| "agents" // expert, openhands, daemon
	| "voice" // voice, livekit
	| "admin" // admin, provider, model
	| "utilities"; // health, status, tools
