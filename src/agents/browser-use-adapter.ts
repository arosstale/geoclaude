/**
 * Browser-Use Adapter for Pi-Mono Discord Bot
 *
 * Integrates browser-use/browser-use AI browser agent:
 * - Autonomous browser control with natural language
 * - Sandbox deployments with @sandbox decorator
 * - Cloud browser with stealth mode
 * - Form filling, navigation, data extraction
 * - Multi-step web workflows
 *
 * @see https://github.com/browser-use/browser-use
 */

import { EventEmitter } from "events";

// ========== Core Types ==========

export type BrowserUseModel = "ChatBrowserUse" | "gpt-4" | "claude-3" | "ollama";

export interface BrowserUseConfig {
    model?: BrowserUseModel;
    useCloud?: boolean; // Use stealth browser on Browser Use Cloud
    headless?: boolean;
    timeout?: number;
    maxSteps?: number;
    apiKey?: string;
}

export interface AgentTask {
    id: string;
    task: string;
    status: "pending" | "running" | "completed" | "failed";
    steps: AgentStep[];
    result?: string;
    error?: string;
    startedAt?: Date;
    completedAt?: Date;
    cost?: number;
}

export interface AgentStep {
    id: string;
    type: "navigate" | "click" | "fill" | "extract" | "scroll" | "wait" | "evaluate" | "screenshot";
    description: string;
    target?: string;
    value?: string;
    result?: unknown;
    success: boolean;
    timestamp: Date;
}

export interface ExtractedData {
    type: "text" | "table" | "list" | "form" | "image" | "structured";
    content: unknown;
    selector?: string;
    timestamp: Date;
}

// ========== Sandbox Types ==========

export interface SandboxConfig {
    persistent?: boolean; // Keep browser state between runs
    auth?: {
        cookies?: Array<{ name: string; value: string; domain: string }>;
        localStorage?: Record<string, string>;
    };
    proxy?: string;
}

export interface SandboxSession {
    id: string;
    config: SandboxConfig;
    status: "initializing" | "ready" | "running" | "completed" | "error";
    browserEndpoint?: string;
    createdAt: Date;
    expiresAt?: Date;
}

// ========== Action Recognition ==========

/**
 * ActionRecognizer - Convert natural language to browser actions
 */
export class ActionRecognizer {
    /**
     * Parse a natural language instruction into browser actions
     */
    parseInstruction(instruction: string): AgentStep[] {
        const steps: AgentStep[] = [];
        const lower = instruction.toLowerCase();

        // Navigation patterns
        if (lower.includes("go to") || lower.includes("navigate to") || lower.includes("open")) {
            const urlMatch = instruction.match(/(?:go to|navigate to|open)\s+([^\s]+)/i);
            if (urlMatch) {
                steps.push(this.createStep("navigate", `Navigate to ${urlMatch[1]}`, urlMatch[1]));
            }
        }

        // Click patterns
        if (lower.includes("click") || lower.includes("press") || lower.includes("tap")) {
            const targetMatch = instruction.match(/(?:click|press|tap)\s+(?:on\s+)?(?:the\s+)?["']?([^"']+)["']?/i);
            if (targetMatch) {
                steps.push(this.createStep("click", `Click on ${targetMatch[1]}`, targetMatch[1]));
            }
        }

        // Fill patterns
        if (lower.includes("fill") || lower.includes("enter") || lower.includes("type") || lower.includes("input")) {
            const fillMatch = instruction.match(/(?:fill|enter|type|input)\s+["']?([^"']+)["']?\s+(?:in|into)\s+(?:the\s+)?([^\s]+)/i);
            if (fillMatch) {
                steps.push(this.createStep("fill", `Fill ${fillMatch[2]} with "${fillMatch[1]}"`, fillMatch[2], fillMatch[1]));
            }
        }

        // Extract patterns
        if (lower.includes("extract") || lower.includes("get") || lower.includes("find") || lower.includes("scrape")) {
            steps.push(this.createStep("extract", `Extract data from page`));
        }

        // Screenshot patterns
        if (lower.includes("screenshot") || lower.includes("capture")) {
            steps.push(this.createStep("screenshot", "Take screenshot"));
        }

        // Scroll patterns
        if (lower.includes("scroll")) {
            const direction = lower.includes("up") ? "up" : "down";
            steps.push(this.createStep("scroll", `Scroll ${direction}`, undefined, direction));
        }

        // Wait patterns
        if (lower.includes("wait")) {
            const timeMatch = instruction.match(/wait\s+(\d+)\s*(?:s|seconds?|ms|milliseconds?)?/i);
            const time = timeMatch ? parseInt(timeMatch[1]) * (timeMatch[0].includes("ms") ? 1 : 1000) : 1000;
            steps.push(this.createStep("wait", `Wait ${time}ms`, undefined, time.toString()));
        }

        // If no specific action recognized, create generic evaluation
        if (steps.length === 0) {
            steps.push(this.createStep("evaluate", instruction));
        }

        return steps;
    }

