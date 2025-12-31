/**
 * Command Registry
 *
 * OCP: Add new commands by registering, not modifying
 * SRP: Only handles command registration and lookup
 */

import type { CommandCategory, CommandHandler } from "./types.js";

/**
 * Command registry - singleton pattern
 */
class CommandRegistry {
	private commands: Map<string, CommandHandler> = new Map();

	/**
	 * Register a command handler
	 */
	register(handler: CommandHandler): void {
		if (this.commands.has(handler.name)) {
			console.warn(`[Commands] Overwriting existing command: ${handler.name}`);
		}
		this.commands.set(handler.name, handler);
	}

	/**
	 * Register multiple commands
	 */
	registerAll(handlers: CommandHandler[]): void {
		for (const handler of handlers) {
			this.register(handler);
		}
	}

	/**
	 * Get a command handler by name
	 */
	get(name: string): CommandHandler | undefined {
		return this.commands.get(name);
	}

	/**
	 * Check if command exists
	 */
	has(name: string): boolean {
		return this.commands.has(name);
	}

	/**
	 * Get all registered commands
	 */
	getAll(): CommandHandler[] {
		return Array.from(this.commands.values());
	}

	/**
	 * Get all available commands (filters by isAvailable)
	 */
	getAvailable(): CommandHandler[] {
		return this.getAll().filter((cmd) => !cmd.isAvailable || cmd.isAvailable());
	}

	/**
	 * Get commands by category
	 */
	getByCategory(category: CommandCategory): CommandHandler[] {
		return this.getAll().filter((cmd) => cmd.category === category);
	}

	/**
	 * Get all command definitions for Discord registration
	 */
	getDefinitions() {
		return this.getAvailable().map((cmd) => cmd.definition);
	}

	/**
	 * Get command count
	 */
	get size(): number {
		return this.commands.size;
	}

	/**
	 * Clear all commands (for testing)
	 */
	clear(): void {
		this.commands.clear();
	}
}

// Singleton instance
export const commandRegistry = new CommandRegistry();

/**
 * Helper to create a command handler with proper typing
 */
export function defineCommand(handler: CommandHandler): CommandHandler {
	return handler;
}
