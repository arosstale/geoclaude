/**
 * ARC-AGI DSPy Evolution Agent
 *
 * Evolves optimal DSPy modules to solve ARC-AGI 2 tasks using GEPA:
 * - Student model: Gemini Flash 3 (fast task execution)
 * - Teacher model: Gemini 3 Pro (deep reflection and mutation)
 *
 * Based on: https://github.com/gepa-ai/gepa
 * Paper: GEPA - System Optimization Through Reflective Text Evolution
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, "..", "..");
const RUNNER_PATH = join(PACKAGE_ROOT, "src", "agents", "arc-agi-evolve.py");
const EVOLUTION_DIR = join(PACKAGE_ROOT, "data", "arc-agi-evolution");

// ============================================================================
// TYPES
// ============================================================================

/** ARC-AGI task structure */
export interface ARCTask {
	taskId: string;
	train: Array<{ input: number[][]; output: number[][] }>;
	test: Array<{ input: number[][]; output: number[][] }>;
}

/** Evolution configuration */
export interface ARCEvolutionConfig {
	/** Number of ARC tasks to use for training */
	numTasks?: number;
	/** Maximum evolution iterations */
	maxIterations?: number;
	/** Seed program type: minimal, pattern, or advanced */
	seedType?: "minimal" | "pattern" | "advanced";
	/** Student model (task execution) - defaults to Gemini Flash 3 */
	studentModel?: string;
	/** Teacher model (reflection) - defaults to Gemini 3 Pro */
	teacherModel?: string;
	/** Output file for evolved program */
	outputPath?: string;
	/** Timeout in milliseconds */
	timeout?: number;
}

/** Evolution result */
export interface ARCEvolutionResult {
	success: boolean;
	bestProgram?: string;
	bestScore?: number;
	initialScore?: number;
	improvement?: number;
	iterations?: number;
	paretoFrontSize?: number;
	error?: string;
	duration: number;
}

/** Evaluation result */
export interface ARCEvaluationResult {
	success: boolean;
	totalTasks?: number;
	exactMatches?: number;
	passAt1?: number;
	avgScore?: number;
	results?: Array<{
		taskId: string;
		score: number;
		exactMatch?: boolean;
		error?: string;
	}>;
	error?: string;
	duration: number;
}

/** ARC-AGI agent status */
export interface ARCAgentStatus {
	dspyAvailable: boolean;
	gepaAvailable: boolean;
	pythonVersion: string;
	studentModel: string;
	teacherModel: string;
}

// ============================================================================
// PRESETS
// ============================================================================

/** Default models for student-teacher paradigm (via OpenRouter for reliability) */
export const GeminiModels = {
	/** Gemini Flash - fast task execution (OpenRouter free tier) */
	student: "openrouter/google/gemini-2.0-flash-exp:free",
	/** Gemini 3 Pro - deep reflection */
	teacher: "openrouter/google/gemini-3-pro-preview",
	/** Alternative: Direct Gemini API (requires GEMINI_API_KEY) */
	studentDirect: "gemini/gemini-2.0-flash-exp",
	teacherDirect: "gemini/gemini-exp-1206",
};

/** DeepSeek models - Best cost efficiency (~$0.14/1M in, $0.28/1M out) */
export const DeepSeekModels = {
	/** DeepSeek V3 - fast task execution */
	student: "openrouter/deepseek/deepseek-chat",
	/** DeepSeek V3.2 - enhanced reflection */
	teacher: "openrouter/deepseek/deepseek-chat-v3-0324",
};

/** Recommended: Full DeepSeek for 90% quality at 1/50th cost */
export const DefaultModels = DeepSeekModels;

