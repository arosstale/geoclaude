/**
 * Administration & Management Tools
 * - Multi-agent orchestration
 * - Context management
 * - Hooks system
 * - Plugins & slash commands
 * - Multi-server sync
 * - Backups
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import {
	createAgentDelegateTool,
	createAgentSpawnTool,
	createBackupTool,
	createContextCompactTool,
	createHookCreateTool,
	createHooksListTool,
	createPluginListTool,
	createPluginLoadTool,
	createServerListTool,
	createServerSyncTool,
	createSlashCommandCreateTool,
	createSlashCommandListTool,
} from "../../mcp-tools.js";

export function getAllAdminTools(): AgentTool<any>[] {
	return [
		createAgentSpawnTool(), // Spawn sub-agent
		createAgentDelegateTool(), // Delegate task
		createContextCompactTool(), // Compact context
		createHooksListTool(), // List hooks
		createHookCreateTool(), // Create hook
		createPluginLoadTool(), // Load plugin
		createPluginListTool(), // List plugins
		createSlashCommandCreateTool(), // Create slash command
		createSlashCommandListTool(), // List slash commands
		createServerSyncTool(), // Sync across servers
		createServerListTool(), // List servers
		createBackupTool(), // Backup data
	];
}
