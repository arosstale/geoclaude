/**
 * AIRIS-Inspired Causal Reasoning Module
 *
 * Implements concepts from AIRIS (Autonomous Intelligent Reinforcement Inferred Symbolism)
 * by ASI Alliance (SingularityNET/Ben Goertzel, Fetch.ai, Ocean Protocol, CUDOS).
 *
 * Key Concepts:
 * - Causal Discovery: Infers cause-effect relationships, not just correlations
 * - State Graph: World model that tracks state transitions and their causes
 * - Prediction-Action-Observation Loop: Validates causal hypotheses through action
 * - Symbolic + Neural Hybrid: Combines symbolic reasoning with pattern recognition
 *
 * @see https://singularitynet.io/airis
 */

import crypto from "crypto";
import { EventEmitter } from "events";

// ============================================================================
// Types
// ============================================================================

/**
 * A state in the world model
 */
export interface WorldState {
	id: string;
	timestamp: number;
	observations: Map<string, unknown>;
	confidence: number;
	source: "observed" | "predicted" | "hypothetical";
}

/**
 * A causal relationship between states or events
 */
export interface CausalLink {
	id: string;
	cause: string; // State/Event ID
	effect: string; // State/Event ID
	action?: string; // Action that triggered the transition
	strength: number; // 0-1, how confident we are in this causal link
	observations: number; // How many times we've seen this pattern
	lastObserved: number;
	counterExamples: number; // Times the cause didn't lead to effect
}

/**
 * An action that can be taken
 */
export interface CausalAction {
	id: string;
	name: string;
	preconditions: Map<string, unknown>; // Required state conditions
	expectedEffects: Map<string, unknown>; // Predicted state changes
	successRate: number;
	executionCount: number;
}

/**
 * A prediction about future state
 */
export interface Prediction {
	id: string;
	currentStateId: string;
	actionId?: string;
	predictedStateId: string;
	confidence: number;
	timestamp: number;
	validated?: boolean;
	actualStateId?: string;
}

/**
 * A causal hypothesis to be tested
 */
export interface CausalHypothesis {
	id: string;
	description: string;
	ifCondition: Map<string, unknown>;
	thenCondition: Map<string, unknown>;
	givenAction?: string;
	confidence: number;
	testsRun: number;
	testsSucceeded: number;
	status: "untested" | "testing" | "supported" | "refuted" | "uncertain";
}

/**
 * Configuration for the causal engine
 */
export interface CausalEngineConfig {
	maxStates: number;
	maxLinks: number;
	minConfidenceThreshold: number;
	learningRate: number;
	decayRate: number;
	hypothesisTestThreshold: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CAUSAL_CONFIG: CausalEngineConfig = {
	maxStates: 10000,
	maxLinks: 50000,
	minConfidenceThreshold: 0.3,
	learningRate: 0.1,
	decayRate: 0.01,
	hypothesisTestThreshold: 5,
};

// ============================================================================
// State Graph - World Model
// ============================================================================

/**
 * State Graph maintains a world model of states and transitions
 */
export class StateGraph {
	private states: Map<string, WorldState> = new Map();
	private links: Map<string, CausalLink> = new Map();
	private stateIndex: Map<string, Set<string>> = new Map(); // observation hash -> state IDs

	constructor(private config: CausalEngineConfig = DEFAULT_CAUSAL_CONFIG) {}

	/**
	 * Create a hash of observations for indexing
	 */
	private hashObservations(observations: Map<string, unknown>): string {
		const sorted = Array.from(observations.entries()).sort((a, b) => a[0].localeCompare(b[0]));
		return crypto.createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 16);
	}

