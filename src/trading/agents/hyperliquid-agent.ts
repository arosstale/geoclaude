/**
 * Hyperliquid Trading Agent
 * Production perp trading on Hyperliquid DEX
 *
 * Based on MoonDev's hyperliquid bots architecture:
 * - Position management with decimal precision
 * - Market making with spread management
 * - Liquidation tracking and arbitrage
 * - Whale position monitoring via Dune Analytics
 *
 * @see https://github.com/moondevonyt/moon-dev-trading-bots/tree/main/bots/hyperliquid
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, TradeSignal } from "../types.js";

// ============================================================================
// Types
// ============================================================================

export interface HyperliquidPosition {
	symbol: string;
	side: "long" | "short";
	size: number;
	entryPrice: number;
	markPrice: number;
	liquidationPrice: number;
	unrealizedPnl: number;
	margin: number;
	leverage: number;
	timestamp: number;
}

export interface HyperliquidOrder {
	id: string;
	symbol: string;
	side: "buy" | "sell";
	type: "limit" | "market";
	size: number;
	price?: number;
	reduceOnly: boolean;
	status: "open" | "filled" | "cancelled" | "rejected";
	filledSize: number;
	avgFillPrice?: number;
	createdAt: number;
}

export interface MarketData {
	symbol: string;
	markPrice: number;
	indexPrice: number;
	fundingRate: number;
	nextFundingTime: number;
	openInterest: number;
	volume24h: number;
	high24h: number;
	low24h: number;
	bid: number;
	ask: number;
	spread: number;
	timestamp: number;
}

export interface WhalePosition {
	address: string;
	symbol: string;
	side: "long" | "short";
	size: number;
	entryPrice: number;
	pnl: number;
	pnlPercent: number;
	liquidationPrice: number;
	distanceToLiq: number; // %
	timestamp: number;
}

export interface LiquidationData {
	symbol: string;
	side: "long" | "short";
	size: number;
	price: number;
	timestamp: number;
	address?: string;
}

interface HyperliquidConfig extends AgentConfig {
	// API Configuration
	apiUrl: string;
	walletAddress?: string;
	// Trading Parameters
	defaultLeverage: number;
	maxPositionSize: number; // in USD
	minOrderSize: number;
	// Risk Management
	maxDrawdown: number;
	stopLossPercent: number;
	takeProfitPercent: number;
	// Market Making
	spreadBps: number; // basis points
	orderRefreshMs: number;
	// Whale Tracking
	minWhaleSize: number; // USD
	whaleTrackingEnabled: boolean;
}

// ============================================================================
// Hyperliquid API Client
// ============================================================================

class HyperliquidClient {
	private readonly baseUrl: string;
	private readonly walletAddress?: string;

	constructor(baseUrl: string, walletAddress?: string) {
		this.baseUrl = baseUrl;
		this.walletAddress = walletAddress;
	}

	/**
	 * Get market data for a symbol
	 */
	async getMarketData(symbol: string): Promise<MarketData | null> {
		try {
			const response = await fetch(`${this.baseUrl}/info`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "metaAndAssetCtxs",
				}),
			});

			if (!response.ok) return null;

			const data = await response.json();
			const assetCtx = data[1]?.find((a: { coin: string }) => a.coin === symbol);

			if (!assetCtx) return null;

			const markPrice = parseFloat(assetCtx.markPx);
			const bid = parseFloat(assetCtx.midPx) * 0.9999; // Approximate
			const ask = parseFloat(assetCtx.midPx) * 1.0001;

			return {
				symbol,
				markPrice,
				indexPrice: parseFloat(assetCtx.oraclePx || assetCtx.markPx),
				fundingRate: parseFloat(assetCtx.funding || "0"),
				nextFundingTime: Date.now() + 3600000, // Approximate
				openInterest: parseFloat(assetCtx.openInterest || "0"),
				volume24h: parseFloat(assetCtx.dayNtlVlm || "0"),
				high24h: markPrice * 1.05, // Placeholder
				low24h: markPrice * 0.95, // Placeholder
				bid,
				ask,
				spread: ((ask - bid) / markPrice) * 10000, // bps
				timestamp: Date.now(),
			};
		} catch (error) {
			console.error(`[Hyperliquid] Failed to get market data:`, error);
			return null;
		}
	}

	/**
	 * Get all positions for wallet
	 */
	async getPositions(): Promise<HyperliquidPosition[]> {
		if (!this.walletAddress) return [];

		try {
			const response = await fetch(`${this.baseUrl}/info`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "clearinghouseState",
					user: this.walletAddress,
				}),
			});

			if (!response.ok) return [];

			const data = await response.json();
			const positions: HyperliquidPosition[] = [];

			for (const pos of data.assetPositions || []) {
				const position = pos.position;
				if (!position || parseFloat(position.szi) === 0) continue;

				const size = parseFloat(position.szi);
				const entryPrice = parseFloat(position.entryPx);
				const markPrice = parseFloat(position.positionValue) / Math.abs(size);

				positions.push({
					symbol: position.coin,
					side: size > 0 ? "long" : "short",
					size: Math.abs(size),
					entryPrice,
					markPrice,
					liquidationPrice: parseFloat(position.liquidationPx || "0"),
					unrealizedPnl: parseFloat(position.unrealizedPnl),
					margin: parseFloat(position.marginUsed),
					leverage: parseFloat(position.leverage?.value || "1"),
					timestamp: Date.now(),
				});
			}

			return positions;
		} catch (error) {
			console.error(`[Hyperliquid] Failed to get positions:`, error);
			return [];
		}
	}

	/**
	 * Get account balance
	 */
	async getBalance(): Promise<{ equity: number; available: number } | null> {
		if (!this.walletAddress) return null;

		try {
			const response = await fetch(`${this.baseUrl}/info`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "clearinghouseState",
					user: this.walletAddress,
				}),
			});

			if (!response.ok) return null;

			const data = await response.json();

			return {
				equity: parseFloat(data.marginSummary?.accountValue || "0"),
				available: parseFloat(data.marginSummary?.totalMarginUsed || "0"),
			};
		} catch (error) {
			console.error(`[Hyperliquid] Failed to get balance:`, error);
			return null;
		}
	}

	/**
	 * Get recent liquidations
	 */
	async getRecentLiquidations(_symbol?: string, _limit = 50): Promise<LiquidationData[]> {
		// Note: Hyperliquid doesn't have a direct liquidation API
		// This would typically use WebSocket or Dune Analytics
		// Returning empty for now - implement with actual data source
		return [];
	}

	/**
	 * Get orderbook
	 */
	async getOrderbook(symbol: string): Promise<{ bids: [number, number][]; asks: [number, number][] } | null> {
		try {
			const response = await fetch(`${this.baseUrl}/info`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "l2Book",
					coin: symbol,
				}),
			});

			if (!response.ok) return null;

			const data = await response.json();

			return {
				bids: data.levels[0]?.map((l: { px: string; sz: string }) => [parseFloat(l.px), parseFloat(l.sz)]) || [],
				asks: data.levels[1]?.map((l: { px: string; sz: string }) => [parseFloat(l.px), parseFloat(l.sz)]) || [],
			};
		} catch (error) {
			console.error(`[Hyperliquid] Failed to get orderbook:`, error);
			return null;
		}
	}
}

