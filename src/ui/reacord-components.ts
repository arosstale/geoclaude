/**
 * Coding Agent Types & Constants
 *
 * Type definitions and constants for the AI coding agent UI.
 * Note: This file originally planned to use Reacord (React for Discord),
 * but Reacord is unmaintained as of late 2025. Instead, we use native
 * discord.js components in button-collectors.ts.
 */

// ============================================================================
// Types
// ============================================================================

export interface CodeSuggestion {
	id: string;
	language: string;
	code: string;
	explanation?: string;
	filePath?: string;
	lineStart?: number;
	lineEnd?: number;
	diff?: string;
}

export interface CodingSession {
	id: string;
	userId: string;
	channelId: string;
	model: string;
	context: string[];
	suggestions: CodeSuggestion[];
	status: "active" | "paused" | "completed";
	systemPrompt?: string;
	threadId?: string;
	lastPrompt?: string;
	tokensUsed?: number;
	estimatedCost?: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface ModelOption {
	id: string;
	name: string;
	provider: string;
	description?: string;
}

// ============================================================================
// Available Models
// ============================================================================

export const AVAILABLE_MODELS: ModelOption[] = [
	{ id: "gpt-4o", name: "GPT-4o", provider: "openai", description: "Best overall" },
	{ id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", description: "Fast & cheap" },
	{ id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic", description: "Best coding" },
	{ id: "claude-3-5-haiku-20241022", name: "Claude Haiku", provider: "anthropic", description: "Fast" },
	{ id: "deepseek-chat", name: "DeepSeek V3", provider: "deepseek", description: "Best value" },
	{ id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "google", description: "Multimodal" },
	{ id: "llama-3.3-70b", name: "Llama 3.3 70B", provider: "groq", description: "Open source" },
	{ id: "qwen-2.5-coder-32b", name: "Qwen 2.5 Coder", provider: "groq", description: "Coding specialist" },
];

// ============================================================================
// Language Detection
// ============================================================================

const LANGUAGE_PATTERNS: Record<string, RegExp[]> = {
	typescript: [/^import\s+.*\s+from\s+['"]/, /:\s*(string|number|boolean|any|void)/, /interface\s+\w+/],
	javascript: [/^const\s+\w+\s*=/, /^let\s+\w+\s*=/, /^function\s+\w+/],
	python: [/^def\s+\w+\(/, /^import\s+\w+/, /^from\s+\w+\s+import/, /:\s*$/m],
	rust: [/^fn\s+\w+/, /^let\s+mut\s+/, /^use\s+\w+::/, /impl\s+\w+/],
	go: [/^package\s+\w+/, /^func\s+\w+/, /^import\s+\(/, /:=\s+/],
	java: [/^public\s+(class|interface)/, /^private\s+\w+/, /System\.out\./],
	cpp: [/#include\s*</, /std::/, /int\s+main\(/],
	sql: [/^SELECT\s+/i, /^INSERT\s+INTO/i, /^CREATE\s+TABLE/i],
	bash: [/^#!\/bin\/(ba)?sh/, /^\$\s+\w+/, /^echo\s+/],
	json: [/^\s*\{/, /^\s*\[/, /":\s*["\[\{]/],
	yaml: [/^\s*\w+:\s*$/, /^\s*-\s+\w+/],
	html: [/<html/i, /<div/i, /<\/\w+>/],
	css: [/^\.\w+\s*\{/, /^#\w+\s*\{/, /:\s*\d+px/],
};

export function detectLanguage(code: string): string {
	for (const [language, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
		for (const pattern of patterns) {
			if (pattern.test(code)) {
				return language;
			}
		}
	}
	return "text";
}

// ============================================================================
// Code Formatting Helpers
// ============================================================================

export function formatCodeBlock(code: string, language?: string): string {
	const lang = language || detectLanguage(code);
	return `\`\`\`${lang}\n${code}\n\`\`\``;
}

export function extractCodeFromResponse(response: string): { code: string; language: string; explanation: string }[] {
	const results: { code: string; language: string; explanation: string }[] = [];
	const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;

	let match: RegExpExecArray | null;
	let lastIndex = 0;

	while ((match = codeBlockRegex.exec(response)) !== null) {
		const explanation = response.slice(lastIndex, match.index).trim();
		const language = match[1] || detectLanguage(match[2]);
		const code = match[2].trim();

		results.push({ code, language, explanation });
		lastIndex = match.index + match[0].length;
	}

	return results;
}

// ============================================================================
// Diff Generation
// ============================================================================

export function generateSimpleDiff(original: string, modified: string): string {
	const originalLines = original.split("\n");
	const modifiedLines = modified.split("\n");
	const diff: string[] = [];

	const maxLines = Math.max(originalLines.length, modifiedLines.length);

	for (let i = 0; i < maxLines; i++) {
		const origLine = originalLines[i];
		const modLine = modifiedLines[i];

		if (origLine === undefined && modLine !== undefined) {
			diff.push(`+ ${modLine}`);
		} else if (modLine === undefined && origLine !== undefined) {
			diff.push(`- ${origLine}`);
		} else if (origLine !== modLine) {
			diff.push(`- ${origLine}`);
			diff.push(`+ ${modLine}`);
		} else {
			diff.push(`  ${origLine}`);
		}
	}

	return diff.join("\n");
}

// ============================================================================
// Token Estimation
// ============================================================================

export function estimateTokens(text: string): number {
	// Rough estimation: ~4 characters per token on average
	return Math.ceil(text.length / 4);
}

// ============================================================================
// Truncation for Discord
// ============================================================================

const DISCORD_MESSAGE_LIMIT = 2000;
const DISCORD_EMBED_LIMIT = 4096;

export function truncateForDiscord(text: string, limit: number = DISCORD_MESSAGE_LIMIT): string {
	if (text.length <= limit) return text;
	return text.slice(0, limit - 3) + "...";
}

export function truncateCodeForEmbed(code: string, language: string): string {
	const overhead = 8 + language.length; // ```lang\n + \n```
	const maxCodeLength = DISCORD_EMBED_LIMIT - overhead - 100; // 100 char buffer for explanation

	if (code.length <= maxCodeLength) return code;
	return code.slice(0, maxCodeLength - 50) + "\n// ... truncated ...";
}

// ============================================================================
// Status Emojis
// ============================================================================

export const STATUS_EMOJIS = {
	pending: "⏳",
	accepted: "✅",
	rejected: "❌",
	running: "🔄",
	success: "✅",
	error: "❌",
	warning: "⚠️",
	info: "ℹ️",
} as const;

// ============================================================================
// Model Provider Colors
// ============================================================================

export const PROVIDER_COLORS: Record<string, number> = {
	openai: 0x10a37f,
	anthropic: 0xd4a574,
	google: 0x4285f4,
	deepseek: 0x00d4ff,
	groq: 0xf55036,
	meta: 0x0668e1,
	mistral: 0xff7000,
	default: 0x5865f2,
};

export function getProviderColor(provider: string): number {
	return PROVIDER_COLORS[provider.toLowerCase()] || PROVIDER_COLORS.default;
}