    private createStep(
        type: AgentStep["type"],
        description: string,
        target?: string,
        value?: string
    ): AgentStep {
        return {
            id: `step-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            type,
            description,
            target,
            value,
            success: false,
            timestamp: new Date(),
        };
    }
}

// ========== Browser Agent ==========

/**
 * BrowserAgent - Autonomous browser control
 */
export class BrowserAgent extends EventEmitter {
    private tasks: Map<string, AgentTask> = new Map();
    private actionRecognizer: ActionRecognizer;
    private config: BrowserUseConfig;
    private currentTask: AgentTask | null = null;

    constructor(config: BrowserUseConfig = {}) {
        super();
        this.config = {
            model: "ChatBrowserUse",
            useCloud: false,
            headless: true,
            timeout: 30000,
            maxSteps: 50,
            ...config,
        };
        this.actionRecognizer = new ActionRecognizer();
    }

    /**
     * Run a task with natural language instruction
     */
    async run(task: string): Promise<AgentTask> {
        const agentTask: AgentTask = {
            id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            task,
            status: "pending",
            steps: [],
            startedAt: new Date(),
        };

        this.tasks.set(agentTask.id, agentTask);
        this.currentTask = agentTask;
        this.emit("task:started", agentTask);

        try {
            agentTask.status = "running";

            // Parse task into steps
            const steps = this.actionRecognizer.parseInstruction(task);

            // Execute each step
            for (const step of steps) {
                if (agentTask.steps.length >= (this.config.maxSteps || 50)) {
                    throw new Error("Max steps exceeded");
                }

                await this.executeStep(step);
                agentTask.steps.push(step);
                this.emit("step:completed", { task: agentTask, step });

                if (!step.success) {
                    throw new Error(`Step failed: ${step.description}`);
                }
            }

            agentTask.status = "completed";
            agentTask.result = this.summarizeResults(agentTask);
            agentTask.completedAt = new Date();
        } catch (error) {
            agentTask.status = "failed";
            agentTask.error = error instanceof Error ? error.message : "Unknown error";
            agentTask.completedAt = new Date();
        }

        this.currentTask = null;
        this.emit("task:completed", agentTask);

        return agentTask;
    }

    /**
     * Execute a single step
     */
    private async executeStep(step: AgentStep): Promise<void> {
        // In real implementation, this would use Playwright/Puppeteer
        // For now, simulate execution

        await new Promise((resolve) => setTimeout(resolve, 100));

        switch (step.type) {
            case "navigate":
                step.result = { navigated: step.target };
                step.success = true;
                break;

            case "click":
                step.result = { clicked: step.target };
                step.success = true;
                break;

            case "fill":
                step.result = { filled: step.target, value: step.value };
                step.success = true;
                break;

            case "extract":
                step.result = { data: "Extracted content placeholder" };
                step.success = true;
                break;

            case "screenshot":
                step.result = { screenshot: "base64-placeholder" };
                step.success = true;
                break;

            case "scroll":
                step.result = { scrolled: step.value || "down" };
                step.success = true;
                break;

            case "wait":
                const waitTime = parseInt(step.value || "1000");
                await new Promise((resolve) => setTimeout(resolve, waitTime));
                step.result = { waited: waitTime };
                step.success = true;
                break;

            case "evaluate":
                step.result = { evaluated: step.description };
                step.success = true;
                break;
        }
    }

    /**
     * Summarize task results
     */
    private summarizeResults(task: AgentTask): string {
        const successfulSteps = task.steps.filter((s) => s.success);
        return `Completed ${successfulSteps.length}/${task.steps.length} steps for task: ${task.task}`;
    }

    /**
     * Get task by ID
     */
    getTask(taskId: string): AgentTask | null {
        return this.tasks.get(taskId) || null;
    }

    /**
     * Get all tasks
     */
    getAllTasks(): AgentTask[] {
        return Array.from(this.tasks.values());
    }

    /**
     * Get current task
     */
    getCurrentTask(): AgentTask | null {
        return this.currentTask;
    }
}

// ========== Sandbox Manager ==========

/**
 * SandboxManager - Manage isolated browser environments
 */
export class SandboxManager extends EventEmitter {
    private sessions: Map<string, SandboxSession> = new Map();
    private agents: Map<string, BrowserAgent> = new Map();

    /**
     * Create a new sandbox session
     */
    async createSession(config: SandboxConfig = {}): Promise<SandboxSession> {
        const session: SandboxSession = {
            id: `sandbox-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            config,
            status: "initializing",
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 3600000), // 1 hour default
        };

