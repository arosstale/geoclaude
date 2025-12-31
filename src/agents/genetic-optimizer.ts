/**
 * Genetic Algorithm Optimizer
 *
 * Inspired by ANG13T's url_genie GA-optimized neural network approach.
 * Applies evolutionary optimization to trading strategies, prompts, and configurations.
 *
 * Pattern: Population → Fitness Evaluation → Selection → Crossover → Mutation → Evolution
 *
 * @see https://github.com/ANG13T/url_genie
 */

import { EventEmitter } from "events";

// ============================================================================
// Types
// ============================================================================

export interface GeneticConfig {
	populationSize: number;
	generations: number;
	mutationRate: number;
	crossoverRate: number;
	elitismCount: number;
	tournamentSize: number;
	convergenceThreshold: number;
	maxStagnantGenerations: number;
}

export interface Individual<T> {
	genes: T;
	fitness: number;
	generation: number;
	id: string;
}

export interface GenerationStats {
	generation: number;
	bestFitness: number;
	avgFitness: number;
	worstFitness: number;
	diversity: number;
	stagnantCount: number;
}

export interface EvolutionResult<T> {
	bestIndividual: Individual<T>;
	finalGeneration: number;
	generations: GenerationStats[];
	converged: boolean;
	totalEvaluations: number;
	elapsedMs: number;
}

export type FitnessFunction<T> = (genes: T) => Promise<number> | number;
export type CrossoverFunction<T> = (parent1: T, parent2: T) => [T, T];
export type MutationFunction<T> = (genes: T, rate: number) => T;
export type InitializerFunction<T> = () => T;

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_GENETIC_CONFIG: GeneticConfig = {
	populationSize: 50,
	generations: 100,
	mutationRate: 0.1,
	crossoverRate: 0.8,
	elitismCount: 2,
	tournamentSize: 3,
	convergenceThreshold: 0.001,
	maxStagnantGenerations: 20,
};

// ============================================================================
// Genetic Optimizer Class
// ============================================================================

export class GeneticOptimizer<T> extends EventEmitter {
	private config: GeneticConfig;
	private fitnessFunc: FitnessFunction<T>;
	private crossoverFunc: CrossoverFunction<T>;
	private mutationFunc: MutationFunction<T>;
	private initializerFunc: InitializerFunction<T>;

	private population: Individual<T>[] = [];
	private generationStats: GenerationStats[] = [];
	private bestEver: Individual<T> | null = null;
	private stagnantCount = 0;
	private totalEvaluations = 0;
	private running = false;

	constructor(
		fitnessFunc: FitnessFunction<T>,
		crossoverFunc: CrossoverFunction<T>,
		mutationFunc: MutationFunction<T>,
		initializerFunc: InitializerFunction<T>,
		config: Partial<GeneticConfig> = {},
	) {
		super();
		this.config = { ...DEFAULT_GENETIC_CONFIG, ...config };
		this.fitnessFunc = fitnessFunc;
		this.crossoverFunc = crossoverFunc;
		this.mutationFunc = mutationFunc;
		this.initializerFunc = initializerFunc;
	}

	/**
	 * Run the genetic algorithm evolution
	 */
	async evolve(): Promise<EvolutionResult<T>> {
		const startTime = Date.now();
		this.running = true;
		this.stagnantCount = 0;
		this.totalEvaluations = 0;
		this.generationStats = [];
		this.bestEver = null;

		// Initialize population
		await this.initializePopulation();

		let generation = 0;
		let converged = false;

		while (generation < this.config.generations && this.running) {
			// Evaluate fitness
			await this.evaluatePopulation();

			// Track statistics
			const stats = this.calculateStats(generation);
			this.generationStats.push(stats);
			this.emit("generation", stats);

			// Check for convergence
			if (this.checkConvergence(stats)) {
				converged = true;
				break;
			}

			// Check for stagnation
			if (this.stagnantCount >= this.config.maxStagnantGenerations) {
				this.emit("stagnation", { generation, stagnantCount: this.stagnantCount });
				break;
			}

			// Create next generation
			this.population = await this.createNextGeneration(generation + 1);
			generation++;
		}

		this.running = false;

		const result: EvolutionResult<T> = {
			bestIndividual: this.bestEver!,
			finalGeneration: generation,
			generations: this.generationStats,
			converged,
			totalEvaluations: this.totalEvaluations,
			elapsedMs: Date.now() - startTime,
		};

		this.emit("complete", result);
		return result;
	}

