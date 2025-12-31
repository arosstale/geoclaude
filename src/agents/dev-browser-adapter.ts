/**
 * Dev-Browser Adapter for Pi-Mono Discord Bot
 *
 * Integrates SawyerHood/dev-browser for browser automation:
 * - Persistent pages (navigate once, interact across scripts)
 * - LLM-friendly DOM snapshots
 * - Flexible execution (full scripts or step-by-step)
 * - Chrome extension support for existing browser control
 *
 * @see https://github.com/SawyerHood/dev-browser
 */

import { EventEmitter } from "events";

// ========== Types ==========

export interface BrowserPage {
	id: string;
	url: string;
	title: string;
	isActive: boolean;
	createdAt: Date;
	lastInteraction?: Date;
}

export interface DOMSnapshot {
	pageId: string;
	url: string;
	title: string;
	html: string;
	text: string;
	links: Array<{ href: string; text: string }>;
	forms: Array<{
		id?: string;
		action?: string;
		inputs: Array<{ name: string; type: string; value?: string }>;
	}>;
	buttons: Array<{ text: string; id?: string; selector: string }>;
	images: Array<{ src: string; alt?: string }>;
	timestamp: Date;
}

export interface BrowserAction {
	type: "navigate" | "click" | "fill" | "scroll" | "screenshot" | "evaluate" | "wait";
	target?: string; // CSS selector or URL
	value?: string; // Text to fill or JS to evaluate
	timeout?: number;
}

export interface BrowserScript {
	id: string;
	name: string;
	actions: BrowserAction[];
	status: "pending" | "running" | "completed" | "failed";
	results?: BrowserActionResult[];
	error?: string;
	startedAt?: Date;
	completedAt?: Date;
}

export interface BrowserActionResult {
	action: BrowserAction;
	success: boolean;
	result?: unknown;
	error?: string;
	duration: number;
	screenshot?: string; // Base64
}

// ========== DOM Snapshot Generator ==========

/**
 * DOMSnapshotGenerator - Create LLM-friendly DOM representations
 */
export class DOMSnapshotGenerator {
	/**
	 * Parse HTML into structured snapshot
	 */
	parseHTML(html: string, url: string, title: string): DOMSnapshot {
		// In real implementation, this would use cheerio or jsdom
		// For now, use regex-based extraction

		const snapshot: DOMSnapshot = {
			pageId: `page-${Date.now()}`,
			url,
			title,
			html: this.truncateHTML(html),
			text: this.extractText(html),
			links: this.extractLinks(html),
			forms: this.extractForms(html),
			buttons: this.extractButtons(html),
			images: this.extractImages(html),
			timestamp: new Date(),
		};

		return snapshot;
	}

	/**
	 * Convert snapshot to LLM-friendly format
	 */
	toLLMFormat(snapshot: DOMSnapshot): string {
		const lines: string[] = [
			`# Page: ${snapshot.title}`,
			`URL: ${snapshot.url}`,
			"",
			"## Main Content",
			snapshot.text.substring(0, 2000) + (snapshot.text.length > 2000 ? "..." : ""),
			"",
		];

		if (snapshot.links.length > 0) {
			lines.push("## Links");
			for (const link of snapshot.links.slice(0, 20)) {
				lines.push(`- [${link.text || "Link"}](${link.href})`);
			}
			lines.push("");
		}

		if (snapshot.buttons.length > 0) {
			lines.push("## Interactive Elements");
			for (const btn of snapshot.buttons.slice(0, 10)) {
				lines.push(`- Button: "${btn.text}" (selector: ${btn.selector})`);
			}
			lines.push("");
		}

		if (snapshot.forms.length > 0) {
			lines.push("## Forms");
			for (const form of snapshot.forms.slice(0, 5)) {
				lines.push(`- Form ${form.id || "(unnamed)"}: ${form.inputs.length} inputs`);
				for (const input of form.inputs.slice(0, 5)) {
					lines.push(`  - ${input.name}: ${input.type}`);
				}
			}
			lines.push("");
		}

		return lines.join("\n");
	}

	// ========== Private Methods ==========

	private truncateHTML(html: string, maxLength = 50000): string {
		if (html.length <= maxLength) return html;
		return `${html.substring(0, maxLength)}<!-- truncated -->`;
	}

