/**
 * Shared types and utilities for MCP tools
 */

// =============================================================================
// Helper Types for Error Handling
// =============================================================================

/** Node.js style error with code property */
export interface NodeError extends Error {
	code?: string;
}

/** Helper to safely get error message */
export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "Unknown error";
}

// =============================================================================
// API Response Types
// =============================================================================

/** Research source */
export interface ResearchSource {
	title: string;
	url: string;
}

/** GitHub repository from search */
export interface GitHubRepo {
	full_name: string;
	stargazers_count: number;
	description?: string;
	html_url: string;
}

/** GitHub issue/PR */
export interface GitHubIssue {
	number: number;
	state: string;
	title: string;
	html_url: string;
}

/** GitHub pull request */
export interface GitHubPullRequest extends GitHubIssue {
	head: { ref: string };
	base: { ref: string };
}

/** HuggingFace model */
export interface HFModel {
	id: string;
	downloads?: number;
	pipeline_tag?: string;
}

/** HuggingFace dataset */
export interface HFDataset {
	id: string;
	downloads?: number;
}

/** DuckDuckGo topic */
export interface DDGTopic {
	Text?: string;
}

/** DuckDuckGo infobox item */
export interface DDGInfoboxItem {
	label: string;
	value: string;
}

/** Exa search result */
export interface ExaSearchResult {
	title: string;
	url: string;
	text?: string;
}

// =============================================================================
// Helper: Log tool usage
// =============================================================================

export function logMcpTool(tool: string, message: string): void {
	const timestamp = new Date().toLocaleTimeString();
	console.log(`[${timestamp}] [MCP:${tool}] ${message}`);
}
