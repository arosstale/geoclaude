/**
 * Read Command
 *
 * SRP: Only handles file reading
 * DIP: Depends on execCommand abstraction
 */

import { SlashCommandBuilder } from "discord.js";
import { resolve } from "path";
import { defineCommand } from "./registry.js";

const SENSITIVE_PATTERNS = [/\.env$/, /\.ssh\//, /credentials/i, /secrets?\.json$/i, /\.(key|pem)$/i];

function shellEscape(str: string): string {
	return `'${str.replace(/'/g, "'\\''")}'`;
}

export const readCommand = defineCommand({
	name: "read",
	category: "core",

	definition: new SlashCommandBuilder()
		.setName("read")
		.setDescription("Read contents of a file")
		.addStringOption((opt) => opt.setName("path").setDescription("File path to read").setRequired(true))
		.addIntegerOption((opt) =>
			opt.setName("lines").setDescription("Number of lines to read (default: 50)").setRequired(false),
		),

	execute: async (interaction, context) => {
		const path = interaction.options.getString("path", true);
		const lines = interaction.options.getInteger("lines") ?? 50;
		const { services } = context;

		const resolvedPath = resolve(path);

		// Log sensitive file access (YOLO mode)
		if (SENSITIVE_PATTERNS.some((p) => p.test(resolvedPath))) {
			console.warn(`[YOLO] /read sensitive file by ${interaction.user.username}: ${resolvedPath}`);
		}

		await interaction.deferReply();

		try {
			const result = await services.execCommand(`head -n ${lines} ${shellEscape(resolvedPath)}`);

			if (result.code !== 0) {
				await interaction.editReply(`Error: ${result.stderr || "Failed to read file"}`);
				return;
			}

			let output = result.stdout || "(empty file)";
			if (output.length > 1900) {
				output = `${output.substring(0, 1900)}\n...(truncated)`;
			}

			await interaction.editReply(`**${path}** (first ${lines} lines):\n\`\`\`\n${output}\n\`\`\``);
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			await interaction.editReply(`Error: ${errMsg.substring(0, 500)}`);
		}
	},
});
