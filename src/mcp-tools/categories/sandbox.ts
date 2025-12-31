/**
 * Code Execution & Sandbox Tools
 * - Code sandbox (in-memory execution)
 * - Docker containers
 * - Python execution
 * - File processing
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import {
	createCodeSandboxTool,
	createDockerSandboxTool,
	createFileProcessTool,
	createPythonExecTool,
	createSandboxExecTool,
} from "../../mcp-tools.js";

export function getAllSandboxTools(): AgentTool<any>[] {
	return [
		createCodeSandboxTool(), // In-memory sandbox
		createDockerSandboxTool(), // Docker sandbox
		createSandboxExecTool(), // Enhanced sandbox
		createPythonExecTool(), // Python execution
		createFileProcessTool(), // File processing
	];
}
