/**
 * Utility Tools
 * - User preferences
 * - Conversation export
 * - Rich embeds
 * - Persona management
 * - Threading
 * - Auto-learning
 * - API usage tracking
 * - Workflow automation
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import {
	createApiUsageTool,
	createAutoLearnTool,
	createBatchGenerateTool,
	createConversationExportTool,
	createPersonaTool,
	createPresetChainTool,
	createRichEmbedTool,
	createThreadingTool,
	createUserPreferencesTool,
} from "../../mcp-tools.js";

export function getAllUtilityTools(): AgentTool<any>[] {
	return [
		createUserPreferencesTool(), // User prefs
		createConversationExportTool(), // Export conversations
		createRichEmbedTool(), // Rich Discord embeds
		createPersonaTool(), // Persona management
		createThreadingTool(), // Thread management
		createAutoLearnTool(), // Auto-learning
		createApiUsageTool(), // API usage stats
		createPresetChainTool(), // Workflow presets
		createBatchGenerateTool(), // Batch generation
	];
}
