/**
 * Vedic Quantum System v1.0
 *
 * Integration of ancient wisdom with modern AI:
 * - b5(9³) Algorithm: Vedic 5-element grid pattern detection
 * - n4(8³) Algorithm: Ifá quantum trading system
 * - Vedic Threefold: Agent output evaluation metric
 *
 * Based on Indra.ai principles by Quinn Michaels
 * Implemented for ARC-AGI and trading applications
 */

// =============================================================================
// PART 1: b5(9³) ALGORITHM - VEDIC PATTERN DETECTOR FOR ARC-AGI
// =============================================================================

/**
 * The Vedic 5-element system:
 * 1 = Ether (Space)
 * 3 = Air
 * 5 = Fire
 * 7 = Water
 * 9 = Earth
 */
export const VEDIC_ELEMENTS = {
	1: "Ether",
	3: "Air",
	5: "Fire",
	7: "Water",
	9: "Earth",
} as const;

/**
 * Base b5(9³) grid - cyclic permutation of odd numbers
 * Each row is a shifted version of {1, 3, 5, 7, 9}
 * Properties:
 * - Row sum = 25
 * - Total sum = 125 = 5³
 * - Rotational symmetry
 * - 45° rotation reveals 6-pointed star (3s and 9s)
 */
export const B5_GRID: number[][] = [
	[1, 3, 5, 7, 9],
	[9, 1, 3, 5, 7],
	[7, 9, 1, 3, 5],
	[5, 7, 9, 1, 3],
	[3, 5, 7, 9, 1],
];

/**
 * n4(8³) grid - Ifá quantum system using even numbers
 * Binary-friendly (all divisible by 2)
 * Used for quantum-inspired trading signals
 */
export const N4_GRID: number[][] = [
	[0, 2, 4, 6, 8],
	[8, 0, 2, 4, 6],
	[6, 8, 0, 2, 4],
	[4, 6, 8, 0, 2],
	[2, 4, 6, 8, 0],
];

/**
 * Pattern types detectable by b5 algorithm
 */
export type PatternType =
	| "cyclic_rotation" // Row/column shifts
	| "diagonal_symmetry" // Main/anti-diagonal symmetry
	| "elemental_balance" // 5-element distribution
	| "star_pattern" // 6-pointed star (hexagram)
	| "tiling" // Repeating subgrid
	| "modular_arithmetic" // Modulo-based transformation
	| "unknown";

export interface B5PatternAnalysis {
	patternType: PatternType;
	confidence: number;
	cyclicShift: number | null;
	elementalDistribution: Record<string, number>;
	symmetryScore: number;
	transformationRule: string;
	vedicInterpretation: string;
}

/**
 * Detect cyclic rotation patterns in a grid
 * Similar to how b5 grid rows are shifted versions of each other
 */
export function detectCyclicPattern(grid: number[][]): {
	isCyclic: boolean;
	shift: number;
	confidence: number;
} {
	if (grid.length === 0 || grid[0].length === 0) {
		return { isCyclic: false, shift: 0, confidence: 0 };
	}

	const rows = grid.length;
	const cols = grid[0].length;
	let bestShift = 0;
	let bestScore = 0;

	// Check if each row is a shifted version of the first row
	for (let shift = 0; shift < cols; shift++) {
		let matchScore = 0;
		for (let r = 1; r < rows; r++) {
			const expectedShift = (shift * r) % cols;
			let rowMatches = 0;
			for (let c = 0; c < cols; c++) {
				const shiftedCol = (c + expectedShift) % cols;
				if (grid[r][c] === grid[0][shiftedCol]) {
					rowMatches++;
				}
			}
			matchScore += rowMatches / cols;
		}
		matchScore /= rows - 1;
		if (matchScore > bestScore) {
			bestScore = matchScore;
			bestShift = shift;
		}
	}

	return {
		isCyclic: bestScore > 0.8,
		shift: bestShift,
		confidence: bestScore,
	};
}

