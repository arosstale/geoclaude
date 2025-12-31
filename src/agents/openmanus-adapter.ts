/**
 * OpenManus Adapter for Pi-Mono Discord Bot
 *
 * Integrates OpenManus AI agent framework (51K stars):
 * - MCP (Model Context Protocol) native integration
 * - Multi-provider LLM support (OpenAI, Azure, Bedrock)
 * - Browser automation via BrowserUseTool
 * - Task planning with PlanningAgent
 * - Multi-agent coordination via FlowFactory
 *
 * @see https://github.com/FoundationAgents/OpenManus
 */

import { type ChildProcess, spawn } from "child_process";
import { EventEmitter } from "events";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// ========== Path Resolution ==========

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const _PACKAGE_ROOT = join(__dirname, "..", "..");

// ========== Configuration Types ==========

/**
 * OpenManus execution mode
 */
export type OpenManusMode =
	| "standard" // python main.py - terminal-based agent
	| "mcp" // python run_mcp.py - MCP integration
	| "flow"; // python run_flow.py - multi-agent (unstable)

/**
 * MCP server connection type
 */
export type MCPConnectionType = "stdio" | "sse";

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
	name: string;
	type: MCPConnectionType;
	command?: string; // For stdio
	args?: string[]; // For stdio
	url?: string; // For SSE (default: http://127.0.0.1:8000/sse)
	env?: Record<string, string>;
}

/**
 * LLM provider configuration
 */
export interface LLMConfig {
	model?: string; // default: gpt-4o
	baseUrl?: string; // default: https://api.openai.com/v1
	apiKey?: string;
	maxTokens?: number; // default: 4096
	temperature?: number; // default: 0.0
	provider?: "openai" | "azure" | "bedrock";
}

/**
 * OpenManus agent configuration
 */
export interface OpenManusConfig {
	llm?: LLMConfig;
	visionLlm?: LLMConfig;
	mode?: OpenManusMode;
	maxSteps?: number; // default: 20
	maxObserveTokens?: number; // default: 10000
	timeout?: number; // seconds, default: 300
	mcpServers?: MCPServerConfig[];
	workspaceDir?: string;
	useDataAnalysisAgent?: boolean;
	pythonPath?: string;
	openManusPath?: string;
}

// ========== Result Types ==========

/**
 * Execution step in OpenManus agent
 */
export interface OpenManusStep {
	id: string;
	phase: "thinking" | "acting" | "planning";
	action?: string;
	tool?: string;
	toolInput?: Record<string, unknown>;
	result?: unknown;
	error?: string;
	timestamp: Date;
}

/**
 * Tool execution result
 */
export interface ToolResult {
	name: string;
	success: boolean;
	output?: string;
	error?: string;
	base64Image?: string;
}

/**
 * OpenManus task representation
 */
export interface OpenManusTask {
	id: string;
	prompt: string;
	status: "pending" | "thinking" | "acting" | "planning" | "completed" | "failed" | "stuck";
	steps: OpenManusStep[];
	toolResults: ToolResult[];
	result?: string;
	error?: string;
	startedAt: Date;
	completedAt?: Date;
	cost?: number;
	tokensUsed?: number;
}

/**
 * Result from OpenManus agent execution
 */
export interface OpenManusResult {
	success: boolean;
	output: string;
	error: string | null;
	task: OpenManusTask;
	mode: OpenManusMode;
	toolsUsed: string[];
	duration: number;
	mcpServersConnected?: string[];
}

/**
 * Options for running OpenManus agent
 */
export interface OpenManusOptions {
	prompt: string;
	config?: OpenManusConfig;
	interactive?: boolean;
	streamCallback?: (step: OpenManusStep) => void;
}

// ========== Availability Check ==========

/**
 * OpenManus availability status
 */
export interface OpenManusStatus {
	available: boolean;
	method: "python" | "docker" | "none";
	version?: string;
	pythonPath?: string;
	openManusPath?: string;
	error?: string;
}

let cachedStatus: OpenManusStatus | null = null;

/**
 * Check if OpenManus is available
 */
