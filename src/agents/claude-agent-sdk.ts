/**
 * Claude Agent SDK Integration
 * Official Anthropic CLI for building AI agents with Claude Code capabilities
 *
 * Note: The Claude Agent SDK is a CLI tool (claude), not a programmatic library.
 * This module provides a TypeScript wrapper for subprocess execution.
 *
 * Features:
 * - File editing and code understanding
 * - Command execution
 * - Complex workflow orchestration
 * - Built-in tools (Bash, Read, Write, Edit, etc.)
 *
 * Docs: https://docs.claude.com/en/docs/agent-sdk/overview
 */

import { exec, spawn } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface ClaudeCLIOptions {
	prompt: string;
	model?: string;
	workingDirectory?: string;
	maxTurns?: number;
	timeout?: number;
	allowedTools?: string[];
	disallowedTools?: string[];
	mcpServers?: string[];
	systemPrompt?: string;
	printMode?: boolean;
}

export interface ClaudeCLIResult {
	success: boolean;
	output: string;
	error?: string;
	duration: number;
	exitCode: number;
}

// Model configurations
export const CLAUDE_MODELS = {
	sonnet: {
		id: "claude-sonnet-4-5-20250514",
		name: "Claude Sonnet 4.5",
		description: "Best balance of speed and capability",
	},
	opus: {
		id: "claude-opus-4-5-20250514",
		name: "Claude Opus 4.5",
		description: "Most capable, best for complex tasks",
	},
	haiku: {
		id: "claude-haiku-4-5-20250514",
		name: "Claude Haiku 4.5",
		description: "Fastest, best for simple tasks",
	},
} as const;

export type ClaudeModelKey = keyof typeof CLAUDE_MODELS;

/**
 * Check if Claude CLI is available
 */
export async function isClaudeAgentAvailable(): Promise<boolean> {
	try {
		const { stdout } = await execAsync("claude --version 2>/dev/null");
		return stdout.includes("claude") || stdout.includes("Claude");
	} catch {
		return false;
	}
}

/**
 * Get Claude CLI version
 */
export async function getClaudeVersion(): Promise<string | null> {
	try {
		const { stdout } = await execAsync("claude --version 2>/dev/null");
		return stdout.trim();
	} catch {
		return null;
	}
}

/**
 * Run Claude Agent CLI with a prompt
 */
export async function runClaudeAgent(options: ClaudeCLIOptions): Promise<ClaudeCLIResult> {
	const startTime = Date.now();

	return new Promise((resolve) => {
		const args: string[] = [];

		// Use print mode for non-interactive execution
		if (options.printMode !== false) {
			args.push("--print");
		}

		// Add model if specified
		if (options.model) {
			args.push("--model", options.model);
		}

		// Add max turns
		if (options.maxTurns) {
			args.push("--max-turns", options.maxTurns.toString());
		}

		// Add allowed tools
		if (options.allowedTools?.length) {
			args.push("--allowedTools", options.allowedTools.join(","));
		}

		// Add disallowed tools
		if (options.disallowedTools?.length) {
			args.push("--disallowedTools", options.disallowedTools.join(","));
		}

		// Add MCP servers
		if (options.mcpServers?.length) {
			for (const server of options.mcpServers) {
				args.push("--mcp", server);
			}
		}

		// Add system prompt
		if (options.systemPrompt) {
			args.push("--system-prompt", options.systemPrompt);
		}

		// Add the prompt as the final argument
		args.push(options.prompt);

		const proc = spawn("claude", args, {
			cwd: options.workingDirectory || process.cwd(),
			timeout: options.timeout || 300000, // 5 minute default
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			resolve({
				success: code === 0,
				output: stdout.trim(),
				error: stderr.trim() || undefined,
				duration: Date.now() - startTime,
				exitCode: code ?? 1,
			});
		});

		proc.on("error", (err) => {
			resolve({
				success: false,
				output: "",
				error: err.message,
				duration: Date.now() - startTime,
				exitCode: 1,
			});
		});
	});
}

/**
 * Presets for common use cases
 */
export const ClaudeAgentPresets = {
	/** Quick code task - uses Haiku for speed */
	code: (prompt: string): ClaudeCLIOptions => ({
		prompt,
		model: CLAUDE_MODELS.haiku.id,
		maxTurns: 5,
	}),

	/** Complex analysis or research - uses Sonnet for balance */
	research: (prompt: string): ClaudeCLIOptions => ({
		prompt,
		model: CLAUDE_MODELS.sonnet.id,
		maxTurns: 20,
	}),

	/** Fast simple task - uses Haiku */
	quick: (prompt: string): ClaudeCLIOptions => ({
		prompt,
		model: CLAUDE_MODELS.haiku.id,
		maxTurns: 3,
	}),

	/** File editing task - uses Haiku for speed */
	edit: (prompt: string, workingDirectory: string): ClaudeCLIOptions => ({
		prompt,
		model: CLAUDE_MODELS.haiku.id,
		workingDirectory,
		maxTurns: 10,
	}),

	/** Debugging task - uses Haiku */
	debug: (prompt: string, workingDirectory: string): ClaudeCLIOptions => ({
		prompt: `Debug the following issue:\n\n${prompt}`,
		model: CLAUDE_MODELS.haiku.id,
		workingDirectory,
		maxTurns: 15,
	}),

	/** Code review - uses Sonnet for thorough analysis */
	review: (prompt: string, workingDirectory: string): ClaudeCLIOptions => ({
		prompt: `Review the following code and provide feedback:\n\n${prompt}`,
		model: CLAUDE_MODELS.sonnet.id,
		workingDirectory,
		maxTurns: 10,
	}),

	/** Safe mode - read only, uses Haiku */
	readOnly: (prompt: string): ClaudeCLIOptions => ({
		prompt,
		model: CLAUDE_MODELS.haiku.id,
		allowedTools: ["Read", "Glob", "Grep", "LS"],
		maxTurns: 5,
	}),
};