/**
 * Detect diagonal symmetry (like the 6-pointed star in b5)
 */
export function detectDiagonalSymmetry(grid: number[][]): {
	hasMainDiagonal: boolean;
	hasAntiDiagonal: boolean;
	symmetryScore: number;
} {
	const rows = grid.length;
	const cols = grid[0]?.length || 0;
	if (rows !== cols || rows === 0) {
		return { hasMainDiagonal: false, hasAntiDiagonal: false, symmetryScore: 0 };
	}

	let mainDiagMatches = 0;
	let antiDiagMatches = 0;
	let total = 0;

	for (let i = 0; i < rows; i++) {
		for (let j = 0; j < cols; j++) {
			if (i !== j) {
				// Main diagonal symmetry: grid[i][j] === grid[j][i]
				if (grid[i][j] === grid[j][i]) mainDiagMatches++;
				// Anti-diagonal: grid[i][j] === grid[rows-1-j][cols-1-i]
				if (grid[i][j] === grid[rows - 1 - j][cols - 1 - i]) antiDiagMatches++;
				total++;
			}
		}
	}

	const mainScore = total > 0 ? mainDiagMatches / total : 0;
	const antiScore = total > 0 ? antiDiagMatches / total : 0;

	return {
		hasMainDiagonal: mainScore > 0.8,
		hasAntiDiagonal: antiScore > 0.8,
		symmetryScore: Math.max(mainScore, antiScore),
	};
}

/**
 * Calculate elemental distribution (mapping values to 5 elements)
 */
export function calculateElementalDistribution(grid: number[][]): Record<string, number> {
	const distribution: Record<string, number> = {
		Ether: 0, // Maps to values mod 5 === 1
		Air: 0, // Maps to values mod 5 === 3
		Fire: 0, // Maps to values mod 5 === 0 (representing 5)
		Water: 0, // Maps to values mod 5 === 2 (representing 7 mod 5)
		Earth: 0, // Maps to values mod 5 === 4 (representing 9 mod 5)
	};

	let total = 0;
	for (const row of grid) {
		for (const val of row) {
			const mod = ((val % 5) + 5) % 5; // Handle negative numbers
			switch (mod) {
				case 1:
					distribution.Ether++;
					break;
				case 3:
					distribution.Air++;
					break;
				case 0:
					distribution.Fire++;
					break;
				case 2:
					distribution.Water++;
					break;
				case 4:
					distribution.Earth++;
					break;
			}
			total++;
		}
	}

	// Normalize to percentages
	if (total > 0) {
		for (const key of Object.keys(distribution)) {
			distribution[key] = distribution[key] / total;
		}
	}

	return distribution;
}

/**
 * Main b5 pattern analyzer for ARC-AGI grids
 */
