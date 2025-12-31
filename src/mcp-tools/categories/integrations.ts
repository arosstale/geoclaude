/**
 * External Integration Tools
 * - HuggingFace (models, datasets, inference)
 * - Social media (Twitter, YouTube, Telegram)
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import {
	createHFInferenceTool,
	createHfDatasetSearchTool,
	createHfModelSearchTool,
	createTelegramBridgeTool,
	createTwitterPostTool,
	createYoutubeUploadTool,
} from "../../mcp-tools.js";

export function getAllIntegrationTools(): AgentTool<any>[] {
	return [
		// HuggingFace
		createHfModelSearchTool(), // Search models
		createHfDatasetSearchTool(), // Search datasets
		createHFInferenceTool(), // Run inference
		// Social Media
		createTwitterPostTool(), // Post to Twitter
		createYoutubeUploadTool(), // Upload to YouTube
		createTelegramBridgeTool(), // Telegram bridge
	];
}
