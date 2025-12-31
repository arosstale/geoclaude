/**
 * Task Management Tools
 * - Task creation and tracking
 * - Scheduled tasks with cron
 * - Creative scheduling
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import {
	createListScheduledTasksTool,
	createScheduleCreativeTool,
	createScheduleTaskTool,
	createTaskCreateTool,
	createTaskListTool,
	createTaskUpdateTool,
} from "../../mcp-tools.js";

export function getAllTaskTools(): AgentTool<any>[] {
	return [
		createTaskCreateTool(), // Create task
		createTaskListTool(), // List tasks
		createTaskUpdateTool(), // Update task
		createScheduleTaskTool(), // Schedule with cron
		createListScheduledTasksTool(), // List scheduled
		createScheduleCreativeTool(), // Schedule creative work
	];
}