export function analyzeB5Pattern(inputGrid: number[][], outputGrid: number[][]): B5PatternAnalysis {
	const cyclic = detectCyclicPattern(inputGrid);
	const symmetry = detectDiagonalSymmetry(inputGrid);
	const inputElements = calculateElementalDistribution(inputGrid);
	const outputElements = calculateElementalDistribution(outputGrid);

	// Determine pattern type based on analysis
	let patternType: PatternType = "unknown";
	let confidence = 0;
	let transformationRule = "";
	let vedicInterpretation = "";

	if (cyclic.isCyclic && cyclic.confidence > 0.8) {
		patternType = "cyclic_rotation";
		confidence = cyclic.confidence;
		transformationRule = `Cyclic shift by ${cyclic.shift} positions`;
		vedicInterpretation = "The pattern follows the eternal cycle of the 5 elements, each transforming into the next";
	} else if (symmetry.symmetryScore > 0.8) {
		patternType = "diagonal_symmetry";
		confidence = symmetry.symmetryScore;
		transformationRule = symmetry.hasMainDiagonal ? "Reflect across main diagonal" : "Reflect across anti-diagonal";
		vedicInterpretation =
			"The 6-pointed star emerges - balance between ascending (3/Air) and descending (9/Earth) forces";
	} else {
		// Check for modular arithmetic pattern
		const rows = inputGrid.length;
		const cols = inputGrid[0]?.length || 0;
		let modularMatches = 0;
		let total = 0;

		for (let i = 0; i < Math.min(rows, outputGrid.length); i++) {
			for (let j = 0; j < Math.min(cols, outputGrid[i]?.length || 0); j++) {
				// Check if output = (input + something) mod N
				const diff = outputGrid[i][j] - inputGrid[i][j];
				if (diff >= 0) modularMatches++;
				total++;
			}
		}

		if (total > 0 && modularMatches / total > 0.7) {
			patternType = "modular_arithmetic";
			confidence = modularMatches / total;
			transformationRule = "Modular transformation detected";
			vedicInterpretation = "The transformation follows the cosmic law of cycles - what goes around comes around";
		}
	}

	// Calculate elemental balance between input and output
	let _elementalShift = 0;
	for (const element of Object.keys(inputElements)) {
		_elementalShift += Math.abs(inputElements[element] - (outputElements[element] || 0));
	}

	return {
		patternType,
		confidence,
		cyclicShift: cyclic.shift,
		elementalDistribution: inputElements,
		symmetryScore: symmetry.symmetryScore,
		transformationRule,
		vedicInterpretation,
	};
}

// =============================================================================
// PART 2: n4(8³) ALGORITHM - IFÁ QUANTUM TRADING SYSTEM
// =============================================================================

/**
 * The 16 Major Odus of Ifá
 * Each has specific meanings and trading implications
 */
export const IFA_ODUS: Record<number, { name: string; meaning: string; action: string }> = {
	1: { name: "Ogbe", meaning: "Light, clarity", action: "buy" },
	2: { name: "Oyeku", meaning: "Darkness, completion", action: "sell" },
	3: { name: "Iwori", meaning: "Inner vision", action: "hold" },
	4: { name: "Odi", meaning: "Rebirth", action: "accumulate" },
	5: { name: "Irosun", meaning: "Path finding", action: "research" },
	6: { name: "Owonrin", meaning: "Unexpected change", action: "hedge" },
	7: { name: "Obara", meaning: "Strength", action: "increase_position" },
	8: { name: "Okanran", meaning: "Controversy", action: "reduce_position" },
	9: { name: "Ogunda", meaning: "Clearing obstacles", action: "breakout_long" },
	10: { name: "Osa", meaning: "Running water", action: "trend_follow" },
	11: { name: "Ika", meaning: "Power", action: "aggressive_buy" },
	12: { name: "Oturupon", meaning: "Earth's womb", action: "wait" },
	13: { name: "Otura", meaning: "Divine word", action: "dca" },
	14: { name: "Irete", meaning: "Press forward", action: "momentum" },
	15: { name: "Ose", meaning: "Victory", action: "take_profit" },
	16: { name: "Ofun", meaning: "Pure white", action: "close_all" },
};

export interface IfaSignal {
	timestamp: number;
	binaryValue: number; // 8-bit value (0-255)
	majorOdu: number; // 1-16
	minorOdu: number; // 1-16
	oduName: string;
	action: string;
	confidence: number;
	quantumState: "superposition" | "collapsed";
}

/**
 * Generate an 8-bit "throw" simulating the Opele divining chain
 * Each bit represents a cowrie shell (open=1, closed=0)
 */
export function throwOpele(): number {
	// Cryptographically secure random for trading
	const array = new Uint8Array(1);
	if (typeof crypto !== "undefined" && crypto.getRandomValues) {
		crypto.getRandomValues(array);
	} else {
		// Fallback for environments without crypto
		array[0] = Math.floor(Math.random() * 256);
	}
	return array[0];
}

/**
 * Convert 8-bit value to Odu indices
 * First 4 bits = Major Odu (1-16)
 * Last 4 bits = Minor Odu (1-16)
 */
export function binaryToOdu(value: number): { major: number; minor: number } {
	const major = ((value >> 4) % 16) + 1;
	const minor = (value % 16) + 1;
	return { major, minor };
}