// ============================================================================
// Whale Tracker (Dune Analytics Integration)
// ============================================================================

class WhaleTracker {
	private readonly duneApiKey?: string;
	private whalePositions: Map<string, WhalePosition[]> = new Map();
	private lastUpdate = 0;
	private readonly updateInterval = 300000; // 5 minutes

	constructor(duneApiKey?: string) {
		this.duneApiKey = duneApiKey;
	}

	/**
	 * Fetch whale positions from Dune
	 */
	async fetchWhalePositions(minSize = 100000): Promise<WhalePosition[]> {
		if (!this.duneApiKey) {
			console.warn("[WhaleTracker] No Dune API key configured");
			return [];
		}

		// Check cache
		if (Date.now() - this.lastUpdate < this.updateInterval) {
			return Array.from(this.whalePositions.values()).flat();
		}

		try {
			// Dune query for Hyperliquid whale positions
			// Query ID would be specific to your Dune dashboard
			const queryId = "3447382"; // Example query ID

			const response = await fetch(`https://api.dune.com/api/v1/query/${queryId}/results`, {
				headers: {
					"X-Dune-API-Key": this.duneApiKey,
				},
			});

			if (!response.ok) {
				console.error("[WhaleTracker] Dune API error:", response.status);
				return [];
			}

			const data = await response.json();
			const positions: WhalePosition[] = [];

			for (const row of data.result?.rows || []) {
				if (Math.abs(row.position_value) < minSize) continue;

				positions.push({
					address: row.user_address,
					symbol: row.coin,
					side: row.position_size > 0 ? "long" : "short",
					size: Math.abs(row.position_value),
					entryPrice: row.entry_price,
					pnl: row.unrealized_pnl,
					pnlPercent: row.pnl_percent,
					liquidationPrice: row.liquidation_price,
					distanceToLiq: row.distance_to_liq,
					timestamp: Date.now(),
				});
			}

			// Update cache
			this.whalePositions.clear();
			for (const pos of positions) {
				const existing = this.whalePositions.get(pos.symbol) || [];
				existing.push(pos);
				this.whalePositions.set(pos.symbol, existing);
			}
			this.lastUpdate = Date.now();

			return positions;
		} catch (error) {
			console.error("[WhaleTracker] Failed to fetch whale positions:", error);
			return [];
		}
	}