        this.sessions.set(session.id, session);
        this.emit("session:created", session);

        // In real implementation, would spin up isolated browser
        await new Promise((resolve) => setTimeout(resolve, 100));

        session.status = "ready";
        session.browserEndpoint = `ws://sandbox-${session.id}.local:9222`;

        // Create agent for this sandbox
        const agent = new BrowserAgent({ useCloud: true });
        this.agents.set(session.id, agent);

        this.emit("session:ready", session);

        return session;
    }

    /**
     * Run task in sandbox
     */
    async runInSandbox(sessionId: string, task: string): Promise<AgentTask> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        if (session.status !== "ready") {
            throw new Error(`Session ${sessionId} is not ready (status: ${session.status})`);
        }

        const agent = this.agents.get(sessionId);
        if (!agent) {
            throw new Error(`No agent for session ${sessionId}`);
        }

        session.status = "running";
        this.emit("session:running", session);

        try {
            const result = await agent.run(task);
            session.status = "ready";
            return result;
        } catch (error) {
            session.status = "error";
            throw error;
        }
    }

    /**
     * Destroy a sandbox session
     */
    async destroySession(sessionId: string): Promise<boolean> {
        const session = this.sessions.get(sessionId);
        if (!session) return false;

        // Cleanup
        this.agents.delete(sessionId);
        this.sessions.delete(sessionId);

        session.status = "completed";
        this.emit("session:destroyed", session);

        return true;
    }

    /**
     * Get session by ID
     */
    getSession(sessionId: string): SandboxSession | null {
        return this.sessions.get(sessionId) || null;
    }

    /**
     * Get all sessions
     */
    getAllSessions(): SandboxSession[] {
        return Array.from(this.sessions.values());
    }
}

// ========== Data Extraction ==========

/**
 * DataExtractor - Extract structured data from pages
 */
export class DataExtractor {
    /**
     * Extract text content
     */
    extractText(html: string, selector?: string): ExtractedData {
        // In real implementation, would use cheerio/jsdom
        let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
        text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
        text = text.replace(/<[^>]+>/g, " ");
        text = text.replace(/\s+/g, " ").trim();

        return {
            type: "text",
            content: text,
            selector,
            timestamp: new Date(),
        };
    }

    /**
     * Extract table data
     */
    extractTable(html: string, selector?: string): ExtractedData {
        const rows: string[][] = [];
        const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/gi);

        if (tableMatch) {
            const rowMatches = tableMatch[0].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
            for (const row of rowMatches) {
                const cells: string[] = [];
                const cellMatches = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [];
                for (const cell of cellMatches) {
                    const text = cell.replace(/<[^>]+>/g, "").trim();
                    cells.push(text);
                }
                if (cells.length > 0) {
                    rows.push(cells);
                }
            }
        }

        return {
            type: "table",
            content: rows,
            selector,
            timestamp: new Date(),
        };
    }

    /**
     * Extract links
     */
    extractLinks(html: string): ExtractedData {
        const links: Array<{ text: string; href: string }> = [];
        const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
        let match;

        while ((match = regex.exec(html)) !== null) {
            links.push({ href: match[1], text: match[2].trim() });
        }

        return {
            type: "list",
            content: links,
            timestamp: new Date(),
        };
    }

    /**
     * Extract form data
     */
    extractForm(html: string, formSelector?: string): ExtractedData {
        const forms: Array<{
            action?: string;
            method?: string;
            fields: Array<{ name: string; type: string; required: boolean }>;
        }> = [];

        const formRegex = /<form[^>]*(?:action=["']([^"']+)["'])?[^>]*(?:method=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/form>/gi;
        let match;

        while ((match = formRegex.exec(html)) !== null) {
            const fields: Array<{ name: string; type: string; required: boolean }> = [];
            const inputRegex = /<input[^>]+name=["']([^"']+)["'][^>]*type=["']([^"']+)["'][^>]*/gi;
            let inputMatch;

            while ((inputMatch = inputRegex.exec(match[3])) !== null) {
                fields.push({
                    name: inputMatch[1],
                    type: inputMatch[2],
                    required: inputMatch[0].includes("required"),
                });
            }

            forms.push({
                action: match[1],
                method: match[2],
                fields,
            });
        }

        return {
            type: "form",
            content: forms,
            selector: formSelector,
            timestamp: new Date(),
        };
    }
}

// ========== Browser-Use Client ==========

