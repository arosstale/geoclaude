/**
 * Class 3.7 Output Style System
 *
 * TAC Pattern: Configurable Response Formats
 * "Control how agents format their outputs for different contexts"
 *
 * Styles:
 * - concise-ultra: Minimal output, bullets only
 * - concise-tts: TTS-friendly, spoken format
 * - verbose-yaml: Structured YAML for parsing
 * - observable-tools: Show all tool usage
 * - markdown-rich: Full markdown with code blocks
 * - json-structured: Machine-parseable JSON
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

/** Output style definition */
export interface OutputStyle {
	id: string;
	name: string;
	description: string;

	/** System prompt modifier */
	systemPromptSuffix: string;

	/** Format instructions */
	formatInstructions: string;

	/** Max response length (chars) */
	maxLength?: number;

	/** Include tool calls in output */
	showToolCalls: boolean;

	/** Include thinking/reasoning */
	showReasoning: boolean;

	/** Include timestamps */
	showTimestamps: boolean;

	/** Include metadata */
	showMetadata: boolean;

	/** Post-processor function */
	postProcess?: (output: string) => string;
}

/** Style preset names */
export type StylePreset =
	| "concise-ultra"
	| "concise-tts"
	| "verbose-yaml"
	| "observable-tools"
	| "markdown-rich"
	| "json-structured"
	| "discord-embed"
	| "trading-report";

/** Style configuration */
export interface StyleConfig {
	defaultStyle: StylePreset;
	enablePostProcessing: boolean;
	maxOutputLength: number;
}

// =============================================================================
// Built-in Styles
// =============================================================================

