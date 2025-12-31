/**
 * Slash Command Definition Types
 *
 * SRP: Only defines types for command definitions
 * DIP: Depend on abstractions (interfaces), not concretions
 */

import type { SlashCommandBuilder, SlashCommandSubcommandsOnlyBuilder } from "discord.js";

/**
 * Command definition type - what Discord needs to register
 * Using ReturnType to capture the actual builder result types
 */
export type CommandDefinition =
	| SlashCommandBuilder
	| SlashCommandSubcommandsOnlyBuilder
	| ReturnType<SlashCommandBuilder["addStringOption"]>
	| ReturnType<SlashCommandBuilder["addBooleanOption"]>
	| ReturnType<SlashCommandBuilder["addIntegerOption"]>;

/**
 * Command definition with metadata
 */
export interface CommandDefinitionMeta {
	/** The slash command builder */
	definition: CommandDefinition;

	/** Category for grouping */
	category: CommandCategory;

	/** Whether this command requires special permissions */
	adminOnly?: boolean;

	/** Whether this command is available */
	enabled?: boolean;
}

/**
 * Command categories - ISP: segregate by purpose
 */
export type CommandCategory =
	| "core" // ask, bash, read, write
	| "memory" // remember, forget, memory
	| "trading" // trading, papertrade, signals
	| "agents" // expert, openhands, daemon, research
	| "voice" // voice, livekit, suno
	| "admin" // admin, provider, model, analytics
	| "utilities" // health, status, tools, reset
	| "ai" // hf, browse, generate
	| "social"; // twitter, telegram