	/**
	 * Add or update a state
	 */
	addState(observations: Map<string, unknown>, source: WorldState["source"] = "observed"): WorldState {
		const hash = this.hashObservations(observations);

		// Check if similar state exists
		const existingIds = this.stateIndex.get(hash);
		if (existingIds) {
			for (const id of existingIds) {
				const existing = this.states.get(id);
				if (existing && this.statesMatch(existing.observations, observations)) {
					existing.timestamp = Date.now();
					existing.confidence = Math.min(1, existing.confidence + this.config.learningRate);
					return existing;
				}
			}
		}

		// Create new state
		const state: WorldState = {
			id: `state-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			timestamp: Date.now(),
			observations: new Map(observations),
			confidence: source === "observed" ? 0.8 : 0.5,
			source,
		};

		this.states.set(state.id, state);

		// Index
		if (!this.stateIndex.has(hash)) {
			this.stateIndex.set(hash, new Set());
		}
		this.stateIndex.get(hash)!.add(state.id);

		// Enforce max states
		if (this.states.size > this.config.maxStates) {
			this.pruneOldestStates();
		}

		return state;
	}

	/**
	 * Check if two observation sets match
	 */
	private statesMatch(a: Map<string, unknown>, b: Map<string, unknown>): boolean {
		if (a.size !== b.size) return false;
		for (const [key, value] of a) {
			if (!b.has(key) || JSON.stringify(b.get(key)) !== JSON.stringify(value)) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Add a causal link between states
	 */
	addLink(causeId: string, effectId: string, action?: string): CausalLink {
		const linkKey = `${causeId}->${effectId}${action ? `[${action}]` : ""}`;

		const existing = this.links.get(linkKey);
		if (existing) {
			existing.observations++;
			existing.strength = Math.min(1, existing.strength + this.config.learningRate);
			existing.lastObserved = Date.now();
			return existing;
		}

		const link: CausalLink = {
			id: linkKey,
			cause: causeId,
			effect: effectId,
			action,
			strength: 0.5,
			observations: 1,
			lastObserved: Date.now(),
			counterExamples: 0,
		};

		this.links.set(linkKey, link);

		// Enforce max links
		if (this.links.size > this.config.maxLinks) {
			this.pruneWeakLinks();
		}

		return link;
	}

	/**
	 * Record a counter-example (cause didn't lead to expected effect)
	 */
	recordCounterExample(causeId: string, effectId: string, action?: string): void {
		const linkKey = `${causeId}->${effectId}${action ? `[${action}]` : ""}`;
		const link = this.links.get(linkKey);
		if (link) {
			link.counterExamples++;
			link.strength = Math.max(0, link.strength - this.config.learningRate * 2);

			// Remove if too weak
			if (link.strength < this.config.minConfidenceThreshold) {
				this.links.delete(linkKey);
			}
		}
	}

	/**
	 * Get all effects of a given state
	 */
	getEffects(stateId: string, action?: string): CausalLink[] {
		const results: CausalLink[] = [];
		for (const link of this.links.values()) {
			if (link.cause === stateId) {
				if (!action || link.action === action) {
					results.push(link);
				}
			}
		}
		return results.sort((a, b) => b.strength - a.strength);
	}

	/**
	 * Get all causes of a given state
	 */
	getCauses(stateId: string): CausalLink[] {
		const results: CausalLink[] = [];
		for (const link of this.links.values()) {
			if (link.effect === stateId) {
				results.push(link);
			}
		}
		return results.sort((a, b) => b.strength - a.strength);
	}

	/**
	 * Find similar states
	 */
	findSimilarStates(observations: Map<string, unknown>, threshold = 0.7): WorldState[] {
		const results: Array<{ state: WorldState; similarity: number }> = [];

		for (const state of this.states.values()) {
			const similarity = this.calculateSimilarity(observations, state.observations);
			if (similarity >= threshold) {
				results.push({ state, similarity });
			}
		}

		return results.sort((a, b) => b.similarity - a.similarity).map((r) => r.state);
	}

	/**
	 * Calculate similarity between two observation sets
	 */
	private calculateSimilarity(a: Map<string, unknown>, b: Map<string, unknown>): number {
		const allKeys = new Set([...a.keys(), ...b.keys()]);
		let matches = 0;

		for (const key of allKeys) {
			if (a.has(key) && b.has(key)) {
				if (JSON.stringify(a.get(key)) === JSON.stringify(b.get(key))) {
					matches++;
				}
			}
		}

		return matches / allKeys.size;
	}

	/**
	 * Prune oldest states when over capacity
	 */
	private pruneOldestStates(): void {
		const sorted = Array.from(this.states.values()).sort((a, b) => a.timestamp - b.timestamp);
		const toRemove = sorted.slice(0, Math.floor(this.config.maxStates * 0.1));

		for (const state of toRemove) {
			this.states.delete(state.id);
			// Also remove associated links
			for (const [key, link] of this.links) {
				if (link.cause === state.id || link.effect === state.id) {
					this.links.delete(key);
				}
			}
		}
	}

	/**
	 * Prune weak links when over capacity
	 */
	private pruneWeakLinks(): void {
		const sorted = Array.from(this.links.values()).sort((a, b) => a.strength - b.strength);
		const toRemove = sorted.slice(0, Math.floor(this.config.maxLinks * 0.1));

		for (const link of toRemove) {
			this.links.delete(link.id);
		}
	}

	/**
	 * Get state by ID
	 */
	getState(id: string): WorldState | undefined {
		return this.states.get(id);
	}

	/**
	 * Get statistics
	 */
	getStats(): { states: number; links: number; avgLinkStrength: number } {
		let totalStrength = 0;
		for (const link of this.links.values()) {
			totalStrength += link.strength;
		}

		return {
			states: this.states.size,
			links: this.links.size,
			avgLinkStrength: this.links.size > 0 ? totalStrength / this.links.size : 0,
		};
	}
}

// ============================================================================
// Causal Reasoning Engine
// ============================================================================

/**
 * AIRIS-inspired Causal Reasoning Engine
 *
 * Implements the Prediction → Action → Observation loop:
 * 1. Observe current state
 * 2. Make predictions about effects of actions
 * 3. Execute action
 * 4. Observe result
 * 5. Update causal model based on prediction accuracy
 */
export class CausalReasoningEngine extends EventEmitter {
	protected stateGraph: StateGraph;
	private actions: Map<string, CausalAction> = new Map();
	private hypotheses: Map<string, CausalHypothesis> = new Map();
	private predictions: Map<string, Prediction> = new Map();
	private currentState: WorldState | null = null;

	constructor(private config: CausalEngineConfig = DEFAULT_CAUSAL_CONFIG) {
		super();
		this.stateGraph = new StateGraph(config);
	}

	// ========== State Management ==========

	/**
	 * Observe and record current state
	 */
	observe(observations: Map<string, unknown>): WorldState {
		const previousState = this.currentState;
		this.currentState = this.stateGraph.addState(observations, "observed");

		// If we had a previous state, create a link
		if (previousState) {
			this.stateGraph.addLink(previousState.id, this.currentState.id);
		}

		// Validate any pending predictions
		this.validatePredictions(this.currentState);

		this.emit("observation", this.currentState);
		return this.currentState;
	}

	/**
	 * Record an action and its observed effect
	 */
	recordAction(actionName: string, resultObservations: Map<string, unknown>): void {
		const beforeState = this.currentState;
		const afterState = this.stateGraph.addState(resultObservations, "observed");

		if (beforeState) {
			this.stateGraph.addLink(beforeState.id, afterState.id, actionName);
		}

		// Update action statistics
		this.updateActionStats(actionName, beforeState, afterState);

		this.currentState = afterState;
		this.emit("action", { actionName, beforeState, afterState });
	}

	// ========== Prediction ==========

	/**
	 * Predict the effect of an action from current state
	 */
	predict(actionName?: string): Prediction | null {
		if (!this.currentState) return null;

		const effects = this.stateGraph.getEffects(this.currentState.id, actionName);
		if (effects.length === 0) {
			// Try to find similar states
			const similar = this.stateGraph.findSimilarStates(this.currentState.observations);
			for (const simState of similar) {
				const simEffects = this.stateGraph.getEffects(simState.id, actionName);
				if (simEffects.length > 0) {
					const bestEffect = simEffects[0];
					const prediction: Prediction = {
						id: `pred-${Date.now()}`,
						currentStateId: this.currentState.id,
						actionId: actionName,
						predictedStateId: bestEffect.effect,
						confidence: bestEffect.strength * 0.8, // Reduce confidence for similar-state prediction
						timestamp: Date.now(),
					};
					this.predictions.set(prediction.id, prediction);
					this.emit("prediction", prediction);
					return prediction;
				}
			}
			return null;
		}

		// Use highest-strength link
		const bestEffect = effects[0];
		const prediction: Prediction = {
			id: `pred-${Date.now()}`,
			currentStateId: this.currentState.id,
			actionId: actionName,
			predictedStateId: bestEffect.effect,
			confidence: bestEffect.strength,
			timestamp: Date.now(),
		};

		this.predictions.set(prediction.id, prediction);
		this.emit("prediction", prediction);
		return prediction;
	}

	/**
	 * Validate predictions against actual observed state
	 */
	private validatePredictions(actualState: WorldState): void {
		const now = Date.now();

		for (const [id, prediction] of this.predictions) {
			// Only validate recent predictions
			if (now - prediction.timestamp > 60000) {
				this.predictions.delete(id);
				continue;
			}

			if (prediction.validated) continue;

			const predictedState = this.stateGraph.getState(prediction.predictedStateId);
			if (!predictedState) continue;

			// Check if prediction was correct
			const similarity = this.calculateStateSimilarity(predictedState.observations, actualState.observations);
			prediction.validated = true;
			prediction.actualStateId = actualState.id;

			if (similarity >= 0.8) {
				// Prediction was correct - strengthen the link
				const link = Array.from(this.stateGraph.getEffects(prediction.currentStateId, prediction.actionId)).find(
					(l) => l.effect === prediction.predictedStateId,
				);
				if (link) {
					link.strength = Math.min(1, link.strength + this.config.learningRate);
				}
				this.emit("prediction:validated", { prediction, correct: true, similarity });
			} else {
				// Prediction was wrong - weaken the link and record counter-example
				this.stateGraph.recordCounterExample(
					prediction.currentStateId,
					prediction.predictedStateId,
					prediction.actionId,
				);

				// Add correct link
				this.stateGraph.addLink(prediction.currentStateId, actualState.id, prediction.actionId);

				this.emit("prediction:validated", { prediction, correct: false, similarity });
			}
		}
	}

	private calculateStateSimilarity(a: Map<string, unknown>, b: Map<string, unknown>): number {
		const allKeys = new Set([...a.keys(), ...b.keys()]);
		let matches = 0;

		for (const key of allKeys) {
			if (a.has(key) && b.has(key)) {
				if (JSON.stringify(a.get(key)) === JSON.stringify(b.get(key))) {
					matches++;
				}
			}
		}

		return allKeys.size > 0 ? matches / allKeys.size : 0;
	}

	// ========== Causal Discovery ==========

	/**
	 * Generate a causal hypothesis
	 */
	generateHypothesis(
		description: string,
		ifCondition: Map<string, unknown>,
		thenCondition: Map<string, unknown>,
		givenAction?: string,
	): CausalHypothesis {
		const hypothesis: CausalHypothesis = {
			id: `hyp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			description,
			ifCondition,
			thenCondition,
			givenAction,
			confidence: 0.5,
			testsRun: 0,
			testsSucceeded: 0,
			status: "untested",
		};

		this.hypotheses.set(hypothesis.id, hypothesis);
		this.emit("hypothesis:created", hypothesis);
		return hypothesis;
	}