export const BUILTIN_STYLES: Record<StylePreset, OutputStyle> = {
	"concise-ultra": {
		id: "concise-ultra",
		name: "Concise Ultra",
		description: "Minimal output - bullets and key points only",
		systemPromptSuffix: `
OUTPUT STYLE: CONCISE-ULTRA
- Use ONLY bullet points
- Max 5 bullets per response
- No explanations, just facts
- No code blocks unless essential
- One sentence max per point`,
		formatInstructions: "Respond with bullet points only. Be extremely brief.",
		maxLength: 500,
		showToolCalls: false,
		showReasoning: false,
		showTimestamps: false,
		showMetadata: false,
		postProcess: (output) => {
			// Ensure bullet format
			const lines = output.split("\n").filter((l) => l.trim());
			return lines
				.slice(0, 5)
				.map((l) => (l.startsWith("•") || l.startsWith("-") ? l : `• ${l}`))
				.join("\n");
		},
	},

	"concise-tts": {
		id: "concise-tts",
		name: "Concise TTS",
		description: "TTS-friendly format for voice output",
		systemPromptSuffix: `
OUTPUT STYLE: CONCISE-TTS (Text-to-Speech)
- Write in natural spoken language
- Avoid special characters: no *, #, \`, [], ()
- Spell out abbreviations
- Use simple punctuation only
- No code blocks or technical formatting
- Keep sentences short and clear
- Pause-friendly: use periods for natural breaks`,
		formatInstructions: "Write as if speaking aloud. Natural, clear sentences.",
		maxLength: 800,
		showToolCalls: false,
		showReasoning: false,
		showTimestamps: false,
		showMetadata: false,
		postProcess: (output) => {
			// Clean for TTS
			return output
				.replace(/[*#`\[\](){}]/g, "")
				.replace(/\n{2,}/g, ". ")
				.replace(/\n/g, " ")
				.replace(/\s{2,}/g, " ")
				.trim();
		},
	},

	"verbose-yaml": {
		id: "verbose-yaml",
		name: "Verbose YAML",
		description: "Structured YAML output for parsing",
		systemPromptSuffix: `
OUTPUT STYLE: VERBOSE-YAML
- Format ALL responses as valid YAML
- Use proper indentation (2 spaces)
- Include all relevant fields
- Structure: summary, details, actions, metadata
- Wrap long text in quotes
- Use arrays for lists`,
		formatInstructions: "Respond in YAML format with summary, details, and actions.",
		showToolCalls: true,
		showReasoning: true,
		showTimestamps: true,
		showMetadata: true,
		postProcess: (output) => {
			// Ensure YAML block
			if (!output.startsWith("```yaml") && !output.startsWith("---")) {
				return `\`\`\`yaml\n${output}\n\`\`\``;
			}
			return output;
		},
	},

	"observable-tools": {
		id: "observable-tools",
		name: "Observable Tools",
		description: "Show all tool usage and reasoning",
		systemPromptSuffix: `
OUTPUT STYLE: OBSERVABLE-TOOLS
- Narrate every tool call you make
- Format: [TOOL: name] input -> output
- Show your reasoning before each action
- Include timing information
- Be transparent about failures`,
		formatInstructions: "Show all tool calls with [TOOL: name] format. Be transparent.",
		showToolCalls: true,
		showReasoning: true,
		showTimestamps: true,
		showMetadata: true,
	},

	"markdown-rich": {
		id: "markdown-rich",
		name: "Markdown Rich",
		description: "Full markdown with headers, code, tables",
		systemPromptSuffix: `
OUTPUT STYLE: MARKDOWN-RICH
- Use full markdown formatting
- Include headers (## for sections)
- Use code blocks with language tags
- Add tables where appropriate
- Use bold, italic for emphasis
- Include horizontal rules for sections`,
		formatInstructions: "Use rich markdown formatting with headers and code blocks.",
		showToolCalls: false,
		showReasoning: false,
		showTimestamps: false,
		showMetadata: false,
	},

	"json-structured": {
		id: "json-structured",
		name: "JSON Structured",
		description: "Machine-parseable JSON output",
		systemPromptSuffix: `
OUTPUT STYLE: JSON-STRUCTURED
- Respond ONLY with valid JSON
- Structure: { "status", "summary", "data", "actions", "errors" }
- Use arrays for multiple items
- Include type hints in field names
- No markdown, just pure JSON`,
		formatInstructions: "Respond with valid JSON only. Include status and data fields.",
		showToolCalls: true,
		showReasoning: false,
		showTimestamps: true,
		showMetadata: true,
		postProcess: (output) => {
			// Ensure JSON block
			const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
			if (jsonMatch) {
				return `\`\`\`json\n${jsonMatch[1].trim()}\n\`\`\``;
			}
			try {
				JSON.parse(output);
				return `\`\`\`json\n${output}\n\`\`\``;
			} catch {
				return output;
			}
		},
	},

	"discord-embed": {
		id: "discord-embed",
		name: "Discord Embed",
		description: "Optimized for Discord embeds",
		systemPromptSuffix: `
OUTPUT STYLE: DISCORD-EMBED
- Keep responses under 4000 chars
- Use inline formatting (bold, italic)
- Structure with clear sections
- Use emojis sparingly for visual cues
- Avoid large code blocks (use links instead)
- Make first line a clear summary`,
		formatInstructions: "Format for Discord. Clear summary first, sections after.",
		maxLength: 4000,
		showToolCalls: false,
		showReasoning: false,
		showTimestamps: false,
		showMetadata: false,
	},

	"trading-report": {
		id: "trading-report",
		name: "Trading Report",
		description: "Trading-focused report format",
		systemPromptSuffix: `
OUTPUT STYLE: TRADING-REPORT
- Lead with key metrics and signals
- Format: SIGNAL | PRICE | CONFIDENCE
- Include risk levels and position sizing
- Use tables for multi-asset data
- Add clear BUY/SELL/HOLD recommendations
- Include timestamp and data freshness`,
		formatInstructions: "Trading report format. Lead with signals and metrics.",
		showToolCalls: false,
		showReasoning: true,
		showTimestamps: true,
		showMetadata: true,
	},
};

// =============================================================================
// Output Style Manager
// =============================================================================

export class OutputStyleManager extends EventEmitter {
	private config: StyleConfig;
	private customStyles: Map<string, OutputStyle> = new Map();
	private agentStyles: Map<string, StylePreset> = new Map();

	constructor(config: Partial<StyleConfig> = {}) {
		super();
		this.config = {
			defaultStyle: config.defaultStyle ?? "markdown-rich",
			enablePostProcessing: config.enablePostProcessing ?? true,
			maxOutputLength: config.maxOutputLength ?? 10000,
		};
	}

	// =========================================================================
	// Style Management
	// =========================================================================

	/** Get a style by ID */
	getStyle(styleId: StylePreset | string): OutputStyle | null {
		if (styleId in BUILTIN_STYLES) {
			return BUILTIN_STYLES[styleId as StylePreset];
		}
		return this.customStyles.get(styleId) || null;
	}

	/** Get all available styles */
	listStyles(): Array<{ id: string; name: string; description: string }> {
		const builtins = Object.values(BUILTIN_STYLES).map((s) => ({
			id: s.id,
			name: s.name,
			description: s.description,
		}));

		const customs = Array.from(this.customStyles.values()).map((s) => ({
			id: s.id,
			name: s.name,
			description: s.description,
		}));

		return [...builtins, ...customs];
	}

	/** Register a custom style */
	registerStyle(style: OutputStyle): void {
		this.customStyles.set(style.id, style);
		this.emit("styleRegistered", { id: style.id, name: style.name });
	}

	/** Set style for an agent */
	setAgentStyle(agentId: string, styleId: StylePreset): void {
		this.agentStyles.set(agentId, styleId);
		this.emit("agentStyleSet", { agentId, styleId });
	}

	/** Get style for an agent */
	getAgentStyle(agentId: string): OutputStyle {
		const styleId = this.agentStyles.get(agentId) || this.config.defaultStyle;
		return this.getStyle(styleId) || BUILTIN_STYLES["markdown-rich"];
	}

	// =========================================================================
	// Prompt Enhancement
	// =========================================================================

	/** Enhance system prompt with style instructions */
	enhanceSystemPrompt(basePrompt: string, styleId: StylePreset | string): string {
		const style = this.getStyle(styleId);
		if (!style) return basePrompt;

		return `${basePrompt}\n\n${style.systemPromptSuffix}`;
	}

	/** Get format instructions for a style */
	getFormatInstructions(styleId: StylePreset | string): string {
		const style = this.getStyle(styleId);
		return style?.formatInstructions || "";
	}

	// =========================================================================
	// Output Processing
	// =========================================================================

	/** Process output according to style */
	processOutput(output: string, styleId: StylePreset | string): string {
		const style = this.getStyle(styleId);
		if (!style) return output;

		let processed = output;

		// Apply max length
		if (style.maxLength && processed.length > style.maxLength) {
			processed = processed.slice(0, style.maxLength) + "...";
		}

		// Apply post-processor
		if (this.config.enablePostProcessing && style.postProcess) {
			processed = style.postProcess(processed);
		}

		// Apply global max
		if (processed.length > this.config.maxOutputLength) {
			processed = processed.slice(0, this.config.maxOutputLength) + "...";
		}

		return processed;
	}

	/** Format tool call for display */
	formatToolCall(
		toolName: string,
		input: unknown,
		output: unknown,
		styleId: StylePreset | string,
	): string | null {
		const style = this.getStyle(styleId);
		if (!style?.showToolCalls) return null;

		const inputStr = typeof input === "string" ? input : JSON.stringify(input).slice(0, 100);
		const outputStr = typeof output === "string" ? output.slice(0, 200) : JSON.stringify(output).slice(0, 200);

		return `[TOOL: ${toolName}] ${inputStr} -> ${outputStr}`;
	}

	/** Add metadata to output */
	addMetadata(
		output: string,
		metadata: { timestamp?: Date; agentId?: string; duration?: number },
		styleId: StylePreset | string,
	): string {
		const style = this.getStyle(styleId);
		if (!style?.showMetadata) return output;

		const parts: string[] = [];

		if (style.showTimestamps && metadata.timestamp) {
			parts.push(`_${metadata.timestamp.toISOString()}_`);
		}

		if (metadata.agentId) {
			parts.push(`Agent: ${metadata.agentId}`);
		}

		if (metadata.duration) {
			parts.push(`Duration: ${metadata.duration}ms`);
		}

		if (parts.length === 0) return output;

		return `${output}\n\n---\n${parts.join(" | ")}`;
	}

	// =========================================================================
	// Convenience Methods
	// =========================================================================

	/** Quick process with default style */
	quick(output: string): string {
		return this.processOutput(output, this.config.defaultStyle);
	}

	/** Process for TTS */
	forTTS(output: string): string {
		return this.processOutput(output, "concise-tts");
	}

	/** Process for Discord */
	forDiscord(output: string): string {
		return this.processOutput(output, "discord-embed");
	}

	/** Process for JSON consumption */
	forJSON(output: string): string {
		return this.processOutput(output, "json-structured");
	}

	/** Get config */
	getConfig(): StyleConfig {
		return { ...this.config };
	}

	/** Update config */
	updateConfig(updates: Partial<StyleConfig>): void {
		this.config = { ...this.config, ...updates };
	}
}

// =============================================================================
// Factory
// =============================================================================

let styleManagerInstance: OutputStyleManager | null = null;

export function getStyleManager(config?: Partial<StyleConfig>): OutputStyleManager {
	if (!styleManagerInstance) {
		styleManagerInstance = new OutputStyleManager(config);
	}
	return styleManagerInstance;
}

export function resetStyleManager(): void {
	styleManagerInstance = null;
}