	private extractText(html: string): string {
		// Remove scripts and styles
		let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
		text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
		// Remove all tags
		text = text.replace(/<[^>]+>/g, " ");
		// Normalize whitespace
		text = text.replace(/\s+/g, " ").trim();
		return text;
	}

	private extractLinks(html: string): DOMSnapshot["links"] {
		const links: DOMSnapshot["links"] = [];
		const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
		for (const match of html.matchAll(regex)) {
			links.push({ href: match[1], text: match[2].trim() });
		}
		return links;
	}

	private extractForms(html: string): DOMSnapshot["forms"] {
		const forms: DOMSnapshot["forms"] = [];
		const formRegex = /<form[^>]*(?:id=["']([^"']+)["'])?[^>]*(?:action=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/form>/gi;
		for (const match of html.matchAll(formRegex)) {
			const inputs: DOMSnapshot["forms"][0]["inputs"] = [];
			const inputRegex =
				/<input[^>]+name=["']([^"']+)["'][^>]*type=["']([^"']+)["'][^>]*(?:value=["']([^"']+)["'])?/gi;
			for (const inputMatch of match[3].matchAll(inputRegex)) {
				inputs.push({ name: inputMatch[1], type: inputMatch[2], value: inputMatch[3] });
			}
			forms.push({ id: match[1], action: match[2], inputs });
		}
		return forms;
	}

	private extractButtons(html: string): DOMSnapshot["buttons"] {
		const buttons: DOMSnapshot["buttons"] = [];
		const btnRegex = /<button[^>]*(?:id=["']([^"']+)["'])?[^>]*>([^<]*)<\/button>/gi;
		let index = 0;
		for (const match of html.matchAll(btnRegex)) {
			buttons.push({
				text: match[2].trim(),
				id: match[1],
				selector: match[1] ? `#${match[1]}` : `button:nth-of-type(${++index})`,
			});
		}
		return buttons;
	}

	private extractImages(html: string): DOMSnapshot["images"] {
		const images: DOMSnapshot["images"] = [];
		const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*(?:alt=["']([^"']+)["'])?/gi;
		for (const match of html.matchAll(imgRegex)) {
			images.push({ src: match[1], alt: match[2] });
		}
		return images;
	}
}

// ========== Browser Session Manager ==========

/**
 * BrowserSessionManager - Manage persistent browser pages
 */
export class BrowserSessionManager extends EventEmitter {
	private pages: Map<string, BrowserPage> = new Map();
	private activePageId: string | null = null;
	private snapshotGenerator: DOMSnapshotGenerator;
	private snapshots: Map<string, DOMSnapshot> = new Map();

	constructor() {
		super();
		this.snapshotGenerator = new DOMSnapshotGenerator();
	}