	/**
	 * Test a hypothesis against current observations
	 */
	testHypothesis(hypothesisId: string, observations: Map<string, unknown>, actionTaken?: string): boolean {
		const hypothesis = this.hypotheses.get(hypothesisId);
		if (!hypothesis) return false;

		// Check if IF condition is met
		let ifMet = true;
		for (const [key, value] of hypothesis.ifCondition) {
			if (!observations.has(key) || JSON.stringify(observations.get(key)) !== JSON.stringify(value)) {
				ifMet = false;
				break;
			}
		}

		// If action is specified, check if it matches
		if (hypothesis.givenAction && actionTaken !== hypothesis.givenAction) {
			return false; // Not applicable
		}

		if (!ifMet) return false; // IF condition not met, test not applicable

		hypothesis.status = "testing";
		hypothesis.testsRun++;

		// Check if THEN condition is met
		let thenMet = true;
		for (const [key, value] of hypothesis.thenCondition) {
			if (!observations.has(key) || JSON.stringify(observations.get(key)) !== JSON.stringify(value)) {
				thenMet = false;
				break;
			}
		}

		if (thenMet) {
			hypothesis.testsSucceeded++;
		}

		// Update confidence
		hypothesis.confidence = hypothesis.testsRun > 0 ? hypothesis.testsSucceeded / hypothesis.testsRun : 0.5;

		// Update status based on tests
		if (hypothesis.testsRun >= this.config.hypothesisTestThreshold) {
			if (hypothesis.confidence >= 0.8) {
				hypothesis.status = "supported";
			} else if (hypothesis.confidence <= 0.2) {
				hypothesis.status = "refuted";
			} else {
				hypothesis.status = "uncertain";
			}
		}

		this.emit("hypothesis:tested", { hypothesis, result: thenMet });
		return thenMet;
	}

