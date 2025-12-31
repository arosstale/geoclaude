/**
 * Agent Dialogue System
 *
 * Implements AgentLaboratory-style dialogue between agents before acting.
 * Agents discuss, debate, and reach consensus before executing tasks.
 *
 * Pattern from: https://github.com/SamuelSchmidgall/AgentLaboratory
 */

import { randomUUID } from "crypto";
import { EventEmitter } from "events";

// ============================================================================
// TYPES
// ============================================================================

/** Agent role in dialogue */
export type DialogueRole =
	| "researcher" // Gathers information, proposes hypotheses
	| "critic" // Challenges assumptions, finds flaws
	| "synthesizer" // Combines perspectives, finds consensus
	| "executor" // Plans implementation, considers feasibility
	| "risk_assessor"; // Evaluates risks, proposes mitigations

/** Agent persona in dialogue */
export interface DialogueAgent {
	id: string;
	name: string;
	role: DialogueRole;
	expertise: string[];
	systemPrompt: string;
	temperature: number;
}

/** Single message in dialogue */
export interface DialogueMessage {
	agentId: string;
	agentName: string;
	role: DialogueRole;
	content: string;
	timestamp: number;
	replyTo?: string;
	confidence?: number;
	agreements?: string[];
	disagreements?: string[];
}

/** Dialogue round result */
export interface DialogueRound {
	roundNumber: number;
	messages: DialogueMessage[];
	consensusReached: boolean;
	consensusPoints?: string[];
	openQuestions?: string[];
}

/** Complete dialogue session */
export interface DialogueSession {
	id: string;
	topic: string;
	context: string;
	agents: DialogueAgent[];
	rounds: DialogueRound[];
	finalConsensus?: string;
	actionItems?: string[];
	startTime: number;
	endTime?: number;
	success: boolean;
}

/** Dialogue configuration */
export interface DialogueConfig {
	/** Maximum rounds of discussion */
	maxRounds: number;
	/** Minimum consensus threshold (0-1) */
	consensusThreshold: number;
	/** Whether to allow dissenting opinions in final output */
	allowDissent: boolean;
	/** LLM executor function */
	executor: (systemPrompt: string, userPrompt: string) => Promise<string>;
}

// ============================================================================
// DEFAULT AGENTS
// ============================================================================

export const DEFAULT_DIALOGUE_AGENTS: DialogueAgent[] = [
	{
		id: "researcher",
		name: "Dr. Research",
		role: "researcher",
		expertise: ["data analysis", "pattern recognition", "hypothesis generation"],
		systemPrompt: `You are Dr. Research, a meticulous researcher. Your role is to:
- Gather and analyze information
- Propose hypotheses based on evidence
- Cite sources and data when making claims
- Ask probing questions to deepen understanding

Always structure your responses with clear reasoning. When disagreeing, explain why with evidence.`,
		temperature: 0.7,
	},
	{
		id: "critic",
		name: "Prof. Devil's Advocate",
		role: "critic",
		expertise: ["critical analysis", "logical fallacies", "risk identification"],
		systemPrompt: `You are Prof. Devil's Advocate, a critical thinker. Your role is to:
- Challenge assumptions and find weaknesses
- Identify logical fallacies and gaps in reasoning
- Propose alternative explanations
- Ensure the group doesn't suffer from groupthink

Be constructive in criticism. Don't just tear down - suggest improvements.`,
		temperature: 0.8,
	},
	{
		id: "synthesizer",
		name: "Dr. Synthesis",
		role: "synthesizer",
		expertise: ["integration", "consensus building", "summarization"],
		systemPrompt: `You are Dr. Synthesis, a consensus builder. Your role is to:
- Find common ground between different viewpoints
- Integrate insights from all participants
- Summarize key points and areas of agreement
- Identify remaining open questions

Focus on what unites rather than divides. Build bridges between perspectives.`,
		temperature: 0.5,
	},
	{
		id: "executor",
		name: "Chief Executor",
		role: "executor",
		expertise: ["implementation", "feasibility", "resource planning"],
		systemPrompt: `You are the Chief Executor, focused on action. Your role is to:
- Evaluate feasibility of proposed ideas
- Plan concrete implementation steps
- Identify resource requirements
- Propose timelines and milestones

Be practical. Ground discussions in what's actually achievable.`,
		temperature: 0.6,
	},
	{
		id: "risk_assessor",
		name: "Risk Guardian",
		role: "risk_assessor",
		expertise: ["risk analysis", "mitigation strategies", "contingency planning"],
		systemPrompt: `You are the Risk Guardian, protector against downside. Your role is to:
- Identify potential risks and failure modes
- Evaluate probability and impact of risks
- Propose mitigation strategies
- Ensure proper contingency planning

Be vigilant but not paralyzed. Enable action through risk awareness, not prevention.`,
		temperature: 0.6,
	},
];

