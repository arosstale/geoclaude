/**
 * E2B Sandbox Service
 * Provides isolated code execution environments for AI agents
 * Wraps the E2B sandbox CLI from agent-sandboxes skill
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

// =============================================================================
// Types
// =============================================================================

export interface SandboxConfig {
	timeout?: number; // seconds, default 3600 (1 hour)
	template?: SandboxTemplate;
	env?: Record<string, string>;
}

export type SandboxTemplate =
	| "fullstack-vue-fastapi-node22"
	| "fullstack-vue-fastapi-node22-lite"
	| "fullstack-vue-fastapi-node22-standard"
	| "fullstack-vue-fastapi-node22-heavy"
	| "fullstack-vue-fastapi-node22-max";

export interface SandboxResult {
	success: boolean;
	sandboxId?: string;
	output?: string;
	error?: string;
	exitCode?: number;
}

export interface ExecOptions {
	cwd?: string;
	env?: Record<string, string>;
	root?: boolean;
	shell?: boolean;
	timeout?: number;
	background?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const SANDBOX_CLI_PATH = path.join(
	process.env.HOME || "/home/majinbu",
	".claude/skills/agent-sandboxes/.claude/skills/agent-sandboxes/sandbox_cli",
);

const DEFAULT_TIMEOUT = 3600; // 1 hour

// =============================================================================
// Sandbox Service
// =============================================================================

export class E2BSandboxService {
	private apiKey: string;
	private activeSandboxes: Map<string, { createdAt: Date; timeout: number }> = new Map();

	constructor(apiKey?: string) {
		this.apiKey = apiKey || process.env.E2B_API_KEY || "";
		if (!this.apiKey) {
			console.warn("[E2B] No API key configured. Set E2B_API_KEY environment variable.");
		}
	}

	/**
	 * Check if E2B is properly configured
	 */
	isConfigured(): boolean {
		return !!this.apiKey && existsSync(SANDBOX_CLI_PATH);
	}

	/**
	 * Run sbx CLI command
	 */
	private async runCli(args: string[], timeout = 60000): Promise<SandboxResult> {
		if (!this.isConfigured()) {
			return {
				success: false,
				error: "E2B not configured. Set E2B_API_KEY and install agent-sandboxes skill.",
			};
		}

		return new Promise((resolve) => {
			const proc = spawn("uv", ["run", "sbx", ...args], {
				cwd: SANDBOX_CLI_PATH,
				env: {
					...process.env,
					E2B_API_KEY: this.apiKey,
				},
				timeout,
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
				const output = stdout + stderr;

				// Extract sandbox ID from output
				const idMatch = output.match(/Sandbox ID:\s*(\S+)/i) || output.match(/Created sandbox:\s*(\S+)/i);
				const sandboxId = idMatch?.[1];

				resolve({
					success: code === 0,
					sandboxId,
					output: stdout.trim(),
					error: code !== 0 ? stderr.trim() || stdout.trim() : undefined,
					exitCode: code ?? undefined,
				});
			});

			proc.on("error", (err) => {
				resolve({
					success: false,
					error: err.message,
				});
			});
		});
	}

	/**
	 * Create a new sandbox
	 */
	async create(config: SandboxConfig = {}): Promise<SandboxResult> {
		const timeout = config.timeout || DEFAULT_TIMEOUT;
		const args = ["init", "--timeout", timeout.toString()];

		if (config.template) {
			args.push("--template", config.template);
		}

		if (config.env) {
			for (const [key, value] of Object.entries(config.env)) {
				args.push("--env", `${key}=${value}`);
			}
		}

		const result = await this.runCli(args, 120000); // 2 min timeout for creation

		if (result.success && result.sandboxId) {
			this.activeSandboxes.set(result.sandboxId, {
				createdAt: new Date(),
				timeout,
			});
		}

		return result;
	}

	/**
	 * Execute command in sandbox
	 */
	async exec(sandboxId: string, command: string, options: ExecOptions = {}): Promise<SandboxResult> {
		const args = ["exec", sandboxId, command];

		if (options.cwd) args.push("--cwd", options.cwd);
		if (options.root) args.push("--root");
		if (options.shell) args.push("--shell");
		if (options.timeout) args.push("--timeout", options.timeout.toString());
		if (options.background) args.push("--background");

		if (options.env) {
			for (const [key, value] of Object.entries(options.env)) {
				args.push("--env", `${key}=${value}`);
			}
		}

		return this.runCli(args, (options.timeout || 60) * 1000 + 5000);
	}

	/**
	 * Write file to sandbox
	 */
	async writeFile(sandboxId: string, remotePath: string, content: string): Promise<SandboxResult> {
		// Use stdin for content to avoid shell escaping issues
		return new Promise((resolve) => {
			const proc = spawn("uv", ["run", "sbx", "files", "write", sandboxId, remotePath, "--stdin"], {
				cwd: SANDBOX_CLI_PATH,
				env: {
					...process.env,
					E2B_API_KEY: this.apiKey,
				},
			});

			let stdout = "";
			let stderr = "";

			proc.stdout.on("data", (data) => {
				stdout += data.toString();
			});
			proc.stderr.on("data", (data) => {
				stderr += data.toString();
			});

			proc.stdin.write(content);
			proc.stdin.end();

			proc.on("close", (code) => {
				resolve({
					success: code === 0,
					output: stdout.trim(),
					error: code !== 0 ? stderr.trim() : undefined,
					exitCode: code ?? undefined,
				});
			});

			proc.on("error", (err) => {
				resolve({ success: false, error: err.message });
			});
		});
	}

	/**
	 * Read file from sandbox
	 */
	async readFile(sandboxId: string, remotePath: string): Promise<SandboxResult> {
		return this.runCli(["files", "read", sandboxId, remotePath]);
	}

	/**
	 * List directory in sandbox
	 */
	async listDir(sandboxId: string, remotePath: string): Promise<SandboxResult> {
		return this.runCli(["files", "ls", sandboxId, remotePath]);
	}

	/**
	 * Upload local file to sandbox
	 */
	async uploadFile(sandboxId: string, localPath: string, remotePath: string): Promise<SandboxResult> {
		return this.runCli(["files", "upload", sandboxId, localPath, remotePath], 120000);
	}

	/**
	 * Download file from sandbox
	 */
	async downloadFile(sandboxId: string, remotePath: string, localPath: string): Promise<SandboxResult> {
		return this.runCli(["files", "download", sandboxId, remotePath, localPath], 120000);
	}

	/**
	 * Get public URL for exposed port
	 */
	async getHost(sandboxId: string, port = 5173): Promise<SandboxResult> {
		return this.runCli(["sandbox", "get-host", sandboxId, "--port", port.toString()]);
	}

	/**
	 * Get sandbox info
	 */
	async info(sandboxId: string): Promise<SandboxResult> {
		return this.runCli(["sandbox", "info", sandboxId]);
	}

	/**
	 * Kill sandbox
	 */
	async kill(sandboxId: string): Promise<SandboxResult> {
		const result = await this.runCli(["sandbox", "kill", sandboxId]);
		if (result.success) {
			this.activeSandboxes.delete(sandboxId);
		}
		return result;
	}

	/**
	 * Pause sandbox (beta)
	 */
	async pause(sandboxId: string): Promise<SandboxResult> {
		return this.runCli(["sandbox", "pause", sandboxId]);
	}

	/**
	 * Resume paused sandbox
	 */
	async resume(sandboxId: string): Promise<SandboxResult> {
		return this.runCli(["sandbox", "connect", sandboxId]);
	}

	/**
	 * Extend sandbox lifetime
	 */
	async extendLifetime(sandboxId: string, additionalSeconds: number): Promise<SandboxResult> {
		return this.runCli(["sandbox", "extend-lifetime", sandboxId, additionalSeconds.toString()]);
	}

	/**
	 * List all active sandboxes
	 */
	async list(): Promise<SandboxResult> {
		return this.runCli(["sandbox", "list"]);
	}

	/**
	 * Get active sandboxes tracked by this service
	 */
	getActiveSandboxes(): Array<{ id: string; createdAt: Date; timeout: number }> {
		return Array.from(this.activeSandboxes.entries()).map(([id, info]) => ({
			id,
			...info,
		}));
	}

	/**
	 * Kill all tracked sandboxes
	 */
	async killAll(): Promise<void> {
		for (const id of this.activeSandboxes.keys()) {
			await this.kill(id);
		}
	}
}