/** Evolution presets for different scenarios */
export const ARCEvolvePresets = {
	/** Quick evolution for testing (5 tasks, 20 iterations) */
	quick: (): ARCEvolutionConfig => ({
		numTasks: 5,
		maxIterations: 20,
		seedType: "minimal",
	}),

	/** Standard evolution (20 tasks, 100 iterations) */
	standard: (): ARCEvolutionConfig => ({
		numTasks: 20,
		maxIterations: 100,
		seedType: "pattern",
	}),

	/** Thorough evolution (50 tasks, 500 iterations) */
	thorough: (): ARCEvolutionConfig => ({
		numTasks: 50,
		maxIterations: 500,
		seedType: "advanced",
	}),

	/** Competition-grade (all tasks, maximum iterations) */
	competition: (): ARCEvolutionConfig => ({
		numTasks: 100,
		maxIterations: 2000,
		seedType: "advanced",
		timeout: 3600000, // 1 hour
	}),
};

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Check if ARC-AGI agent is available (GEPA + DSPy installed)
 */
export async function isARCAgentAvailable(): Promise<boolean> {
	try {
		const status = await getARCAgentStatus();
		return status.dspyAvailable && status.gepaAvailable;
	} catch {
		return false;
	}
}

/**
 * Get ARC-AGI agent status and version info
 */
export async function getARCAgentStatus(): Promise<ARCAgentStatus> {
	return new Promise((resolve) => {
		const python = spawn("python3", [RUNNER_PATH, "--mode", "status"], {
			timeout: 30000,
		});

		let stdout = "";
		python.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		python.on("close", (_code) => {
			try {
				const result = JSON.parse(stdout.trim());
				resolve({
					dspyAvailable: result.dspy_available,
					gepaAvailable: result.gepa_available,
					pythonVersion: result.python_version,
					studentModel: result.student_model,
					teacherModel: result.teacher_model,
				});
			} catch {
				resolve({
					dspyAvailable: false,
					gepaAvailable: false,
					pythonVersion: "unknown",
					studentModel: GeminiModels.student,
					teacherModel: GeminiModels.teacher,
				});
			}
		});

		python.on("error", () => {
			resolve({
				dspyAvailable: false,
				gepaAvailable: false,
				pythonVersion: "unknown",
				studentModel: GeminiModels.student,
				teacherModel: GeminiModels.teacher,
			});
		});
	});
}

/**
 * Evolve an optimal DSPy program for ARC-AGI solving
 */
export async function evolveARCSolver(config: ARCEvolutionConfig = {}): Promise<ARCEvolutionResult> {
	const startTime = Date.now();

	const {
		numTasks = 10,
		maxIterations = 100,
		seedType = "minimal",
		studentModel = GeminiModels.student,
		teacherModel = GeminiModels.teacher,
		outputPath,
		timeout = 600000, // 10 minutes default
	} = config;

	// Ensure evolution directory exists
	if (!existsSync(EVOLUTION_DIR)) {
		mkdirSync(EVOLUTION_DIR, { recursive: true });
	}

	return new Promise((resolve) => {
		const args = [
			RUNNER_PATH,
			"--mode",
			"evolve",
			"--tasks",
			numTasks.toString(),
			"--iterations",
			maxIterations.toString(),
			"--seed",
			seedType,
			"--student-model",
			studentModel,
			"--teacher-model",
			teacherModel,
			"--json",
		];

		if (outputPath) {
			args.push("--output", outputPath);
		}

		const python = spawn("python3", args, { timeout });

		let stdout = "";
		let stderr = "";

		python.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		python.stderr.on("data", (data) => {
			stderr += data.toString();
			// Log progress to console
			process.stderr.write(data);
		});

		python.on("close", (code) => {
			const duration = Date.now() - startTime;

			if (code !== 0) {
				resolve({
					success: false,
					error: stderr || `Process exited with code ${code}`,
					duration,
				});
				return;
			}

			try {
				const result = JSON.parse(stdout.trim());
				resolve({
					success: result.success,
					bestProgram: result.best_program,
					bestScore: result.best_score,
					initialScore: result.initial_score,
					improvement: result.improvement,
					iterations: result.iterations,
					paretoFrontSize: result.pareto_front_size,
					error: result.error,
					duration,
				});
			} catch (e) {
				resolve({
					success: false,
					error: `Failed to parse output: ${e}`,
					duration,
				});
			}
		});

		python.on("error", (err) => {
			resolve({
				success: false,
				error: `Failed to spawn process: ${err.message}`,
				duration: Date.now() - startTime,
			});
		});
	});
}

