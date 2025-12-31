/**
 * LiveKit Voice AI Agent
 *
 * TypeScript wrapper for Python LiveKit Agents framework.
 * Provides voice AI capabilities for LiveKit rooms with function tools.
 *
 * Features:
 * - Multi-mode support (general, trading, coding, research)
 * - OpenAI TTS/STT and Deepgram STT
 * - Function tools: crypto prices, sentiment analysis
 * - Graceful error handling
 */

import { type ChildProcess, spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, "..", "..");
const SCRIPT_PATH = join(PACKAGE_ROOT, "src", "agents", "livekit-voice-runner.py");

// ============================================================================
// TYPES
// ============================================================================

/** Agent mode/personality */
export type VoiceAgentMode = "general" | "trading" | "coding" | "research";

/** OpenAI TTS voices */
export type VoiceAgentVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

/** Options for starting voice agent */
export interface StartVoiceAgentOptions {
	/** Room name to join */
	roomName: string;
	/** Agent mode/personality (default: general) */
	mode?: VoiceAgentMode;
	/** TTS voice (default: alloy) */
	voice?: VoiceAgentVoice;
	/** Callback for stdout logs */
	onLog?: (message: string) => void;
	/** Callback for stderr logs */
	onError?: (message: string) => void;
}

/** Result from starting voice agent */
export interface StartVoiceAgentResult {
	success: boolean;
	pid?: number;
	roomName?: string;
	mode?: VoiceAgentMode;
	voice?: VoiceAgentVoice;
	error?: string;
}

/** Voice agent status */
export interface VoiceAgentStatus {
	livekitAvailable: boolean;
	deepgramAvailable: boolean;
	sileroAvailable: boolean;
	openaiKey: boolean;
	deepgramKey: boolean;
	livekitConfigured: boolean;
}

/** Running agent info */
interface RunningAgent {
	process: ChildProcess;
	roomName: string;
	mode: VoiceAgentMode;
	voice: VoiceAgentVoice;
	pid: number;
	startTime: number;
}

// ============================================================================
// STATE
// ============================================================================

/** Map of running agents by PID */
const runningAgents = new Map<number, RunningAgent>();

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Start a LiveKit voice AI agent
 *
 * Spawns a Python process that connects to a LiveKit room and provides
 * voice AI interactions with function tools.
 *
 * @returns Promise resolving to start result with PID
 */
