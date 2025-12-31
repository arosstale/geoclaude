/**
 * GEPA Agent - Prompt Optimization via Reflective Text Evolution
 *
 * Integrates GEPA (Genetic-Pareto) optimizer for self-improving agent prompts.
 * Uses LLM reflection to evolve prompts with minimal training data.
 *
 * Features:
 * - Prompt optimization for any agent type
 * - Integration with Agent Experts (expertise files)
 * - Evaluation metrics tracking
 * - DSPy-style optimization support
 *
 * Paper: "GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning"
 * https://arxiv.org/abs/2507.19457
 */

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, "..", "..");
const SCRIPT_PATH = join(PACKAGE_ROOT, "src", "agents", "gepa-runner.py");
const EXPERTISE_DIR = join(PACKAGE_ROOT, "src", "agents", "expertise");

// ============================================================================
// TYPES
// ============================================================================

/** Agent types supported for prompt optimization */
export type GEPAAgentType =
	| "default"
	| "coding"
	| "trading"
	| "research"
	| "security"
	| "database"
	| "api_integration"
	| "performance";

/** Example for training/evaluation */
export interface GEPAExample {
	input: string;
	expected: string;
	keywords?: string[];
	metadata?: Record<string, any>;
}

/** Options for GEPA optimization */
export interface GEPAOptimizeOptions {
	/** Initial prompt to optimize */
	prompt: string;
	/** Training/validation examples */
	examples: GEPAExample[];
	/** Agent type for adapter selection */
	agentType?: GEPAAgentType;
	/** Model for task execution */
	taskModel?: string;
	/** Model for reflection */
	reflectionModel?: string;
	/** Maximum optimization iterations */
	maxIterations?: number;
	/** Domain for saving optimized prompt */
	domain?: string;
	/** Whether to save to expertise file */
	saveToExpertise?: boolean;
	/** Timeout in milliseconds */
	timeout?: number;
}

/** Result from GEPA optimization */
export interface GEPAOptimizeResult {
	success: boolean;
	originalPrompt: string;
	optimizedPrompt?: string;
	improvement?: number;
	bestScore?: number;
	iterations?: number;
	savedTo?: string;
	error?: string;
	duration: number;
}

/** Options for prompt evaluation */
export interface GEPAEvaluateOptions {
	prompt: string;
	examples: GEPAExample[];
	agentType?: GEPAAgentType;
}

/** Evaluation result */
export interface GEPAEvaluateResult {
	success: boolean;
	prompt: string;
	avgScore: number;
	minScore: number;
	maxScore: number;
	numExamples: number;
	passing: number;
	failing: number;
	error?: string;
}

/** GEPA status info */
export interface GEPAStatus {
	available: boolean;
	version: string | null;
	pythonVersion: string;
}

// ============================================================================
// PRESETS
// ============================================================================

/** Preset configurations for common optimization scenarios */
export const GEPAPresets = {
	/** Quick optimization with minimal iterations */
	quick: (prompt: string, examples: GEPAExample[]): GEPAOptimizeOptions => ({
		prompt,
		examples,
		maxIterations: 20,
		taskModel: "openai/gpt-4.1-mini",
		reflectionModel: "openai/gpt-4.1-mini",
	}),

	/** Thorough optimization with more iterations */
	thorough: (prompt: string, examples: GEPAExample[]): GEPAOptimizeOptions => ({
		prompt,
		examples,
		maxIterations: 100,
		taskModel: "openai/gpt-4.1-mini",
		reflectionModel: "openai/gpt-4.1",
	}),

	/** Coding agent optimization */
	coding: (prompt: string, examples: GEPAExample[]): GEPAOptimizeOptions => ({
		prompt,
		examples,
		agentType: "coding",
		maxIterations: 50,
		domain: "coding",
		saveToExpertise: true,
	}),

	/** Trading agent optimization */
	trading: (prompt: string, examples: GEPAExample[]): GEPAOptimizeOptions => ({
		prompt,
		examples,
		agentType: "trading",
		maxIterations: 50,
		domain: "trading",
		saveToExpertise: true,
	}),

	/** Security expert optimization */
	security: (prompt: string, examples: GEPAExample[]): GEPAOptimizeOptions => ({
		prompt,
		examples,
		agentType: "security",
		maxIterations: 75,
		domain: "security",
		saveToExpertise: true,
	}),
};

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Check if GEPA is available
 */
export async function isGEPAAvailable(): Promise<boolean> {
	try {
		const status = await getGEPAStatus();
		return status.available;
	} catch {
		return false;
	}
}

/**
 * Get GEPA status and version info
 */
