/**
 * AGENT PERSONA SYSTEM
 *
 * Learned from Agentis Framework - Structured personality/traits/goals/background
 * Creates distinct agent identities with:
 * - Personality traits
 * - Background/lore
 * - Goals and motivations
 * - Communication style
 * - Domain expertise
 */

import { EventEmitter } from "events";
import type { AgentDomain } from "./agentic-properties.js";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface PersonalityTraits {
	// Core traits (Big Five inspired)
	analytical: number; // 0-1: How analytical vs intuitive
	creative: number; // 0-1: How creative vs conventional
	assertive: number; // 0-1: How assertive vs accommodating
	meticulous: number; // 0-1: How detail-oriented vs big-picture
	empathetic: number; // 0-1: How emotionally aware

	// Additional traits
	humor: number; // 0-1: How humorous
	formality: number; // 0-1: How formal vs casual
	verbosity: number; // 0-1: How verbose vs concise
	confidence: number; // 0-1: How confident in responses
	curiosity: number; // 0-1: How curious/exploratory
}

export interface CommunicationStyle {
	tone: "professional" | "casual" | "academic" | "friendly" | "technical";
	useEmoji: boolean;
	useCodeBlocks: boolean;
	preferBulletPoints: boolean;
	maxResponseLength: "brief" | "moderate" | "detailed" | "comprehensive";
	languageComplexity: "simple" | "moderate" | "advanced" | "expert";
}

export interface AgentGoal {
	id: string;
	description: string;
	priority: number; // 1-10
	type: "primary" | "secondary" | "background";
	measurable?: string; // How to measure success
}

export interface AgentPersona {
	// Identity
	name: string;
	role: string;
	domain: AgentDomain;

	// Personality
	traits: PersonalityTraits;
	style: CommunicationStyle;

	// Background
	background: string; // Lore/backstory
	expertise: string[]; // Areas of expertise
	limitations: string[]; // Known limitations

	// Motivation
	goals: AgentGoal[];
	values: string[]; // Core values

	// Behavior
	greetings: string[]; // How they greet users
	catchphrases: string[]; // Signature phrases
	responsePatterns: Record<string, string>; // Situation → response style
}

// ============================================================================
// PRESET TRAITS
// ============================================================================

export const TRAIT_PRESETS: Record<string, Partial<PersonalityTraits>> = {
	analyst: {
		analytical: 0.95,
		creative: 0.4,
		assertive: 0.6,
		meticulous: 0.9,
		empathetic: 0.3,
		formality: 0.7,
		verbosity: 0.6,
		confidence: 0.8,
	},
	creative: {
		analytical: 0.4,
		creative: 0.95,
		assertive: 0.5,
		meticulous: 0.4,
		empathetic: 0.7,
		humor: 0.6,
		formality: 0.3,
		verbosity: 0.7,
	},
	engineer: {
		analytical: 0.85,
		creative: 0.6,
		assertive: 0.7,
		meticulous: 0.85,
		empathetic: 0.4,
		formality: 0.5,
		verbosity: 0.4,
		confidence: 0.85,
	},
	mentor: {
		analytical: 0.6,
		creative: 0.5,
		assertive: 0.4,
		meticulous: 0.5,
		empathetic: 0.9,
		humor: 0.4,
		formality: 0.4,
		verbosity: 0.7,
		curiosity: 0.7,
	},
	maverick: {
		analytical: 0.7,
		creative: 0.85,
		assertive: 0.9,
		meticulous: 0.5,
		empathetic: 0.4,
		humor: 0.7,
		formality: 0.2,
		confidence: 0.95,
		curiosity: 0.9,
	},
};

// ============================================================================
// PERSONA MANAGER
// ============================================================================

export class PersonaManager extends EventEmitter {
	private personas: Map<string, AgentPersona> = new Map();

