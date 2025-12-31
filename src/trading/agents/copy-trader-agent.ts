/**
 * Copy Trader Agent
 * Monitors successful traders/wallets and copies their trades
 * Inspired by Moon Dev's copy trading patterns
 *
 * Data sources:
 * - Whale Alert API
 * - Lookonchain data
 * - DEX analytics (Dune, Arkham)
 * - Social trading platforms
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, TradingAction } from "../types.js";

// ============================================================================
// Types
// ============================================================================

/** Exchange flow API response item */
interface ExchangeFlowItem {
	netflow: number;
	price?: number;
	createTime?: number;
}

interface TrackedWallet {
	address: string;
	label: string;
	source: "whale" | "fund" | "influencer" | "smart_money";
	successRate: number; // Historical success rate
	avgReturn: number; // Average return per trade
	tradeCount: number;
	lastActive: number;
	enabled: boolean;
}

interface WalletTrade {
	wallet: string;
	symbol: string;
	action: "buy" | "sell";
	amount: number;
	usdValue: number;
	timestamp: number;
	txHash?: string;
}

interface CopyTraderConfig extends AgentConfig {
	minSuccessRate: number; // Minimum success rate to copy
	minTradeValue: number; // Minimum USD value to trigger copy
	maxCopyPerHour: number; // Rate limit
	cooldownMs: number; // Time between copies from same wallet
}

// ============================================================================
// Known Smart Money Wallets (examples - add your own)
// ============================================================================

const KNOWN_WALLETS: TrackedWallet[] = [
	{
		address: "0x28c6c06298d514db089934071355e5743bf21d60", // Binance Hot Wallet (for reference)
		label: "Binance",
		source: "fund",
		successRate: 0,
		avgReturn: 0,
		tradeCount: 0,
		lastActive: 0,
		enabled: false, // Disabled - just for monitoring
	},
	// Add more wallets as you identify them
];

// ============================================================================
// Copy Trader Agent
// ============================================================================

export class CopyTraderAgent extends BaseAgent {
	private trackedWallets: Map<string, TrackedWallet> = new Map();
	private recentTrades: WalletTrade[] = [];
	private copiedTrades: Map<string, number> = new Map(); // wallet -> last copy timestamp
	private readonly MAX_TRADES = 200;

	constructor(config: Partial<CopyTraderConfig> = {}) {
		super({
			name: "CopyTraderAgent",
			enabled: true,
			interval: 120000, // 2 minutes
			symbols: ["BTC", "ETH", "SOL"],
			thresholds: {},
			minSuccessRate: 0.6, // 60% success rate minimum
			minTradeValue: 100000, // $100K minimum
			maxCopyPerHour: 5,
			cooldownMs: 3600000, // 1 hour between copies from same wallet
			...config,
		});

		// Initialize known wallets
		for (const wallet of KNOWN_WALLETS) {
			this.trackedWallets.set(wallet.address.toLowerCase(), wallet);
		}
	}

	protected async run(): Promise<void> {
		try {
			// Fetch recent trades from tracked wallets
			const trades = await this.fetchRecentTrades();

			// Analyze and potentially copy trades
			for (const trade of trades) {
				await this.analyzeTrade(trade);
			}
		} catch (error) {
			console.error("[CopyTraderAgent] Run error:", error);
		}
	}

	private async fetchRecentTrades(): Promise<WalletTrade[]> {
		const trades: WalletTrade[] = [];

		// Try multiple data sources
		try {
			// 1. Arkham Intelligence (if API key available)
			const arkhamTrades = await this.fetchFromArkham();
			trades.push(...arkhamTrades);
		} catch {
			// Silent fail - source not available
		}

		try {
			// 2. DeFiLlama API (free)
			const defiTrades = await this.fetchFromDeFiLlama();
			trades.push(...defiTrades);
		} catch {
			// Silent fail
		}

		try {
			// 3. CoinGlass for exchange flows
			const flowTrades = await this.fetchFromCoinGlass();
			trades.push(...flowTrades);
		} catch {
			// Silent fail
		}

		// Store trades
		this.recentTrades.push(...trades);
		while (this.recentTrades.length > this.MAX_TRADES) {
			this.recentTrades.shift();
		}

		return trades;
	}

	private async fetchFromArkham(): Promise<WalletTrade[]> {
		// Arkham Intelligence API requires API key
		// https://arkham.com/api-docs
		const apiKey = process.env.ARKHAM_API_KEY;
		if (!apiKey) return [];

		// Implementation would query Arkham's API for tracked wallet activity
		// For now, return empty - implement when API key available
		return [];
	}

	private async fetchFromDeFiLlama(): Promise<WalletTrade[]> {
		// DeFiLlama has free endpoints for whale tracking
		try {
			// Note: DeFiLlama whale API is limited
			// This is a placeholder for actual implementation
			return [];
		} catch {
			return [];
		}
	}

	private async fetchFromCoinGlass(): Promise<WalletTrade[]> {
		try {
			const response = await fetch(
				"https://open-api.coinglass.com/public/v2/indicator/exchange_netflow?symbol=BTC&interval=h1",
				{ headers: { accept: "application/json" } },
			);

			if (!response.ok) return [];

			const data = await response.json();
			if (!data.success || !data.data) return [];

			// Convert exchange flows to trade signals
			const flowItems = data.data as ExchangeFlowItem[];
			return flowItems
				.slice(0, 10)
				.filter((item) => Math.abs(item.netflow || 0) > 100) // Min 100 BTC
				.map((item) => ({
					wallet: "exchange_flow",
					symbol: "BTC",
					action: item.netflow > 0 ? ("buy" as const) : ("sell" as const),
					amount: Math.abs(item.netflow),
					usdValue: Math.abs(item.netflow) * (item.price || 100000),
					timestamp: item.createTime || Date.now(),
				}));
		} catch {
			return [];
		}
	}