export async function getGEPAStatus(): Promise<GEPAStatus> {
	return new Promise((resolve) => {
		const python = spawn("python3", [SCRIPT_PATH, "--mode", "status"]);

		let stdout = "";
		let _stderr = "";

		python.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		python.stderr.on("data", (data) => {
			_stderr += data.toString();
		});

		python.on("close", (code) => {
			if (code !== 0) {
				resolve({
					available: false,
					version: null,
					pythonVersion: "unknown",
				});
				return;
			}

			try {
				const result = JSON.parse(stdout.trim());
				resolve({
					available: result.gepa_available,
					version: result.gepa_version,
					pythonVersion: result.python_version,
				});
			} catch {
				resolve({
					available: false,
					version: null,
					pythonVersion: "unknown",
				});
			}
		});

		python.on("error", () => {
			resolve({
				available: false,
				version: null,
				pythonVersion: "unknown",
			});
		});
	});
}

/**
 * Optimize a prompt using GEPA's reflective text evolution
 */
export async function optimizePrompt(options: GEPAOptimizeOptions): Promise<GEPAOptimizeResult> {
	const startTime = Date.now();

	const {
		prompt,
		examples,
		agentType = "default",
		taskModel = "openai/gpt-4.1-mini",
		reflectionModel = "openai/gpt-4.1-mini",
		maxIterations = 50,
		domain,
		saveToExpertise = false,
		timeout = 300000, // 5 minutes default
	} = options;

	return new Promise((resolve) => {
		const args = [
			SCRIPT_PATH,
			"--mode",
			"optimize",
			"--prompt",
			prompt,
			"--examples",
			JSON.stringify(examples),
			"--agent-type",
			agentType,
			"--task-model",
			taskModel,
			"--reflection-model",
			reflectionModel,
			"--max-iterations",
			maxIterations.toString(),
		];

		if (saveToExpertise && domain) {
			args.push("--expertise-dir", EXPERTISE_DIR);
			args.push("--domain", domain);
		}

		const python = spawn("python3", args, {
			env: { ...process.env },
			timeout,
		});

		let stdout = "";
		let stderr = "";

		python.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		python.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		python.on("close", (code) => {
			const duration = Date.now() - startTime;

			if (code !== 0) {
				resolve({
					success: false,
					originalPrompt: prompt,
					error: stderr || `Process exited with code ${code}`,
					duration,
				});
				return;
			}

			try {
				const result = JSON.parse(stdout.trim());
				resolve({
					success: result.success,
					originalPrompt: result.original_prompt,
					optimizedPrompt: result.optimized_prompt,
					improvement: result.improvement,
					bestScore: result.best_score,
					iterations: result.iterations,
					savedTo: result.saved_to,
					error: result.error,
					duration,
				});
			} catch (e) {
				resolve({
					success: false,
					originalPrompt: prompt,
					error: `Failed to parse output: ${e}`,
					duration,
				});
			}
		});

		python.on("error", (err) => {
			resolve({
				success: false,
				originalPrompt: prompt,
				error: `Failed to spawn process: ${err.message}`,
				duration: Date.now() - startTime,
			});
		});
	});
}

/**
 * Evaluate a prompt against examples without optimization
 */
export async function evaluatePrompt(options: GEPAEvaluateOptions): Promise<GEPAEvaluateResult> {
	const { prompt, examples, agentType = "default" } = options;

	return new Promise((resolve) => {
		const args = [
			SCRIPT_PATH,
			"--mode",
			"evaluate",
			"--prompt",
			prompt,
			"--examples",
			JSON.stringify(examples),
			"--agent-type",
			agentType,
		];

		const python = spawn("python3", args);

		let stdout = "";
		let stderr = "";

		python.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		python.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		python.on("close", (code) => {
			if (code !== 0) {
				resolve({
					success: false,
					prompt,
					avgScore: 0,
					minScore: 0,
					maxScore: 0,
					numExamples: examples.length,
					passing: 0,
					failing: examples.length,
					error: stderr || `Process exited with code ${code}`,
				});
				return;
			}

			try {
				const result = JSON.parse(stdout.trim());
				resolve({
					success: result.success,
					prompt: result.prompt,
					avgScore: result.avg_score,
					minScore: result.min_score,
					maxScore: result.max_score,
					numExamples: result.num_examples,
					passing: result.passing,
					failing: result.failing,
					error: result.error,
				});
			} catch (e) {
				resolve({
					success: false,
					prompt,
					avgScore: 0,
					minScore: 0,
					maxScore: 0,
					numExamples: examples.length,
					passing: 0,
					failing: examples.length,
					error: `Failed to parse output: ${e}`,
				});
			}
		});

		python.on("error", (err) => {
			resolve({
				success: false,
				prompt,
				avgScore: 0,
				minScore: 0,
				maxScore: 0,
				numExamples: examples.length,
				passing: 0,
				failing: examples.length,
				error: `Failed to spawn process: ${err.message}`,
			});
		});
	});
}

// ============================================================================
// EXPERTISE INTEGRATION
// ============================================================================

/**
 * Load existing expertise prompt for a domain
 */
export function loadExpertisePrompt(domain: string): string | null {
	const filepath = join(EXPERTISE_DIR, `${domain}.md`);

	if (!existsSync(filepath)) {
		return null;
	}

	return readFileSync(filepath, "utf-8");
}

