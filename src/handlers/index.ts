/**
 * Event Handlers Module
 *
 * Strategy Pattern: Each handler implements EventHandler interface
 * OCP: Add new handlers without modifying existing code
 *
 * Usage:
 *   import { registerHandlers } from "./handlers/index.js";
 *   registerHandlers(client, context);
 */

import type { Client } from "discord.js";
import type { EventHandler, HandlerContext } from "./types.js";

// Types
export type { EventHandler, HandlerContext, InteractionHandler, MessageHandler, ReadyHandler } from "./types.js";

// Handlers - import as we migrate them
// import { interactionHandler } from "./interaction.js";
// import { messageHandler } from "./message.js";
// import { readyHandler } from "./ready.js";

/**
 * All event handlers
 * OCP: Add new handlers here
 */
const handlers: EventHandler[] = [
	// interactionHandler,
	// messageHandler,
	// readyHandler,
];

/**
 * Register all handlers with the Discord client
 */
export function registerHandlers(client: Client, context: HandlerContext): void {
	for (const handler of handlers) {
		if (handler.once) {
			client.once(handler.name, (event) => handler.execute(event, context));
		} else {
			client.on(handler.name, (event) => handler.execute(event, context));
		}
	}
	console.log(`[Handlers] Registered ${handlers.length} event handlers`);
}