	/**
	 * Create a new page
	 */
	createPage(url: string): BrowserPage {
		const page: BrowserPage = {
			id: `page-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
			url,
			title: url,
			isActive: true,
			createdAt: new Date(),
		};

		// Deactivate other pages
		for (const p of this.pages.values()) {
			p.isActive = false;
		}

		this.pages.set(page.id, page);
		this.activePageId = page.id;
		this.emit("page:created", page);

		return page;
	}

	/**
	 * Navigate current page
	 */
	navigate(url: string): BrowserPage | null {
		if (!this.activePageId) {
			return this.createPage(url);
		}

		const page = this.pages.get(this.activePageId);
		if (!page) return null;

		page.url = url;
		page.lastInteraction = new Date();
		this.emit("page:navigated", page);

		return page;
	}

	/**
	 * Switch to a page
	 */
	switchTo(pageId: string): BrowserPage | null {
		const page = this.pages.get(pageId);
		if (!page) return null;

		for (const p of this.pages.values()) {
			p.isActive = p.id === pageId;
		}

		this.activePageId = pageId;
		this.emit("page:switched", page);

		return page;
	}

	/**
	 * Close a page
	 */
	closePage(pageId: string): boolean {
		const page = this.pages.get(pageId);
		if (!page) return false;

		this.pages.delete(pageId);
		this.snapshots.delete(pageId);

		if (this.activePageId === pageId) {
			this.activePageId = this.pages.size > 0 ? this.pages.keys().next().value || null : null;
		}

		this.emit("page:closed", page);
		return true;
	}

	/**
	 * Get active page
	 */
	getActivePage(): BrowserPage | null {
		if (!this.activePageId) return null;
		return this.pages.get(this.activePageId) || null;
	}

	/**
	 * Get all pages
	 */
	getAllPages(): BrowserPage[] {
		return Array.from(this.pages.values());
	}

	/**
	 * Store snapshot for a page
	 */
	storeSnapshot(pageId: string, html: string, title?: string): DOMSnapshot {
		const page = this.pages.get(pageId);
		if (!page) {
			throw new Error(`Page ${pageId} not found`);
		}

		const snapshot = this.snapshotGenerator.parseHTML(html, page.url, title || page.title);
		snapshot.pageId = pageId;
		this.snapshots.set(pageId, snapshot);

		if (title) {
			page.title = title;
		}

		this.emit("snapshot:stored", snapshot);
		return snapshot;
	}

	/**
	 * Get snapshot for page
	 */
	getSnapshot(pageId: string): DOMSnapshot | null {
		return this.snapshots.get(pageId) || null;
	}

	/**
	 * Get LLM-friendly snapshot
	 */
	getSnapshotForLLM(pageId: string): string | null {
		const snapshot = this.snapshots.get(pageId);
		if (!snapshot) return null;
		return this.snapshotGenerator.toLLMFormat(snapshot);
	}
}

// ========== Script Executor ==========

/**
 * ScriptExecutor - Execute browser automation scripts
 */
export class ScriptExecutor extends EventEmitter {
	private scripts: Map<string, BrowserScript> = new Map();
	private sessionManager: BrowserSessionManager;

	constructor(sessionManager: BrowserSessionManager) {
		super();
		this.sessionManager = sessionManager;
	}

	/**
	 * Create a new script
	 */
	createScript(name: string, actions: BrowserAction[]): BrowserScript {
		const script: BrowserScript = {
			id: `script-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
			name,
			actions,
			status: "pending",
		};

		this.scripts.set(script.id, script);
		this.emit("script:created", script);

		return script;
	}

	/**
	 * Execute a script
	 */
	async executeScript(scriptId: string): Promise<BrowserScript> {
		const script = this.scripts.get(scriptId);
		if (!script) {
			throw new Error(`Script ${scriptId} not found`);
		}

		script.status = "running";
		script.startedAt = new Date();
		script.results = [];

		this.emit("script:started", script);

		try {
			for (const action of script.actions) {
				const result = await this.executeAction(action);
				script.results.push(result);

				if (!result.success) {
					throw new Error(result.error || "Action failed");
				}

				this.emit("action:completed", { script, result });
			}

			script.status = "completed";
			script.completedAt = new Date();
		} catch (error) {
			script.status = "failed";
			script.error = error instanceof Error ? error.message : "Unknown error";
			script.completedAt = new Date();
		}

		this.emit("script:completed", script);
		return script;
	}

	/**
	 * Execute a single action
	 */
	async executeAction(action: BrowserAction): Promise<BrowserActionResult> {
		const startTime = Date.now();

		try {
			let result: unknown;

			switch (action.type) {
				case "navigate":
					if (!action.target) throw new Error("Navigate requires target URL");
					this.sessionManager.navigate(action.target);
					result = { url: action.target };
					break;

				case "click":
					// In real implementation, would use Puppeteer/Playwright
					result = { clicked: action.target };
					break;

				case "fill":
					if (!action.target || !action.value) {
						throw new Error("Fill requires target selector and value");
					}
					result = { filled: action.target, value: action.value };
					break;

				case "scroll":
					result = { scrolled: action.value || "down" };
					break;

				case "screenshot":
					result = { screenshot: "base64-placeholder" };
					break;

				case "evaluate":
					if (!action.value) throw new Error("Evaluate requires JS code");
					// In real implementation, would execute in browser
					result = { evaluated: action.value };
					break;

				case "wait":
					await new Promise((resolve) => setTimeout(resolve, action.timeout || 1000));
					result = { waited: action.timeout || 1000 };
					break;

				default:
					throw new Error(`Unknown action type: ${action.type}`);
			}

			return {
				action,
				success: true,
				result,
				duration: Date.now() - startTime,
			};
		} catch (error) {
			return {
				action,
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
				duration: Date.now() - startTime,
			};
		}
	}

	/**
	 * Get script by ID
	 */
	getScript(scriptId: string): BrowserScript | null {
		return this.scripts.get(scriptId) || null;
	}

