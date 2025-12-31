/**
 * Ask Command
 *
 * SRP: Only handles AI question routing
 * DIP: Depends on handleAgentRequest abstraction
 */

import { SlashCommandBuilder } from "discord.js";
import { defineCommand } from "./registry.js";

const MAX_MESSAGE_LENGTH = 2000;

function splitMessage(content: string, maxLength = MAX_MESSAGE_LENGTH): string[] {
	if (content.length <= maxLength) return [content];

	const chunks: string[] = [];
	let remaining = content;

	while (remaining.length > 0) {
		if (remaining.length <= maxLength) {
			chunks.push(remaining);
			break;
		}

		// Find a good break point
		let breakPoint = remaining.lastIndexOf("\n", maxLength);
		if (breakPoint === -1 || breakPoint < maxLength / 2) {
			breakPoint = remaining.lastIndexOf(" ", maxLength);
		}
		if (breakPoint === -1 || breakPoint < maxLength / 2) {
			breakPoint = maxLength;
		}

		chunks.push(remaining.substring(0, breakPoint));
		remaining = remaining.substring(breakPoint).trimStart();
	}

	return chunks;
}

export const askCommand = defineCommand({
	name: "ask",
	category: "core",

	definition: new SlashCommandBuilder()
		.setName("ask")
		.setDescription("Ask the AI agent a question")
		.addStringOption((opt) => opt.setName("question").setDescription("Your question").setRequired(true)),

	execute: async (interaction, context) => {
		const question = interaction.options.getString("question", true);
		const { services } = context;

		if (!services.handleAgentRequest) {
			await interaction.reply("Agent service not available");
			return;
		}

		await interaction.deferReply();

		let hasResponded = false;
		const safeEditReply = async (content: string) => {
			if (hasResponded) return;
			hasResponded = true;

			const chunks = splitMessage(content);
			if (chunks.length === 1) {
				await interaction.editReply(chunks[0]);
			} else {
				await interaction.editReply(chunks[0]);
				for (let i = 1; i < chunks.length; i++) {
					await interaction.followUp(chunks[i]);
				}
			}
		};

		const channelName = interaction.channel?.toString() ?? context.channelId;

		await services.handleAgentRequest(
			context.channelId,
			channelName,
			interaction.user.username,
			context.userId,
			question,
			context.dataDir,
			safeEditReply,
			safeEditReply,
			null,
		);
	},
});