	/**
	 * Get whale positions for symbol
	 */
	getPositionsForSymbol(symbol: string): WhalePosition[] {
		return this.whalePositions.get(symbol) || [];
	}

	/**
	 * Find positions close to liquidation
	 */
	findCloseToLiquidation(maxDistance = 5): WhalePosition[] {
		const positions: WhalePosition[] = [];

		for (const symbolPositions of this.whalePositions.values()) {
			for (const pos of symbolPositions) {
				if (pos.distanceToLiq <= maxDistance) {
					positions.push(pos);
				}
			}
		}

		return positions.sort((a, b) => a.distanceToLiq - b.distanceToLiq);
	}
}

// ============================================================================
// Hyperliquid Agent
// ============================================================================

export class HyperliquidAgent extends BaseAgent {
	private client: HyperliquidClient;
	private whaleTracker: WhaleTracker;
	private hlConfig: HyperliquidConfig;
	private marketDataCache: Map<string, MarketData> = new Map();
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: Reserved for liquidation tracking
	private _liquidationHistory: LiquidationData[] = [];

	constructor(config: Partial<HyperliquidConfig> = {}) {
		const fullConfig: HyperliquidConfig = {
			name: "HyperliquidAgent",
			enabled: true,
			interval: 60000, // 1 minute
			symbols: ["BTC", "ETH", "SOL"],
			thresholds: {},
			// Hyperliquid specific
			apiUrl: "https://api.hyperliquid.xyz",
			defaultLeverage: 3,
			maxPositionSize: 1000,
			minOrderSize: 10,
			maxDrawdown: 0.1, // 10%
			stopLossPercent: 0.02, // 2%
			takeProfitPercent: 0.04, // 4%
			spreadBps: 10, // 0.1%
			orderRefreshMs: 5000,
			minWhaleSize: 100000,
			whaleTrackingEnabled: true,
			...config,
		};
		super(fullConfig);
		this.hlConfig = fullConfig;

		this.client = new HyperliquidClient(this.hlConfig.apiUrl, this.hlConfig.walletAddress);

		this.whaleTracker = new WhaleTracker(process.env.DUNE_KEY);
	}

	/**
	 * Main agent loop - updates market data and generates signals
	 */
	protected async run(): Promise<void> {
		// Update market data
		await this.updateMarketData();

		// Update whale positions
		await this.updateWhalePositions();

		// Generate liquidation arbitrage signals
		const liqSignals = this.analyzeLiquidationOpportunities();
		for (const signal of liqSignals) {
			await this.emitSignal(signal);
		}

		// Generate funding rate signals
		const fundingSignals = this.analyzeFundingOpportunities();
		for (const signal of fundingSignals) {
			await this.emitSignal(signal);
		}
	}

