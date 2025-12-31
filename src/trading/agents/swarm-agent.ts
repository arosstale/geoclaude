/**
 * Swarm Consensus Agent
 * MoonDev-style multi-LLM voting system
 *
 * Queries 6+ AI models in parallel for consensus trading decisions:
 * - Claude (Anthropic)
 * - GPT-4o (OpenAI)
 * - Gemini (Google)
 * - Grok (xAI)
 * - DeepSeek
 * - Llama (Groq)
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, PriceData, TradingAction } from "../types.js";

// ============================================================================
// Types
// ============================================================================

interface SwarmModel {
	name: string;
	provider: "openrouter" | "groq" | "gemini" | "xai" | "deepseek" | "anthropic";
	model: string;
	enabled: boolean;
	weight: number; // Higher = more influence
	apiKeyEnv: string;
}

interface SwarmVote {
	model: string;
	action: TradingAction;
	confidence: number;
	reasoning: string;
	latencyMs: number;
	error?: string;
}

interface SwarmResult {
	symbol: string;
	action: TradingAction;
	confidence: number;
	agreement: number; // % of models that agree
	votes: SwarmVote[];
	totalLatencyMs: number;
	timestamp: number;
}

interface SwarmAgentConfig extends AgentConfig {
	minAgreement: number; // Minimum % agreement to act
	minConfidence: number; // Minimum confidence to act
	timeoutMs: number; // Max time to wait for all models
}

// ============================================================================
// Model Configuration
// ============================================================================

const SWARM_MODELS: SwarmModel[] = [
	// Tier 1: Primary models (highest weight)
	{
		name: "Claude",
		provider: "anthropic",
		model: "claude-sonnet-4-20250514",
		enabled: true,
		weight: 1.5,
		apiKeyEnv: "ANTHROPIC_API_KEY",
	},
	{
		name: "GPT-4o",
		provider: "openrouter",
		model: "openai/gpt-4o",
		enabled: true,
		weight: 1.3,
		apiKeyEnv: "OPENROUTER_API_KEY",
	},
	{
		name: "Gemini",
		provider: "gemini",
		model: "gemini-1.5-flash",
		enabled: true,
		weight: 1.2,
		apiKeyEnv: "GEMINI_API_KEY",
	},

	// Tier 2: Secondary models
	{
		name: "DeepSeek",
		provider: "deepseek",
		model: "deepseek-chat",
		enabled: true,
		weight: 1.0,
		apiKeyEnv: "DEEPSEEK_API_KEY",
	},
	{
		name: "Grok",
		provider: "xai",
		model: "grok-beta",
		enabled: false, // Enable when API available
		weight: 1.0,
		apiKeyEnv: "XAI_API_KEY",
	},

	// Tier 3: Fast inference (Groq)
	{
		name: "Llama-70B",
		provider: "groq",
		model: "llama-3.3-70b-versatile",
		enabled: true,
		weight: 0.9,
		apiKeyEnv: "GROQ_API_KEY",
	},
	{
		name: "Mixtral",
		provider: "groq",
		model: "mixtral-8x7b-32768",
		enabled: true,
		weight: 0.7,
		apiKeyEnv: "GROQ_API_KEY",
	},
];

// ============================================================================
// Swarm Agent
// ============================================================================

export class SwarmAgent extends BaseAgent {
	private models: SwarmModel[];
	private lastSwarmResult: SwarmResult | null = null;
	private swarmHistory: SwarmResult[] = [];
	private readonly MAX_HISTORY = 50;

	constructor(config: Partial<SwarmAgentConfig> = {}) {
		super({
			name: "SwarmAgent",
			enabled: true,
			interval: 300000, // 5 minutes between swarm queries
			symbols: ["BTC", "ETH", "SOL"],
			thresholds: {},
			minAgreement: 0.5, // At least 50% must agree
			minConfidence: 0.6, // Minimum 60% confidence
			timeoutMs: 45000, // 45 second timeout
			...config,
		});

		// Filter to enabled models with valid API keys
		this.models = SWARM_MODELS.filter((m) => m.enabled && process.env[m.apiKeyEnv]);
	}

	protected async run(): Promise<void> {
		for (const symbol of this.config.symbols as string[]) {
			try {
				// Get price data
				const priceData = await this.fetchPriceData(symbol);
				if (!priceData) continue;

				// Run swarm consensus
				const result = await this.getSwarmConsensus(symbol, priceData);

				// Store result
				this.lastSwarmResult = result;
				this.swarmHistory.push(result);
				if (this.swarmHistory.length > this.MAX_HISTORY) {
					this.swarmHistory.shift();
				}

				// Emit signal if consensus met
				const cfg = this.config as SwarmAgentConfig;
				if (result.agreement >= cfg.minAgreement && result.confidence >= cfg.minConfidence) {
					await this.emitSignal({
						symbol,
						action: result.action,
						confidence: result.confidence,
						price: priceData.price,
						reason: `Swarm Consensus: ${(result.agreement * 100).toFixed(0)}% agreement (${result.votes.length} models)`,
						source: this.name,
						timestamp: result.timestamp,
						metadata: {
							swarmAgreement: result.agreement,
							modelsQueried: result.votes.length,
							totalLatencyMs: result.totalLatencyMs,
							votes: result.votes.map((v) => ({ model: v.model, action: v.action, confidence: v.confidence })),
						},
					});
				}
			} catch (error) {
				console.error(`[SwarmAgent] Error for ${symbol}:`, error);
			}
		}
	}

	/**
	 * Get swarm consensus for a symbol
	 */
	async getSwarmConsensus(symbol: string, priceData: PriceData, context?: string): Promise<SwarmResult> {
		const prompt = this.buildPrompt(symbol, priceData, context);
		const startTime = Date.now();

		// Query all models in parallel
		const votePromises = this.models.map(async (model) => {
			const modelStart = Date.now();
			try {
				const result = await this.queryModel(model, prompt);
				return {
					...result,
					latencyMs: Date.now() - modelStart,
				};
			} catch (error) {
				return {
					model: model.name,
					action: "HOLD" as TradingAction,
					confidence: 0,
					reasoning: `Error: ${error instanceof Error ? error.message : "Unknown"}`,
					latencyMs: Date.now() - modelStart,
					error: String(error),
				};
			}
		});

		// Wait with timeout
		const cfg = this.config as SwarmAgentConfig;
		const votes = await Promise.race([
			Promise.all(votePromises),
			new Promise<SwarmVote[]>((resolve) =>
				setTimeout(
					() =>
						resolve(
							this.models.map((m) => ({
								model: m.name,
								action: "HOLD" as TradingAction,
								confidence: 0,
								reasoning: "Timeout",
								latencyMs: cfg.timeoutMs,
								error: "Timeout",
							})),
						),
					cfg.timeoutMs,
				),
			),
		]);

		// Calculate consensus
		const validVotes = votes.filter((v) => !v.error);
		const consensus = this.calculateConsensus(validVotes);

		return {
			symbol,
			action: consensus.action,
			confidence: consensus.confidence,
			agreement: consensus.agreement,
			votes,
			totalLatencyMs: Date.now() - startTime,
			timestamp: Date.now(),
		};
	}

	private buildPrompt(symbol: string, priceData: PriceData, context?: string): string {
		return `You are an elite crypto trading analyst. Analyze this data and provide a trading recommendation.

## ${symbol} Market Data
- Price: $${priceData.price.toLocaleString()}
- 24h Change: ${priceData.change24h >= 0 ? "+" : ""}${priceData.change24h.toFixed(2)}%
- 24h Volume: $${this.formatNumber(priceData.volume24h)}
- Market Cap: $${this.formatNumber(priceData.marketCap)}
${context ? `\n## Additional Context\n${context}` : ""}

## Instructions
Respond with ONLY a JSON object (no markdown):
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation (max 80 chars)"
}

