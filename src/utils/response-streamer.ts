/**
 * AI Response Streaming Utility
 * Progressive response updates for better UX
 */

import type { Message, TextChannel } from "discord.js";

interface StreamerConfig {
	updateInterval: number; // Minimum ms between updates
	maxLength: number; // Max message length (Discord limit)
	thinkingMessage: string; // Initial placeholder
	typingIndicator: boolean; // Show typing before response
}

const DEFAULT_CONFIG: StreamerConfig = {
	updateInterval: 500, // Update every 500ms minimum
	maxLength: 2000, // Discord limit
	thinkingMessage: "🤔 Thinking...",
	typingIndicator: true,
};

/**
 * Stream chunks to a Discord message with progressive updates
 */
export async function streamToMessage(
	message: Message,
	generator: AsyncIterable<string>,
	config: Partial<StreamerConfig> = {},
): Promise<string> {
	const cfg = { ...DEFAULT_CONFIG, ...config };
	let buffer = "";
	let lastUpdate = 0;

	for await (const chunk of generator) {
		buffer += chunk;

		// Throttle updates to avoid rate limits
		const now = Date.now();
		if (now - lastUpdate >= cfg.updateInterval) {
			const content = buffer.length > cfg.maxLength ? `${buffer.slice(-cfg.maxLength)}...` : buffer;

			try {
				await message.edit(content || cfg.thinkingMessage);
				lastUpdate = now;
			} catch {
				// Message may have been deleted, continue buffering
			}
		}
	}

	// Final update with complete content
	const finalContent = buffer.length > cfg.maxLength ? `${buffer.slice(0, cfg.maxLength - 3)}...` : buffer;

	try {
		await message.edit(finalContent || "No response generated.");
	} catch {
		// Ignore if message was deleted
	}

	return buffer;
}

/**
 * Stream response with typing indicator
 */
export async function streamWithTyping(
	channel: TextChannel,
	generator: AsyncIterable<string>,
	config: Partial<StreamerConfig> = {},
): Promise<{ message: Message; content: string }> {
	const cfg = { ...DEFAULT_CONFIG, ...config };

	// Start typing indicator
	if (cfg.typingIndicator) {
		await channel.sendTyping();
	}

	// Send placeholder message
	const message = await channel.send(cfg.thinkingMessage);

	// Stream content
	const content = await streamToMessage(message, generator, cfg);

	return { message, content };
}

/**
 * Create a simple async generator from a string (for testing)
 */
export async function* stringToChunks(text: string, chunkSize = 50): AsyncIterable<string> {
	for (let i = 0; i < text.length; i += chunkSize) {
		yield text.slice(i, i + chunkSize);
		await new Promise((r) => setTimeout(r, 50)); // Simulate delay
	}
}

/**
 * Create chunked progress updates for long operations
 */
export function createProgressUpdater(
	message: Message,
	config: { steps: string[]; updateInterval?: number } = { steps: [] },
): {
	update: (step: number, extra?: string) => Promise<void>;
	complete: (finalMessage: string) => Promise<void>;
	error: (errorMessage: string) => Promise<void>;
} {
	const { steps, updateInterval = 1000 } = config;
	let lastUpdate = 0;

	return {
		async update(step: number, extra?: string) {
			const now = Date.now();
			if (now - lastUpdate < updateInterval) return;

			const progress = steps
				.map((s, i) => {
					if (i < step) return `✅ ${s}`;
					if (i === step) return `⏳ ${s}${extra ? ` (${extra})` : ""}`;
					return `⬜ ${s}`;
				})
				.join("\n");

			try {
				await message.edit(progress);
				lastUpdate = now;
			} catch {
				// Ignore
			}
		},

		async complete(finalMessage: string) {
			try {
				await message.edit(finalMessage);
			} catch {
				// Ignore
			}
		},

		async error(errorMessage: string) {
			try {
				await message.edit(`❌ Error: ${errorMessage}`);
			} catch {
				// Ignore
			}
		},
	};
}

/**
 * Truncate response with smart splitting for Discord
 */
export function truncateForDiscord(content: string, maxLength = 2000): string {
	if (content.length <= maxLength) return content;

	// Try to break at a natural point
	const breakPoints = ["\n\n", "\n", ". ", " "];
	const limit = maxLength - 3; // Room for "..."

	for (const bp of breakPoints) {
		const lastBreak = content.lastIndexOf(bp, limit);
		if (lastBreak > limit * 0.7) {
			return `${content.slice(0, lastBreak)}...`;
		}
	}

	return `${content.slice(0, limit)}...`;
}

/**
 * Split long content into multiple messages
 */
export function splitForDiscord(content: string, maxLength = 2000): string[] {
	if (content.length <= maxLength) return [content];

	const parts: string[] = [];
	let remaining = content;

	while (remaining.length > 0) {
		if (remaining.length <= maxLength) {
			parts.push(remaining);
			break;
		}

		// Find a good break point
		let breakPoint = maxLength;
		const breakPoints = ["\n\n", "\n", ". ", " "];

		for (const bp of breakPoints) {
			const lastBreak = remaining.lastIndexOf(bp, maxLength);
			if (lastBreak > maxLength * 0.5) {
				breakPoint = lastBreak + bp.length;
				break;
			}
		}

		parts.push(remaining.slice(0, breakPoint));
		remaining = remaining.slice(breakPoint);
	}

	return parts;
}
