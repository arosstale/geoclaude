/**
 * Example Usage: Discord-LiveKit Bridge
 *
 * This example demonstrates how to bridge audio between a Discord voice channel
 * and a LiveKit room.
 */

import type { VoiceChannel } from "discord.js";
import { createBridge, isLiveKitAvailable } from "./discord-livekit-bridge.js";

/**
 * Example: Basic bridge setup
 */
async function basicExample(discordChannel: VoiceChannel) {
	// Check if LiveKit is available
	if (!isLiveKitAvailable()) {
		console.error("LiveKit client not installed. Run: npm install livekit-client");
		return;
	}

	// Create bridge
	const bridge = createBridge({
		discordChannel,
		livekitRoom: "my-room-name",
		livekitUrl: process.env.LIVEKIT_URL || "wss://your-livekit-server.com",
		livekitToken: process.env.LIVEKIT_TOKEN || "",
		bidirectional: true, // Two-way audio (default)
		debug: true, // Enable debug logging
	});

	try {
		// Start bridging
		console.log("Starting bridge...");
		await bridge.start();

		// Get status
		const status = bridge.getStatus();
		console.log("Bridge status:", status);
		// { connected: true, discordUsers: 3, livekitParticipants: 5 }

		// Keep bridge running for 5 minutes
		await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));

		// Stop bridge
		console.log("Stopping bridge...");
		await bridge.stop();
	} catch (error) {
		console.error("Bridge error:", error);
		await bridge.stop();
	}
}

/**
 * Example: Unidirectional bridge (Discord → LiveKit only)
 */
async function unidirectionalExample(discordChannel: VoiceChannel) {
	const bridge = createBridge({
		discordChannel,
		livekitRoom: "broadcast-room",
		bidirectional: false, // One-way audio only
	});

	await bridge.start();

	// Only Discord users speaking will be forwarded to LiveKit
	// LiveKit participants won't be heard in Discord
}

/**
 * Example: Event-driven bridge with monitoring
 */
async function monitoredExample(discordChannel: VoiceChannel) {
	const bridge = createBridge({
		discordChannel,
		livekitRoom: "monitored-room",
		debug: true,
	});

	// Start bridge
	await bridge.start();

	// Monitor status every 10 seconds
	const monitor = setInterval(() => {
		const status = bridge.getStatus();

		if (!status.connected) {
			console.log("Bridge disconnected!");
			clearInterval(monitor);
			return;
		}

		console.log(`Active users - Discord: ${status.discordUsers}, LiveKit: ${status.livekitParticipants}`);
	}, 10000);

	// Stop after some condition
	setTimeout(async () => {
		clearInterval(monitor);
		await bridge.stop();
	}, 30000);
}

/**
 * Example: Error handling and recovery
 */
async function robustExample(discordChannel: VoiceChannel) {
	const bridge = createBridge({
		discordChannel,
		livekitRoom: "robust-room",
	});

	let reconnectAttempts = 0;
	const MAX_RECONNECT_ATTEMPTS = 3;

	async function startBridge() {
		try {
			await bridge.start();
			reconnectAttempts = 0; // Reset on success
		} catch (error) {
			console.error("Failed to start bridge:", error);

			if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
				reconnectAttempts++;
				console.log(`Retrying... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
				await new Promise((resolve) => setTimeout(resolve, 5000));
				await startBridge();
			} else {
				console.error("Max reconnect attempts reached");
			}
		}
	}

	await startBridge();
}

/**
 * Example: Integration with Discord bot
 */
export function setupBridgeCommands(client: { on: (event: string, handler: (...args: any[]) => void) => void }) {
	const activeBridges = new Map<string, ReturnType<typeof createBridge>>();

	// Handle slash command: /bridge start <room>
	client.on("interactionCreate", async (interaction: any) => {
		if (!interaction.isCommand()) return;

		if (interaction.commandName === "bridge") {
			const subcommand = interaction.options.getSubcommand();

			if (subcommand === "start") {
				const roomName = interaction.options.getString("room", true);
				const member = interaction.member;

				if (!member?.voice?.channel) {
					await interaction.reply("You must be in a voice channel!");
					return;
				}

				// Create and start bridge
				const bridge = createBridge({
					discordChannel: member.voice.channel,
					livekitRoom: roomName,
					debug: true,
				});

				try {
					await bridge.start();
					activeBridges.set(interaction.guildId, bridge);
					await interaction.reply(`Bridge started to room: ${roomName}`);
				} catch (error) {
					await interaction.reply(`Failed to start bridge: ${error}`);
				}
			} else if (subcommand === "stop") {
				const bridge = activeBridges.get(interaction.guildId);
				if (!bridge) {
					await interaction.reply("No active bridge in this server");
					return;
				}

				await bridge.stop();
				activeBridges.delete(interaction.guildId);
				await interaction.reply("Bridge stopped");
			} else if (subcommand === "status") {
				const bridge = activeBridges.get(interaction.guildId);
				if (!bridge) {
					await interaction.reply("No active bridge in this server");
					return;
				}

				const status = bridge.getStatus();
				await interaction.reply(
					`Bridge Status:\n` +
						`Connected: ${status.connected}\n` +
						`Discord Users: ${status.discordUsers}\n` +
						`LiveKit Participants: ${status.livekitParticipants}`,
				);
			}
		}
	});

	// Cleanup on bot shutdown
	process.on("SIGINT", async () => {
		console.log("Stopping all bridges...");
		for (const bridge of activeBridges.values()) {
			await bridge.stop();
		}
		process.exit(0);
	});
}

// Export examples for documentation
export { basicExample, unidirectionalExample, monitoredExample, robustExample };
