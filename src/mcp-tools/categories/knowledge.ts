/**
 * Knowledge & Codebase Tools
 * - Codebase analysis
 * - RAG search
 * - Skills system
 * - Pi-mono source access
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import {
	createCodebaseKnowledgeTool,
	createKnowledgeSearchTool,
	createPiMonoListTool,
	createPiMonoReadTool,
	createRAGSearchTool,
	createSkillCreateTool,
	createSkillListTool,
	createSkillLoadTool,
} from "../../mcp-tools.js";

export function getAllKnowledgeTools(): AgentTool<any>[] {
	return [
		createCodebaseKnowledgeTool(), // Analyze codebase
		createPiMonoReadTool(), // Read pi-mono files
		createPiMonoListTool(), // List pi-mono files
		createSkillListTool(), // List skills
		createSkillLoadTool(), // Load skill
		createSkillCreateTool(), // Create skill
		createKnowledgeSearchTool(), // Search knowledge base
		createRAGSearchTool(), // RAG semantic search
	];
}
