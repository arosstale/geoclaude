/**
 * Bash Command
 *
 * SRP: Only handles shell command execution
 * DIP: Depends on execCommand abstraction
 */

import { SlashCommandBuilder } from "discord.js";
import { defineCommand } from "./registry.js";

const DANGEROUS_PATTERNS = [/rm\s+-rf?\s+[/~]/, />\s*\/dev\/sd/, /mkfs\./, /dd\s+if=/, /:(){ :|:& };:/];

function isDangerousCommand(command: string): boolean {
	return DANGEROUS_PATTERNS.some((p) => p.test(command));
}

export const bashCommand = defineCommand({
	name: "bash",
	category: "core",

	definition: new SlashCommandBuilder()
		.setName("bash")
		.setDescription("Execute a shell command")
		.addStringOption((opt) => opt.setName("command").setDescription("Command to execute").setRequired(true))
		.addIntegerOption((opt) => opt.setName("timeout").setDescription("Timeout in milliseconds").setRequired(false)),

	execute: async (interaction, context) => {
		const command = interaction.options.getString("command", true);
		const timeout = interaction.options.getInteger("timeout") ?? undefined;
		const { services } = context;

		// Log dangerous commands but execute (YOLO mode)
		if (isDangerousCommand(command)) {
			console.warn(`[YOLO] /bash dangerous command from ${interaction.user.username}: ${command.substring(0, 100)}`);
		}

		await interaction.deferReply();

		try {
			const result = await services.execCommand(command, { timeout });
			let output = result.stdout || result.stderr || "(no output)";

			if (result.code !== 0) {
				output += `\n\nExit code: ${result.code}`;
			}

			if (output.length > 1900) {
				output = `${output.substring(0, 1900)}\n...(truncated)`;
			}

			await interaction.editReply(`\`\`\`\n${output}\n\`\`\``);
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			await interaction.editReply(`Error: ${errMsg.substring(0, 500)}`);
		}
	},
});