/**
 * Generate Ifá trading signal
 */
export function generateIfaSignal(): IfaSignal {
	const binaryValue = throwOpele();
	const { major, minor } = binaryToOdu(binaryValue);
	const odu = IFA_ODUS[major];

	// Calculate confidence based on alignment of major and minor
	// When major and minor align (same value), highest confidence
	const alignment = 1 - Math.abs(major - minor) / 15;
	const confidence = 0.5 + alignment * 0.5; // 0.5 to 1.0

	return {
		timestamp: Date.now(),
		binaryValue,
		majorOdu: major,
		minorOdu: minor,
		oduName: odu.name,
		action: odu.action,
		confidence,
		quantumState: "collapsed", // Once observed, the state collapses
	};
}

/**
 * Ifá Trading Strategy Configuration
 */
export interface IfaTradingConfig {
	symbol: string;
	capital: number;
	maxPositionSize: number; // Percentage of capital
	stopLossPercent: number;
	takeProfitPercent: number;
	signalFrequency: "hourly" | "daily" | "weekly";
	useAstrologicalFilter: boolean;
	solsticeBoost: number; // Multiplier for signals near solstice
}

/**
 * Trading action mapping based on Odu
 */
export interface TradingAction {
	type: "buy" | "sell" | "hold" | "close";
	size: number; // Position size as decimal (0-1)
	stopLoss?: number;
	takeProfit?: number;
	reason: string;
}

/**
 * Convert Ifá signal to trading action
 */
export function ifaSignalToAction(signal: IfaSignal, config: IfaTradingConfig, currentPrice: number): TradingAction {
	const baseSize = config.maxPositionSize * signal.confidence;

	// Check if near solstice (June 21 or December 21)
	const now = new Date();
	const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));
	const nearSolstice = Math.abs(dayOfYear - 172) < 14 || Math.abs(dayOfYear - 355) < 14;
	const solsticeMultiplier = nearSolstice && config.useAstrologicalFilter ? config.solsticeBoost : 1;

	const adjustedSize = Math.min(baseSize * solsticeMultiplier, 1);

	switch (signal.action) {
		case "buy":
		case "aggressive_buy":
		case "accumulate":
		case "breakout_long":
		case "dca":
			return {
				type: "buy",
				size: adjustedSize,
				stopLoss: currentPrice * (1 - config.stopLossPercent / 100),
				takeProfit: currentPrice * (1 + config.takeProfitPercent / 100),
				reason: `Odu ${signal.oduName}: ${signal.action}`,
			};

		case "sell":
		case "take_profit":
		case "close_all":
			return {
				type: "sell",
				size: adjustedSize,
				reason: `Odu ${signal.oduName}: ${signal.action}`,
			};

		case "reduce_position":
		case "hedge":
			return {
				type: "sell",
				size: adjustedSize * 0.5,
				reason: `Odu ${signal.oduName}: ${signal.action}`,
			};

		case "increase_position":
		case "momentum":
		case "trend_follow":
			return {
				type: "buy",
				size: adjustedSize * 0.3, // Smaller add-on positions
				stopLoss: currentPrice * (1 - config.stopLossPercent / 100),
				takeProfit: currentPrice * (1 + config.takeProfitPercent / 100),
				reason: `Odu ${signal.oduName}: ${signal.action}`,
			};

		default:
			return {
				type: "hold",
				size: 0,
				reason: `Odu ${signal.oduName}: ${signal.action}`,
			};
	}
}

/**
 * Simple backtesting engine for Ifá strategy
 */
export interface BacktestResult {
	totalTrades: number;
	winningTrades: number;
	losingTrades: number;
	winRate: number;
	totalReturn: number;
	finalCapital: number;
	maxDrawdown: number;
	sharpeRatio: number;
	oduPerformance: Record<string, { trades: number; pnl: number }>;
}

