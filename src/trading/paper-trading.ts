/**
 * Paper Trading Service
 * Simulated trading with real market data for strategy validation
 *
 * Supported Platforms:
 * - Alpaca (stocks/crypto paper trading)
 * - Binance Testnet (crypto paper trading)
 * - Internal simulation (no API required)
 */

// ============================================================================
// Types
// ============================================================================

/** Alpaca API position response */
interface AlpacaPosition {
	symbol: string;
	qty: string;
	avg_entry_price: string;
	current_price: string;
	unrealized_pl: string;
	unrealized_plpc: string;
}

/** Alpaca API activity response */
interface AlpacaActivity {
	id: string;
	symbol: string;
	side: "buy" | "sell";
	qty: string;
	price: string;
	transaction_time: string;
}

/** Alpaca API account response */
interface AlpacaAccount {
	cash: string;
	equity: string;
	last_equity: string;
	initial_margin?: string;
}

/** Alpaca API order response */
interface AlpacaOrder {
	id: string;
	symbol: string;
	side: "buy" | "sell";
	type: "market" | "limit" | "stop";
	qty: string;
	limit_price?: string;
	status: string;
	filled_avg_price?: string;
	filled_at?: string;
	created_at: string;
}

/** Binance API balance item */
interface BinanceBalance {
	asset: string;
	free: string;
	locked: string;
}

/** Binance API account response */
interface BinanceAccount {
	balances: BinanceBalance[];
}

/** Binance API order response */
interface BinanceOrder {
	orderId: number;
	symbol: string;
	origQty: string;
	price?: string;
	status: string;
	avgPrice?: string;
	transactTime: number;
}

export interface PaperPosition {
	symbol: string;
	side: "long" | "short";
	quantity: number;
	entryPrice: number;
	entryTime: number;
	currentPrice: number;
	unrealizedPnL: number;
	unrealizedPnLPercent: number;
}

export interface PaperOrder {
	id: string;
	symbol: string;
	side: "buy" | "sell";
	type: "market" | "limit" | "stop";
	quantity: number;
	price?: number; // For limit/stop orders
	status: "pending" | "filled" | "cancelled" | "rejected";
	filledPrice?: number;
	filledAt?: number;
	createdAt: number;
	source: string; // Which agent triggered this
}

export interface PaperTrade {
	id: string;
	symbol: string;
	side: "buy" | "sell";
	quantity: number;
	entryPrice: number;
	exitPrice: number;
	entryTime: number;
	exitTime: number;
	pnL: number;
	pnLPercent: number;
	source: string;
	reason: string;
}

export interface PaperPortfolio {
	cash: number;
	equity: number;
	positions: PaperPosition[];
	dayPnL: number;
	totalPnL: number;
	winRate: number;
	trades: number;
}

export interface PaperTradingConfig {
	provider: "alpaca" | "binance" | "simulation";
	initialCapital: number;
	maxPositionSize: number; // Max % of portfolio per position
	maxDrawdown: number; // Stop trading if hit
	riskPerTrade: number; // % risk per trade
}

// ============================================================================
// Price Feed (Real-time market data)
// ============================================================================

class PriceFeed {
	private prices: Map<string, number> = new Map();
	private lastUpdate: Map<string, number> = new Map();
	private readonly CACHE_TTL = 10000; // 10 seconds