export async function isOpenManusAvailable(): Promise<OpenManusStatus> {
	if (cachedStatus) return cachedStatus;

	// Check for Python and OpenManus installation
	const pythonPaths = ["/usr/bin/python3.12", "/usr/bin/python3.11", "/usr/bin/python3", "python3", "python"];

	for (const pythonPath of pythonPaths) {
		try {
			const result = await checkPythonOpenManus(pythonPath);
			if (result.available) {
				cachedStatus = result;
				return result;
			}
		} catch {}
	}

	// Check for Docker
	try {
		const dockerResult = await checkDockerOpenManus();
		if (dockerResult.available) {
			cachedStatus = dockerResult;
			return dockerResult;
		}
	} catch {
		// Docker not available
	}

	cachedStatus = {
		available: false,
		method: "none",
		error: "OpenManus not found. Install via: pip install openmanus or clone https://github.com/FoundationAgents/OpenManus",
	};
	return cachedStatus;
}

async function checkPythonOpenManus(pythonPath: string): Promise<OpenManusStatus> {
	return new Promise((resolve) => {
		const proc = spawn(pythonPath, ["-c", "import app.agent.manus; print('OK')"], {
			timeout: 5000,
			cwd: process.env.OPENMANUS_PATH || undefined,
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
			if (code === 0 && stdout.includes("OK")) {
				resolve({
					available: true,
					method: "python",
					pythonPath,
					openManusPath: process.env.OPENMANUS_PATH,
				});
			} else {
				resolve({
					available: false,
					method: "none",
					error: stderr || "OpenManus not importable",
				});
			}
		});

		proc.on("error", () => {
			resolve({
				available: false,
				method: "none",
				error: `Python not found at ${pythonPath}`,
			});
		});
	});
}

async function checkDockerOpenManus(): Promise<OpenManusStatus> {
	return new Promise((resolve) => {
		const proc = spawn("docker", ["images", "-q", "openmanus/openmanus"], {
			timeout: 5000,
		});

		let stdout = "";

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		proc.on("close", (code) => {
			if (code === 0 && stdout.trim()) {
				resolve({
					available: true,
					method: "docker",
				});
			} else {
				resolve({
					available: false,
					method: "none",
					error: "Docker image not found",
				});
			}
		});

		proc.on("error", () => {
			resolve({
				available: false,
				method: "none",
				error: "Docker not available",
			});
		});
	});
}

// ========== OpenManus Client ==========

/**
 * OpenManus client for agent execution
 */
export class OpenManusClient extends EventEmitter {
	private config: OpenManusConfig;
	private tasks: Map<string, OpenManusTask> = new Map();
	private activeProcess: ChildProcess | null = null;

	constructor(config: OpenManusConfig = {}) {
		super();
		this.config = {
			mode: "standard",
			maxSteps: 20,
			maxObserveTokens: 10000,
			timeout: 300,
			pythonPath: "/usr/bin/python3.12",
			...config,
		};
	}

	/**
	 * Run OpenManus agent with a prompt
	 */
	async run(options: OpenManusOptions): Promise<OpenManusResult> {
		const startTime = Date.now();
		const status = await isOpenManusAvailable();

		if (!status.available) {
			return {
				success: false,
				output: "",
				error: status.error || "OpenManus not available",
				task: this.createEmptyTask(options.prompt),
				mode: this.config.mode || "standard",
				toolsUsed: [],
				duration: Date.now() - startTime,
			};
		}

		if (status.method === "python") {
			return this.runWithPython(options, startTime);
		} else {
			return this.runWithDocker(options, startTime);
		}
	}

	/**
	 * Run via Python subprocess
	 */
	private async runWithPython(options: OpenManusOptions, startTime: number): Promise<OpenManusResult> {
		const task = this.createTask(options.prompt);
		this.tasks.set(task.id, task);

		const pythonPath = this.config.pythonPath || "/usr/bin/python3.12";
		const openManusPath = this.config.openManusPath || process.env.OPENMANUS_PATH;

		// Build Python execution script
		const script = this.buildPythonScript(options);

		return new Promise((resolve) => {
			const args = ["-c", script];

			this.activeProcess = spawn(pythonPath, args, {
				cwd: openManusPath,
				env: {
					...process.env,
					PYTHONPATH: openManusPath,
				},
				timeout: (this.config.timeout || 300) * 1000,
			});

			let stdout = "";
			let stderr = "";

			this.activeProcess.stdout?.on("data", (data) => {
				const chunk = data.toString();
				stdout += chunk;
				this.parseStreamOutput(chunk, task, options.streamCallback);
			});

			this.activeProcess.stderr?.on("data", (data) => {
				stderr += data.toString();
			});

			this.activeProcess.on("close", (code) => {
				const duration = Date.now() - startTime;
				task.completedAt = new Date();

				try {
					const result = this.parseResult(stdout);
					task.status = result.success ? "completed" : "failed";
					task.result = result.output;
					task.error = result.error ?? undefined;

					resolve({
						success: result.success,
						output: result.output,
						error: result.error,
						task,
						mode: this.config.mode || "standard",
						toolsUsed: result.toolsUsed || [],
						duration,
						mcpServersConnected: result.mcpServers,
					});
				} catch {
					task.status = "failed";
					task.error = stderr || `Process exited with code ${code}`;

					resolve({
						success: false,
						output: stdout,
						error: task.error,
						task,
						mode: this.config.mode || "standard",
						toolsUsed: [],
						duration,
					});
				}

				this.activeProcess = null;
			});

			this.activeProcess.on("error", (err) => {
				task.status = "failed";
				task.error = err.message;
				task.completedAt = new Date();

				resolve({
					success: false,
					output: "",
					error: err.message,
					task,
					mode: this.config.mode || "standard",
					toolsUsed: [],
					duration: Date.now() - startTime,
				});

				this.activeProcess = null;
			});
		});
	}