export function backtestIfaStrategy(
	priceData: { timestamp: number; open: number; high: number; low: number; close: number }[],
	config: IfaTradingConfig,
): BacktestResult {
	let capital = config.capital;
	let position = 0;
	let entryPrice = 0;
	let peakCapital = capital;
	let maxDrawdown = 0;
	const returns: number[] = [];
	const oduPerformance: Record<string, { trades: number; pnl: number }> = {};

	let totalTrades = 0;
	let winningTrades = 0;
	let losingTrades = 0;

	// Initialize Odu performance tracking
	for (let i = 1; i <= 16; i++) {
		oduPerformance[IFA_ODUS[i].name] = { trades: 0, pnl: 0 };
	}

	for (let i = 1; i < priceData.length; i++) {
		const candle = priceData[i];
		const signal = generateIfaSignal();
		const action = ifaSignalToAction(signal, config, candle.open);

		// Track Odu usage
		oduPerformance[signal.oduName].trades++;

		if (action.type === "buy" && position === 0) {
			// Enter long position
			const positionValue = capital * action.size;
			position = positionValue / candle.open;
			entryPrice = candle.open;
			totalTrades++;
		} else if (action.type === "sell" && position > 0) {
			// Exit position
			const exitValue = position * candle.close;
			const pnl = exitValue - entryPrice * position;
			capital += pnl;
			returns.push(pnl / (entryPrice * position));

			oduPerformance[signal.oduName].pnl += pnl;

			if (pnl > 0) winningTrades++;
			else losingTrades++;

			position = 0;
			entryPrice = 0;
		}

		// Check stop loss / take profit if in position
		if (position > 0 && action.stopLoss && action.takeProfit) {
			if (candle.low <= action.stopLoss) {
				// Stop loss hit
				const exitValue = position * action.stopLoss;
				const pnl = exitValue - entryPrice * position;
				capital += pnl;
				returns.push(pnl / (entryPrice * position));
				losingTrades++;
				position = 0;
			} else if (candle.high >= action.takeProfit) {
				// Take profit hit
				const exitValue = position * action.takeProfit;
				const pnl = exitValue - entryPrice * position;
				capital += pnl;
				returns.push(pnl / (entryPrice * position));
				winningTrades++;
				position = 0;
			}
		}

		// Track drawdown
		if (capital > peakCapital) peakCapital = capital;
		const drawdown = (peakCapital - capital) / peakCapital;
		if (drawdown > maxDrawdown) maxDrawdown = drawdown;
	}

	// Calculate Sharpe ratio (simplified, assuming risk-free rate = 0)
	const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
	const variance = returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (returns.length || 1);
	const stdDev = Math.sqrt(variance);
	const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

	return {
		totalTrades,
		winningTrades,
		losingTrades,
		winRate: totalTrades > 0 ? winningTrades / totalTrades : 0,
		totalReturn: (capital - config.capital) / config.capital,
		finalCapital: capital,
		maxDrawdown,
		sharpeRatio,
		oduPerformance,
	};
}

// =============================================================================
// PART 3: VEDIC THREEFOLD EVALUATION METRIC
// =============================================================================

/**
 * The three Gunas (qualities) from Vedic philosophy:
 * - Sattva (Goodness): Harmony, wisdom, balance
 * - Rajas (Passion): Action, change, dynamism
 * - Tamas (Ignorance): Inertia, darkness, resistance
 */
export interface ThreefoldScore {
	sattva: number; // 0-100: Goodness
	rajas: number; // 0-100: Passion
	tamas: number; // 0-100: Ignorance
	dominant: "sattva" | "rajas" | "tamas";
	divineScale: number; // -100 (demonic) to +100 (divine)
}

/**
 * Keywords associated with each Guna
 */
const SATTVA_KEYWORDS = [
	"wisdom",
	"truth",
	"balance",
	"harmony",
	"clarity",
	"peace",
	"pure",
	"honest",
	"helpful",
	"compassion",
	"understanding",
	"insight",
	"correct",
	"accurate",
	"ethical",
	"fair",
	"just",
	"knowledge",
	"learn",
	"improve",
	"benefit",
	"positive",
	"constructive",
];