	async getPrice(symbol: string): Promise<number> {
		const cached = this.prices.get(symbol);
		const lastUpdate = this.lastUpdate.get(symbol) || 0;

		if (cached && Date.now() - lastUpdate < this.CACHE_TTL) {
			return cached;
		}

		// Fetch from CoinGecko (free, no API key)
		try {
			const coinId = this.symbolToCoinId(symbol);
			const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`);

			if (response.ok) {
				const data = await response.json();
				const price = data[coinId]?.usd;
				if (price) {
					this.prices.set(symbol, price);
					this.lastUpdate.set(symbol, Date.now());
					return price;
				}
			}
		} catch {
			// Fallback to cached or estimate
		}

		// Fallback: use cached or return 0
		return cached || 0;
	}

	private symbolToCoinId(symbol: string): string {
		const map: Record<string, string> = {
			BTC: "bitcoin",
			ETH: "ethereum",
			SOL: "solana",
			DOGE: "dogecoin",
			XRP: "ripple",
			ADA: "cardano",
			AVAX: "avalanche-2",
			DOT: "polkadot",
			MATIC: "matic-network",
			LINK: "chainlink",
		};
		return map[symbol.toUpperCase()] || symbol.toLowerCase();
	}

	async getPrices(symbols: string[]): Promise<Map<string, number>> {
		const results = new Map<string, number>();
		await Promise.all(
			symbols.map(async (symbol) => {
				const price = await this.getPrice(symbol);
				results.set(symbol, price);
			}),
		);
		return results;
	}
}

// ============================================================================
// Alpaca Paper Trading
// ============================================================================

class AlpacaPaperTrading {
	private readonly baseUrl = "https://paper-api.alpaca.markets";
	private readonly apiKey: string;
	private readonly apiSecret: string;

	constructor() {
		this.apiKey = process.env.ALPACA_API_KEY || "";
		this.apiSecret = process.env.ALPACA_API_SECRET || "";
	}

	isConfigured(): boolean {
		return !!(this.apiKey && this.apiSecret);
	}

	private async request<T>(endpoint: string, method = "GET", body?: object): Promise<T> {
		const response = await fetch(`${this.baseUrl}${endpoint}`, {
			method,
			headers: {
				"APCA-API-KEY-ID": this.apiKey,
				"APCA-API-SECRET-KEY": this.apiSecret,
				"Content-Type": "application/json",
			},
			body: body ? JSON.stringify(body) : undefined,
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Alpaca API error: ${response.status} - ${error}`);
		}

		return response.json() as Promise<T>;
	}

	async getAccount(): Promise<PaperPortfolio> {
		const account = await this.request<AlpacaAccount>("/v2/account");
		const positions = await this.getPositions();

		return {
			cash: parseFloat(account.cash),
			equity: parseFloat(account.equity),
			positions,
			dayPnL: parseFloat(account.equity) - parseFloat(account.last_equity),
			totalPnL: parseFloat(account.equity) - parseFloat(account.initial_margin || "0"),
			winRate: 0, // Calculated from trade history
			trades: 0,
		};
	}

	async getPositions(): Promise<PaperPosition[]> {
		const positions = await this.request<AlpacaPosition[]>("/v2/positions");
		return positions.map((p) => ({
			symbol: p.symbol,
			side: parseFloat(p.qty) > 0 ? ("long" as const) : ("short" as const),
			quantity: Math.abs(parseFloat(p.qty)),
			entryPrice: parseFloat(p.avg_entry_price),
			entryTime: Date.now(), // Alpaca doesn't provide this directly
			currentPrice: parseFloat(p.current_price),
			unrealizedPnL: parseFloat(p.unrealized_pl),
			unrealizedPnLPercent: parseFloat(p.unrealized_plpc) * 100,
		}));
	}

	async placeOrder(
		symbol: string,
		side: "buy" | "sell",
		quantity: number,
		type: "market" | "limit" = "market",
		price?: number,
	): Promise<PaperOrder> {
		const order = await this.request<AlpacaOrder>("/v2/orders", "POST", {
			symbol,
			qty: quantity.toString(),
			side,
			type,
			time_in_force: "gtc",
			limit_price: price?.toString(),
		});

		return {
			id: order.id,
			symbol: order.symbol,
			side: order.side,
			type: order.type,
			quantity: parseFloat(order.qty),
			price: order.limit_price ? parseFloat(order.limit_price) : undefined,
			status: order.status === "filled" ? "filled" : "pending",
			filledPrice: order.filled_avg_price ? parseFloat(order.filled_avg_price) : undefined,
			filledAt: order.filled_at ? new Date(order.filled_at).getTime() : undefined,
			createdAt: new Date(order.created_at).getTime(),
			source: "alpaca",
		};
	}

	async cancelOrder(orderId: string): Promise<void> {
		await this.request<void>(`/v2/orders/${orderId}`, "DELETE");
	}

	async getTradeHistory(limit = 50): Promise<PaperTrade[]> {
		const activities = await this.request<AlpacaActivity[]>(`/v2/account/activities/FILL?page_size=${limit}`);
		// Convert to PaperTrade format (simplified)
		return activities.map((a) => ({
			id: a.id,
			symbol: a.symbol,
			side: a.side,
			quantity: parseFloat(a.qty),
			entryPrice: parseFloat(a.price),
			exitPrice: parseFloat(a.price),
			entryTime: new Date(a.transaction_time).getTime(),
			exitTime: new Date(a.transaction_time).getTime(),
			pnL: 0,
			pnLPercent: 0,
			source: "alpaca",
			reason: "",
		}));
	}
}