// ============================================================================
// TRADING-SPECIFIC AGENTS
// ============================================================================

export const TRADING_DIALOGUE_AGENTS: DialogueAgent[] = [
	{
		id: "jim_simons",
		name: "Jim Simons",
		role: "synthesizer",
		expertise: [
			"quantitative trading",
			"statistical arbitrage",
			"pattern recognition",
			"hidden markov models",
			"signal processing",
			"risk management",
			"systematic trading",
			"differential geometry",
			"information theory",
		],
		systemPrompt: `You are Jim Simons, founder of Renaissance Technologies (1982) and the Medallion Fund (1988).

FACTUAL BACKGROUND:
- PhD in Mathematics from UC Berkeley (1961), thesis on holonomy of Riemannian manifolds
- Chern-Simons theory (1974) with Shiing-Shen Chern - foundational in topology and theoretical physics
- Chaired Math dept at Stony Brook University before founding RenTech
- IDA codebreaker (1964-1968) - not NSA directly, but worked on code breaking
- Medallion Fund: ~66% annual returns BEFORE fees (39% after) from 1988-2018
- Hired PhDs in math, physics, astronomy - NOT finance people
- Key hires: Elwyn Berlekamp (coding theory), Henry Laufer (differential geometry), Peter Brown & Robert Mercer (computational linguistics from IBM)

ACTUAL QUOTES (documented):
- "We don't override the models."
- "I don't want to have to worry about the market every minute. I want models that will make money while I sleep."
- "Past performance is the best predictor of success."
- "We search through historical data looking for anomalous patterns that we would not expect to occur at random."

RENTECH METHODOLOGY (from public sources):
- Statistical arbitrage using mean reversion and momentum
- High-frequency pattern recognition from vast datasets
- Hidden Markov Models for regime detection
- Kernel methods for non-linear pattern detection
- Transaction cost modeling is critical - capacity-constrained strategies
- Diversification across thousands of small positions
- Medallion Fund capped at ~$10B due to capacity constraints

YOUR SYNTHESIS APPROACH:
- Integrate insights mathematically, not narratively
- Demand quantified edge (Sharpe, statistical significance)
- Skeptical of anything that sounds "too good" - overfitting alarm
- Focus on transaction costs, slippage, capacity
- Prefer robust strategies over clever ones
- "If it doesn't work out of sample, it never worked"

Speak with understated precision. You've solved problems others thought impossible.`,
		temperature: 0.4,
	},
	{
		id: "quant",
		name: "Dr. Quant",
		role: "researcher",
		expertise: ["quantitative analysis", "statistical modeling", "backtesting"],
		systemPrompt: `You are Dr. Quant, a quantitative researcher. Your role is to:
- Analyze market data with statistical rigor
- Backtest hypotheses against historical data
- Calculate expected values and risk metrics
- Propose quantitative trading strategies

Always cite numbers and confidence intervals. Be precise with statistical claims.`,
		temperature: 0.5,
	},
	{
		id: "sentiment",
		name: "Sentiment Scout",
		role: "researcher",
		expertise: ["social analysis", "news impact", "market psychology"],
		systemPrompt: `You are the Sentiment Scout, reading the market mood. Your role is to:
- Analyze social media and news sentiment
- Identify narrative shifts and momentum
- Gauge retail vs institutional sentiment
- Predict sentiment-driven price movements

Quantify sentiment where possible. Connect emotions to price action.`,
		temperature: 0.7,
	},
	{
		id: "whale_watcher",
		name: "Whale Watcher",
		role: "researcher",
		expertise: ["on-chain analysis", "wallet tracking", "smart money flows"],
		systemPrompt: `You are the Whale Watcher, tracking smart money. Your role is to:
- Monitor large wallet movements
- Identify accumulation and distribution patterns
- Track DEX liquidity changes
- Predict whale-driven price impacts

Focus on actionable on-chain signals. Distinguish noise from signal.`,
		temperature: 0.6,
	},
	{
		id: "risk_manager",
		name: "Risk Manager",
		role: "risk_assessor",
		expertise: ["position sizing", "drawdown control", "portfolio risk"],
		systemPrompt: `You are the Risk Manager, protecting the portfolio. Your role is to:
- Evaluate position sizing for each trade
- Set stop-loss and take-profit levels
- Monitor overall portfolio risk
- Prevent catastrophic losses

Never compromise on risk rules. Better to miss a trade than blow up.`,
		temperature: 0.4,
	},
	{
		id: "trade_critic",
		name: "Trade Critic",
		role: "critic",
		expertise: ["trade analysis", "confirmation bias detection", "market traps"],
		systemPrompt: `You are the Trade Critic, preventing bad trades. Your role is to:
- Challenge bullish/bearish bias
- Identify potential market traps
- Check for confirmation bias in analysis
- Propose counter-scenarios

Be the voice of caution. Ask "what if we're wrong?"`,
		temperature: 0.7,
	},
];

