/**
 * Health Command
 *
 * SRP: Only handles health check functionality
 * Example of the new command pattern
 */

import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { defineCommand } from "./registry.js";

export const healthCommand = defineCommand({
	name: "health",
	category: "utilities",

	definition: new SlashCommandBuilder().setName("health").setDescription("Check bot health and API status"),

	execute: async (interaction, _context) => {
		await interaction.deferReply();

		const uptime = process.uptime();
		const memory = process.memoryUsage();
		const memoryMB = Math.round(memory.heapUsed / 1024 / 1024);

		const embed = new EmbedBuilder()
			.setTitle("Bot Health")
			.setColor(0x00ff00)
			.addFields(
				{
					name: "Status",
					value: "Online",
					inline: true,
				},
				{
					name: "Uptime",
					value: formatUptime(uptime),
					inline: true,
				},
				{
					name: "Memory",
					value: `${memoryMB} MB`,
					inline: true,
				},
			)
			.setTimestamp();

		await interaction.editReply({ embeds: [embed] });
	},
});

function formatUptime(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	const parts = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);

	return parts.length > 0 ? parts.join(" ") : "< 1m";
}
