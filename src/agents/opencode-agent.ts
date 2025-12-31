/**
 * OpenCode Agent - Access models via OpenCode CLI
 * Uses opencode CLI for reliable model access via GitHub Copilot, DeepSeek, OpenRouter
 *
 * Required environment variables:
 * - GITHUB_TOKEN for GitHub Copilot/GitHub Models (Grok, Claude, GPT, etc.)
 * - DEEPSEEK_API_KEY for DeepSeek models
 * - OPENROUTER_API_KEY for OpenRouter models
 */

import { execSync, spawn } from "child_process";

export interface OpenCodeOptions {
	prompt: string;
	model?: string; // Model key: "grok", "minimax", "pickle" (default: grok)
	systemPrompt?: string;
	timeout?: number;
}

export interface OpenCodeResult {
	success: boolean;
	output: string;
	error?: string;
	duration: number;
	model: string;
	sessionId?: string;
}

// Models available via OpenCode CLI (provider/model format)
export const OPENCODE_FREE_MODELS = {
	grok: { fullModel: "github-copilot/grok-code-fast-1", name: "Grok Code Fast 1" },
	grok3: { fullModel: "github-models/xai/grok-3", name: "Grok 3" },
	deepseek: { fullModel: "deepseek/deepseek-chat", name: "DeepSeek Chat" },
	phi4: { fullModel: "github-models/microsoft/phi-4", name: "Microsoft Phi-4" },
	claude: { fullModel: "github-copilot/claude-sonnet-4", name: "Claude Sonnet 4" },
	gpt: { fullModel: "github-copilot/gpt-4o", name: "GPT-4o" },
} as const;

export type OpenCodeModelKey = keyof typeof OPENCODE_FREE_MODELS;

// Default model
const DEFAULT_MODEL: OpenCodeModelKey = "grok";

// Omni routing patterns
const OMNI_PATTERNS = {
	code: [
		/\b(code|function|class|implement|debug|fix|refactor|typescript|javascript|python|rust|go)\b/i,
		/\b(api|endpoint|server|database|query|sql|schema)\b/i,
		/\b(test|unit|integration|coverage|assert)\b/i,
		/\b(build|compile|deploy|docker|kubernetes)\b/i,
	],
	reasoning: [
		/\b(analyze|reason|think|explain|why|how|understand)\b/i,
		/\b(complex|difficult|challenging|hard|problem)\b/i,
		/\b(math|logic|proof|theorem|calculate)\b/i,
	],
};

/**
 * Omni Router - Automatically selects best model based on prompt
 */
export function omniRoute(prompt: string): OpenCodeModelKey {
	const lowerPrompt = prompt.toLowerCase();

	// Check code patterns - use Grok for code
	for (const pattern of OMNI_PATTERNS.code) {
		if (pattern.test(lowerPrompt)) {
			return "grok";
		}
	}

	// Check reasoning patterns - use DeepSeek for complex reasoning
	for (const pattern of OMNI_PATTERNS.reasoning) {
		if (pattern.test(lowerPrompt)) {
			return "deepseek";
		}
	}

	// Default to grok (good general purpose)
	return "grok";
}

/**
 * Check if OpenCode CLI is available
 */
