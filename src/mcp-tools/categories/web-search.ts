/**
 * Web Search & Research Tools
 * - Exa AI search and deep research
 * - DuckDuckGo free search
 * - Web scraping (BrightData + direct fetch)
 * - Web crawling with depth control
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import {
	createDeepResearchTool,
	createFreeWebSearchTool,
	createWebCrawlTool,
	createWebScrapeTool,
	createWebSearchTool,
} from "../../mcp-tools.js";

export function getAllWebSearchTools(): AgentTool<any>[] {
	return [
		createWebSearchTool(), // Exa AI search
		createDeepResearchTool(), // AI-powered research
		createWebScrapeTool(), // BrightData scraper
		createFreeWebSearchTool(), // DuckDuckGo (no key)
		createWebCrawlTool(), // Deep crawling
	];
}