/**
 * Get all available expertise domains
 */
export function getExpertiseDomains(): string[] {
	if (!existsSync(EXPERTISE_DIR)) {
		return [];
	}

	const { readdirSync } = require("fs");
	const files = readdirSync(EXPERTISE_DIR) as string[];

	return files.filter((f: string) => f.endsWith(".md")).map((f: string) => f.slice(0, -3));
}

/**
 * Optimize an existing expertise prompt with new examples
 */
export async function optimizeExpertise(
	domain: string,
	examples: GEPAExample[],
	options: Partial<GEPAOptimizeOptions> = {},
): Promise<GEPAOptimizeResult> {
	const currentPrompt = loadExpertisePrompt(domain);

	if (!currentPrompt) {
		return {
			success: false,
			originalPrompt: "",
			error: `No existing expertise found for domain: ${domain}`,
			duration: 0,
		};
	}

	return optimizePrompt({
		prompt: currentPrompt,
		examples,
		domain,
		saveToExpertise: true,
		agentType: domain as GEPAAgentType,
		...options,
	});
}

// ============================================================================
// EXAMPLE GENERATORS
// ============================================================================

/**
 * Generate coding examples for optimization
 */
export function generateCodingExamples(): GEPAExample[] {
	return [
		{
			input: "Write a function to reverse a string",
			expected: "function reverseString(s) { return s.split('').reverse().join(''); }",
			keywords: ["function", "reverse", "string", "return"],
		},
		{
			input: "Create a class for a binary search tree",
			expected: "class BST with insert, search, delete methods",
			keywords: ["class", "binary", "search", "tree", "insert"],
		},
		{
			input: "Debug this null pointer error",
			expected: "Add null check before accessing property",
			keywords: ["null", "check", "undefined", "error", "fix"],
		},
		{
			input: "Optimize this O(n^2) loop",
			expected: "Use hash map for O(n) lookup",
			keywords: ["optimize", "complexity", "hash", "performance"],
		},
		{
			input: "Add error handling to API call",
			expected: "try/catch with specific error types and retry logic",
			keywords: ["try", "catch", "error", "retry", "async"],
		},
	];
}

/**
 * Generate trading examples for optimization
 */
export function generateTradingExamples(): GEPAExample[] {
	return [
		{
			input: "Analyze BTC price action",
			expected: "Technical analysis with support/resistance levels and trend direction",
			keywords: ["technical", "support", "resistance", "trend", "bullish", "bearish"],
		},
		{
			input: "Calculate position size for $1000 account with 2% risk",
			expected: "Position size = (Account * Risk) / Stop Loss Distance",
			keywords: ["position", "size", "risk", "stop", "loss"],
		},
		{
			input: "Identify whale movements on-chain",
			expected: "Large wallet transfers to/from exchanges with timing analysis",
			keywords: ["whale", "transfer", "exchange", "wallet", "volume"],
		},
		{
			input: "Backtest moving average crossover strategy",
			expected: "Entry on golden cross, exit on death cross with performance metrics",
			keywords: ["backtest", "moving", "average", "crossover", "entry", "exit"],
		},
		{
			input: "Assess portfolio risk exposure",
			expected: "Correlation matrix, VaR calculation, and diversification analysis",
			keywords: ["portfolio", "risk", "correlation", "VaR", "diversification"],
		},
	];
}

/**
 * Generate security examples for optimization
 */
export function generateSecurityExamples(): GEPAExample[] {
	return [
		{
			input: "Review authentication flow",
			expected: "Check for password hashing, session management, CSRF protection",
			keywords: ["authentication", "password", "hash", "session", "CSRF"],
		},
		{
			input: "Scan for SQL injection vulnerabilities",
			expected: "Identify parameterized queries vs string concatenation",
			keywords: ["SQL", "injection", "parameterized", "sanitize", "escape"],
		},
		{
			input: "Audit API authorization",
			expected: "Verify JWT validation, role-based access, rate limiting",
			keywords: ["JWT", "authorization", "role", "permission", "rate"],
		},
		{
			input: "Check for XSS vulnerabilities",
			expected: "Review output encoding and CSP headers",
			keywords: ["XSS", "encoding", "escape", "CSP", "sanitize"],
		},
		{
			input: "Review secrets management",
			expected: "Check for hardcoded secrets, env vars, and vault usage",
			keywords: ["secrets", "env", "vault", "encryption", "keys"],
		},
	];
}

// ============================================================================
// CONVENIENCE FUNCTION
// ============================================================================

/**
 * Run GEPA optimization with sensible defaults
 */
export async function runGEPA(
	prompt: string,
	examples: GEPAExample[],
	agentType: GEPAAgentType = "default",
): Promise<GEPAOptimizeResult> {
	return optimizePrompt({
		prompt,
		examples,
		agentType,
		maxIterations: 50,
		saveToExpertise: true,
		domain: agentType,
	});
}