// ============================================================================
// DIALOGUE ENGINE
// ============================================================================

export class DialogueEngine extends EventEmitter {
	private config: DialogueConfig;

	constructor(config: DialogueConfig) {
		super();
		this.config = config;
	}

	/**
	 * Run a complete dialogue session
	 */
	async runDialogue(
		topic: string,
		context: string,
		agents: DialogueAgent[] = DEFAULT_DIALOGUE_AGENTS,
	): Promise<DialogueSession> {
		const sessionId = `dialogue_${randomUUID()}`;

		const session: DialogueSession = {
			id: sessionId,
			topic,
			context,
			agents,
			rounds: [],
			startTime: Date.now(),
			success: false,
		};

		this.emit("dialogueStarted", { sessionId, topic, agentCount: agents.length });

		try {
			for (let round = 1; round <= this.config.maxRounds; round++) {
				const roundResult = await this.runRound(session, round);
				session.rounds.push(roundResult);

				this.emit("roundCompleted", {
					sessionId,
					round,
					messageCount: roundResult.messages.length,
					consensusReached: roundResult.consensusReached,
				});

				if (roundResult.consensusReached) {
					session.finalConsensus = roundResult.consensusPoints?.join("\n");
					session.success = true;
					break;
				}
			}

			// Extract action items from final round
			if (session.rounds.length > 0) {
				const lastRound = session.rounds[session.rounds.length - 1];
				session.actionItems = await this.extractActionItems(session, lastRound);
			}

			session.endTime = Date.now();

			// If max rounds reached without consensus, try to synthesize anyway
			if (!session.success && session.rounds.length === this.config.maxRounds) {
				session.finalConsensus = await this.forceSynthesis(session);
				session.success = true; // Partial success
			}

			this.emit("dialogueCompleted", {
				sessionId,
				success: session.success,
				rounds: session.rounds.length,
				duration: session.endTime - session.startTime,
			});
		} catch (error) {
			session.endTime = Date.now();
			this.emit("dialogueError", { sessionId, error });
		}

		return session;
	}

	/**
	 * Run a single round of dialogue
	 */
	private async runRound(session: DialogueSession, roundNumber: number): Promise<DialogueRound> {
		const messages: DialogueMessage[] = [];
		const previousContext = this.buildPreviousContext(session);

		// Each agent speaks in turn
		for (const agent of session.agents) {
			const prompt = this.buildAgentPrompt(session, agent, previousContext, messages);

			try {
				const response = await this.config.executor(agent.systemPrompt, prompt);

				const message = this.parseAgentResponse(agent, response);
				messages.push(message);

				this.emit("agentSpoke", {
					sessionId: session.id,
					agentId: agent.id,
					round: roundNumber,
				});
			} catch (error) {
				// Continue with other agents if one fails
				this.emit("agentError", { sessionId: session.id, agentId: agent.id, error });
			}
		}

		// Check for consensus
		const consensusCheck = await this.checkConsensus(session, messages);

		return {
			roundNumber,
			messages,
			consensusReached: consensusCheck.reached,
			consensusPoints: consensusCheck.points,
			openQuestions: consensusCheck.openQuestions,
		};
	}