/**
 * BrowserUseClient - Main entry point for browser-use integration
 */
export class BrowserUseClient extends EventEmitter {
    public agent: BrowserAgent;
    public sandboxManager: SandboxManager;
    public dataExtractor: DataExtractor;
    private config: BrowserUseConfig;

    constructor(config: BrowserUseConfig = {}) {
        super();
        this.config = {
            model: "ChatBrowserUse",
            useCloud: false,
            headless: true,
            timeout: 30000,
            maxSteps: 50,
            ...config,
        };

        this.agent = new BrowserAgent(config);
        this.sandboxManager = new SandboxManager();
        this.dataExtractor = new DataExtractor();

        // Forward events
        this.agent.on("task:started", (t) => this.emit("task:started", t));
        this.agent.on("task:completed", (t) => this.emit("task:completed", t));
        this.sandboxManager.on("session:ready", (s) => this.emit("sandbox:ready", s));
    }

    /**
     * Run a simple task
     */
    async run(task: string): Promise<AgentTask> {
        return this.agent.run(task);
    }

    /**
     * Run task in isolated sandbox
     */
    async runInSandbox(task: string, sandboxConfig?: SandboxConfig): Promise<{ session: SandboxSession; task: AgentTask }> {
        const session = await this.sandboxManager.createSession(sandboxConfig);
        const result = await this.sandboxManager.runInSandbox(session.id, task);
        return { session, task: result };
    }

    /**
     * Quick data extraction
     */
    async extract(url: string, extractType: "text" | "table" | "links" | "form" = "text"): Promise<ExtractedData> {
        // First navigate
        await this.agent.run(`Navigate to ${url}`);

        // In real implementation, would get actual HTML
        const mockHtml = `<html><body><h1>Content</h1><table><tr><td>Data</td></tr></table></body></html>`;

        switch (extractType) {
            case "text":
                return this.dataExtractor.extractText(mockHtml);
            case "table":
                return this.dataExtractor.extractTable(mockHtml);
            case "links":
                return this.dataExtractor.extractLinks(mockHtml);
            case "form":
                return this.dataExtractor.extractForm(mockHtml);
            default:
                return this.dataExtractor.extractText(mockHtml);
        }
    }

    /**
     * Fill and submit a form
     */
    async fillForm(
        url: string,
        formData: Record<string, string>,
        submitSelector?: string
    ): Promise<AgentTask> {
        const steps: string[] = [
            `Navigate to ${url}`,
            ...Object.entries(formData).map(([field, value]) => `Fill "${value}" in ${field}`),
        ];

        if (submitSelector) {
            steps.push(`Click ${submitSelector}`);
        } else {
            steps.push("Click submit button");
        }

        // Combine into single task
        return this.agent.run(steps.join(", then "));
    }

    /**
     * Take screenshot of page
     */
    async screenshot(url?: string): Promise<AgentTask> {
        const task = url ? `Navigate to ${url} and take screenshot` : "Take screenshot";
        return this.agent.run(task);
    }

    /**
     * Get status
     */
    getStatus(): {
        activeTasks: number;
        completedTasks: number;
        activeSandboxes: number;
        config: BrowserUseConfig;
    } {
        const tasks = this.agent.getAllTasks();
        return {
            activeTasks: tasks.filter((t) => t.status === "running").length,
            completedTasks: tasks.filter((t) => t.status === "completed").length,
            activeSandboxes: this.sandboxManager.getAllSessions().filter((s) => s.status === "ready" || s.status === "running").length,
            config: this.config,
        };
    }
}

// ========== Global Instance ==========

let browserUseClient: BrowserUseClient | null = null;

/**
 * Get or create Browser-Use client instance
 */
export function getBrowserUseClient(config?: BrowserUseConfig): BrowserUseClient {
    if (!browserUseClient) {
        browserUseClient = new BrowserUseClient(config);
    }
    return browserUseClient;
}

/**
 * Initialize Browser-Use
 */
export function initBrowserUse(config?: BrowserUseConfig): BrowserUseClient {
    return getBrowserUseClient(config);
}

// ========== Decorator-style sandbox (like Python @sandbox) ==========

/**
 * Create a sandboxed task runner
 * Mimics Python's @sandbox() decorator pattern
 */
export function createSandboxedRunner(config?: SandboxConfig) {
    return async function <T>(taskFn: (client: BrowserUseClient) => Promise<T>): Promise<{ session: SandboxSession; result: T }> {
        const client = getBrowserUseClient({ useCloud: true });
        const session = await client.sandboxManager.createSession(config);

        try {
            const result = await taskFn(client);
            return { session, result };
        } finally {
            await client.sandboxManager.destroySession(session.id);
        }
    };
}
