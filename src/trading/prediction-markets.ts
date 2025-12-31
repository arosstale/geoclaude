/**
 * Prediction Markets Integration
 * Connects beyondmcp prediction markets system to Discord bot
 *
 * Uses the CLI tool from:
 * /home/majinbu/organized/active-projects/ai-tools/ai/nano-agent/beyond-mcp-prediction-markets/2_cli
 */

import { execSync } from "child_process";
import { existsSync } from "fs";

const BEYONDMCP_PATH = "/home/majinbu/organized/active-projects/ai-tools/ai/nano-agent/beyond-mcp-prediction-markets";
const CLI_PATH = `${BEYONDMCP_PATH}/2_cli/cli.py`;

export interface PredictionMarket {
	platform: string;
	question: string;
	price: number;
	volume: string;
	active: boolean;
}

export interface TradingSignal {
	market: string;
	recommendation: "BUY_YES" | "BUY_NO" | "HOLD";
	expectedValue: number;
	confidence: number;
	suggestedPosition: number;
	rationale: string;
}

/**
 * Check if beyondmcp system is available
 */
export function isPredictionMarketsAvailable(): boolean {
	return existsSync(CLI_PATH);
}

/**
 * Search prediction markets
 */
export async function searchMarkets(query: string): Promise<PredictionMarket[]> {
	try {
		const output = execSync(`python3 ${CLI_PATH} search "${query}" --limit 20`, {
			cwd: `${BEYONDMCP_PATH}/2_cli`,
			timeout: 30000,
			encoding: "utf-8",
		});

		// Parse the JSON output
		const lines = output.split("\n").filter((l) => l.trim());
		const jsonLine = lines.find((l) => l.startsWith("["));
		if (jsonLine) {
			return JSON.parse(jsonLine);
		}

		// Fallback: parse table output (columns: platform question price volume active)
		const markets: PredictionMarket[] = [];
		const tableLines = lines.filter((l) => l.includes("Polymarket") || l.includes("Kalshi"));
		for (const line of tableLines) {
			// Parse from the end since question can contain spaces
			// Format: Platform Question... Price Volume Active
			const trimmed = line.trim();
			const activeMatch = trimmed.match(/\s+(True|False)\s*$/);
			const volumeMatch = trimmed.match(/(\$[\d,]+)\s+(?:True|False)\s*$/);
			const priceMatch = trimmed.match(/(\d+\.\d+)\s+\$[\d,]+\s+(?:True|False)\s*$/);

			if (priceMatch && volumeMatch && activeMatch) {
				const platform = trimmed.startsWith("Polymarket") ? "Polymarket" : "Kalshi";
				const questionEnd = trimmed.indexOf(priceMatch[1]) - 1;
				const questionStart = platform.length;
				const question = trimmed.substring(questionStart, questionEnd).trim();

				markets.push({
					platform,
					question,
					price: parseFloat(priceMatch[1]),
					volume: volumeMatch[1],
					active: activeMatch[1] === "True",
				});
			}
		}
		return markets;
	} catch (error) {
		console.error("[PREDICTION] Search error:", error);
		return [];
	}
}

/**
 * Get whale trades (large positions)
 */
export async function getWhaleTrades(minSize = 5000): Promise<string> {
	try {
		const output = execSync(`python3 ${CLI_PATH} sweeps --min-size ${minSize}`, {
			cwd: `${BEYONDMCP_PATH}/2_cli`,
			timeout: 30000,
			encoding: "utf-8",
		});
		return output;
	} catch {
		return "No whale trades found or API unavailable";
	}
}

/**
 * Generate trading signal for a market
 */
export async function generateSignal(market: string, trueProb: number, bankroll = 1000): Promise<TradingSignal | null> {
	try {
		const output = execSync(`python3 ${CLI_PATH} signal "${market}" --true-prob ${trueProb} --bankroll ${bankroll}`, {
			cwd: `${BEYONDMCP_PATH}/2_cli`,
			timeout: 30000,
			encoding: "utf-8",
		});

		// Parse signal output
		const lines = output.split("\n");
		let recommendation: "BUY_YES" | "BUY_NO" | "HOLD" = "HOLD";
		let expectedValue = 0;
		let confidence = 0;
		let suggestedPosition = 0;
		let rationale = "";

		for (const line of lines) {
			if (line.includes("BUY YES")) recommendation = "BUY_YES";
			else if (line.includes("BUY NO")) recommendation = "BUY_NO";
			else if (line.includes("HOLD")) recommendation = "HOLD";

			if (line.includes("Expected Value")) expectedValue = parseFloat(line.match(/[\d.]+/)?.[0] || "0");
			if (line.includes("Confidence")) confidence = parseFloat(line.match(/[\d.]+/)?.[0] || "0");
			if (line.includes("Position"))
				suggestedPosition = parseFloat(line.match(/\$[\d.]+/)?.[0]?.replace("$", "") || "0");
			if (line.includes("Rationale")) rationale = line.split(":")[1]?.trim() || "";
		}

		return {
			market,
			recommendation,
			expectedValue,
			confidence,
			suggestedPosition,
			rationale,
		};
	} catch {
		return null;
	}
}

/**
 * Calculate arbitrage opportunity between platforms
 */
export async function calculateArbitrage(
	polyYes: number,
	kalshiYes: number,
	amount = 1000,
): Promise<{ profit: number; roi: number; recommendation: string }> {
	try {
		const output = execSync(
			`python3 ${BEYONDMCP_PATH}/3_file_system_scripts/calculate_arbitrage.py --poly-yes ${polyYes} --kalshi-yes ${kalshiYes} --amount ${amount}`,
			{
				cwd: `${BEYONDMCP_PATH}/3_file_system_scripts`,
				timeout: 30000,
				encoding: "utf-8",
			},
		);

		// Parse output
		const profitMatch = output.match(/Net Profit: \$([\d.]+)/);
		const roiMatch = output.match(/ROI: ([\d.]+)%/);
		const hasExecute = output.includes("EXECUTE");

		return {
			profit: parseFloat(profitMatch?.[1] || "0"),
			roi: parseFloat(roiMatch?.[1] || "0"),
			recommendation: hasExecute ? "EXECUTE" : "SKIP",
		};
	} catch {
		return { profit: 0, roi: 0, recommendation: "ERROR" };
	}
}

/**
 * Get top trending prediction markets
 */
export async function getTrendingMarkets(limit = 10): Promise<PredictionMarket[]> {
	// Search for high-volume categories
	const categories = ["bitcoin", "trump", "election", "crypto"];
	const allMarkets: PredictionMarket[] = [];

	for (const cat of categories) {
		const markets = await searchMarkets(cat);
		allMarkets.push(...markets);
	}

	// Sort by volume and dedupe
	const seen = new Set<string>();
	return allMarkets
		.filter((m) => {
			if (seen.has(m.question)) return false;
			seen.add(m.question);
			return true;
		})
		.sort((a, b) => {
			const volA = parseInt(a.volume.replace(/[$,]/g, ""), 10) || 0;
			const volB = parseInt(b.volume.replace(/[$,]/g, ""), 10) || 0;
			return volB - volA;
		})
		.slice(0, limit);
}

// Export for Discord bot integration
export const predictionMarkets = {
	isAvailable: isPredictionMarketsAvailable,
	search: searchMarkets,
	getWhales: getWhaleTrades,
	generateSignal,
	calculateArbitrage,
	getTrending: getTrendingMarkets,
};