const RAJAS_KEYWORDS = [
	"action",
	"change",
	"desire",
	"passion",
	"ambition",
	"competition",
	"drive",
	"energy",
	"dynamic",
	"fast",
	"quick",
	"urgent",
	"profit",
	"gain",
	"win",
	"achieve",
	"goal",
	"target",
	"aggressive",
	"bold",
	"risk",
	"opportunity",
];

const TAMAS_KEYWORDS = [
	"error",
	"wrong",
	"fail",
	"mistake",
	"ignore",
	"lazy",
	"slow",
	"stuck",
	"confused",
	"unclear",
	"dark",
	"hidden",
	"secret",
	"deceptive",
	"harmful",
	"negative",
	"destructive",
	"block",
	"obstacle",
	"resist",
	"delay",
	"procrastinate",
];

/**
 * Divine vs Demonic qualities for the Divine-Demonic scale
 */
const DIVINE_QUALITIES = [
	"fearless",
	"charity",
	"duty",
	"austerity",
	"honest",
	"nonviolent",
	"truthful",
	"equanimity",
	"compassion",
	"gentle",
	"modest",
	"humble",
];

const DEMONIC_QUALITIES = [
	"hypocrisy",
	"arrogance",
	"pride",
	"anger",
	"harsh",
	"ignorant",
	"greedy",
	"cruel",
	"malicious",
	"deceitful",
	"manipulative",
	"selfish",
];

/**
 * Evaluate text content using Vedic Threefold metric
 */
export function evaluateThreefold(text: string): ThreefoldScore {
	const lowerText = text.toLowerCase();
	const words = lowerText.split(/\s+/);
	const _totalWords = words.length || 1;

	// Count keyword matches
	let sattvaCount = 0;
	let rajasCount = 0;
	let tamasCount = 0;
	let divineCount = 0;
	let demonicCount = 0;

	for (const word of words) {
		if (SATTVA_KEYWORDS.some((k) => word.includes(k))) sattvaCount++;
		if (RAJAS_KEYWORDS.some((k) => word.includes(k))) rajasCount++;
		if (TAMAS_KEYWORDS.some((k) => word.includes(k))) tamasCount++;
		if (DIVINE_QUALITIES.some((k) => word.includes(k))) divineCount++;
		if (DEMONIC_QUALITIES.some((k) => word.includes(k))) demonicCount++;
	}

	// Normalize scores (0-100)
	const total = sattvaCount + rajasCount + tamasCount || 1;
	const sattva = Math.round((sattvaCount / total) * 100);
	const rajas = Math.round((rajasCount / total) * 100);
	const tamas = Math.round((tamasCount / total) * 100);

	// Determine dominant guna
	let dominant: "sattva" | "rajas" | "tamas" = "sattva";
	if (rajas > sattva && rajas > tamas) dominant = "rajas";
	if (tamas > sattva && tamas > rajas) dominant = "tamas";

	// Calculate divine scale (-100 to +100)
	const divineTotal = divineCount + demonicCount || 1;
	const divineScale = Math.round(((divineCount - demonicCount) / divineTotal) * 100);

	return { sattva, rajas, tamas, dominant, divineScale };
}

/**
 * Threefold evaluation categories for different domains
 */