	/**
	 * Run via Docker container
	 */
	private async runWithDocker(options: OpenManusOptions, startTime: number): Promise<OpenManusResult> {
		const task = this.createTask(options.prompt);
		this.tasks.set(task.id, task);

		const dockerArgs = [
			"run",
			"--rm",
			"-e",
			`OPENAI_API_KEY=${this.config.llm?.apiKey || process.env.OPENAI_API_KEY}`,
		];

		// Add workspace mount if specified
		if (this.config.workspaceDir) {
			dockerArgs.push("-v", `${this.config.workspaceDir}:/workspace`);
		}

		dockerArgs.push("openmanus/openmanus", "python", "main.py", "--prompt", options.prompt);

		return new Promise((resolve) => {
			this.activeProcess = spawn("docker", dockerArgs, {
				timeout: (this.config.timeout || 300) * 1000,
			});

			let stdout = "";
			let stderr = "";

			this.activeProcess.stdout?.on("data", (data) => {
				const chunk = data.toString();
				stdout += chunk;
				this.parseStreamOutput(chunk, task, options.streamCallback);
			});

			this.activeProcess.stderr?.on("data", (data) => {
				stderr += data.toString();
			});

			this.activeProcess.on("close", (code) => {
				const duration = Date.now() - startTime;
				task.completedAt = new Date();
				task.status = code === 0 ? "completed" : "failed";
				task.result = stdout;
				task.error = code !== 0 ? stderr : undefined;

				resolve({
					success: code === 0,
					output: stdout,
					error: code !== 0 ? stderr : null,
					task,
					mode: this.config.mode || "standard",
					toolsUsed: this.extractToolsUsed(stdout),
					duration,
				});

				this.activeProcess = null;
			});

			this.activeProcess.on("error", (err) => {
				task.status = "failed";
				task.error = err.message;
				task.completedAt = new Date();

				resolve({
					success: false,
					output: "",
					error: err.message,
					task,
					mode: this.config.mode || "standard",
					toolsUsed: [],
					duration: Date.now() - startTime,
				});

				this.activeProcess = null;
			});
		});
	}