	// ========================================================================
	// Market Data
	// ========================================================================

	/**
	 * Update market data for all symbols
	 */
	async updateMarketData(): Promise<void> {
		for (const symbol of this.config.symbols) {
			const data = await this.client.getMarketData(symbol);
			if (data) {
				this.marketDataCache.set(symbol, data);
			}
		}
	}

	/**
	 * Get cached market data
	 */
	getMarketData(symbol: string): MarketData | undefined {
		return this.marketDataCache.get(symbol);
	}

	/**
	 * Get all market data
	 */
	getAllMarketData(): MarketData[] {
		return Array.from(this.marketDataCache.values());
	}

	// ========================================================================
	// Position Management
	// ========================================================================

	/**
	 * Get current positions
	 */
	async getPositions(): Promise<HyperliquidPosition[]> {
		return this.client.getPositions();
	}

	/**
	 * Get account balance
	 */
	async getBalance(): Promise<{ equity: number; available: number } | null> {
		return this.client.getBalance();
	}

	/**
	 * Calculate position size based on risk
	 */
	calculatePositionSize(_symbol: string, stopLossPercent: number): number {
		const balance = 1000; // Would get from getBalance()
		const riskAmount = balance * 0.01; // 1% risk per trade
		const positionSize = riskAmount / stopLossPercent;

		return Math.min(positionSize, this.hlConfig.maxPositionSize);
	}

	// ========================================================================
	// Whale Tracking
	// ========================================================================

	/**
	 * Update whale positions
	 */
	async updateWhalePositions(): Promise<void> {
		if (!this.hlConfig.whaleTrackingEnabled) return;

		await this.whaleTracker.fetchWhalePositions(this.hlConfig.minWhaleSize);
	}

	/**
	 * Get whale positions for symbol
	 */
	getWhalePositions(symbol: string): WhalePosition[] {
		return this.whaleTracker.getPositionsForSymbol(symbol);
	}

	/**
	 * Get positions close to liquidation
	 */
	getCloseToLiquidation(maxDistancePercent = 5): WhalePosition[] {
		return this.whaleTracker.findCloseToLiquidation(maxDistancePercent);
	}

	// ========================================================================
	// Signal Generation
	// ========================================================================

	/**
	 * Analyze for liquidation-based signals
	 */
	analyzeLiquidationOpportunities(): TradeSignal[] {
		const signals: TradeSignal[] = [];
		const closeToLiq = this.getCloseToLiquidation(3); // Within 3%

		for (const whale of closeToLiq) {
			const marketData = this.getMarketData(whale.symbol);
			if (!marketData) continue;

			// If large short is close to liquidation, potential squeeze
			if (whale.side === "short" && whale.size > this.hlConfig.minWhaleSize) {
				signals.push({
					symbol: whale.symbol,
					action: "BUY",
					confidence: 0.7,
					price: marketData.markPrice,
					timestamp: Date.now(),
					source: "HyperliquidAgent",
					reason: `Large short ($${(whale.size / 1000).toFixed(0)}k) ${whale.distanceToLiq.toFixed(1)}% from liquidation - potential squeeze`,
					metadata: {
						whaleAddress: whale.address,
						whaleSize: whale.size,
						distanceToLiq: whale.distanceToLiq,
						liquidationPrice: whale.liquidationPrice,
					},
				});
			}

			// If large long is close to liquidation, potential cascade
			if (whale.side === "long" && whale.size > this.hlConfig.minWhaleSize) {
				signals.push({
					symbol: whale.symbol,
					action: "SELL",
					confidence: 0.65,
					price: marketData.markPrice,
					timestamp: Date.now(),
					source: "HyperliquidAgent",
					reason: `Large long ($${(whale.size / 1000).toFixed(0)}k) ${whale.distanceToLiq.toFixed(1)}% from liquidation - potential cascade`,
					metadata: {
						whaleAddress: whale.address,
						whaleSize: whale.size,
						distanceToLiq: whale.distanceToLiq,
						liquidationPrice: whale.liquidationPrice,
					},
				});
			}
		}

		return signals;
	}

