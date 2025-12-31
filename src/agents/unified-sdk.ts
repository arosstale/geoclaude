/**
 * Unified SDK Interface
 * Aggregates all 4 SDKs into a single interface for easy access
 *
 * SDKs:
 * 1. Claude Agent SDK - Anthropic's official CLI agent framework
 * 2. OpenCode SDK - Free Grok access
 * 3. OpenHands SDK - Software development agents
 * 4. Pi-Mono SDK - Core agent framework
 */

// Pi-Mono types from core packages
import type { Agent as PiAgent, AgentEvent as PiAgentEvent } from "@mariozechner/pi-agent-core";
import type { Model as PiModel } from "@mariozechner/pi-ai";
import {
	CLAUDE_MODELS,
	ClaudeAgentPresets,
	type ClaudeCLIOptions,
	type ClaudeCLIResult,
	getClaudeVersion,
	isClaudeAgentAvailable,
	runClaudeAgent,
} from "./claude-agent-sdk.js";
import {
	isOpenCodeAvailable,
	OPENCODE_FREE_MODELS,
	type OpenCodeOptions,
	OpenCodePresets,
	type OpenCodeResult,
	runOpenCodeAgent,
} from "./opencode-agent.js";
import {
	isOpenHandsAvailable,
	type OpenHandsOptions,
	OpenHandsPresets,
	type OpenHandsResult,
	runOpenHandsAgent,
} from "./openhands-agent.js";

/**
 * Unified SDK result type
 */
export interface UnifiedResult {
	success: boolean;
	output: string;
	error?: string;
	duration: number;
	sdk: "claude" | "opencode" | "openhands" | "pi-mono";
	model?: string;
	metadata?: Record<string, unknown>;
}

/**
 * SDK availability status
 */
export interface SDKStatus {
	claude: boolean;
	opencode: boolean;
	openhands: boolean;
	piMono: boolean;
}

/**
 * Check availability of all SDKs
 */
export async function checkAllSDKs(): Promise<SDKStatus> {
	const [claude, opencode, openhandsResult] = await Promise.all([
		isClaudeAgentAvailable(),
		isOpenCodeAvailable(),
		isOpenHandsAvailable(),
	]);

	return {
		claude,
		opencode,
		openhands: openhandsResult.available,
		piMono: true, // Always available as core dependency
	};
}

/**
 * Get best available SDK for a task type
 */
export async function getBestSDK(
	taskType: "code" | "research" | "quick" | "security" | "free",
): Promise<"claude" | "opencode" | "openhands" | "pi-mono"> {
	const status = await checkAllSDKs();

	switch (taskType) {
		case "code":
			// Prefer Claude for coding, fallback to OpenHands
			if (status.claude) return "claude";
			if (status.openhands) return "openhands";
			if (status.opencode) return "opencode";
			return "pi-mono";

		case "research":
			// Prefer Claude Opus for research
			if (status.claude) return "claude";
			if (status.opencode) return "opencode";
			return "pi-mono";

		case "quick":
			// Prefer free/fast options
			if (status.opencode) return "opencode";
			if (status.claude) return "claude";
			return "pi-mono";

		case "security":
			// Prefer OpenHands for security scanning
			if (status.openhands) return "openhands";
			if (status.claude) return "claude";
			return "pi-mono";

		case "free":
			// Only free options
			if (status.opencode) return "opencode";
			return "pi-mono";

		default:
			return "pi-mono";
	}
}

/**
 * Run task with best available SDK
 */
