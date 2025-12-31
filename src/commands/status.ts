/**
 * Status Command
 *
 * SRP: Only handles bot status display
 */

import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { defineCommand } from "./registry.js";

export const statusCommand = defineCommand({
	name: "status",
	category: "utilities",

	definition: new SlashCommandBuilder().setName("status").setDescription("Show bot status and current model"),

	execute: async (interaction, context) => {
		const { services } = context;

		const uptime = process.uptime();
		const hours = Math.floor(uptime / 3600);
		const mins = Math.floor((uptime % 3600) / 60);
		const uptimeStr = `${hours}h ${mins}m`;

		const currentModelId = services.getCurrentModelId?.(context.userId) ?? "unknown";
		const globalModelId = services.globalModelId ?? "unknown";
		const channelCount = services.getActiveChannelCount?.() ?? 0;

		const embed = new EmbedBuilder()
			.setColor(0x5865f2)
			.setTitle("Bot Status")
			.addFields(
				{ name: "Uptime", value: uptimeStr, inline: true },
				{ name: "Your Model", value: currentModelId, inline: true },
				{ name: "Global Model", value: globalModelId, inline: true },
				{ name: "Active Channels", value: String(channelCount), inline: true },
				{ name: "Data Dir", value: context.dataDir, inline: false },
			)
			.setTimestamp();

		await interaction.reply({ embeds: [embed] });
	},
});