	/**
	 * Build Python execution script
	 */
	private buildPythonScript(options: OpenManusOptions): string {
		const escapedPrompt = options.prompt.replace(/"/g, '\\"').replace(/\n/g, "\\n");
		const mode = this.config.mode || "standard";

		// Generate LLM config
		const llmConfig = this.config.llm || {};
		const _llmConfigStr = JSON.stringify({
			model: llmConfig.model || "gpt-4o",
			base_url: llmConfig.baseUrl || "https://api.openai.com/v1",
			api_key: llmConfig.apiKey || process.env.OPENAI_API_KEY || "",
			max_tokens: llmConfig.maxTokens || 4096,
			temperature: llmConfig.temperature || 0.0,
		});

		if (mode === "mcp") {
			return `
import asyncio
import json
import sys

async def main():
    from app.agent.manus import Manus

    result = {"success": False, "output": "", "error": None, "toolsUsed": [], "mcpServers": []}

    try:
        agent = await Manus.create()
        output = await agent.run("${escapedPrompt}")
        result["success"] = True
        result["output"] = str(output) if output else ""
        result["toolsUsed"] = list(getattr(agent, '_tools_used', set()))
        result["mcpServers"] = list(getattr(agent, '_connected_servers', set()))
    except Exception as e:
        result["error"] = str(e)
    finally:
        if 'agent' in dir():
            await agent.cleanup()

    print("###OPENMANUS_RESULT###")
    print(json.dumps(result))

asyncio.run(main())
`;
		}

		// Standard mode
		return `
import asyncio
import json
import sys

async def main():
    from app.agent.manus import Manus

    result = {"success": False, "output": "", "error": None, "toolsUsed": [], "mcpServers": []}

    try:
        agent = await Manus.create()
        output = await agent.run("${escapedPrompt}")
        result["success"] = True
        result["output"] = str(output) if output else ""
        result["toolsUsed"] = list(getattr(agent, '_tools_used', set()))
    except Exception as e:
        result["error"] = str(e)
    finally:
        if 'agent' in dir():
            await agent.cleanup()

    print("###OPENMANUS_RESULT###")
    print(json.dumps(result))

asyncio.run(main())
`;
	}

	/**
	 * Parse streaming output for step updates
	 */
	private parseStreamOutput(chunk: string, task: OpenManusTask, callback?: (step: OpenManusStep) => void): void {
		// Look for step markers in output
		const lines = chunk.split("\n");

		for (const line of lines) {
			if (line.includes("[THINK]") || line.includes("Thinking:")) {
				const step = this.createStep("thinking", line);
				task.steps.push(step);
				task.status = "thinking";
				callback?.(step);
				this.emit("step", step);
			} else if (line.includes("[ACT]") || line.includes("Executing:")) {
				const step = this.createStep("acting", line);
				task.steps.push(step);
				task.status = "acting";
				callback?.(step);
				this.emit("step", step);
			} else if (line.includes("[PLAN]") || line.includes("Planning:")) {
				const step = this.createStep("planning", line);
				task.steps.push(step);
				task.status = "planning";
				callback?.(step);
				this.emit("step", step);
			} else if (line.includes("Tool:") || line.includes("tool_call:")) {
				const toolMatch = line.match(/Tool:\s*(\w+)/i) || line.match(/tool_call:\s*(\w+)/i);
				if (toolMatch) {
					const step = this.createStep("acting", line, toolMatch[1]);
					task.steps.push(step);
					callback?.(step);
					this.emit("step", step);
				}
			}
		}
	}

	/**
	 * Parse final result from output
	 */
	private parseResult(stdout: string): {
		success: boolean;
		output: string;
		error: string | null;
		toolsUsed?: string[];
		mcpServers?: string[];
	} {
		const marker = "###OPENMANUS_RESULT###";
		const idx = stdout.indexOf(marker);

		if (idx !== -1) {
			const jsonStr = stdout.slice(idx + marker.length).trim();
			try {
				const result = JSON.parse(jsonStr);
				return {
					success: result.success,
					output: result.output || "",
					error: result.error || null,
					toolsUsed: result.toolsUsed,
					mcpServers: result.mcpServers,
				};
			} catch {
				// Fall through to default parsing
			}
		}

		// Default: treat all output as result
		return {
			success: true,
			output: stdout,
			error: null,
		};
	}

	/**
	 * Extract tools used from output
	 */
	private extractToolsUsed(output: string): string[] {
		const tools = new Set<string>();
		const patterns = [/Tool:\s*(\w+)/gi, /tool_call:\s*(\w+)/gi, /Executing\s+(\w+)/gi, /Using\s+(\w+)\s+tool/gi];

		for (const pattern of patterns) {
			let match;
			while ((match = pattern.exec(output)) !== null) {
				tools.add(match[1]);
			}
		}

		return Array.from(tools);
	}

	/**
	 * Create a new task
	 */
	private createTask(prompt: string): OpenManusTask {
		return {
			id: `omanus-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
			prompt,
			status: "pending",
			steps: [],
			toolResults: [],
			startedAt: new Date(),
		};
	}

	/**
	 * Create empty task for error cases
	 */
	private createEmptyTask(prompt: string): OpenManusTask {
		return {
			id: `omanus-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
			prompt,
			status: "failed",
			steps: [],
			toolResults: [],
			startedAt: new Date(),
			completedAt: new Date(),
		};
	}

	/**
	 * Create a step
	 */
	private createStep(phase: OpenManusStep["phase"], description: string, tool?: string): OpenManusStep {
		return {
			id: `step-${Date.now()}-${Math.random().toString(36).substring(2, 4)}`,
			phase,
			action: description,
			tool,
			timestamp: new Date(),
		};
	}

	/**
	 * Get task by ID
	 */
	getTask(taskId: string): OpenManusTask | undefined {
		return this.tasks.get(taskId);
	}

	/**
	 * List all tasks
	 */
	listTasks(): OpenManusTask[] {
		return Array.from(this.tasks.values());
	}

	/**
	 * Cancel active execution
	 */
	cancel(): void {
		if (this.activeProcess) {
			this.activeProcess.kill("SIGTERM");
			this.activeProcess = null;
		}
	}

	/**
	 * Dispose client
	 */
	dispose(): void {
		this.cancel();
		this.tasks.clear();
		this.removeAllListeners();
	}
}

// ========== Singleton Instance ==========

let clientInstance: OpenManusClient | null = null;

/**
 * Get or create OpenManus client instance
 */
export function getOpenManusClient(config?: OpenManusConfig): OpenManusClient {
	if (!clientInstance) {
		clientInstance = new OpenManusClient(config);
	}
	return clientInstance;
}

/**
 * Initialize OpenManus with configuration
 */
export function initOpenManus(config: OpenManusConfig): OpenManusClient {
	if (clientInstance) {
		clientInstance.dispose();
	}
	clientInstance = new OpenManusClient(config);
	return clientInstance;
}

/**
 * Dispose OpenManus client
 */
export function disposeOpenManus(): void {
	if (clientInstance) {
		clientInstance.dispose();
		clientInstance = null;
	}
}

// ========== Convenience Functions ==========

/**
 * Run OpenManus agent (convenience wrapper)
 */
export async function runOpenManus(prompt: string, config?: OpenManusConfig): Promise<OpenManusResult> {
	const client = getOpenManusClient(config);
	return client.run({ prompt, config });
}

/**
 * Run OpenManus with MCP mode
 */
export async function runOpenManusMCP(
	prompt: string,
	mcpServers?: MCPServerConfig[],
	config?: OpenManusConfig,
): Promise<OpenManusResult> {
	const client = getOpenManusClient({
		...config,
		mode: "mcp",
		mcpServers,
	});
	return client.run({ prompt });
}

/**
 * Run OpenManus with streaming output
 */
export async function runOpenManusStream(
	prompt: string,
	onStep: (step: OpenManusStep) => void,
	config?: OpenManusConfig,
): Promise<OpenManusResult> {
	const client = getOpenManusClient(config);
	return client.run({ prompt, streamCallback: onStep });
}

// ========== Presets ==========

/**
 * OpenManus configuration presets
 */
export const OpenManusPresets = {
	/** Standard execution with GPT-4o */
	standard: {
		mode: "standard" as OpenManusMode,
		llm: {
			model: "gpt-4o",
			maxTokens: 4096,
			temperature: 0.0,
		},
		maxSteps: 20,
		timeout: 300,
	},

	/** Fast execution with reduced steps */
	fast: {
		mode: "standard" as OpenManusMode,
		llm: {
			model: "gpt-4o-mini",
			maxTokens: 2048,
			temperature: 0.0,
		},
		maxSteps: 10,
		timeout: 120,
	},

	/** MCP integration mode */
	mcp: {
		mode: "mcp" as OpenManusMode,
		llm: {
			model: "gpt-4o",
			maxTokens: 4096,
			temperature: 0.0,
		},
		maxSteps: 30,
		timeout: 600,
	},

	/** Data analysis with specialized agent */
	dataAnalysis: {
		mode: "flow" as OpenManusMode,
		useDataAnalysisAgent: true,
		llm: {
			model: "gpt-4o",
			maxTokens: 8192,
			temperature: 0.0,
		},
		maxSteps: 50,
		timeout: 900,
	},

	/** Claude-powered execution */
	claude: {
		mode: "standard" as OpenManusMode,
		llm: {
			model: "claude-3-5-sonnet-20241022",
			baseUrl: "https://api.anthropic.com/v1",
			maxTokens: 4096,
			temperature: 0.0,
		},
		maxSteps: 20,
		timeout: 300,
	},

	/** Local Ollama execution */
	ollama: {
		mode: "standard" as OpenManusMode,
		llm: {
			model: "llama3.3:70b",
			baseUrl: "http://localhost:11434/v1",
			maxTokens: 4096,
			temperature: 0.0,
		},
		maxSteps: 15,
		timeout: 600,
	},
} satisfies Record<string, OpenManusConfig>;

// ========== Export Types ==========

export type OpenManusPresetName = keyof typeof OpenManusPresets;