	/**
	 * Find causal chains between two states
	 */
	findCausalChain(fromStateId: string, toStateId: string, maxDepth = 5): CausalLink[][] {
		const chains: CausalLink[][] = [];
		const visited = new Set<string>();

		const dfs = (currentId: string, chain: CausalLink[], depth: number): void => {
			if (depth > maxDepth) return;
			if (currentId === toStateId) {
				chains.push([...chain]);
				return;
			}
			if (visited.has(currentId)) return;

			visited.add(currentId);

			for (const link of this.stateGraph.getEffects(currentId)) {
				chain.push(link);
				dfs(link.effect, chain, depth + 1);
				chain.pop();
			}

			visited.delete(currentId);
		};

		dfs(fromStateId, [], 0);
		return chains.sort((a, b) => {
			// Sort by total chain strength
			const strengthA = a.reduce((sum, l) => sum * l.strength, 1);
			const strengthB = b.reduce((sum, l) => sum * l.strength, 1);
			return strengthB - strengthA;
		});
	}

	/**
	 * Infer potential causes for an observed effect
	 */
	inferCauses(effectObservations: Map<string, unknown>): Array<{ cause: WorldState; link: CausalLink }> {
		const results: Array<{ cause: WorldState; link: CausalLink }> = [];

		// Find similar states
		const similarStates = this.stateGraph.findSimilarStates(effectObservations, 0.6);

		for (const state of similarStates) {
			const causes = this.stateGraph.getCauses(state.id);
			for (const link of causes) {
				const causeState = this.stateGraph.getState(link.cause);
				if (causeState) {
					results.push({ cause: causeState, link });
				}
			}
		}

		return results.sort((a, b) => b.link.strength - a.link.strength);
	}