	/**
	 * Stop the evolution process
	 */
	stop(): void {
		this.running = false;
	}

	/**
	 * Get current best individual
	 */
	getBest(): Individual<T> | null {
		return this.bestEver;
	}

	/**
	 * Get current population
	 */
	getPopulation(): Individual<T>[] {
		return [...this.population];
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	private async initializePopulation(): Promise<void> {
		this.population = [];
		for (let i = 0; i < this.config.populationSize; i++) {
			const genes = this.initializerFunc();
			this.population.push({
				genes,
				fitness: 0,
				generation: 0,
				id: `ind_${Date.now()}_${i}`,
			});
		}
		this.emit("initialized", { size: this.population.length });
	}

	private async evaluatePopulation(): Promise<void> {
		const evaluations = this.population.map(async (individual) => {
			if (individual.fitness === 0) {
				individual.fitness = await this.fitnessFunc(individual.genes);
				this.totalEvaluations++;
			}
			return individual;
		});

		await Promise.all(evaluations);

		// Sort by fitness (descending)
		this.population.sort((a, b) => b.fitness - a.fitness);

		// Update best ever
		const currentBest = this.population[0];
		if (!this.bestEver || currentBest.fitness > this.bestEver.fitness) {
			this.bestEver = { ...currentBest };
			this.stagnantCount = 0;
			this.emit("newBest", this.bestEver);
		} else {
			this.stagnantCount++;
		}
	}

	private calculateStats(generation: number): GenerationStats {
		const fitnesses = this.population.map((ind) => ind.fitness);
		const sum = fitnesses.reduce((a, b) => a + b, 0);

		// Calculate diversity (standard deviation of fitness)
		const avg = sum / fitnesses.length;
		const variance = fitnesses.reduce((acc, f) => acc + (f - avg) ** 2, 0) / fitnesses.length;
		const diversity = Math.sqrt(variance);

		return {
			generation,
			bestFitness: fitnesses[0],
			avgFitness: avg,
			worstFitness: fitnesses[fitnesses.length - 1],
			diversity,
			stagnantCount: this.stagnantCount,
		};
	}

	private checkConvergence(stats: GenerationStats): boolean {
		if (this.generationStats.length < 2) return false;

		const prevStats = this.generationStats[this.generationStats.length - 2];
		const improvement = Math.abs(stats.bestFitness - prevStats.bestFitness);

		return improvement < this.config.convergenceThreshold && stats.diversity < this.config.convergenceThreshold;
	}

	private async createNextGeneration(generation: number): Promise<Individual<T>[]> {
		const newPopulation: Individual<T>[] = [];

		// Elitism: Keep best individuals
		for (let i = 0; i < this.config.elitismCount; i++) {
			newPopulation.push({
				...this.population[i],
				generation,
			});
		}

		// Fill rest with offspring
		while (newPopulation.length < this.config.populationSize) {
			// Selection
			const parent1 = this.tournamentSelect();
			const parent2 = this.tournamentSelect();

			// Crossover
			let [child1Genes, child2Genes] = [parent1.genes, parent2.genes];
			if (Math.random() < this.config.crossoverRate) {
				[child1Genes, child2Genes] = this.crossoverFunc(parent1.genes, parent2.genes);
			}

			// Mutation
			child1Genes = this.mutationFunc(child1Genes, this.config.mutationRate);
			child2Genes = this.mutationFunc(child2Genes, this.config.mutationRate);

			// Add to population
			newPopulation.push({
				genes: child1Genes,
				fitness: 0,
				generation,
				id: `ind_${Date.now()}_${newPopulation.length}`,
			});

			if (newPopulation.length < this.config.populationSize) {
				newPopulation.push({
					genes: child2Genes,
					fitness: 0,
					generation,
					id: `ind_${Date.now()}_${newPopulation.length}`,
				});
			}
		}

		return newPopulation;
	}

	private tournamentSelect(): Individual<T> {
		const tournament: Individual<T>[] = [];

		for (let i = 0; i < this.config.tournamentSize; i++) {
			const idx = Math.floor(Math.random() * this.population.length);
			tournament.push(this.population[idx]);
		}

		return tournament.reduce((best, ind) => (ind.fitness > best.fitness ? ind : best));
	}
}

// ============================================================================
// Trading Strategy Genes
// ============================================================================

export interface TradingStrategyGenes {
	// Entry conditions
	entryThreshold: number; // 0-1
	momentumWeight: number; // 0-1
	volumeWeight: number; // 0-1
	sentimentWeight: number; // 0-1