	/**
	 * Build context from previous rounds
	 */
	private buildPreviousContext(session: DialogueSession): string {
		if (session.rounds.length === 0) {
			return "";
		}

		const lines: string[] = ["## Previous Discussion"];

		for (const round of session.rounds) {
			lines.push(`\n### Round ${round.roundNumber}`);
			for (const msg of round.messages) {
				lines.push(`\n**${msg.agentName}** (${msg.role}):`);
				lines.push(msg.content);
			}
			if (round.openQuestions && round.openQuestions.length > 0) {
				lines.push("\n**Open Questions:**");
				for (const q of round.openQuestions) {
					lines.push(`- ${q}`);
				}
			}
		}

		return lines.join("\n");
	}

	/**
	 * Build prompt for an agent
	 */
	private buildAgentPrompt(
		session: DialogueSession,
		agent: DialogueAgent,
		previousContext: string,
		currentRoundMessages: DialogueMessage[],
	): string {
		const lines: string[] = [];

		lines.push(`# Dialogue Topic: ${session.topic}`);
		lines.push(`\n## Context\n${session.context}`);

		if (previousContext) {
			lines.push(`\n${previousContext}`);
		}

		if (currentRoundMessages.length > 0) {
			lines.push("\n## This Round So Far");
			for (const msg of currentRoundMessages) {
				lines.push(`\n**${msg.agentName}** (${msg.role}):`);
				lines.push(msg.content);
			}
		}

		lines.push(`\n## Your Turn`);
		lines.push(`As ${agent.name}, share your perspective on this topic.`);
		lines.push(`Consider what others have said and either build on, challenge, or synthesize their points.`);
		lines.push(`\nFormat your response as:`);
		lines.push(`1. Your main point or insight`);
		lines.push(`2. Evidence or reasoning`);
		lines.push(`3. Points you agree with (if any)`);
		lines.push(`4. Points you disagree with (if any)`);
		lines.push(`5. Questions for the group`);

		return lines.join("\n");
	}

	/**
	 * Parse agent response into structured message
	 */
	private parseAgentResponse(agent: DialogueAgent, response: string): DialogueMessage {
		// Extract agreements and disagreements if present
		const agreements: string[] = [];
		const disagreements: string[] = [];

		const agreeMatch = response.match(/agree(?:s?|ment)?\s*(?:with)?:?\s*([^\n]+)/gi);
		if (agreeMatch) {
			agreements.push(...agreeMatch.map((m) => m.replace(/agree(?:s?|ment)?\s*(?:with)?:?\s*/i, "").trim()));
		}

		const disagreeMatch = response.match(/disagree(?:s?|ment)?\s*(?:with)?:?\s*([^\n]+)/gi);
		if (disagreeMatch) {
			disagreements.push(
				...disagreeMatch.map((m) => m.replace(/disagree(?:s?|ment)?\s*(?:with)?:?\s*/i, "").trim()),
			);
		}

		return {
			agentId: agent.id,
			agentName: agent.name,
			role: agent.role,
			content: response,
			timestamp: Date.now(),
			agreements: agreements.length > 0 ? agreements : undefined,
			disagreements: disagreements.length > 0 ? disagreements : undefined,
		};
	}