	// ========== Action Management ==========

	/**
	 * Register an action
	 */
	registerAction(
		name: string,
		preconditions: Map<string, unknown>,
		expectedEffects: Map<string, unknown>,
	): CausalAction {
		const action: CausalAction = {
			id: `action-${name}`,
			name,
			preconditions,
			expectedEffects,
			successRate: 0.5,
			executionCount: 0,
		};

		this.actions.set(name, action);
		return action;
	}

	/**
	 * Get recommended actions for achieving a goal state
	 */
	recommendActions(goalObservations: Map<string, unknown>): CausalAction[] {
		const recommendations: Array<{ action: CausalAction; score: number }> = [];

		for (const action of this.actions.values()) {
			// Check how many goal observations this action's expected effects satisfy
			let matchScore = 0;
			for (const [key, value] of goalObservations) {
				if (
					action.expectedEffects.has(key) &&
					JSON.stringify(action.expectedEffects.get(key)) === JSON.stringify(value)
				) {
					matchScore++;
				}
			}

			if (matchScore > 0) {
				recommendations.push({
					action,
					score: (matchScore / goalObservations.size) * action.successRate,
				});
			}
		}

		return recommendations.sort((a, b) => b.score - a.score).map((r) => r.action);
	}

	private updateActionStats(actionName: string, _beforeState: WorldState | null, afterState: WorldState): void {
		const action = this.actions.get(actionName);
		if (!action) return;

		action.executionCount++;

		// Check if expected effects were achieved
		let effectsAchieved = 0;
		for (const [key, value] of action.expectedEffects) {
			if (
				afterState.observations.has(key) &&
				JSON.stringify(afterState.observations.get(key)) === JSON.stringify(value)
			) {
				effectsAchieved++;
			}
		}

		const successRate = action.expectedEffects.size > 0 ? effectsAchieved / action.expectedEffects.size : 0;

		// Update rolling average
		action.successRate = action.successRate * (1 - this.config.learningRate) + successRate * this.config.learningRate;
	}

	// ========== Query Methods ==========

	/**
	 * Get current state
	 */
	getCurrentState(): WorldState | null {
		return this.currentState;
	}

	/**
	 * Get all hypotheses
	 */
	getHypotheses(): CausalHypothesis[] {
		return Array.from(this.hypotheses.values());
	}

