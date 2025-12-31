/**
 * Core Command Definitions
 *
 * SRP: Only defines core slash commands (ask, bash, read, write)
 * OCP: Add new core commands by adding to array, not modifying
 */

import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinitionMeta } from "./types.js";

/**
 * /ask - Main AI interaction command
 */
const askDefinition: CommandDefinitionMeta = {
	category: "core",
	definition: new SlashCommandBuilder()
		.setName("ask")
		.setDescription("Ask the AI assistant anything")
		.addStringOption((option) =>
			option.setName("prompt").setDescription("Your question or request").setRequired(true),
		)
		.addBooleanOption((option) =>
			option.setName("ephemeral").setDescription("Only you can see the response").setRequired(false),
		),
};

/**
 * /bash - Execute shell commands
 */
const bashDefinition: CommandDefinitionMeta = {
	category: "core",
	definition: new SlashCommandBuilder()
		.setName("bash")
		.setDescription("Execute a shell command")
		.addStringOption((option) =>
			option.setName("command").setDescription("The command to execute").setRequired(true),
		),
};

/**
 * /read - Read file contents
 */
const readDefinition: CommandDefinitionMeta = {
	category: "core",
	definition: new SlashCommandBuilder()
		.setName("read")
		.setDescription("Read a file's contents")
		.addStringOption((option) => option.setName("path").setDescription("Path to the file").setRequired(true))
		.addIntegerOption((option) =>
			option.setName("lines").setDescription("Number of lines to read (default: all)").setRequired(false),
		),
};

/**
 * /health - Bot health check
 */
const healthDefinition: CommandDefinitionMeta = {
	category: "utilities",
	definition: new SlashCommandBuilder().setName("health").setDescription("Check bot health and API status"),
};

/**
 * /status - Bot status
 */
const statusDefinition: CommandDefinitionMeta = {
	category: "utilities",
	definition: new SlashCommandBuilder().setName("status").setDescription("View bot status and statistics"),
};

/**
 * /reset - Clear conversation
 */
const resetDefinition: CommandDefinitionMeta = {
	category: "utilities",
	definition: new SlashCommandBuilder().setName("reset").setDescription("Clear conversation history for this channel"),
};

/**
 * All core command definitions
 * OCP: Add new definitions here
 */
export const coreDefinitions: CommandDefinitionMeta[] = [
	askDefinition,
	bashDefinition,
	readDefinition,
	healthDefinition,
	statusDefinition,
	resetDefinition,
];
