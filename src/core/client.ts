/**
 * Discord Client Factory
 *
 * Factory Pattern: Creates configured Discord client
 * SRP: Only handles client creation and configuration
 */

import { Client, GatewayIntentBits, Partials } from "discord.js";

/**
 * Client configuration options
 */
export interface ClientOptions {
	/** Enable voice support */
	voice?: boolean;

	/** Enable DM support */
	directMessages?: boolean;

	/** Enable guild message content */
	messageContent?: boolean;
}

/**
 * Create a configured Discord client
 * Factory Pattern: Encapsulates complex client creation
 */
export function createClient(options: ClientOptions = {}): Client {
	const { voice = true, directMessages = true, messageContent = true } = options;

	const intents: GatewayIntentBits[] = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];

	const partials: Partials[] = [];

	// Add optional intents
	if (voice) {
		intents.push(GatewayIntentBits.GuildVoiceStates);
	}

	if (directMessages) {
		intents.push(GatewayIntentBits.DirectMessages, GatewayIntentBits.DirectMessageReactions);
		partials.push(Partials.Channel, Partials.Message);
	}

	if (messageContent) {
		intents.push(GatewayIntentBits.MessageContent);
	}

	return new Client({
		intents,
		partials,
	});
}

/**
 * Default client with all features enabled
 */
export function createDefaultClient(): Client {
	return createClient({
		voice: true,
		directMessages: true,
		messageContent: true,
	});
}
