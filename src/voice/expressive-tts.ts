/**
 * Expressive TTS Preprocessor
 * Converts natural text patterns to paralinguistic expression tags
 * Inspired by Chatterbox TTS expressiveness
 */

export interface ExpressionOptions {
	provider?: "vibevoice" | "mms-tts" | "elevenlabs";
	preserveOriginal?: boolean; // Keep original emoticons alongside tags
}

interface ExpressionMapping {
	pattern: RegExp;
	replacement: string | ((match: string) => string);
	priority: number; // Lower = higher priority
}

/**
 * Supported paralinguistic tags by provider
 */
const PROVIDER_SUPPORT: Record<string, string[]> = {
	vibevoice: ["laugh", "chuckle", "sigh", "pause"],
	"mms-tts": [], // Minimal TTS model, no tag support
	elevenlabs: ["laugh", "chuckle", "sigh", "pause", "gasp", "breath"],
};

/**
 * Expression mappings with priority (processed in order)
 */
const EXPRESSION_MAPPINGS: ExpressionMapping[] = [
	// Laughter patterns
	{
		pattern: /\b(ha(ha)+|he(he)+|lol|lmao|rofl)\b/gi,
		replacement: "[laugh]",
		priority: 1,
	},
	{
		pattern: /\b(lmfao)\b/gi,
		replacement: "[laugh] [laugh]",
		priority: 1,
	},

	// Emoticon patterns - preserve spacing
	{
		pattern: /:\)/g,
		replacement: "[chuckle]",
		priority: 2,
	},
	{
		pattern: /:\(/g,
		replacement: "[sigh]",
		priority: 2,
	},
	{
		pattern: /;-?\)/g,
		replacement: "[chuckle]",
		priority: 2,
	},
	{
		pattern: /:D/g,
		replacement: "[laugh]",
		priority: 2,
	},
	{
		pattern: /D:/g,
		replacement: "[gasp]",
		priority: 2,
	},
	{
		pattern: /:\*/g,
		replacement: "[pause]",
		priority: 2,
	},

	// Ellipsis and pauses
	{
		pattern: /\.{3,}/g,
		replacement: "[pause]",
		priority: 3,
	},

	// Exclamation emphasis - add natural pause after
	{
		pattern: /!+/g,
		replacement: (match: string) => {
			// Multiple exclamations = longer pause
			const count = match.length;
			return count > 2 ? "! [pause]" : "!";
		},
		priority: 4,
	},

	// Question emphasis - add slight pause for dramatic questions
	{
		pattern: /\?{2,}/g,
		replacement: "? [pause]",
		priority: 4,
	},

	// Breathing/gasps
	{
		pattern: /\*gasp\*|\*gasps\*/gi,
		replacement: "[gasp]",
		priority: 5,
	},
	{
		pattern: /\*breath\*|\*breathe\*/gi,
		replacement: "[breath]",
		priority: 5,
	},

	// Sighs in asterisks
	{
		pattern: /\*sigh\*|\*sighs\*/gi,
		replacement: "[sigh]",
		priority: 5,
	},
];

/**
 * Get supported tags for a provider
 */
export function getSupportedTags(provider: string = "vibevoice"): string[] {
	return PROVIDER_SUPPORT[provider] || [];
}

/**
 * Strip unsupported tags for a given provider
 */
export function stripUnsupportedTags(text: string, provider: string = "vibevoice"): string {
	const supported = new Set(getSupportedTags(provider));

	// If provider doesn't support any tags, strip all
	if (supported.size === 0) {
		return text.replace(/\[[a-z]+\]/gi, "");
	}

	// Strip only unsupported tags
	return text.replace(/\[([a-z]+)\]/gi, (match, tag) => {
		return supported.has(tag.toLowerCase()) ? match : "";
	});
}

/**
 * Preprocess text with expression mappings
 */
function preprocessExpressions(text: string, _options: ExpressionOptions = {}): string {
	let processed = text;

	// Sort by priority and apply transformations
	const sortedMappings = [...EXPRESSION_MAPPINGS].sort((a, b) => a.priority - b.priority);

	for (const mapping of sortedMappings) {
		if (typeof mapping.replacement === "string") {
			processed = processed.replace(mapping.pattern, mapping.replacement);
		} else {
			processed = processed.replace(mapping.pattern, mapping.replacement);
		}
	}

	// Clean up multiple consecutive pauses
	processed = processed.replace(/(\[pause\]\s*){2,}/g, "[pause] ");

	// Clean up excessive whitespace around tags
	processed = processed.replace(/\s*(\[[a-z]+\])\s*/g, " $1 ");

	// Clean up leading/trailing whitespace
	processed = processed.trim();

	// Normalize multiple spaces
	processed = processed.replace(/\s{2,}/g, " ");

	return processed;
}

/**
 * Add expressive paralinguistic tags to text
 *
 * @param text - Input text with natural expressions
 * @param options - Expression options (provider, preserveOriginal)
 * @returns Text with paralinguistic tags
 *
 * @example
 * addExpression("I'm so happy! :)", { provider: "vibevoice" })
 * // Returns: "I'm so happy! [chuckle]"
 *
 * @example
 * addExpression("Wait... what?", { provider: "vibevoice" })
 * // Returns: "Wait [pause] what?"
 *
 * @example
 * addExpression("haha that's funny :D", { provider: "vibevoice" })
 * // Returns: "[laugh] that's funny [laugh]"
 */
export function addExpression(text: string, options: ExpressionOptions = {}): string {
	const { provider = "vibevoice" } = options;

	// Step 1: Convert natural patterns to tags
	let processed = preprocessExpressions(text, options);

	// Step 2: Strip unsupported tags for the provider
	processed = stripUnsupportedTags(processed, provider);

	return processed;
}

/**
 * Preview expression conversion (shows before/after)
 */
export function previewExpression(
	text: string,
	provider: string = "vibevoice",
): {
	original: string;
	processed: string;
	tags: string[];
	stripped: string[];
} {
	const processed = preprocessExpressions(text);
	const final = stripUnsupportedTags(processed, provider);

	// Extract all tags from processed
	const allTags = Array.from(processed.matchAll(/\[([a-z]+)\]/gi)).map((m) => m[1].toLowerCase());

	// Extract stripped tags
	const finalTags = Array.from(final.matchAll(/\[([a-z]+)\]/gi)).map((m) => m[1].toLowerCase());
	const stripped = allTags.filter((tag) => !finalTags.includes(tag));

	// Deduplicate arrays
	const uniqueFinalTags = Array.from(new Set(finalTags));
	const uniqueStripped = Array.from(new Set(stripped));

	return {
		original: text,
		processed: final,
		tags: uniqueFinalTags,
		stripped: uniqueStripped,
	};
}

/**
 * Check if text contains expressible patterns
 */
export function hasExpressibleContent(text: string): boolean {
	return EXPRESSION_MAPPINGS.some((mapping) => mapping.pattern.test(text));
}