Be conservative. Only recommend BUY/SELL with high conviction (>70% confidence).`;
	}

	private async queryModel(model: SwarmModel, prompt: string): Promise<Omit<SwarmVote, "latencyMs">> {
		switch (model.provider) {
			case "groq":
				return this.queryGroq(model, prompt);
			case "gemini":
				return this.queryGemini(model, prompt);
			case "xai":
				return this.queryXAI(model, prompt);
			case "deepseek":
				return this.queryDeepSeek(model, prompt);
			case "anthropic":
				return this.queryAnthropic(model, prompt);
			default:
				return this.queryOpenRouter(model, prompt);
		}
	}

	private async queryGroq(model: SwarmModel, prompt: string): Promise<Omit<SwarmVote, "latencyMs">> {
		const apiKey = process.env.GROQ_API_KEY;
		if (!apiKey) throw new Error("GROQ_API_KEY not set");

		const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: model.model,
				messages: [{ role: "user", content: prompt }],
				temperature: 0.3,
				max_tokens: 150,
			}),
		});

		if (!response.ok) throw new Error(`Groq API error: ${response.status}`);
		const data = await response.json();
		return this.parseResponse(model.name, data.choices?.[0]?.message?.content || "");
	}

	private async queryGemini(model: SwarmModel, prompt: string): Promise<Omit<SwarmVote, "latencyMs">> {
		const apiKey = process.env.GEMINI_API_KEY;
		if (!apiKey) throw new Error("GEMINI_API_KEY not set");

		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/${model.model}:generateContent?key=${apiKey}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: { temperature: 0.3, maxOutputTokens: 150 },
				}),
			},
		);

		if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
		const data = await response.json();
		return this.parseResponse(model.name, data.candidates?.[0]?.content?.parts?.[0]?.text || "");
	}

	private async queryXAI(model: SwarmModel, prompt: string): Promise<Omit<SwarmVote, "latencyMs">> {
		const apiKey = process.env.XAI_API_KEY;
		if (!apiKey) throw new Error("XAI_API_KEY not set");

		const response = await fetch("https://api.x.ai/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: model.model,
				messages: [{ role: "user", content: prompt }],
				temperature: 0.3,
				max_tokens: 150,
			}),
		});

		if (!response.ok) throw new Error(`xAI API error: ${response.status}`);
		const data = await response.json();
		return this.parseResponse(model.name, data.choices?.[0]?.message?.content || "");
	}

	private async queryDeepSeek(model: SwarmModel, prompt: string): Promise<Omit<SwarmVote, "latencyMs">> {
		const apiKey = process.env.DEEPSEEK_API_KEY;
		if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");

		const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: model.model,
				messages: [{ role: "user", content: prompt }],
				temperature: 0.3,
				max_tokens: 150,
			}),
		});

		if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);
		const data = await response.json();
		return this.parseResponse(model.name, data.choices?.[0]?.message?.content || "");
	}

	private async queryAnthropic(model: SwarmModel, prompt: string): Promise<Omit<SwarmVote, "latencyMs">> {
		const apiKey = process.env.ANTHROPIC_API_KEY;
		if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

		const response = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"x-api-key": apiKey,
				"Content-Type": "application/json",
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model: model.model,
				max_tokens: 150,
				messages: [{ role: "user", content: prompt }],
			}),
		});

		if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
		const data = await response.json();
		return this.parseResponse(model.name, data.content?.[0]?.text || "");
	}

	private async queryOpenRouter(model: SwarmModel, prompt: string): Promise<Omit<SwarmVote, "latencyMs">> {
		const apiKey = process.env.OPENROUTER_API_KEY;
		if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

		const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://github.com/ai-trading-agent",
			},
			body: JSON.stringify({
				model: model.model,
				messages: [{ role: "user", content: prompt }],
				temperature: 0.3,
				max_tokens: 150,
			}),
		});

		if (!response.ok) throw new Error(`OpenRouter API error: ${response.status}`);
		const data = await response.json();
		return this.parseResponse(model.name, data.choices?.[0]?.message?.content || "");
	}

	private parseResponse(modelName: string, content: string): Omit<SwarmVote, "latencyMs"> {
		try {
			const jsonMatch = content.match(/\{[\s\S]*\}/);
			if (!jsonMatch) throw new Error("No JSON found");

			const parsed = JSON.parse(jsonMatch[0]);
			return {
				model: modelName,
				action: this.normalizeAction(parsed.action),
				confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
				reasoning: String(parsed.reasoning || "").slice(0, 150),
			};
		} catch {
			// Fallback parsing
			const upper = content.toUpperCase();
			let action: TradingAction = "HOLD";
			if (upper.includes("BUY")) action = "BUY";
			else if (upper.includes("SELL")) action = "SELL";

			return {
				model: modelName,
				action,
				confidence: 0.3,
				reasoning: "Failed to parse response",
			};
		}
	}

	private normalizeAction(action: string): TradingAction {
		const upper = String(action).toUpperCase().trim();
		if (upper === "BUY") return "BUY";
		if (upper === "SELL") return "SELL";
		return "HOLD";
	}

	private calculateConsensus(votes: SwarmVote[]): {
		action: TradingAction;
		confidence: number;
		agreement: number;
	} {
		if (votes.length === 0) {
			return { action: "HOLD", confidence: 0, agreement: 0 };
		}

		// Count weighted votes
		const voteWeights: Record<TradingAction, number> = { BUY: 0, SELL: 0, HOLD: 0, NOTHING: 0 };
		let totalWeight = 0;
		let totalConfidence = 0;

		for (const vote of votes) {
			const model = this.models.find((m) => m.name === vote.model);
			const weight = model?.weight || 1;

			voteWeights[vote.action] += weight * vote.confidence;
			totalWeight += weight;
			totalConfidence += vote.confidence * weight;
		}

		// Find winner
		let winningAction: TradingAction = "HOLD";
		let maxWeight = 0;
		for (const [action, weight] of Object.entries(voteWeights)) {
			if (weight > maxWeight) {
				maxWeight = weight;
				winningAction = action as TradingAction;
			}
		}

		const agreement = maxWeight / totalWeight;
		const avgConfidence = totalConfidence / totalWeight;

		return {
			action: winningAction,
			confidence: avgConfidence * agreement,
			agreement,
		};
	}

	private async fetchPriceData(symbol: string): Promise<PriceData | null> {
		try {
			const response = await fetch(
				`https://api.coingecko.com/api/v3/simple/price?ids=${this.getCoingeckoId(symbol)}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`,
			);
			if (!response.ok) return null;

			const data = await response.json();
			const id = this.getCoingeckoId(symbol);
			const item = data[id];
			if (!item) return null;

			return {
				symbol,
				price: item.usd || 0,
				change24h: item.usd_24h_change || 0,
				volume24h: item.usd_24h_vol || 0,
				marketCap: item.usd_market_cap || 0,
				timestamp: Date.now(),
			};
		} catch {
			return null;
		}
	}

	private getCoingeckoId(symbol: string): string {
		const map: Record<string, string> = {
			BTC: "bitcoin",
			ETH: "ethereum",
			SOL: "solana",
			DOGE: "dogecoin",
			XRP: "ripple",
		};
		return map[symbol.toUpperCase()] || symbol.toLowerCase();
	}

	private formatNumber(num: number): string {
		if (num >= 1e12) return `${(num / 1e12).toFixed(2)}T`;
		if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
		if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
		if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
		return num.toFixed(2);
	}

	// ============================================================================
	// Public API
	// ============================================================================

	getLastResult(): SwarmResult | null {
		return this.lastSwarmResult;
	}

	getHistory(): SwarmResult[] {
		return [...this.swarmHistory];
	}

	getStats(): {
		totalQueries: number;
		avgAgreement: number;
		avgLatency: number;
		modelStats: Record<string, { queries: number; avgConfidence: number; errors: number }>;
	} {
		const modelStats: Record<string, { queries: number; avgConfidence: number; errors: number }> = {};

		let totalAgreement = 0;
		let totalLatency = 0;

		for (const result of this.swarmHistory) {
			totalAgreement += result.agreement;
			totalLatency += result.totalLatencyMs;

			for (const vote of result.votes) {
				if (!modelStats[vote.model]) {
					modelStats[vote.model] = { queries: 0, avgConfidence: 0, errors: 0 };
				}
				modelStats[vote.model].queries++;
				modelStats[vote.model].avgConfidence += vote.confidence;
				if (vote.error) modelStats[vote.model].errors++;
			}
		}

		// Calculate averages
		for (const model of Object.keys(modelStats)) {
			if (modelStats[model].queries > 0) {
				modelStats[model].avgConfidence /= modelStats[model].queries;
			}
		}

		return {
			totalQueries: this.swarmHistory.length,
			avgAgreement: this.swarmHistory.length > 0 ? totalAgreement / this.swarmHistory.length : 0,
			avgLatency: this.swarmHistory.length > 0 ? totalLatency / this.swarmHistory.length : 0,
			modelStats,
		};
	}

	getEnabledModels(): string[] {
		return this.models.map((m) => m.name);
	}
}

// ============================================================================
// Export
// ============================================================================

export { SWARM_MODELS };
export type { SwarmModel, SwarmVote, SwarmResult };
