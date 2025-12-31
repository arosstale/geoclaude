/**
 * Event Handler Types
 *
 * SRP: Only defines handler interfaces
 * Strategy Pattern: Different handlers for different events
 */

import type { Client, Interaction, Message } from "discord.js";

/**
 * Base event handler interface
 */
export interface EventHandler<T = unknown> {
	/** Event name */
	name: string;

	/** Whether this handler runs once or on every event */
	once?: boolean;

	/** Execute the handler */
	execute: (event: T, context: HandlerContext) => Promise<void>;
}

/**
 * Context passed to all handlers
 */
export interface HandlerContext {
	/** Discord client */
	client: Client;

	/** Data directory */
	dataDir: string;

	/** Database instance */
	db: unknown;
}

/**
 * Interaction handler (slash commands, buttons, etc.)
 */
export interface InteractionHandler extends EventHandler<Interaction> {
	name: "interactionCreate";
}

/**
 * Message handler (DMs, mentions)
 */
export interface MessageHandler extends EventHandler<Message> {
	name: "messageCreate";
}

/**
 * Ready handler (bot startup)
 */
export interface ReadyHandler extends EventHandler<Client> {
	name: "ready";
	once: true;
}