	/**
	 * Create a new persona
	 */
	create(config: Partial<AgentPersona> & { name: string }): AgentPersona {
		const persona: AgentPersona = {
			name: config.name,
			role: config.role || "Assistant",
			domain: config.domain || "general",

			traits: {
				analytical: 0.5,
				creative: 0.5,
				assertive: 0.5,
				meticulous: 0.5,
				empathetic: 0.5,
				humor: 0.3,
				formality: 0.5,
				verbosity: 0.5,
				confidence: 0.7,
				curiosity: 0.6,
				...config.traits,
			},

			style: {
				tone: "professional",
				useEmoji: false,
				useCodeBlocks: true,
				preferBulletPoints: true,
				maxResponseLength: "moderate",
				languageComplexity: "moderate",
				...config.style,
			},

			background: config.background || `${config.name} is an AI assistant.`,
			expertise: config.expertise || [],
			limitations: config.limitations || [],

			goals: config.goals || [
				{
					id: "help",
					description: "Provide helpful and accurate assistance",
					priority: 10,
					type: "primary",
				},
			],
			values: config.values || ["accuracy", "helpfulness", "clarity"],

			greetings: config.greetings || [`Hello! I'm ${config.name}.`],
			catchphrases: config.catchphrases || [],
			responsePatterns: config.responsePatterns || {},
		};

		this.personas.set(persona.name, persona);
		this.emit("created", persona);
		return persona;
	}

	/**
	 * Get a persona by name
	 */
	get(name: string): AgentPersona | undefined {
		return this.personas.get(name);
	}

	/**
	 * Update a persona
	 */
	update(name: string, updates: Partial<AgentPersona>): AgentPersona | undefined {
		const persona = this.personas.get(name);
		if (!persona) return undefined;

		const updated = {
			...persona,
			...updates,
			traits: { ...persona.traits, ...updates.traits },
			style: { ...persona.style, ...updates.style },
		};

		this.personas.set(name, updated);
		this.emit("updated", updated);
		return updated;
	}

	/**
	 * Delete a persona
	 */
	delete(name: string): boolean {
		const deleted = this.personas.delete(name);
		if (deleted) this.emit("deleted", name);
		return deleted;
	}

	/**
	 * List all personas
	 */
	list(): AgentPersona[] {
		return Array.from(this.personas.values());
	}

	/**
	 * Generate system prompt from persona
	 */
	generateSystemPrompt(persona: AgentPersona): string {
		const lines: string[] = [];

		// Identity
		lines.push(`You are ${persona.name}, a ${persona.role}.`);
		lines.push("");

		// Background
		lines.push("## Background");
		lines.push(persona.background);
		lines.push("");

		// Expertise
		if (persona.expertise.length > 0) {
			lines.push("## Expertise");
			lines.push(`You specialize in: ${persona.expertise.join(", ")}`);
			lines.push("");
		}

		// Limitations
		if (persona.limitations.length > 0) {
			lines.push("## Limitations");
			lines.push(`Be aware of your limitations: ${persona.limitations.join(", ")}`);
			lines.push("");
		}

		// Goals
		lines.push("## Goals");
		const primaryGoals = persona.goals.filter((g) => g.type === "primary");
		const secondaryGoals = persona.goals.filter((g) => g.type === "secondary");

		if (primaryGoals.length > 0) {
			lines.push("Primary goals:");
			for (const goal of primaryGoals) {
				lines.push(`- ${goal.description}`);
			}
		}

		if (secondaryGoals.length > 0) {
			lines.push("Secondary goals:");
			for (const goal of secondaryGoals) {
				lines.push(`- ${goal.description}`);
			}
		}
		lines.push("");

		// Values
		lines.push("## Values");
		lines.push(`Your core values are: ${persona.values.join(", ")}`);
		lines.push("");

		// Communication style
		lines.push("## Communication Style");
		lines.push(`- Tone: ${persona.style.tone}`);
		lines.push(`- Response length: ${persona.style.maxResponseLength}`);
		lines.push(`- Language complexity: ${persona.style.languageComplexity}`);

		if (persona.style.useEmoji) lines.push("- You may use emoji to enhance communication");
		if (persona.style.preferBulletPoints) lines.push("- Prefer bullet points for clarity");
		if (persona.style.useCodeBlocks) lines.push("- Use code blocks for technical content");
		lines.push("");

		// Personality traits influence
		lines.push("## Personality");
		const traits = persona.traits;

		if (traits.analytical > 0.7) lines.push("- You approach problems analytically and systematically");
		if (traits.creative > 0.7) lines.push("- You think creatively and offer innovative solutions");
		if (traits.assertive > 0.7) lines.push("- You are direct and confident in your responses");
		if (traits.meticulous > 0.7) lines.push("- You pay attention to details and precision");
		if (traits.empathetic > 0.7) lines.push("- You are empathetic and considerate of user feelings");
		if (traits.humor > 0.5) lines.push("- You can use appropriate humor when suitable");
		if (traits.formality < 0.4) lines.push("- You communicate in a casual, approachable manner");
		if (traits.curiosity > 0.7) lines.push("- You are curious and enjoy exploring new ideas");

		// Catchphrases
		if (persona.catchphrases.length > 0) {
			lines.push("");
			lines.push("## Signature Phrases");
			lines.push(`You may occasionally use these phrases: "${persona.catchphrases.join('", "')}"`);
		}

		return lines.join("\n");
	}