	/**
	 * Get hypothesis by status
	 */
	getHypothesesByStatus(status: CausalHypothesis["status"]): CausalHypothesis[] {
		return Array.from(this.hypotheses.values()).filter((h) => h.status === status);
	}

	/**
	 * Get engine statistics
	 */
	getStats(): {
		graphStats: ReturnType<StateGraph["getStats"]>;
		actions: number;
		hypotheses: { total: number; supported: number; refuted: number; uncertain: number };
		predictions: number;
	} {
		const hypothesesByStatus = {
			supported: 0,
			refuted: 0,
			uncertain: 0,
		};

		for (const h of this.hypotheses.values()) {
			if (h.status === "supported") hypothesesByStatus.supported++;
			else if (h.status === "refuted") hypothesesByStatus.refuted++;
			else if (h.status === "uncertain") hypothesesByStatus.uncertain++;
		}

		return {
			graphStats: this.stateGraph.getStats(),
			actions: this.actions.size,
			hypotheses: {
				total: this.hypotheses.size,
				...hypothesesByStatus,
			},
			predictions: this.predictions.size,
		};
	}

	/**
	 * Export model for persistence
	 */
	exportModel(): string {
		return JSON.stringify(
			{
				config: this.config,
				stats: this.getStats(),
				hypotheses: Array.from(this.hypotheses.values()),
				actions: Array.from(this.actions.values()),
			},
			null,
			2,
		);
	}
}

// ============================================================================
// Global Instance
// ============================================================================

let globalEngine: CausalReasoningEngine | null = null;

/**
 * Get or create the global causal reasoning engine
 */
export function getCausalEngine(config?: CausalEngineConfig): CausalReasoningEngine {
	if (!globalEngine) {
		globalEngine = new CausalReasoningEngine(config);
	}
	return globalEngine;
}

/**
 * Reset the global engine
 */
export function resetCausalEngine(): void {
	globalEngine = null;
}

// ============================================================================
// Trading-Specific Extensions
// ============================================================================

/**
 * Trading-specific causal reasoning for market analysis
 */
export class TradingCausalEngine extends CausalReasoningEngine {
	/**
	 * Observe market state
	 */
	observeMarket(data: {
		symbol: string;
		price: number;
		volume: number;
		rsi?: number;
		macd?: number;
		sentiment?: number;
		timestamp?: number;
	}): WorldState {
		const observations = new Map<string, unknown>([
			["symbol", data.symbol],
			["price", data.price],
			["volume", data.volume],
			["priceDirection", data.price > 0 ? "up" : "down"],
			["volumeLevel", data.volume > 1000000 ? "high" : data.volume > 100000 ? "medium" : "low"],
		]);

		if (data.rsi !== undefined) {
			observations.set("rsi", data.rsi);
			observations.set("rsiZone", data.rsi > 70 ? "overbought" : data.rsi < 30 ? "oversold" : "neutral");
		}

		if (data.macd !== undefined) {
			observations.set("macd", data.macd);
			observations.set("macdSignal", data.macd > 0 ? "bullish" : "bearish");
		}

		if (data.sentiment !== undefined) {
			observations.set("sentiment", data.sentiment);
			observations.set(
				"sentimentZone",
				data.sentiment > 0.6 ? "bullish" : data.sentiment < 0.4 ? "bearish" : "neutral",
			);
		}

		return this.observe(observations);
	}

	/**
	 * Record a trade action
	 */
	recordTrade(action: "buy" | "sell" | "hold", resultData: { pnl: number; priceChange: number }): void {
		const observations = new Map<string, unknown>([
			["action", action],
			["pnl", resultData.pnl],
			["pnlDirection", resultData.pnl > 0 ? "profit" : resultData.pnl < 0 ? "loss" : "breakeven"],
			["priceChange", resultData.priceChange],
			["priceChangeDirection", resultData.priceChange > 0 ? "up" : "down"],
		]);

		this.recordAction(action, observations);
	}