	// Exit conditions
	takeProfitPercent: number; // 1-20
	stopLossPercent: number; // 1-10
	trailingStopPercent: number; // 0-5

	// Position sizing
	maxPositionSize: number; // 0.01-0.5
	scalingFactor: number; // 0.5-2.0

	// Timing
	minHoldingPeriod: number; // 1-100 (bars)
	maxHoldingPeriod: number; // 10-500 (bars)

	// Risk management
	maxDrawdownPercent: number; // 5-30
	correlationThreshold: number; // 0-1
}

/**
 * Initialize random trading strategy genes
 */
export function initializeTradingGenes(): TradingStrategyGenes {
	return {
		entryThreshold: Math.random(),
		momentumWeight: Math.random(),
		volumeWeight: Math.random(),
		sentimentWeight: Math.random(),
		takeProfitPercent: 1 + Math.random() * 19,
		stopLossPercent: 1 + Math.random() * 9,
		trailingStopPercent: Math.random() * 5,
		maxPositionSize: 0.01 + Math.random() * 0.49,
		scalingFactor: 0.5 + Math.random() * 1.5,
		minHoldingPeriod: Math.floor(1 + Math.random() * 99),
		maxHoldingPeriod: Math.floor(10 + Math.random() * 490),
		maxDrawdownPercent: 5 + Math.random() * 25,
		correlationThreshold: Math.random(),
	};
}

/**
 * Crossover for trading strategy genes (uniform crossover)
 */
export function crossoverTradingGenes(
	parent1: TradingStrategyGenes,
	parent2: TradingStrategyGenes,
): [TradingStrategyGenes, TradingStrategyGenes] {
	const child1: TradingStrategyGenes = { ...parent1 };
	const child2: TradingStrategyGenes = { ...parent2 };

	const keys = Object.keys(parent1) as (keyof TradingStrategyGenes)[];

	for (const key of keys) {
		if (Math.random() < 0.5) {
			// Swap genes
			const temp = child1[key];
			(child1 as unknown as Record<string, number>)[key] = child2[key];
			(child2 as unknown as Record<string, number>)[key] = temp;
		}
	}

	return [child1, child2];
}

/**
 * Mutation for trading strategy genes (Gaussian mutation)
 */
export function mutateTradingGenes(genes: TradingStrategyGenes, rate: number): TradingStrategyGenes {
	const mutated = { ...genes };

	const mutateValue = (value: number, min: number, max: number): number => {
		if (Math.random() < rate) {
			const sigma = (max - min) * 0.1;
			const mutation = gaussianRandom() * sigma;
			return Math.max(min, Math.min(max, value + mutation));
		}
		return value;
	};

	mutated.entryThreshold = mutateValue(genes.entryThreshold, 0, 1);
	mutated.momentumWeight = mutateValue(genes.momentumWeight, 0, 1);
	mutated.volumeWeight = mutateValue(genes.volumeWeight, 0, 1);
	mutated.sentimentWeight = mutateValue(genes.sentimentWeight, 0, 1);
	mutated.takeProfitPercent = mutateValue(genes.takeProfitPercent, 1, 20);
	mutated.stopLossPercent = mutateValue(genes.stopLossPercent, 1, 10);
	mutated.trailingStopPercent = mutateValue(genes.trailingStopPercent, 0, 5);
	mutated.maxPositionSize = mutateValue(genes.maxPositionSize, 0.01, 0.5);
	mutated.scalingFactor = mutateValue(genes.scalingFactor, 0.5, 2.0);
	mutated.minHoldingPeriod = Math.floor(mutateValue(genes.minHoldingPeriod, 1, 100));
	mutated.maxHoldingPeriod = Math.floor(mutateValue(genes.maxHoldingPeriod, 10, 500));
	mutated.maxDrawdownPercent = mutateValue(genes.maxDrawdownPercent, 5, 30);
	mutated.correlationThreshold = mutateValue(genes.correlationThreshold, 0, 1);

	// Ensure minHoldingPeriod < maxHoldingPeriod
	if (mutated.minHoldingPeriod >= mutated.maxHoldingPeriod) {
		mutated.maxHoldingPeriod = mutated.minHoldingPeriod + 10;
	}

	return mutated;
}

// Helper: Gaussian random using Box-Muller transform
function gaussianRandom(): number {
	const u1 = Math.random();
	const u2 = Math.random();
	return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ============================================================================
// Trading Strategy Optimizer
// ============================================================================

export interface BacktestResult {
	totalReturn: number;
	sharpeRatio: number;
	maxDrawdown: number;
	winRate: number;
	totalTrades: number;
	profitFactor: number;
}

export type BacktestFunction = (genes: TradingStrategyGenes) => Promise<BacktestResult>;

/**
 * Create a fitness function from backtest results
 * Multi-objective optimization using weighted sum
 */
export function createTradingFitnessFunction(
	backtestFunc: BacktestFunction,
	weights: {
		returnWeight?: number;
		sharpeWeight?: number;
		drawdownWeight?: number;
		winRateWeight?: number;
	} = {},
): FitnessFunction<TradingStrategyGenes> {
	const { returnWeight = 0.3, sharpeWeight = 0.4, drawdownWeight = 0.2, winRateWeight = 0.1 } = weights;

	return async (genes: TradingStrategyGenes): Promise<number> => {
		const result = await backtestFunc(genes);

		// Normalize and combine objectives
		const normalizedReturn = Math.tanh(result.totalReturn / 100); // -1 to 1
		const normalizedSharpe = Math.tanh(result.sharpeRatio / 3); // -1 to 1
		const normalizedDrawdown = 1 - result.maxDrawdown / 100; // 0 to 1 (lower is better)
		const normalizedWinRate = result.winRate; // 0 to 1

		const fitness =
			returnWeight * normalizedReturn +
			sharpeWeight * normalizedSharpe +
			drawdownWeight * normalizedDrawdown +
			winRateWeight * normalizedWinRate;

		// Penalize strategies with too few trades
		const tradePenalty = result.totalTrades < 10 ? 0.5 : 1.0;

		return fitness * tradePenalty;
	};
}

/**
 * Create a trading strategy optimizer
 */
export function createTradingOptimizer(
	backtestFunc: BacktestFunction,
	config: Partial<GeneticConfig> = {},
): GeneticOptimizer<TradingStrategyGenes> {
	const fitnessFunc = createTradingFitnessFunction(backtestFunc);

	return new GeneticOptimizer(fitnessFunc, crossoverTradingGenes, mutateTradingGenes, initializeTradingGenes, {
		populationSize: 30,
		generations: 50,
		mutationRate: 0.15,
		crossoverRate: 0.7,
		elitismCount: 3,
		...config,
	});
}

// ============================================================================
// Prompt Optimization Genes (for GEPA integration)
// ============================================================================

export interface PromptGenes {
	// Structure
	systemPromptLength: number; // 100-2000 chars
	includeExamples: boolean;
	exampleCount: number; // 1-5
	includeChainOfThought: boolean;

	// Style
	formalityLevel: number; // 0-1 (casual to formal)
	technicalDepth: number; // 0-1 (simple to complex)
	verbosityLevel: number; // 0-1 (concise to verbose)

	// Instructions
	includeConstraints: boolean;
	includeRoleDefinition: boolean;
	includeOutputFormat: boolean;

	// Encoding of actual prompt components (indices into template arrays)
	roleIndex: number;
	constraintIndices: number[];
	formatIndex: number;
}

/**
 * Initialize random prompt genes
 */
export function initializePromptGenes(): PromptGenes {
	return {
		systemPromptLength: Math.floor(100 + Math.random() * 1900),
		includeExamples: Math.random() > 0.5,
		exampleCount: Math.floor(1 + Math.random() * 4),
		includeChainOfThought: Math.random() > 0.5,
		formalityLevel: Math.random(),
		technicalDepth: Math.random(),
		verbosityLevel: Math.random(),
		includeConstraints: Math.random() > 0.3,
		includeRoleDefinition: Math.random() > 0.2,
		includeOutputFormat: Math.random() > 0.4,
		roleIndex: Math.floor(Math.random() * 10),
		constraintIndices: Array.from({ length: Math.floor(1 + Math.random() * 4) }, () =>
			Math.floor(Math.random() * 20),
		),
		formatIndex: Math.floor(Math.random() * 5),
	};
}

/**
 * Crossover for prompt genes
 */
export function crossoverPromptGenes(parent1: PromptGenes, parent2: PromptGenes): [PromptGenes, PromptGenes] {
	const child1: PromptGenes = {
		...parent1,
		// Take some from parent2
		formalityLevel: parent2.formalityLevel,
		technicalDepth: parent2.technicalDepth,
		constraintIndices: [...parent2.constraintIndices],
	};

	const child2: PromptGenes = {
		...parent2,
		// Take some from parent1
		formalityLevel: parent1.formalityLevel,
		technicalDepth: parent1.technicalDepth,
		constraintIndices: [...parent1.constraintIndices],
	};

	return [child1, child2];
}

/**
 * Mutation for prompt genes
 */
export function mutatePromptGenes(genes: PromptGenes, rate: number): PromptGenes {
	const mutated = { ...genes, constraintIndices: [...genes.constraintIndices] };

	if (Math.random() < rate) mutated.includeExamples = !mutated.includeExamples;
	if (Math.random() < rate) mutated.exampleCount = Math.floor(1 + Math.random() * 4);
	if (Math.random() < rate) mutated.includeChainOfThought = !mutated.includeChainOfThought;
	if (Math.random() < rate) mutated.formalityLevel = Math.random();
	if (Math.random() < rate) mutated.technicalDepth = Math.random();
	if (Math.random() < rate) mutated.verbosityLevel = Math.random();
	if (Math.random() < rate) mutated.includeConstraints = !mutated.includeConstraints;
	if (Math.random() < rate) mutated.includeRoleDefinition = !mutated.includeRoleDefinition;
	if (Math.random() < rate) mutated.includeOutputFormat = !mutated.includeOutputFormat;
	if (Math.random() < rate) mutated.roleIndex = Math.floor(Math.random() * 10);
	if (Math.random() < rate) mutated.formatIndex = Math.floor(Math.random() * 5);

	// Mutate constraint indices
	if (Math.random() < rate) {
		const idx = Math.floor(Math.random() * mutated.constraintIndices.length);
		mutated.constraintIndices[idx] = Math.floor(Math.random() * 20);
	}

	return mutated;
}

// ============================================================================
// Presets
// ============================================================================

export const GeneticOptimizerPresets = {
	/**
	 * Quick optimization for rapid iteration
	 */
	quick: <T>(
		fitnessFunc: FitnessFunction<T>,
		crossoverFunc: CrossoverFunction<T>,
		mutationFunc: MutationFunction<T>,
		initializerFunc: InitializerFunction<T>,
	) =>
		new GeneticOptimizer(fitnessFunc, crossoverFunc, mutationFunc, initializerFunc, {
			populationSize: 20,
			generations: 20,
			mutationRate: 0.2,
			elitismCount: 2,
		}),

	/**
	 * Thorough optimization for best results
	 */
	thorough: <T>(
		fitnessFunc: FitnessFunction<T>,
		crossoverFunc: CrossoverFunction<T>,
		mutationFunc: MutationFunction<T>,
		initializerFunc: InitializerFunction<T>,
	) =>
		new GeneticOptimizer(fitnessFunc, crossoverFunc, mutationFunc, initializerFunc, {
			populationSize: 100,
			generations: 200,
			mutationRate: 0.1,
			elitismCount: 5,
			maxStagnantGenerations: 30,
		}),

	/**
	 * Trading strategy optimization preset
	 */
	trading: (backtestFunc: BacktestFunction) => createTradingOptimizer(backtestFunc),

	/**
	 * High diversity optimization (for exploration)
	 */
	exploratory: <T>(
		fitnessFunc: FitnessFunction<T>,
		crossoverFunc: CrossoverFunction<T>,
		mutationFunc: MutationFunction<T>,
		initializerFunc: InitializerFunction<T>,
	) =>
		new GeneticOptimizer(fitnessFunc, crossoverFunc, mutationFunc, initializerFunc, {
			populationSize: 50,
			generations: 50,
			mutationRate: 0.3,
			crossoverRate: 0.9,
			elitismCount: 1,
			tournamentSize: 2,
		}),
};