	private async analyzeTrade(trade: WalletTrade): Promise<void> {
		const cfg = this.config as CopyTraderConfig;

		// Check minimum trade value
		if (trade.usdValue < cfg.minTradeValue) {
			return;
		}

		// Get wallet info
		const wallet = this.trackedWallets.get(trade.wallet.toLowerCase());

		// Check if wallet meets criteria
		if (wallet && !wallet.enabled) {
			return; // Wallet disabled
		}

		if (wallet && wallet.successRate < cfg.minSuccessRate) {
			return; // Below success threshold
		}

		// Check cooldown
		const lastCopy = this.copiedTrades.get(trade.wallet.toLowerCase()) || 0;
		if (Date.now() - lastCopy < cfg.cooldownMs) {
			return; // Still in cooldown
		}

		// Rate limit check
		const recentCopies = [...this.copiedTrades.values()].filter((t) => Date.now() - t < 3600000).length;
		if (recentCopies >= cfg.maxCopyPerHour) {
			return; // Rate limited
		}

		// Convert to our symbols
		const symbol = this.normalizeSymbol(trade.symbol);
		if (!(this.config.symbols as string[]).includes(symbol)) {
			return; // Not a tracked symbol
		}

		// Calculate confidence based on wallet reputation and trade size
		let confidence = 0.5;
		if (wallet) {
			confidence = wallet.successRate * 0.7 + Math.min(trade.usdValue / 10000000, 0.3);
		} else {
			// Unknown wallet - lower confidence
			confidence = 0.4 + Math.min(trade.usdValue / 50000000, 0.2);
		}

		// Emit copy signal
		const action: TradingAction = trade.action === "buy" ? "BUY" : "SELL";

		await this.emitSignal({
			symbol,
			action,
			confidence: Math.min(confidence, 0.85),
			price: 0,
			reason: `Copy Trade: ${wallet?.label || "Smart Money"} ${trade.action} $${this.formatNumber(trade.usdValue)}`,
			source: this.name,
			timestamp: trade.timestamp,
			metadata: {
				walletAddress: trade.wallet,
				walletLabel: wallet?.label || "Unknown",
				walletSource: wallet?.source || "unknown",
				tradeValue: trade.usdValue,
				successRate: wallet?.successRate || 0,
			},
		});

		// Record copy
		this.copiedTrades.set(trade.wallet.toLowerCase(), Date.now());
	}

	private normalizeSymbol(symbol: string): string {
		const upper = symbol.toUpperCase();
		const map: Record<string, string> = {
			BITCOIN: "BTC",
			WBTC: "BTC",
			ETHEREUM: "ETH",
			WETH: "ETH",
			SOLANA: "SOL",
			WSOL: "SOL",
		};
		return map[upper] || upper;
	}

	private formatNumber(num: number): string {
		if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
		if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
		if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
		return num.toFixed(2);
	}

	// ============================================================================
	// Public API
	// ============================================================================

	/**
	 * Add a wallet to track
	 */
	addWallet(wallet: TrackedWallet): void {
		this.trackedWallets.set(wallet.address.toLowerCase(), wallet);
	}

	/**
	 * Remove a wallet from tracking
	 */
	removeWallet(address: string): boolean {
		return this.trackedWallets.delete(address.toLowerCase());
	}

	/**
	 * Get all tracked wallets
	 */
	getTrackedWallets(): TrackedWallet[] {
		return [...this.trackedWallets.values()];
	}

	/**
	 * Get recent trades
	 */
	getRecentTrades(limit = 20): WalletTrade[] {
		return this.recentTrades.slice(-limit);
	}

	/**
	 * Update wallet success rate (call after trade outcome known)
	 */
	updateWalletStats(address: string, success: boolean, returnPct: number): void {
		const wallet = this.trackedWallets.get(address.toLowerCase());
		if (!wallet) return;

		wallet.tradeCount++;
		wallet.successRate = (wallet.successRate * (wallet.tradeCount - 1) + (success ? 1 : 0)) / wallet.tradeCount;
		wallet.avgReturn = (wallet.avgReturn * (wallet.tradeCount - 1) + returnPct) / wallet.tradeCount;
		wallet.lastActive = Date.now();
	}

	/**
	 * Get copy trading stats
	 */
	getStats(): {
		trackedWallets: number;
		enabledWallets: number;
		totalTrades: number;
		copiesMade: number;
		avgSuccessRate: number;
	} {
		const wallets = [...this.trackedWallets.values()];
		const enabledWallets = wallets.filter((w) => w.enabled);

		return {
			trackedWallets: wallets.length,
			enabledWallets: enabledWallets.length,
			totalTrades: this.recentTrades.length,
			copiesMade: this.copiedTrades.size,
			avgSuccessRate:
				enabledWallets.length > 0
					? enabledWallets.reduce((sum, w) => sum + w.successRate, 0) / enabledWallets.length
					: 0,
		};
	}
}

// ============================================================================
// Export
// ============================================================================

export type { TrackedWallet, WalletTrade, CopyTraderConfig };