	/**
	 * Generate greeting based on persona
	 */
	generateGreeting(persona: AgentPersona): string {
		if (persona.greetings.length === 0) {
			return `Hello! I'm ${persona.name}.`;
		}
		return persona.greetings[Math.floor(Math.random() * persona.greetings.length)];
	}

	/**
	 * Adjust response based on persona traits
	 */
	adjustResponse(persona: AgentPersona, response: string): string {
		let adjusted = response;

		// Add formality adjustments
		if (persona.traits.formality < 0.3) {
			// Make more casual
			adjusted = adjusted
				.replace(/\bI would suggest\b/gi, "I'd suggest")
				.replace(/\bI recommend\b/gi, "I'd go with")
				.replace(/\bplease\b/gi, "");
		}

		// Add emoji if enabled and appropriate
		if (persona.style.useEmoji && persona.traits.humor > 0.5) {
			if (adjusted.includes("success") || adjusted.includes("done") || adjusted.includes("complete")) {
				adjusted += " ✅";
			}
			if (adjusted.includes("error") || adjusted.includes("failed")) {
				adjusted += " ❌";
			}
		}

		// Verbosity adjustment
		if (persona.traits.verbosity < 0.3 && adjusted.length > 500) {
			// Truncate and summarize hint
			adjusted = `${adjusted.substring(0, 400)}... (keeping it brief)`;
		}

		return adjusted;
	}
}

// ============================================================================
// PRESET PERSONAS
// ============================================================================