	/**
	 * Generate trading hypothesis
	 */
	generateTradingHypothesis(
		name: string,
		condition: { rsiZone?: string; sentimentZone?: string; volumeLevel?: string },
		expectedOutcome: { pnlDirection: string },
		action: "buy" | "sell" | "hold",
	): CausalHypothesis {
		const ifCondition = new Map<string, unknown>();
		if (condition.rsiZone) ifCondition.set("rsiZone", condition.rsiZone);
		if (condition.sentimentZone) ifCondition.set("sentimentZone", condition.sentimentZone);
		if (condition.volumeLevel) ifCondition.set("volumeLevel", condition.volumeLevel);

		const thenCondition = new Map<string, unknown>([["pnlDirection", expectedOutcome.pnlDirection]]);

		return this.generateHypothesis(name, ifCondition, thenCondition, action);
	}

	/**
	 * Get trading recommendations based on causal analysis
	 */
	getTradingRecommendation(): { action: "buy" | "sell" | "hold"; confidence: number; reasoning: string } {
		const current = this.getCurrentState();
		if (!current) {
			return { action: "hold", confidence: 0, reasoning: "No market data observed yet" };
		}

		// Predict outcomes for each action
		const predictions: Array<{ action: "buy" | "sell" | "hold"; prediction: Prediction | null }> = [
			{ action: "buy", prediction: this.predict("buy") },
			{ action: "sell", prediction: this.predict("sell") },
			{ action: "hold", prediction: this.predict("hold") },
		];

		// Find best action based on predicted profit
		let bestAction: "buy" | "sell" | "hold" = "hold";
		let bestConfidence = 0;
		let reasoning = "Insufficient data for recommendation";

		for (const { action, prediction } of predictions) {
			if (prediction && prediction.confidence > bestConfidence) {
				const predictedState = this.stateGraph.getState(prediction.predictedStateId);
				if (predictedState && predictedState.observations.get("pnlDirection") === "profit") {
					bestAction = action;
					bestConfidence = prediction.confidence;
					reasoning = `Based on ${predictedState.observations.size} state observations with ${(prediction.confidence * 100).toFixed(1)}% confidence`;
				}
			}
		}

		return { action: bestAction, confidence: bestConfidence, reasoning };
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

let tradingEngine: TradingCausalEngine | null = null;

/**
 * Get trading-specific causal engine
 */
export function getTradingCausalEngine(): TradingCausalEngine {
	if (!tradingEngine) {
		tradingEngine = new TradingCausalEngine();
	}
	return tradingEngine;
}

/**
 * Create MCP tools for causal reasoning
 */
export function createCausalTools(): Array<{
	name: string;
	description: string;
	execute: (params: Record<string, unknown>) => Promise<string>;
}> {
	return [
		{
			name: "causal_observe",
			description: "Record an observation in the causal world model",
			execute: async (params) => {
				const engine = getCausalEngine();
				const observations = new Map(Object.entries(params.observations as Record<string, unknown>));
				const state = engine.observe(observations);
				return JSON.stringify({ stateId: state.id, confidence: state.confidence });
			},
		},
		{
			name: "causal_predict",
			description: "Predict the effect of an action",
			execute: async (params) => {
				const engine = getCausalEngine();
				const prediction = engine.predict(params.action as string | undefined);
				return prediction ? JSON.stringify(prediction) : "No prediction available";
			},
		},
		{
			name: "causal_hypothesis",
			description: "Create and test a causal hypothesis",
			execute: async (params) => {
				const engine = getCausalEngine();
				const hypothesis = engine.generateHypothesis(
					params.description as string,
					new Map(Object.entries(params.ifCondition as Record<string, unknown>)),
					new Map(Object.entries(params.thenCondition as Record<string, unknown>)),
					params.action as string | undefined,
				);
				return JSON.stringify(hypothesis);
			},
		},
		{
			name: "causal_infer_causes",
			description: "Infer potential causes for an observed effect",
			execute: async (params) => {
				const engine = getCausalEngine();
				const observations = new Map(Object.entries(params.observations as Record<string, unknown>));
				const causes = engine.inferCauses(observations);
				return JSON.stringify(
					causes.slice(0, 10).map((c) => ({
						causeId: c.cause.id,
						linkStrength: c.link.strength,
						action: c.link.action,
					})),
				);
			},
		},
		{
			name: "causal_stats",
			description: "Get causal engine statistics",
			execute: async () => {
				const engine = getCausalEngine();
				return JSON.stringify(engine.getStats(), null, 2);
			},
		},
	];
}