// =============================================================================
// Singleton Instance
// =============================================================================

let sandboxService: E2BSandboxService | null = null;

export function getE2BSandboxService(): E2BSandboxService {
	if (!sandboxService) {
		sandboxService = new E2BSandboxService();
	}
	return sandboxService;
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Quick sandbox execution - create, run, return result
 */
export async function runInSandbox(
	code: string,
	options: {
		language?: "python" | "node" | "bash";
		timeout?: number;
		keepAlive?: boolean;
	} = {},
): Promise<{ success: boolean; output: string; sandboxId?: string; error?: string }> {
	const service = getE2BSandboxService();

	// Create sandbox
	const createResult = await service.create({ timeout: options.timeout || 300 });
	if (!createResult.success || !createResult.sandboxId) {
		return { success: false, output: "", error: createResult.error || "Failed to create sandbox" };
	}

	const sandboxId = createResult.sandboxId;

	try {
		let execResult: SandboxResult;

		switch (options.language) {
			case "python":
				// Write Python script and execute
				await service.writeFile(sandboxId, "/home/user/script.py", code);
				execResult = await service.exec(sandboxId, "python3 /home/user/script.py", { timeout: 120 });
				break;

			case "node":
				// Write Node script and execute
				await service.writeFile(sandboxId, "/home/user/script.js", code);
				execResult = await service.exec(sandboxId, "node /home/user/script.js", { timeout: 120 });
				break;

			default:
				// Execute bash/shell command directly
				execResult = await service.exec(sandboxId, code, { shell: true, timeout: 120 });
				break;
		}

		if (!options.keepAlive) {
			await service.kill(sandboxId);
		}

		return {
			success: execResult.success,
			output: execResult.output || "",
			sandboxId: options.keepAlive ? sandboxId : undefined,
			error: execResult.error,
		};
	} catch (err) {
		if (!options.keepAlive) {
			await service.kill(sandboxId);
		}
		return {
			success: false,
			output: "",
			error: err instanceof Error ? err.message : "Unknown error",
		};
	}
}

/**
 * Check if E2B is available
 */
export function isE2BAvailable(): boolean {
	return getE2BSandboxService().isConfigured();
}

export default {
	E2BSandboxService,
	getE2BSandboxService,
	runInSandbox,
	isE2BAvailable,
};