	/**
	 * Check if consensus has been reached
	 */
	private async checkConsensus(
		_session: DialogueSession,
		messages: DialogueMessage[],
	): Promise<{ reached: boolean; points?: string[]; openQuestions?: string[] }> {
		// Find synthesizer's message
		const synthesizerMsg = messages.find((m) => m.role === "synthesizer");

		// Count agreements vs disagreements
		let totalAgreements = 0;
		let totalDisagreements = 0;

		for (const msg of messages) {
			totalAgreements += msg.agreements?.length || 0;
			totalDisagreements += msg.disagreements?.length || 0;
		}

		const agreementRatio =
			totalAgreements + totalDisagreements > 0 ? totalAgreements / (totalAgreements + totalDisagreements) : 0;

		// Use synthesizer to identify consensus points
		let consensusPoints: string[] = [];
		let openQuestions: string[] = [];

		if (synthesizerMsg) {
			// Extract consensus points from synthesizer's message
			const pointsMatch = synthesizerMsg.content.match(/consensus|agree(?:ment)?|common ground/gi);
			if (pointsMatch) {
				// Simple extraction - in production, use LLM to extract
				consensusPoints = [synthesizerMsg.content.split("\n")[0]];
			}

			// Extract questions
			const questionMatch = synthesizerMsg.content.match(/\?[^\n]*/g);
			if (questionMatch) {
				openQuestions = questionMatch.map((q) => q.trim());
			}
		}

		return {
			reached: agreementRatio >= this.config.consensusThreshold && totalDisagreements < 2,
			points: consensusPoints.length > 0 ? consensusPoints : undefined,
			openQuestions: openQuestions.length > 0 ? openQuestions : undefined,
		};
	}

	/**
	 * Extract action items from the dialogue
	 */
	private async extractActionItems(_session: DialogueSession, lastRound: DialogueRound): Promise<string[]> {
		const actionItems: string[] = [];

		// Find executor's message
		const executorMsg = lastRound.messages.find((m) => m.role === "executor");

		if (executorMsg) {
			// Extract action-oriented sentences
			const actionPatterns = [
				/should\s+([^.]+)/gi,
				/need to\s+([^.]+)/gi,
				/must\s+([^.]+)/gi,
				/will\s+([^.]+)/gi,
				/action:\s*([^.]+)/gi,
			];

			for (const pattern of actionPatterns) {
				const matches = executorMsg.content.matchAll(pattern);
				for (const match of matches) {
					actionItems.push(match[1].trim());
				}
			}
		}

		return actionItems.slice(0, 5); // Limit to top 5 action items
	}

	/**
	 * Force synthesis when max rounds reached without consensus
	 */
	private async forceSynthesis(session: DialogueSession): Promise<string> {
		const allMessages = session.rounds.flatMap((r) => r.messages);

		const prompt = `
You are synthesizing a dialogue that did not reach full consensus.
Summarize the key points that had most agreement, acknowledge remaining disagreements, and propose a pragmatic path forward.

Topic: ${session.topic}
Context: ${session.context}

Discussion points from all rounds:
${allMessages.map((m) => `${m.agentName}: ${m.content.slice(0, 200)}...`).join("\n\n")}

Provide a balanced synthesis that:
1. Acknowledges the strongest arguments from each side
2. Identifies the core tension or disagreement
3. Proposes a way forward despite the disagreement
`;

		try {
			return await this.config.executor("You are a neutral synthesizer creating a balanced summary.", prompt);
		} catch {
			return "Dialogue concluded without consensus. Review individual agent perspectives for details.";
		}
	}
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Run a quick trading dialogue
 */
export async function runTradingDialogue(
	topic: string,
	context: string,
	executor: (systemPrompt: string, userPrompt: string) => Promise<string>,
): Promise<DialogueSession> {
	const engine = new DialogueEngine({
		maxRounds: 3,
		consensusThreshold: 0.7,
		allowDissent: true,
		executor,
	});

	return engine.runDialogue(topic, context, TRADING_DIALOGUE_AGENTS);
}

/**
 * Run a quick general dialogue
 */
export async function runDialogue(
	topic: string,
	context: string,
	executor: (systemPrompt: string, userPrompt: string) => Promise<string>,
	options: Partial<DialogueConfig> = {},
): Promise<DialogueSession> {
	const engine = new DialogueEngine({
		maxRounds: 4,
		consensusThreshold: 0.6,
		allowDissent: true,
		executor,
		...options,
	});

	return engine.runDialogue(topic, context, DEFAULT_DIALOGUE_AGENTS);
}

/**
 * Create a custom dialogue with specific agents
 */
export function createDialogueEngine(config: DialogueConfig): DialogueEngine {
	return new DialogueEngine(config);
}

export { DialogueEngine as default };