export async function runWithBestSDK(
	prompt: string,
	taskType: "code" | "research" | "quick" | "security" | "free" = "code",
): Promise<UnifiedResult> {
	const sdk = await getBestSDK(taskType);
	const startTime = Date.now();

	try {
		switch (sdk) {
			case "claude": {
				const preset =
					taskType === "research"
						? ClaudeAgentPresets.research(prompt)
						: taskType === "quick"
							? ClaudeAgentPresets.quick(prompt)
							: ClaudeAgentPresets.code(prompt);
				const result = await runClaudeAgent(preset);
				return {
					success: result.success,
					output: result.output,
					error: result.error,
					duration: result.duration,
					sdk: "claude",
					metadata: { exitCode: result.exitCode },
				};
			}

			case "opencode": {
				const preset = taskType === "quick" ? OpenCodePresets.fast(prompt) : OpenCodePresets.code(prompt);
				const result = await runOpenCodeAgent(preset);
				return {
					success: result.success,
					output: result.output,
					error: result.error,
					duration: result.duration,
					sdk: "opencode",
					model: result.model,
				};
			}

			case "openhands": {
				const preset =
					taskType === "security"
						? OpenHandsPresets.vulnerabilityScan(process.cwd())
						: OpenHandsPresets.developer(prompt);
				const result = await runOpenHandsAgent(preset);
				return {
					success: result.success,
					output: result.output,
					error: result.error ?? undefined,
					duration: result.duration,
					sdk: "openhands",
					metadata: { mode: result.mode ?? undefined },
				};
			}

			default:
				// Pi-Mono fallback - minimal implementation
				return {
					success: false,
					output: "",
					error: "Pi-Mono direct execution not implemented - use Agent class directly",
					duration: Date.now() - startTime,
					sdk: "pi-mono",
				};
		}
	} catch (error) {
		return {
			success: false,
			output: "",
			error: error instanceof Error ? error.message : String(error),
			duration: Date.now() - startTime,
			sdk,
		};
	}
}

/**
 * SDK info and capabilities
 */
export const SDK_INFO = {
	claude: {
		name: "Claude Agent SDK",
		version: "0.1.76",
		package: "@anthropic-ai/claude-agent-sdk",
		docs: "https://docs.claude.com/en/docs/agent-sdk/overview",
		features: ["File editing", "Command execution", "Code understanding", "Complex workflows"],
		models: CLAUDE_MODELS,
		requiresKey: "ANTHROPIC_API_KEY",
		type: "cli" as const,
	},
	opencode: {
		name: "OpenCode SDK",
		version: "1.0.83",
		package: "@opencode-ai/sdk",
		docs: "https://opencode.ai/docs",
		features: ["Free Grok access", "Multiple free models", "Omni routing"],
		models: OPENCODE_FREE_MODELS,
		requiresKey: "OPENCODE_ZEN_API_KEY (optional)",
		type: "library" as const,
	},
	openhands: {
		name: "OpenHands SDK",
		version: "0.62.0",
		package: "openhands-ai (Python)",
		docs: "https://docs.all-hands.dev",
		features: ["Software development", "Security scanning", "Code review", "Test generation"],
		modes: [
			"developer",
			"vulnerability_scan",
			"code_review",
			"test_generation",
			"documentation",
			"refactor",
			"debug",
			"migrate",
			"optimize",
		],
		requiresKey: "ZAI_API_KEY",
		type: "python" as const,
	},
	piMono: {
		name: "Pi-Mono SDK",
		version: "0.30.2",
		packages: ["@mariozechner/pi-agent-core", "@mariozechner/pi-ai", "@mariozechner/pi-coding-agent"],
		docs: "https://github.com/badlogic/pi-mono",
		features: ["Agent runtime", "Model abstraction", "Event streaming", "Session management"],
		requiresKey: "Various (provider-dependent)",
		type: "library" as const,
	},
} as const;

// Re-export individual SDK functions and types
export {
	// Claude Agent SDK
	runClaudeAgent,
	isClaudeAgentAvailable,
	ClaudeAgentPresets,
	CLAUDE_MODELS,
	getClaudeVersion,
	type ClaudeCLIOptions,
	type ClaudeCLIResult,
	// OpenCode SDK
	runOpenCodeAgent,
	isOpenCodeAvailable,
	OpenCodePresets,
	OPENCODE_FREE_MODELS,
	type OpenCodeOptions,
	type OpenCodeResult,
	// OpenHands SDK
	runOpenHandsAgent,
	isOpenHandsAvailable,
	OpenHandsPresets,
	type OpenHandsOptions,
	type OpenHandsResult,
	// Pi-Mono types
	type PiAgent,
	type PiAgentEvent,
	type PiModel,
};
