/**
 * Autocomplete Handlers
 * Dynamic suggestions for slash commands
 */

import type { AutocompleteInteraction } from "discord.js";

// Recent queries per user (for suggestions)
const recentQueries = new Map<string, string[]>();
const MAX_RECENT = 10;

// Common patterns and templates
const COMMON_PATTERNS = {
	ask: [
		"Explain how to...",
		"What is the best way to...",
		"Help me debug...",
		"Write a function that...",
		"Analyze this code...",
		"Review for security issues...",
	],
	research: [
		"Latest developments in...",
		"Compare X vs Y for...",
		"Best practices for...",
		"Technical analysis of...",
		"Security implications of...",
	],
	trading: [
		"BTC price analysis",
		"SOL momentum check",
		"ETH trend prediction",
		"Market sentiment for...",
		"Whale activity on...",
	],
	model: ["glm-4.7", "glm-4.6", "claude-sonnet", "gpt-4o", "gemini-pro", "deepseek-v3"],
	expertise: ["trading", "security", "database", "api_integration", "performance", "coding", "research"],
};

/**
 * Store a recent query for a user
 */
export function addRecentQuery(userId: string, query: string): void {
	const recent = recentQueries.get(userId) || [];

	// Don't add duplicates
	if (recent.includes(query)) {
		// Move to front
		const idx = recent.indexOf(query);
		recent.splice(idx, 1);
		recent.unshift(query);
	} else {
		recent.unshift(query);
		if (recent.length > MAX_RECENT) {
			recent.pop();
		}
	}

	recentQueries.set(userId, recent);
}

/**
 * Get autocomplete suggestions for a query
 */
export function getSuggestions(
	userId: string,
	focused: string,
	type: keyof typeof COMMON_PATTERNS = "ask",
): Array<{ name: string; value: string }> {
	const suggestions: Array<{ name: string; value: string }> = [];
	const focusedLower = focused.toLowerCase();

	// Add matching recent queries first
	const recent = recentQueries.get(userId) || [];
	for (const query of recent) {
		if (query.toLowerCase().includes(focusedLower) || focusedLower === "") {
			suggestions.push({ name: `🕐 ${query.slice(0, 90)}`, value: query });
		}
		if (suggestions.length >= 5) break;
	}

	// Add matching common patterns
	const patterns = COMMON_PATTERNS[type] || COMMON_PATTERNS.ask;
	for (const pattern of patterns) {
		if (pattern.toLowerCase().includes(focusedLower) || focusedLower === "") {
			if (!suggestions.find((s) => s.value === pattern)) {
				suggestions.push({ name: pattern.slice(0, 100), value: pattern });
			}
		}
		if (suggestions.length >= 15) break;
	}

	// If user is typing something new, add it as first option
	if (focused.length > 2 && !suggestions.find((s) => s.value === focused)) {
		suggestions.unshift({ name: focused.slice(0, 100), value: focused });
	}

	return suggestions.slice(0, 25); // Discord limit
}

/**
 * Handle autocomplete interaction for various commands
 */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
	const command = interaction.commandName;
	const focused = interaction.options.getFocused();
	const userId = interaction.user.id;

	let suggestions: Array<{ name: string; value: string }> = [];

	switch (command) {
		case "ask":
		case "agent":
			suggestions = getSuggestions(userId, focused, "ask");
			break;

		case "research":
			suggestions = getSuggestions(userId, focused, "research");
			break;

		case "trading":
		case "price":
		case "chart":
			suggestions = getSuggestions(userId, focused, "trading");
			break;

		case "model":
		case "provider":
			suggestions = getSuggestions(userId, focused, "model");
			break;

		case "expert":
		case "expertise":
			suggestions = getSuggestions(userId, focused, "expertise");
			break;

		default:
			// Generic suggestions
			suggestions = getSuggestions(userId, focused, "ask");
	}

	try {
		await interaction.respond(suggestions);
	} catch {
		// Ignore expired interactions
	}
}

/**
 * Get suggestions for symbol/token autocomplete
 */
export function getTokenSuggestions(focused: string): Array<{ name: string; value: string }> {
	const tokens = [
		{ name: "Bitcoin (BTC)", value: "BTC" },
		{ name: "Ethereum (ETH)", value: "ETH" },
		{ name: "Solana (SOL)", value: "SOL" },
		{ name: "Cardano (ADA)", value: "ADA" },
		{ name: "Polygon (MATIC)", value: "MATIC" },
		{ name: "Avalanche (AVAX)", value: "AVAX" },
		{ name: "Chainlink (LINK)", value: "LINK" },
		{ name: "Uniswap (UNI)", value: "UNI" },
		{ name: "Aave (AAVE)", value: "AAVE" },
		{ name: "Maker (MKR)", value: "MKR" },
	];

	const focusedLower = focused.toLowerCase();
	return tokens
		.filter((t) => t.name.toLowerCase().includes(focusedLower) || t.value.toLowerCase().includes(focusedLower))
		.slice(0, 25);
}

/**
 * Get suggestions for file paths
 */
export function getPathSuggestions(focused: string, basePaths: string[] = []): Array<{ name: string; value: string }> {
	const suggestions: Array<{ name: string; value: string }> = [];

	// Common paths
	const commonPaths = [
		"src/",
		"src/agents/",
		"src/trading/",
		"src/utils/",
		"package.json",
		"tsconfig.json",
		...basePaths,
	];

	for (const path of commonPaths) {
		if (path.toLowerCase().includes(focused.toLowerCase())) {
			suggestions.push({ name: path, value: path });
		}
	}

	return suggestions.slice(0, 25);
}

/**
 * Clean up old entries
 */
export function cleanupAutocomplete(): void {
	// Keep only last 1000 users
	if (recentQueries.size > 1000) {
		const entries = Array.from(recentQueries.entries());
		const toRemove = entries.slice(0, entries.length - 1000);
		for (const [userId] of toRemove) {
			recentQueries.delete(userId);
		}
	}
}

// Cleanup every hour
setInterval(cleanupAutocomplete, 3600000);
