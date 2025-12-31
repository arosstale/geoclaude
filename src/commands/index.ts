/**
 * Commands Module
 *
 * OCP: Add new commands by importing and adding to array
 * SRP: Each command in its own file
 *
 * Usage in main.ts:
 *   import { commandRegistry, registerAllCommands } from "./commands/index.js";
 *
 *   // Register all commands
 *   registerAllCommands();
 *
 *   // Get handler for a command
 *   const handler = commandRegistry.get(commandName);
 *   if (handler) {
 *     await handler.execute(interaction, context);
 *   }
 */

// Registry
export { commandRegistry, defineCommand } from "./registry.js";
// Types
export type {
	BotStats,
	CommandCategory,
	CommandContext,
	CommandDefinition,
	CommandHandler,
	CommandServices,
} from "./types.js";

import { askCommand } from "./ask.js";
import { bashCommand } from "./bash.js";
// Commands - import as we migrate them
import { healthCommand } from "./health.js";
import { readCommand } from "./read.js";
import { commandRegistry } from "./registry.js";
import { statusCommand } from "./status.js";

/**
 * All migrated commands
 * Add new commands here as they are migrated from main.ts
 */
const commands = [healthCommand, statusCommand, askCommand, bashCommand, readCommand];

/**
 * Register all commands with the registry
 */
export function registerAllCommands(): void {
	commandRegistry.registerAll(commands);
	console.log(`[Commands] Registered ${commandRegistry.size} commands`);
}

/**
 * Get command definitions for Discord registration
 * Use alongside existing slashCommands array during migration
 */
export function getMigratedDefinitions() {
	return commands.map((cmd) => cmd.definition);
}