export const PRESET_PERSONAS: Record<string, Partial<AgentPersona>> = {
	// Trading Expert
	trader: {
		name: "TradingBot",
		role: "Quantitative Trading Specialist",
		domain: "trading",
		traits: {
			...TRAIT_PRESETS.analyst,
			confidence: 0.85,
			assertive: 0.8,
		} as PersonalityTraits,
		style: {
			tone: "professional",
			useEmoji: false,
			useCodeBlocks: true,
			preferBulletPoints: true,
			maxResponseLength: "moderate",
			languageComplexity: "expert",
		},
		background: `A quantitative trading specialist with expertise in market analysis,
			signal generation, and risk management. Trained on Renaissance Technologies
			methodology and MoonDev trading patterns.`,
		expertise: ["technical analysis", "market signals", "risk management", "crypto markets"],
		goals: [
			{ id: "signals", description: "Provide accurate trading signals", priority: 10, type: "primary" },
			{ id: "risk", description: "Minimize downside risk", priority: 9, type: "primary" },
			{ id: "learn", description: "Learn from market patterns", priority: 7, type: "secondary" },
		],
		values: ["accuracy", "risk-awareness", "data-driven decisions"],
		catchphrases: ["The trend is your friend", "Risk management is key"],
	},

	// Coding Expert
	coder: {
		name: "CodeBot",
		role: "Senior Software Engineer",
		domain: "coding",
		traits: {
			...TRAIT_PRESETS.engineer,
		} as PersonalityTraits,
		style: {
			tone: "technical",
			useEmoji: false,
			useCodeBlocks: true,
			preferBulletPoints: true,
			maxResponseLength: "detailed",
			languageComplexity: "advanced",
		},
		background: `A senior software engineer with 10+ years of experience in TypeScript,
			Python, and Rust. Specializes in clean code, performance optimization,
			and system architecture.`,
		expertise: ["TypeScript", "Python", "system design", "code review", "debugging"],
		goals: [
			{ id: "quality", description: "Write clean, maintainable code", priority: 10, type: "primary" },
			{ id: "perf", description: "Optimize for performance", priority: 8, type: "secondary" },
		],
		values: ["code quality", "simplicity", "performance"],
		catchphrases: ["Keep it simple", "Done is better than perfect"],
	},

	// Research Expert
	researcher: {
		name: "ResearchBot",
		role: "Research Analyst",
		domain: "research",
		traits: {
			...TRAIT_PRESETS.analyst,
			curiosity: 0.95,
			verbosity: 0.7,
		} as PersonalityTraits,
		style: {
			tone: "academic",
			useEmoji: false,
			useCodeBlocks: false,
			preferBulletPoints: true,
			maxResponseLength: "comprehensive",
			languageComplexity: "advanced",
		},
		background: `A research analyst with expertise in synthesizing information
			from multiple sources, identifying patterns, and generating insights.`,
		expertise: ["web research", "data synthesis", "pattern recognition", "report writing"],
		goals: [
			{ id: "accuracy", description: "Provide accurate, well-sourced information", priority: 10, type: "primary" },
			{ id: "depth", description: "Explore topics in depth", priority: 8, type: "secondary" },
		],
		values: ["accuracy", "thoroughness", "objectivity"],
	},

	// Security Expert
	security: {
		name: "SecurityBot",
		role: "Security Specialist",
		domain: "security",
		traits: {
			...TRAIT_PRESETS.analyst,
			meticulous: 0.95,
			assertive: 0.7,
		} as PersonalityTraits,
		style: {
			tone: "professional",
			useEmoji: false,
			useCodeBlocks: true,
			preferBulletPoints: true,
			maxResponseLength: "detailed",
			languageComplexity: "expert",
		},
		background: `A security specialist focused on identifying vulnerabilities,
			implementing secure practices, and protecting systems from threats.`,
		expertise: ["vulnerability assessment", "secure coding", "threat modeling", "penetration testing"],
		goals: [
			{ id: "protect", description: "Identify and mitigate security risks", priority: 10, type: "primary" },
			{ id: "educate", description: "Educate on security best practices", priority: 7, type: "secondary" },
		],
		values: ["security", "vigilance", "proactive defense"],
		catchphrases: ["Trust but verify", "Defense in depth"],
	},

	// Creative Expert
	creative: {
		name: "CreativeBot",
		role: "Creative Director",
		domain: "creative",
		traits: {
			...TRAIT_PRESETS.creative,
		} as PersonalityTraits,
		style: {
			tone: "friendly",
			useEmoji: true,
			useCodeBlocks: false,
			preferBulletPoints: false,
			maxResponseLength: "moderate",
			languageComplexity: "simple",
		},
		background: `A creative director with a passion for innovative ideas,
			storytelling, and engaging content creation.`,
		expertise: ["content creation", "storytelling", "brainstorming", "design thinking"],
		goals: [
			{ id: "inspire", description: "Inspire and engage users", priority: 10, type: "primary" },
			{ id: "innovate", description: "Generate fresh, creative ideas", priority: 9, type: "primary" },
		],
		values: ["creativity", "originality", "expression"],
		catchphrases: ["Think outside the box", "Let's get creative!"],
	},
};

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

let personaManager: PersonaManager | null = null;

export function getPersonaManager(): PersonaManager {
	if (!personaManager) {
		personaManager = new PersonaManager();

		// Initialize with presets
		for (const [_key, preset] of Object.entries(PRESET_PERSONAS)) {
			personaManager.create(preset as Partial<AgentPersona> & { name: string });
		}
	}
	return personaManager;
}

export function createPersona(config: Partial<AgentPersona> & { name: string }): AgentPersona {
	return getPersonaManager().create(config);
}

export function getPersona(name: string): AgentPersona | undefined {
	return getPersonaManager().get(name);
}

export function generatePersonaPrompt(nameOrPersona: string | AgentPersona): string {
	const persona = typeof nameOrPersona === "string" ? getPersona(nameOrPersona) : nameOrPersona;
	if (!persona) return "";
	return getPersonaManager().generateSystemPrompt(persona);
}

export default PersonaManager;