function checkOpenCodeCLI(): boolean {
	try {
		execSync("which opencode", { encoding: "utf-8" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Run a task using OpenCode CLI
 * @param options - Options including prompt, model selection, timeout
 */
export async function runOpenCodeAgent(options: OpenCodeOptions): Promise<OpenCodeResult> {
	const { prompt, model: modelKey = DEFAULT_MODEL, systemPrompt, timeout = 60000 } = options;

	// Get model config (default to grok if invalid key)
	const modelConfig = OPENCODE_FREE_MODELS[modelKey as OpenCodeModelKey] || OPENCODE_FREE_MODELS[DEFAULT_MODEL];

	const startTime = Date.now();

	console.log(`[OpenCode] Starting with model: ${modelConfig.fullModel}, prompt: ${prompt.substring(0, 50)}...`);

	return new Promise((resolve) => {
		// Build command arguments
		// Use --agent general to prevent agentic tool use (web search, file ops, etc.)
		const args = ["run", "--agent", "general", "-m", modelConfig.fullModel];

		// Build the prompt (include system prompt if provided)
		const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
		args.push(fullPrompt);

		let resolved = false;

		const proc = spawn("opencode", args, {
			cwd: "/tmp", // Run from /tmp to avoid agentic codebase exploration
			stdio: ["ignore", "pipe", "pipe"], // Don't wait for stdin
			env: process.env,
		});

		// Manual timeout
		const timeoutId = setTimeout(() => {
			if (!resolved) {
				resolved = true;
				console.log(`[OpenCode] Timeout after ${timeout}ms`);
				proc.kill("SIGTERM");
				resolve({
					success: false,
					output: "",
					error: `Timeout after ${timeout}ms`,
					duration: Date.now() - startTime,
					model: modelConfig.fullModel,
				});
			}
		}, timeout);

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			if (resolved) return;
			resolved = true;
			clearTimeout(timeoutId);

			const output = stdout.trim();
			const success = code === 0 && output.length > 0;

			// Check for rate limiting in stderr or empty output with success code
			let errorMsg = stderr.trim() || `Exit code: ${code}`;
			if (!success && output.length === 0 && code === 0) {
				// OpenCode exits 0 but no output often means API error (rate limit, auth, etc.)
				errorMsg = "API error - possibly rate limited (429). Wait a few minutes and try again.";
			}

			console.log(
				`[OpenCode] Completed in ${Date.now() - startTime}ms, success: ${success}, output length: ${output.length}`,
			);

			resolve({
				success,
				output: output || "(no output)",
				error: success ? undefined : errorMsg,
				duration: Date.now() - startTime,
				model: modelConfig.fullModel,
			});
		});

		proc.on("error", (err) => {
			if (resolved) return;
			resolved = true;
			clearTimeout(timeoutId);

			console.log(`[OpenCode] Error: ${err.message}`);

			resolve({
				success: false,
				output: "",
				error: err.message,
				duration: Date.now() - startTime,
				model: modelConfig.fullModel,
			});
		});
	});
}

/**
 * Check if OpenCode CLI is available
 */
export function isOpenCodeAvailable(): boolean {
	return checkOpenCodeCLI();
}

/**
 * Get the free model name by key
 */
export function getGrokModelName(modelKey: OpenCodeModelKey = "grok"): string {
	return OPENCODE_FREE_MODELS[modelKey]?.name || OPENCODE_FREE_MODELS.grok.name;
}

/**
 * Get all available models
 */
export function getOpenCodeModels(): Record<OpenCodeModelKey, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(OPENCODE_FREE_MODELS)) {
		result[key] = value.name;
	}
	return result as Record<OpenCodeModelKey, string>;
}

/**
 * Check if GitHub token is configured (required for most models)
 */
export function hasGitHubToken(): boolean {
	return !!process.env.GITHUB_TOKEN;
}

/**
 * Cleanup OpenCode (no-op for CLI-based approach)
 */
export async function disposeOpenCode(): Promise<void> {
	// No cleanup needed for CLI-based approach
}

/**
 * Run with Omni auto-routing (selects best model automatically)
 */
export async function runOmniAgent(options: Omit<OpenCodeOptions, "model">): Promise<OpenCodeResult> {
	const selectedModel = omniRoute(options.prompt);
	return runOpenCodeAgent({ ...options, model: selectedModel });
}

/**
 * Pre-configured OpenCode agent presets (all free models)
 */
export const OpenCodePresets = {
	/** Omni - Auto-routes to best model based on prompt */
	omni: (prompt: string, systemPrompt?: string): OpenCodeOptions => ({
		prompt,
		model: omniRoute(prompt),
		systemPrompt,
		timeout: 60000,
	}),

	/** Quick coding task (uses Grok - best for code) */
	code: (task: string, model: OpenCodeModelKey = "grok"): OpenCodeOptions => ({
		prompt: task,
		model,
		timeout: 60000,
	}),

	/** Fast response */
	fast: (prompt: string, model: OpenCodeModelKey = "grok"): OpenCodeOptions => ({
		prompt,
		model,
		timeout: 30000,
	}),

	/** Trading analysis */
	trading: (symbol: string, data: string): OpenCodeOptions => ({
		prompt: `Analyze trading data for ${symbol}:\n\n${data}`,
		model: "grok",
		systemPrompt: "You are a quantitative trading analyst. Provide data-driven insights.",
		timeout: 45000,
	}),

	/** Reasoning tasks (uses DeepSeek) */
	reasoning: (prompt: string): OpenCodeOptions => ({
		prompt,
		model: "deepseek",
		timeout: 60000,
	}),

	/** Advanced reasoning (uses Grok 3) */
	advanced: (prompt: string): OpenCodeOptions => ({
		prompt,
		model: "grok3",
		timeout: 60000,
	}),
};
