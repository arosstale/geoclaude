/**
 * Command Definitions Module
 *
 * SRP: Only handles command definition aggregation
 * OCP: Add new definition files, import here
 *
 * Usage:
 *   import { getAllDefinitions } from "./definitions/index.js";
 *   const commands = getAllDefinitions();
 */

// Types
export type { CommandCategory, CommandDefinition, CommandDefinitionMeta } from "./types.js";

// Definition modules - add new categories here
import { coreDefinitions } from "./core.js";

// import { tradingDefinitions } from "./trading.js";
// import { agentDefinitions } from "./agents.js";
// import { voiceDefinitions } from "./voice.js";
// import { adminDefinitions } from "./admin.js";

/**
 * All command definitions
 * OCP: Add new definition arrays here
 */
const allDefinitions = [
	...coreDefinitions,
	// ...tradingDefinitions,
	// ...agentDefinitions,
	// ...voiceDefinitions,
	// ...adminDefinitions,
];

/**
 * Get all command definitions
 */
export function getAllDefinitions() {
	return allDefinitions;
}

/**
 * Get definitions by category
 */
export function getDefinitionsByCategory(category: string) {
	return allDefinitions.filter((def) => def.category === category);
}

/**
 * Get just the SlashCommandBuilder objects for Discord registration
 */
export function getSlashCommandBuilders() {
	return allDefinitions.filter((def) => def.enabled !== false).map((def) => def.definition);
}