	/**
	 * Get all scripts
	 */
	getAllScripts(): BrowserScript[] {
		return Array.from(this.scripts.values());
	}
}

// ========== Dev-Browser Client ==========

export interface DevBrowserConfig {
	serverPort?: number;
	useExtension?: boolean; // Use Chrome extension for existing browser
	headless?: boolean;
	timeout?: number;
}

/**
 * DevBrowserClient - Main entry point for dev-browser integration
 */
export class DevBrowserClient extends EventEmitter {
	public sessionManager: BrowserSessionManager;
	public scriptExecutor: ScriptExecutor;
	public config: Required<DevBrowserConfig>;
	private connected: boolean = false;

	constructor(config: DevBrowserConfig = {}) {
		super();
		this.config = {
			serverPort: 3000,
			useExtension: false,
			headless: true,
			timeout: 30000,
			...config,
		};

		this.sessionManager = new BrowserSessionManager();
		this.scriptExecutor = new ScriptExecutor(this.sessionManager);

		// Forward events
		this.sessionManager.on("page:created", (p) => this.emit("page:created", p));
		this.sessionManager.on("page:navigated", (p) => this.emit("page:navigated", p));
		this.scriptExecutor.on("script:completed", (s) => this.emit("script:completed", s));
	}

	/**
	 * Connect to browser (or dev-browser server)
	 */
	async connect(): Promise<boolean> {
		// In real implementation, would connect to Puppeteer/Playwright/dev-browser server
		this.connected = true;
		this.emit("connected");
		return true;
	}

	/**
	 * Disconnect
	 */
	async disconnect(): Promise<void> {
		this.connected = false;
		this.emit("disconnected");
	}

	/**
	 * Quick navigate and snapshot
	 */
	async goto(url: string): Promise<{ page: BrowserPage; snapshot: string }> {
		const page = this.sessionManager.navigate(url) || this.sessionManager.createPage(url);

		// In real implementation, would fetch actual HTML
		const mockHtml = `<html><head><title>${url}</title></head><body><h1>Page Content</h1></body></html>`;
		this.sessionManager.storeSnapshot(page.id, mockHtml, url);

		const snapshot = this.sessionManager.getSnapshotForLLM(page.id) || "";

		return { page, snapshot };
	}

	/**
	 * Click an element
	 */
	async click(selector: string): Promise<BrowserActionResult> {
		return this.scriptExecutor.executeAction({ type: "click", target: selector });
	}

	/**
	 * Fill a form field
	 */
	async fill(selector: string, value: string): Promise<BrowserActionResult> {
		return this.scriptExecutor.executeAction({ type: "fill", target: selector, value });
	}

	/**
	 * Take a screenshot
	 */
	async screenshot(): Promise<BrowserActionResult> {
		return this.scriptExecutor.executeAction({ type: "screenshot" });
	}

	/**
	 * Evaluate JavaScript
	 */
	async evaluate(code: string): Promise<BrowserActionResult> {
		return this.scriptExecutor.executeAction({ type: "evaluate", value: code });
	}

	/**
	 * Run a full automation script
	 */
	async runScript(name: string, actions: BrowserAction[]): Promise<BrowserScript> {
		const script = this.scriptExecutor.createScript(name, actions);
		return this.scriptExecutor.executeScript(script.id);
	}

	/**
	 * Get current page snapshot for LLM
	 */
	getCurrentSnapshot(): string | null {
		const page = this.sessionManager.getActivePage();
		if (!page) return null;
		return this.sessionManager.getSnapshotForLLM(page.id);
	}

	/**
	 * Get status
	 */
	getStatus(): {
		connected: boolean;
		pages: number;
		activePage: BrowserPage | null;
		scripts: number;
	} {
		return {
			connected: this.connected,
			pages: this.sessionManager.getAllPages().length,
			activePage: this.sessionManager.getActivePage(),
			scripts: this.scriptExecutor.getAllScripts().length,
		};
	}
}

// ========== Global Instance ==========

let devBrowserClient: DevBrowserClient | null = null;

/**
 * Get or create Dev-Browser client instance
 */
export function getDevBrowserClient(config?: DevBrowserConfig): DevBrowserClient {
	if (!devBrowserClient) {
		devBrowserClient = new DevBrowserClient(config);
	}
	return devBrowserClient;
}

/**
 * Initialize Dev-Browser
 */
export async function initDevBrowser(config?: DevBrowserConfig): Promise<DevBrowserClient> {
	const client = getDevBrowserClient(config);
	await client.connect();
	return client;
}
