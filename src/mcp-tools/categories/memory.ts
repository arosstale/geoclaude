/**
 * Memory & Knowledge Graph Tools
 * - Entity storage and recall
 * - Relationship mapping
 * - Memory updates
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import {
	createMemoryRecallTool,
	createMemoryRelateTool,
	createMemoryStoreTool,
	createMemoryUpdateTool,
} from "../../mcp-tools.js";

export function getAllMemoryTools(): AgentTool<any>[] {
	return [
		createMemoryStoreTool(), // Store entities
		createMemoryRecallTool(), // Recall memories
		createMemoryRelateTool(), // Create relationships
		createMemoryUpdateTool(), // Update MEMORY.md
	];
}