// ============================================================================
// Binance Testnet Paper Trading
// ============================================================================

class BinanceTestnetTrading {
	private readonly baseUrl = "https://testnet.binance.vision";
	private readonly apiKey: string;
	private readonly apiSecret: string;

	constructor() {
		this.apiKey = process.env.BINANCE_TESTNET_API_KEY || "";
		this.apiSecret = process.env.BINANCE_TESTNET_API_SECRET || "";
	}

	isConfigured(): boolean {
		return !!(this.apiKey && this.apiSecret);
	}

	private async request<T>(endpoint: string, method = "GET", params: Record<string, string> = {}): Promise<T> {
		const timestamp = Date.now().toString();
		const queryParams = new URLSearchParams({
			...params,
			timestamp,
		});

		// Sign the request
		const crypto = await import("crypto");
		const signature = crypto.createHmac("sha256", this.apiSecret).update(queryParams.toString()).digest("hex");

		queryParams.append("signature", signature);

		const url = `${this.baseUrl}${endpoint}?${queryParams.toString()}`;
		const response = await fetch(url, {
			method,
			headers: {
				"X-MBX-APIKEY": this.apiKey,
			},
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Binance API error: ${response.status} - ${error}`);
		}

		return response.json() as Promise<T>;
	}

	async getAccount(): Promise<PaperPortfolio> {
		const account = await this.request<BinanceAccount>("/api/v3/account");
		const balances = account.balances.filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);

		// Calculate USDT equivalent
		let totalEquity = 0;
		for (const balance of balances) {
			if (balance.asset === "USDT") {
				totalEquity += parseFloat(balance.free) + parseFloat(balance.locked);
			}
			// Add other asset valuations if needed
		}

		return {
			cash: totalEquity,
			equity: totalEquity,
			positions: [], // Need to fetch open orders
			dayPnL: 0,
			totalPnL: 0,
			winRate: 0,
			trades: 0,
		};
	}

	async placeOrder(
		symbol: string,
		side: "buy" | "sell",
		quantity: number,
		type: "market" | "limit" = "market",
		price?: number,
	): Promise<PaperOrder> {
		const params: Record<string, string> = {
			symbol: `${symbol}USDT`,
			side: side.toUpperCase(),
			type: type.toUpperCase(),
			quantity: quantity.toString(),
		};

		if (type === "limit" && price) {
			params.price = price.toString();
			params.timeInForce = "GTC";
		}

		const order = await this.request<BinanceOrder>("/api/v3/order", "POST", params);

		return {
			id: order.orderId.toString(),
			symbol,
			side,
			type,
			quantity: parseFloat(order.origQty),
			price: order.price ? parseFloat(order.price) : undefined,
			status: order.status === "FILLED" ? "filled" : "pending",
			filledPrice: order.avgPrice ? parseFloat(order.avgPrice) : undefined,
			filledAt: order.transactTime,
			createdAt: order.transactTime,
			source: "binance-testnet",
		};
	}
}

// ============================================================================
// Internal Simulation (No API required)
// ============================================================================

class SimulationTrading {
	private portfolio: PaperPortfolio;
	private orders: PaperOrder[] = [];
	private trades: PaperTrade[] = [];
	private priceFeed: PriceFeed;
	private orderIdCounter = 0;

	constructor(initialCapital = 10000) {
		this.priceFeed = new PriceFeed();
		this.portfolio = {
			cash: initialCapital,
			equity: initialCapital,
			positions: [],
			dayPnL: 0,
			totalPnL: 0,
			winRate: 0,
			trades: 0,
		};
	}

	async getAccount(): Promise<PaperPortfolio> {
		// Update positions with current prices
		for (const position of this.portfolio.positions) {
			position.currentPrice = await this.priceFeed.getPrice(position.symbol);
			position.unrealizedPnL =
				(position.currentPrice - position.entryPrice) * position.quantity * (position.side === "long" ? 1 : -1);
			position.unrealizedPnLPercent = (position.unrealizedPnL / (position.entryPrice * position.quantity)) * 100;
		}

		// Recalculate equity
		const positionsValue = this.portfolio.positions.reduce((sum, p) => sum + p.currentPrice * p.quantity, 0);
		this.portfolio.equity = this.portfolio.cash + positionsValue;

		// Calculate win rate
		const wins = this.trades.filter((t) => t.pnL > 0).length;
		this.portfolio.winRate = this.trades.length > 0 ? (wins / this.trades.length) * 100 : 0;
		this.portfolio.trades = this.trades.length;

		return { ...this.portfolio };
	}

	async placeOrder(
		symbol: string,
		side: "buy" | "sell",
		quantity: number,
		type: "market" | "limit" = "market",
		price?: number,
		source = "manual",
		reason = "",
	): Promise<PaperOrder> {
		const currentPrice = await this.priceFeed.getPrice(symbol);
		const fillPrice = type === "market" ? currentPrice : price || currentPrice;

		// Check if we have enough cash for buy orders
		if (side === "buy") {
			const cost = fillPrice * quantity;
			if (cost > this.portfolio.cash) {
				return {
					id: `sim-${++this.orderIdCounter}`,
					symbol,
					side,
					type,
					quantity,
					price,
					status: "rejected",
					createdAt: Date.now(),
					source,
				};
			}
		}

		// Check if we have the position for sell orders
		if (side === "sell") {
			const position = this.portfolio.positions.find((p) => p.symbol === symbol && p.side === "long");
			if (!position || position.quantity < quantity) {
				return {
					id: `sim-${++this.orderIdCounter}`,
					symbol,
					side,
					type,
					quantity,
					price,
					status: "rejected",
					createdAt: Date.now(),
					source,
				};
			}
		}

		const order: PaperOrder = {
			id: `sim-${++this.orderIdCounter}`,
			symbol,
			side,
			type,
			quantity,
			price,
			status: "filled",
			filledPrice: fillPrice,
			filledAt: Date.now(),
			createdAt: Date.now(),
			source,
		};

		// Execute the trade
		if (side === "buy") {
			// Deduct cash
			this.portfolio.cash -= fillPrice * quantity;

			// Add or update position
			const existingPosition = this.portfolio.positions.find((p) => p.symbol === symbol && p.side === "long");
			if (existingPosition) {
				// Average down/up
				const totalQuantity = existingPosition.quantity + quantity;
				existingPosition.entryPrice =
					(existingPosition.entryPrice * existingPosition.quantity + fillPrice * quantity) / totalQuantity;
				existingPosition.quantity = totalQuantity;
			} else {
				this.portfolio.positions.push({
					symbol,
					side: "long",
					quantity,
					entryPrice: fillPrice,
					entryTime: Date.now(),
					currentPrice: fillPrice,
					unrealizedPnL: 0,
					unrealizedPnLPercent: 0,
				});
			}
		} else {
			// Sell
			const position = this.portfolio.positions.find((p) => p.symbol === symbol && p.side === "long");
			if (position) {
				// Calculate P&L
				const pnL = (fillPrice - position.entryPrice) * quantity;
				const pnLPercent = ((fillPrice - position.entryPrice) / position.entryPrice) * 100;

				// Record trade
				this.trades.push({
					id: `trade-${this.trades.length + 1}`,
					symbol,
					side: "sell",
					quantity,
					entryPrice: position.entryPrice,
					exitPrice: fillPrice,
					entryTime: position.entryTime,
					exitTime: Date.now(),
					pnL,
					pnLPercent,
					source,
					reason,
				});

				// Update portfolio
				this.portfolio.cash += fillPrice * quantity;
				this.portfolio.totalPnL += pnL;
				this.portfolio.dayPnL += pnL;

				// Update position
				position.quantity -= quantity;
				if (position.quantity <= 0) {
					this.portfolio.positions = this.portfolio.positions.filter((p) => p !== position);
				}
			}
		}

		this.orders.push(order);
		return order;
	}

	async getPositions(): Promise<PaperPosition[]> {
		return this.portfolio.positions;
	}

	async getTradeHistory(limit = 50): Promise<PaperTrade[]> {
		return this.trades.slice(-limit);
	}

	async getOrders(limit = 50): Promise<PaperOrder[]> {
		return this.orders.slice(-limit);
	}

	reset(initialCapital = 10000): void {
		this.portfolio = {
			cash: initialCapital,
			equity: initialCapital,
			positions: [],
			dayPnL: 0,
			totalPnL: 0,
			winRate: 0,
			trades: 0,
		};
		this.orders = [];
		this.trades = [];
	}
}

// ============================================================================
// Paper Trading Service (Unified Interface)
// ============================================================================

export class PaperTradingService {
	private config: PaperTradingConfig;
	private alpaca: AlpacaPaperTrading;
	private binance: BinanceTestnetTrading;
	private simulation: SimulationTrading;
	private activeProvider: "alpaca" | "binance" | "simulation";

	constructor(config: Partial<PaperTradingConfig> = {}) {
		this.config = {
			provider: "simulation",
			initialCapital: 10000,
			maxPositionSize: 0.1, // 10% max per position
			maxDrawdown: 0.2, // 20% max drawdown
			riskPerTrade: 0.02, // 2% risk per trade
			...config,
		};

		this.alpaca = new AlpacaPaperTrading();
		this.binance = new BinanceTestnetTrading();
		this.simulation = new SimulationTrading(this.config.initialCapital);

		// Auto-select provider based on available credentials
		if (this.config.provider === "alpaca" && this.alpaca.isConfigured()) {
			this.activeProvider = "alpaca";
		} else if (this.config.provider === "binance" && this.binance.isConfigured()) {
			this.activeProvider = "binance";
		} else {
			this.activeProvider = "simulation";
		}
	}

	getActiveProvider(): string {
		return this.activeProvider;
	}

	async getPortfolio(): Promise<PaperPortfolio> {
		switch (this.activeProvider) {
			case "alpaca":
				return this.alpaca.getAccount();
			case "binance":
				return this.binance.getAccount();
			default:
				return this.simulation.getAccount();
		}
	}

	async placeOrder(
		symbol: string,
		side: "buy" | "sell",
		quantity: number,
		type: "market" | "limit" = "market",
		price?: number,
		source = "manual",
		reason = "",
	): Promise<PaperOrder> {
		// Risk management checks
		const portfolio = await this.getPortfolio();
		const positionValue = (await this.getCurrentPrice(symbol)) * quantity;

		// Check max position size
		if (positionValue > portfolio.equity * this.config.maxPositionSize) {
			return {
				id: `rejected-${Date.now()}`,
				symbol,
				side,
				type,
				quantity,
				price,
				status: "rejected",
				createdAt: Date.now(),
				source,
			};
		}

		// Check drawdown
		const drawdown = (this.config.initialCapital - portfolio.equity) / this.config.initialCapital;
		if (drawdown >= this.config.maxDrawdown) {
			console.warn(`[PaperTrading] Max drawdown reached (${(drawdown * 100).toFixed(1)}%). Trading paused.`);
			return {
				id: `rejected-${Date.now()}`,
				symbol,
				side,
				type,
				quantity,
				price,
				status: "rejected",
				createdAt: Date.now(),
				source,
			};
		}

		switch (this.activeProvider) {
			case "alpaca":
				return this.alpaca.placeOrder(symbol, side, quantity, type, price);
			case "binance":
				return this.binance.placeOrder(symbol, side, quantity, type, price);
			default:
				return this.simulation.placeOrder(symbol, side, quantity, type, price, source, reason);
		}
	}

	async getCurrentPrice(symbol: string): Promise<number> {
		const priceFeed = new PriceFeed();
		return priceFeed.getPrice(symbol);
	}

	async getPositions(): Promise<PaperPosition[]> {
		switch (this.activeProvider) {
			case "alpaca":
				return this.alpaca.getPositions();
			default:
				return this.simulation.getPositions();
		}
	}

	async getTradeHistory(limit = 50): Promise<PaperTrade[]> {
		switch (this.activeProvider) {
			case "alpaca":
				return this.alpaca.getTradeHistory(limit);
			default:
				return this.simulation.getTradeHistory(limit);
		}
	}

	async executeSignal(
		symbol: string,
		action: "BUY" | "SELL",
		confidence: number,
		source: string,
		reason: string,
	): Promise<PaperOrder | null> {
		// Only execute high-confidence signals
		if (confidence < 0.6) {
			return null;
		}

		const portfolio = await this.getPortfolio();
		const price = await this.getCurrentPrice(symbol);

		if (action === "BUY") {
			// Calculate position size based on risk
			const riskAmount = portfolio.equity * this.config.riskPerTrade;
			const quantity = riskAmount / price;

			if (quantity > 0) {
				return this.placeOrder(symbol, "buy", quantity, "market", undefined, source, reason);
			}
		} else {
			// Sell existing position
			const positions = await this.getPositions();
			const position = positions.find((p) => p.symbol === symbol);

			if (position && position.quantity > 0) {
				return this.placeOrder(symbol, "sell", position.quantity, "market", undefined, source, reason);
			}
		}

		return null;
	}

	reset(): void {
		if (this.activeProvider === "simulation") {
			this.simulation.reset(this.config.initialCapital);
		}
	}

	async getFormattedStats(): Promise<string> {
		const portfolio = await this.getPortfolio();
		const trades = await this.getTradeHistory(100);
		const wins = trades.filter((t) => t.pnL > 0);
		const losses = trades.filter((t) => t.pnL < 0);

		const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnLPercent, 0) / wins.length : 0;
		const avgLoss =
			losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnLPercent, 0) / losses.length) : 0;

		return [
			`**💼 Paper Trading Stats**`,
			`Provider: ${this.activeProvider}`,
			``,
			`**Portfolio**`,
			`Cash: $${portfolio.cash.toFixed(2)}`,
			`Equity: $${portfolio.equity.toFixed(2)}`,
			`Positions: ${portfolio.positions.length}`,
			``,
			`**Performance**`,
			`Total P&L: $${portfolio.totalPnL.toFixed(2)} (${((portfolio.totalPnL / this.config.initialCapital) * 100).toFixed(1)}%)`,
			`Day P&L: $${portfolio.dayPnL.toFixed(2)}`,
			`Win Rate: ${portfolio.winRate.toFixed(1)}%`,
			`Trades: ${portfolio.trades}`,
			``,
			`**Risk Metrics**`,
			`Avg Win: ${avgWin.toFixed(2)}%`,
			`Avg Loss: ${avgLoss.toFixed(2)}%`,
			`Risk/Reward: ${avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : "N/A"}`,
			`Max Position: ${(this.config.maxPositionSize * 100).toFixed(0)}%`,
			`Max Drawdown: ${(this.config.maxDrawdown * 100).toFixed(0)}%`,
		].join("\n");
	}
}

// ============================================================================
// Singleton Export
// ============================================================================

let paperTradingInstance: PaperTradingService | null = null;

export function getPaperTrading(config?: Partial<PaperTradingConfig>): PaperTradingService {
	if (!paperTradingInstance) {
		paperTradingInstance = new PaperTradingService(config);
	}
	return paperTradingInstance;
}

export function resetPaperTrading(): void {
	paperTradingInstance = null;
}