/**
 * Evaluate a DSPy program on ARC tasks
 */
export async function evaluateARCProgram(
	programPath: string,
	numTasks: number = 20,
	model: string = GeminiModels.student,
): Promise<ARCEvaluationResult> {
	const startTime = Date.now();

	return new Promise((resolve) => {
		const python = spawn(
			"python3",
			[
				RUNNER_PATH,
				"--mode",
				"evaluate",
				"--program",
				programPath,
				"--tasks",
				numTasks.toString(),
				"--student-model",
				model,
				"--json",
			],
			{ timeout: 300000 },
		);

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
					error: stderr || `Process exited with code ${code}`,
					duration,
				});
				return;
			}

			try {
				const result = JSON.parse(stdout.trim());
				resolve({
					success: result.success,
					totalTasks: result.total_tasks,
					exactMatches: result.exact_matches,
					passAt1: result.pass_at_1,
					avgScore: result.avg_score,
					results: result.results?.map((r: any) => ({
						taskId: r.task_id,
						score: r.score,
						exactMatch: r.exact_match,
						error: r.error,
					})),
					error: result.error,
					duration,
				});
			} catch (e) {
				resolve({
					success: false,
					error: `Failed to parse output: ${e}`,
					duration,
				});
			}
		});

		python.on("error", (err) => {
			resolve({
				success: false,
				error: `Failed to spawn process: ${err.message}`,
				duration: Date.now() - startTime,
			});
		});
	});
}

/**
 * Benchmark all seed programs on ARC tasks
 */
export async function benchmarkARCSeeds(numTasks: number = 5): Promise<
	Record<
		string,
		{
			passAt1: number;
			avgScore: number;
			exactMatches: number;
		}
	>
> {
	return new Promise((resolve) => {
		const python = spawn("python3", [RUNNER_PATH, "--mode", "benchmark", "--tasks", numTasks.toString(), "--json"], {
			timeout: 300000,
		});

		let stdout = "";

		python.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		python.on("close", () => {
			try {
				const result = JSON.parse(stdout.trim());
				const formatted: Record<string, { passAt1: number; avgScore: number; exactMatches: number }> = {};

				for (const [name, metrics] of Object.entries(result)) {
					const m = metrics as any;
					formatted[name] = {
						passAt1: m.pass_at_1,
						avgScore: m.avg_score,
						exactMatches: m.exact_matches,
					};
				}

				resolve(formatted);
			} catch {
				resolve({});
			}
		});

		python.on("error", () => {
			resolve({});
		});
	});
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick ARC evolution with sensible defaults
 */
export async function quickARCEvolve(): Promise<ARCEvolutionResult> {
	return evolveARCSolver(ARCEvolvePresets.quick());
}

/**
 * Standard ARC evolution for production use
 */
export async function standardARCEvolve(): Promise<ARCEvolutionResult> {
	return evolveARCSolver(ARCEvolvePresets.standard());
}

/**
 * Load the best evolved program if available
 */
export function loadBestProgram(): string | null {
	const programPath = join(EVOLUTION_DIR, "best_arc_solver.py");

	if (!existsSync(programPath)) {
		return null;
	}

	return readFileSync(programPath, "utf-8");
}

/**
 * Save an evolved program as the best
 */
export function saveBestProgram(program: string): string {
	if (!existsSync(EVOLUTION_DIR)) {
		mkdirSync(EVOLUTION_DIR, { recursive: true });
	}

	const programPath = join(EVOLUTION_DIR, "best_arc_solver.py");
	writeFileSync(programPath, program, "utf-8");

	return programPath;
}