export const THREEFOLD_CATEGORIES = {
	thought: {
		goodness: "Serenity of mind, gentleness, equanimity, self-control, purity",
		passion: "Restlessness, attachment, desire for recognition",
		ignorance: "Delusion, confusion, inability to discern",
	},
	word: {
		goodness: "Non-offensive, truthful, pleasant, beneficial, honest",
		passion: "Exaggerated, self-promoting, argumentative",
		ignorance: "Harsh, deceptive, harmful, misleading",
	},
	deed: {
		goodness: "Service, purity, truth, nonviolence",
		passion: "Self-interested, competitive, results-focused",
		ignorance: "Harmful, destructive, negligent",
	},
	action: {
		goodness: "Without attachment, non-egotistic, unperturbed by outcome",
		passion: "With ego, selfish motives, excessive effort",
		ignorance: "Delusional, disregarding consequences, harmful",
	},
	intellect: {
		goodness: "Understands right/wrong, fear/fearlessness, bondage/liberation",
		passion: "Cannot distinguish righteousness from unrighteousness",
		ignorance: "Accepts unrighteousness as righteousness",
	},
	food: {
		goodness: "Juicy, smooth, substantial, nutritious",
		passion: "Bitter, sour, salty, hot, pungent",
		ignorance: "Stale, tasteless, putrid, impure",
	},
};

/**
 * Evaluate agent output against Threefold criteria
 */
export interface AgentOutputEvaluation {
	content: string;
	threefoldScore: ThreefoldScore;
	qualityGrade: "A" | "B" | "C" | "D" | "F";
	recommendations: string[];
	categoryScores: {
		thought: ThreefoldScore;
		word: ThreefoldScore;
		deed: ThreefoldScore;
	};
}

/**
 * Comprehensive evaluation of agent output
 */
export function evaluateAgentOutput(output: string): AgentOutputEvaluation {
	const threefoldScore = evaluateThreefold(output);

	// Break down into thought/word/deed components
	// (simplified - in practice would use more sophisticated NLP)
	const sentences = output.split(/[.!?]+/).filter((s) => s.trim());
	const third = Math.ceil(sentences.length / 3);

	const thoughtSection = sentences.slice(0, third).join(". ");
	const wordSection = sentences.slice(third, third * 2).join(". ");
	const deedSection = sentences.slice(third * 2).join(". ");

	const categoryScores = {
		thought: evaluateThreefold(thoughtSection),
		word: evaluateThreefold(wordSection),
		deed: evaluateThreefold(deedSection),
	};

	// Calculate quality grade based on Sattva dominance
	let qualityGrade: "A" | "B" | "C" | "D" | "F";
	if (threefoldScore.sattva >= 70 && threefoldScore.divineScale >= 50) {
		qualityGrade = "A";
	} else if (threefoldScore.sattva >= 50 && threefoldScore.divineScale >= 20) {
		qualityGrade = "B";
	} else if (threefoldScore.sattva >= 30 && threefoldScore.divineScale >= 0) {
		qualityGrade = "C";
	} else if (threefoldScore.sattva >= 20) {
		qualityGrade = "D";
	} else {
		qualityGrade = "F";
	}

	// Generate recommendations
	const recommendations: string[] = [];

	if (threefoldScore.tamas > 30) {
		recommendations.push("Reduce confusion and unclear statements. Aim for clarity and precision.");
	}
	if (threefoldScore.rajas > 50) {
		recommendations.push("Balance action-oriented content with wisdom. Consider long-term consequences.");
	}
	if (threefoldScore.sattva < 40) {
		recommendations.push("Increase focus on truth, clarity, and beneficial outcomes.");
	}
	if (threefoldScore.divineScale < 0) {
		recommendations.push("Review for potential harmful or deceptive content. Align with ethical principles.");
	}

	return {
		content: output.substring(0, 200) + (output.length > 200 ? "..." : ""),
		threefoldScore,
		qualityGrade,
		recommendations,
		categoryScores,
	};
}

// =============================================================================
// PART 4: UNIFIED FRAMEWORK - INDRA QUANTUM SYSTEM
// =============================================================================

/**
 * Unified Indra Quantum System that combines all algorithms
 */
export interface IndraQuantumSystemConfig {
	enableB5PatternDetection: boolean;
	enableIfaTrading: boolean;
	enableThreefoldEvaluation: boolean;
	tradingConfig?: IfaTradingConfig;
}