	/**
	 * Analyze funding rate opportunities
	 */
	analyzeFundingOpportunities(): TradeSignal[] {
		const signals: TradeSignal[] = [];

		for (const data of this.getAllMarketData()) {
			// Extreme positive funding = short opportunity
			if (data.fundingRate > 0.001) {
				// > 0.1%
				signals.push({
					symbol: data.symbol,
					action: "SELL",
					confidence: 0.6,
					price: data.markPrice,
					timestamp: Date.now(),
					source: "HyperliquidAgent",
					reason: `High funding rate ${(data.fundingRate * 100).toFixed(3)}% - short opportunity`,
					metadata: {
						fundingRate: data.fundingRate,
						nextFunding: data.nextFundingTime,
					},
				});
			}

			// Extreme negative funding = long opportunity
			if (data.fundingRate < -0.001) {
				signals.push({
					symbol: data.symbol,
					action: "BUY",
					confidence: 0.6,
					price: data.markPrice,
					timestamp: Date.now(),
					source: "HyperliquidAgent",
					reason: `Negative funding rate ${(data.fundingRate * 100).toFixed(3)}% - long opportunity`,
					metadata: {
						fundingRate: data.fundingRate,
						nextFunding: data.nextFundingTime,
					},
				});
			}
		}

		return signals;
	}

	// ========================================================================
	// BaseAgent Implementation
	// ========================================================================

	async analyze(): Promise<TradeSignal[]> {
		// Update market data
		await this.updateMarketData();

		// Update whale positions
		await this.updateWhalePositions();

		// Collect signals from different strategies
		const signals: TradeSignal[] = [...this.analyzeLiquidationOpportunities(), ...this.analyzeFundingOpportunities()];

		// Sort by confidence
		return signals.sort((a, b) => b.confidence - a.confidence);
	}

	// ========================================================================
	// Stats & Reporting
	// ========================================================================

	getStats(): {
		markets: number;
		whalePositions: number;
		closeToLiq: number;
		avgFundingRate: number;
	} {
		const marketData = this.getAllMarketData();
		const closeToLiq = this.getCloseToLiquidation(5);

		let totalFunding = 0;
		for (const m of marketData) {
			totalFunding += m.fundingRate;
		}

		return {
			markets: marketData.length,
			whalePositions: Array.from(this.whaleTracker.getPositionsForSymbol("BTC")).length,
			closeToLiq: closeToLiq.length,
			avgFundingRate: marketData.length > 0 ? totalFunding / marketData.length : 0,
		};
	}

	getFormattedStats(): string {
		const stats = this.getStats();
		const marketData = this.getAllMarketData();

		const marketLines = marketData.slice(0, 5).map((m) => {
			const fundingStr =
				m.fundingRate >= 0 ? `+${(m.fundingRate * 100).toFixed(4)}%` : `${(m.fundingRate * 100).toFixed(4)}%`;
			return `${m.symbol}: $${m.markPrice.toFixed(2)} | Funding: ${fundingStr}`;
		});

		return [
			"**Hyperliquid Agent Stats**",
			"",
			"**Market Data**",
			`Tracking: ${stats.markets} markets`,
			...marketLines,
			"",
			"**Whale Tracking**",
			`Positions monitored: ${stats.whalePositions}`,
			`Close to liquidation (<5%): ${stats.closeToLiq}`,
			"",
			"**Configuration**",
			`Max Position: $${this.hlConfig.maxPositionSize}`,
			`Default Leverage: ${this.hlConfig.defaultLeverage}x`,
			`Stop Loss: ${this.hlConfig.stopLossPercent * 100}%`,
			`Take Profit: ${this.hlConfig.takeProfitPercent * 100}%`,
		].join("\n");
	}
}