export async function startVoiceAgent(options: StartVoiceAgentOptions): Promise<StartVoiceAgentResult> {
	const { roomName, mode = "general", voice = "alloy", onLog, onError } = options;

	// Validate environment
	const requiredEnvVars = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"];
	const missing = requiredEnvVars.filter((v) => !process.env[v]);

	if (missing.length > 0) {
		return {
			success: false,
			error: `Missing required environment variables: ${missing.join(", ")}`,
		};
	}

	if (!process.env.OPENAI_API_KEY) {
		return {
			success: false,
			error: "OPENAI_API_KEY required for TTS/STT/LLM",
		};
	}

	return new Promise((resolve) => {
		const args = [SCRIPT_PATH, "--mode", "start", "--room", roomName, "--agent-mode", mode, "--voice", voice];

		const pythonProcess = spawn("python3", args, {
			env: {
				...process.env,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});

		const pid = pythonProcess.pid;
		if (!pid) {
			resolve({
				success: false,
				error: "Failed to spawn process (no PID)",
			});
			return;
		}

		let stdoutBuffer = "";
		let stderrBuffer = "";
		let resolved = false;

		// Capture stdout
		pythonProcess.stdout?.on("data", (data) => {
			const text = data.toString();
			stdoutBuffer += text;

			// Log if callback provided
			if (onLog) {
				onLog(text);
			}

			// Try to parse JSON output (success/error message)
			const lines = stdoutBuffer.split("\n");
			for (const line of lines) {
				if (line.trim().startsWith("{")) {
					try {
						const result = JSON.parse(line);
						if (!resolved) {
							resolved = true;
							if (result.success) {
								// Store running agent
								runningAgents.set(pid, {
									process: pythonProcess,
									roomName: result.room || roomName,
									mode: result.mode || mode,
									voice: result.voice || voice,
									pid,
									startTime: Date.now(),
								});

								resolve({
									success: true,
									pid,
									roomName: result.room || roomName,
									mode: result.mode || mode,
									voice: result.voice || voice,
								});
							} else {
								resolve({
									success: false,
									error: result.error || "Unknown error",
								});
							}
						}
					} catch {
						// Not JSON, continue
					}
				}
			}
		});

		// Capture stderr
		pythonProcess.stderr?.on("data", (data) => {
			const text = data.toString();
			stderrBuffer += text;

			// Log if callback provided
			if (onError) {
				onError(text);
			}
		});

		// Handle process exit
		pythonProcess.on("close", (code) => {
			// Clean up
			runningAgents.delete(pid);

			if (!resolved) {
				resolved = true;
				resolve({
					success: false,
					error: `Process exited with code ${code}. ${stderrBuffer || "No error details."}`,
				});
			}
		});

		// Handle process error
		pythonProcess.on("error", (err) => {
			runningAgents.delete(pid);

			if (!resolved) {
				resolved = true;
				resolve({
					success: false,
					error: `Failed to spawn process: ${err.message}`,
				});
			}
		});

		// Timeout after 30 seconds if no response
		setTimeout(() => {
			if (!resolved) {
				resolved = true;
				pythonProcess.kill("SIGTERM");
				runningAgents.delete(pid);
				resolve({
					success: false,
					error: "Timeout: Agent did not start within 30 seconds",
				});
			}
		}, 30000);
	});
}

/**
 * Stop a running voice agent by PID
 *
 * @param pid - Process ID of the agent to stop
 * @returns true if stopped, false if not found
 */
export function stopVoiceAgent(pid: number): boolean {
	const agent = runningAgents.get(pid);

	if (!agent) {
		return false;
	}

	try {
		agent.process.kill("SIGTERM");
		runningAgents.delete(pid);
		return true;
	} catch (error) {
		console.error(`Failed to kill voice agent ${pid}:`, error);
		return false;
	}
}

/**
 * Stop a running voice agent by room name
 *
 * @param roomName - Room name of the agent to stop
 * @returns true if stopped, false if not found
 */
export function stopVoiceAgentByRoom(roomName: string): boolean {
	for (const [pid, agent] of runningAgents.entries()) {
		if (agent.roomName === roomName) {
			return stopVoiceAgent(pid);
		}
	}
	return false;
}

/**
 * Get status of voice agent system
 *
 * Checks if LiveKit agents framework is installed and configured.
 *
 * @returns Promise resolving to status info
 */
export async function getVoiceAgentStatus(): Promise<VoiceAgentStatus> {
	return new Promise((resolve) => {
		const pythonProcess = spawn("python3", [SCRIPT_PATH, "--mode", "status"]);

		let stdout = "";

		pythonProcess.stdout?.on("data", (data) => {
			stdout += data.toString();
		});

		pythonProcess.on("close", (code) => {
			if (code !== 0) {
				resolve({
					livekitAvailable: false,
					deepgramAvailable: false,
					sileroAvailable: false,
					openaiKey: false,
					deepgramKey: false,
					livekitConfigured: false,
				});
				return;
			}

			try {
				const result = JSON.parse(stdout.trim());
				resolve({
					livekitAvailable: result.livekit_available,
					deepgramAvailable: result.deepgram_available,
					sileroAvailable: result.silero_available,
					openaiKey: result.openai_key,
					deepgramKey: result.deepgram_key,
					livekitConfigured: result.livekit_configured,
				});
			} catch {
				resolve({
					livekitAvailable: false,
					deepgramAvailable: false,
					sileroAvailable: false,
					openaiKey: false,
					deepgramKey: false,
					livekitConfigured: false,
				});
			}
		});

		pythonProcess.on("error", () => {
			resolve({
				livekitAvailable: false,
				deepgramAvailable: false,
				sileroAvailable: false,
				openaiKey: false,
				deepgramKey: false,
				livekitConfigured: false,
			});
		});
	});
}

/**
 * Check if voice agent system is available
 *
 * @returns Promise resolving to true if available
 */
export async function isVoiceAgentAvailable(): Promise<boolean> {
	const status = await getVoiceAgentStatus();
	return status.livekitAvailable && status.livekitConfigured && status.openaiKey;
}

/**
 * Get list of running voice agents
 *
 * @returns Array of running agent info
 */
export function getRunningAgents(): Array<{
	pid: number;
	roomName: string;
	mode: VoiceAgentMode;
	voice: VoiceAgentVoice;
	uptimeSeconds: number;
}> {
	const now = Date.now();
	return Array.from(runningAgents.values()).map((agent) => ({
		pid: agent.pid,
		roomName: agent.roomName,
		mode: agent.mode,
		voice: agent.voice,
		uptimeSeconds: Math.floor((now - agent.startTime) / 1000),
	}));
}

/**
 * Stop all running voice agents
 *
 * @returns Number of agents stopped
 */
export function stopAllVoiceAgents(): number {
	let count = 0;
	for (const pid of Array.from(runningAgents.keys())) {
		if (stopVoiceAgent(pid)) {
			count++;
		}
	}
	return count;
}

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * Cleanup handler to stop all agents on process exit
 */
function cleanup() {
	if (runningAgents.size > 0) {
		console.log(`Stopping ${runningAgents.size} voice agent(s)...`);
		stopAllVoiceAgents();
	}
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
	cleanup();
	process.exit(0);
});
process.on("SIGTERM", () => {
	cleanup();
	process.exit(0);
});