export interface IndraSystemAnalysis {
	timestamp: number;
	b5Analysis?: B5PatternAnalysis;
	ifaSignal?: IfaSignal;
	tradingAction?: TradingAction;
	threefoldEvaluation?: AgentOutputEvaluation;
	unifiedScore: number; // 0-100 overall system health
	cosmicAlignment: string; // Interpretation of combined signals
}

/**
 * Main Indra Quantum System class
 */
export class IndraQuantumSystem {
	private config: IndraQuantumSystemConfig;

	constructor(config: IndraQuantumSystemConfig) {
		this.config = config;
	}

	/**
	 * Analyze ARC-AGI grid using b5 algorithm
	 */
	analyzeGrid(input: number[][], output: number[][]): B5PatternAnalysis | undefined {
		if (!this.config.enableB5PatternDetection) return undefined;
		return analyzeB5Pattern(input, output);
	}

	/**
	 * Generate trading signal using Ifá system
	 */
	generateTradingSignal(currentPrice: number): {
		signal: IfaSignal;
		action: TradingAction;
	} | null {
		if (!this.config.enableIfaTrading || !this.config.tradingConfig) return null;
		const signal = generateIfaSignal();
		const action = ifaSignalToAction(signal, this.config.tradingConfig, currentPrice);
		return { signal, action };
	}

	/**
	 * Evaluate agent output using Threefold metric
	 */
	evaluateOutput(output: string): AgentOutputEvaluation | undefined {
		if (!this.config.enableThreefoldEvaluation) return undefined;
		return evaluateAgentOutput(output);
	}

	/**
	 * Run full system analysis
	 */
	analyze(params: {
		grid?: { input: number[][]; output: number[][] };
		price?: number;
		agentOutput?: string;
	}): IndraSystemAnalysis {
		const analysis: IndraSystemAnalysis = {
			timestamp: Date.now(),
			unifiedScore: 0,
			cosmicAlignment: "",
		};

		let scoreSum = 0;
		let scoreCount = 0;

		// B5 Analysis
		if (params.grid) {
			analysis.b5Analysis = this.analyzeGrid(params.grid.input, params.grid.output);
			if (analysis.b5Analysis) {
				scoreSum += analysis.b5Analysis.confidence * 100;
				scoreCount++;
			}
		}

		// Ifá Trading
		if (params.price !== undefined) {
			const trading = this.generateTradingSignal(params.price);
			if (trading) {
				analysis.ifaSignal = trading.signal;
				analysis.tradingAction = trading.action;
				scoreSum += trading.signal.confidence * 100;
				scoreCount++;
			}
		}

		// Threefold Evaluation
		if (params.agentOutput) {
			analysis.threefoldEvaluation = this.evaluateOutput(params.agentOutput);
			if (analysis.threefoldEvaluation) {
				scoreSum += analysis.threefoldEvaluation.threefoldScore.sattva;
				scoreCount++;
			}
		}

		// Calculate unified score
		analysis.unifiedScore = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0;

		// Generate cosmic alignment interpretation
		analysis.cosmicAlignment = this.interpretAlignment(analysis);

		return analysis;
	}

	/**
	 * Interpret the cosmic alignment of all signals
	 */
	private interpretAlignment(analysis: IndraSystemAnalysis): string {
		const parts: string[] = [];

		if (analysis.b5Analysis) {
			parts.push(`Grid: ${analysis.b5Analysis.patternType} (${Math.round(analysis.b5Analysis.confidence * 100)}%)`);
		}

		if (analysis.ifaSignal) {
			parts.push(`Odu: ${analysis.ifaSignal.oduName} → ${analysis.ifaSignal.action}`);
		}

		if (analysis.threefoldEvaluation) {
			parts.push(
				`Guna: ${analysis.threefoldEvaluation.threefoldScore.dominant} (Grade: ${analysis.threefoldEvaluation.qualityGrade})`,
			);
		}

		if (parts.length === 0) {
			return "No cosmic signals detected";
		}

		return `Cosmic Alignment: ${parts.join(" | ")}`;
	}
}

// =============================================================================
// EXPORTS
// =============================================================================

export default IndraQuantumSystem;
