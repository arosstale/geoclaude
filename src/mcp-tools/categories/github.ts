/**
 * GitHub Integration Tools
 * - Repository search
 * - File operations
 * - Issue & PR management
 * - Branch operations
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import {
	createGithubCreateBranchTool,
	createGithubCreateIssueTool,
	createGithubCreatePRTool,
	createGithubGetFileTool,
	createGithubListIssuesTool,
	createGithubListPRsTool,
	createGithubRepoSearchTool,
} from "../../mcp-tools.js";

export function getAllGitHubTools(): AgentTool<any>[] {
	return [
		createGithubRepoSearchTool(), // Search repositories
		createGithubGetFileTool(), // Get file contents
		createGithubCreateIssueTool(), // Create issue
		createGithubListIssuesTool(), // List issues
		createGithubCreateBranchTool(), // Create branch
		createGithubCreatePRTool(), // Create PR
		createGithubListPRsTool(), // List PRs
	];
}
