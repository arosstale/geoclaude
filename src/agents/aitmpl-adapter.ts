/**
 * AITMPL Adapter for Pi-Mono Discord Bot
 *
 * Integrates aitmpl.com Claude Code templates platform:
 * - Agent templates and configurations
 * - Skill definitions and activation
 * - Hook management
 * - MCP server configurations
 * - Command templates
 * - Platform integrations (OpenAI, Stripe, AWS, etc.)
 *
 * @see https://www.aitmpl.com/agents
 */

import { EventEmitter } from "events";

// ========== Template Types ==========

export type ComponentType = "agent" | "command" | "setting" | "hook" | "mcp" | "skill" | "template";

export interface AitmplComponent {
    id: string;
    name: string;
    type: ComponentType;
    description: string;
    version: string;
    author?: string;
    tags: string[];
    dependencies?: string[];
    config?: Record<string, unknown>;
    installedAt?: Date;
}

export interface AgentTemplate extends AitmplComponent {
    type: "agent";
    capabilities: string[];
    model?: string;
    systemPrompt?: string;
    tools?: string[];
    maxTokens?: number;
}

export interface SkillTemplate extends AitmplComponent {
    type: "skill";
    triggers: string[];
    handler: string;
    priority: "low" | "medium" | "high" | "critical";
    category: string;
}

export interface HookTemplate extends AitmplComponent {
    type: "hook";
    event: "preToolCall" | "postToolCall" | "preResponse" | "postResponse" | "onError";
    handler: string;
    async: boolean;
}

export interface MCPTemplate extends AitmplComponent {
    type: "mcp";
    server: string;
    transport: "stdio" | "http" | "websocket";
    tools: string[];
    resources?: string[];
}

export interface CommandTemplate extends AitmplComponent {
    type: "command";
    command: string;
    usage: string;
    examples: string[];
}

// ========== Platform Integration Types ==========

export interface PlatformIntegration {
    id: string;
    name: string;
    category: "ai" | "payment" | "crm" | "ecommerce" | "communication" | "cloud" | "devops";
    description: string;
    authType: "api_key" | "oauth2" | "basic" | "token";
    requiredEnvVars: string[];
    endpoints?: Record<string, string>;
    installed: boolean;
}

// Pre-built platform integrations from aitmpl.com
export const PLATFORM_INTEGRATIONS: PlatformIntegration[] = [
    {
        id: "openai",
        name: "OpenAI",
        category: "ai",
        description: "GPT models, DALL-E, Whisper integration",
        authType: "api_key",
        requiredEnvVars: ["OPENAI_API_KEY"],
        installed: false,
    },
    {
        id: "anthropic",
        name: "Anthropic",
        category: "ai",
        description: "Claude models integration",
        authType: "api_key",
        requiredEnvVars: ["ANTHROPIC_API_KEY"],
        installed: false,
    },
    {
        id: "stripe",
        name: "Stripe",
        category: "payment",
        description: "Payment processing and subscriptions",
        authType: "api_key",
        requiredEnvVars: ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY"],
        installed: false,
    },
    {
        id: "salesforce",
        name: "Salesforce",
        category: "crm",
        description: "CRM and sales automation",
        authType: "oauth2",
        requiredEnvVars: ["SALESFORCE_CLIENT_ID", "SALESFORCE_CLIENT_SECRET"],
        installed: false,
    },
    {
        id: "shopify",
        name: "Shopify",
        category: "ecommerce",
        description: "E-commerce platform integration",
        authType: "api_key",
        requiredEnvVars: ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET"],
        installed: false,
    },
    {
        id: "twilio",
        name: "Twilio",
        category: "communication",
        description: "SMS, voice, and messaging",
        authType: "api_key",
        requiredEnvVars: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
        installed: false,
    },
    {
        id: "aws",
        name: "AWS",
        category: "cloud",
        description: "Amazon Web Services integration",
        authType: "api_key",
        requiredEnvVars: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
        installed: false,
    },
    {
        id: "github",
        name: "GitHub",
        category: "devops",
        description: "Repository and CI/CD integration",
        authType: "token",
        requiredEnvVars: ["GITHUB_TOKEN"],
        installed: false,
    },
    {
        id: "google-cloud",
        name: "Google Cloud",
        category: "cloud",
        description: "GCP services integration",
        authType: "oauth2",
        requiredEnvVars: ["GOOGLE_APPLICATION_CREDENTIALS"],
        installed: false,
    },
    {
        id: "slack",
        name: "Slack",
        category: "communication",
        description: "Team messaging integration",
        authType: "oauth2",
        requiredEnvVars: ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"],
        installed: false,
    },
];

// ========== Analytics Types ==========

export interface AnalyticsMetric {
    name: string;
    value: number;
    unit: string;
    timestamp: Date;
    tags?: Record<string, string>;
}

export interface ToolUsageStats {
    toolName: string;
    callCount: number;
    successRate: number;
    avgDuration: number;
    lastUsed: Date;
}

export interface PerformanceReport {
    period: "hour" | "day" | "week" | "month";
    tokenUsage: number;
    toolCalls: number;
    successRate: number;
    avgResponseTime: number;
    topTools: ToolUsageStats[];
    costEstimate: number;
}

// ========== Template Registry ==========

/**
 * TemplateRegistry - Manage installed Claude Code templates
 */
export class TemplateRegistry extends EventEmitter {
    private components: Map<string, AitmplComponent> = new Map();
    private installedStacks: Set<string> = new Set();

    /**
     * Register a component
     */
    register(component: AitmplComponent): void {
        component.installedAt = new Date();
        this.components.set(component.id, component);
        this.emit("component:registered", component);
    }

    /**
     * Unregister a component
     */
    unregister(componentId: string): boolean {
        const component = this.components.get(componentId);
        if (!component) return false;

        this.components.delete(componentId);
        this.emit("component:unregistered", component);
        return true;
    }

    /**
     * Get component by ID
     */
    get(componentId: string): AitmplComponent | null {
        return this.components.get(componentId) || null;
    }

    /**
     * Get all components of a type
     */
    getByType(type: ComponentType): AitmplComponent[] {
        return Array.from(this.components.values()).filter((c) => c.type === type);
    }

    /**
     * Search components
     */
    search(query: string): AitmplComponent[] {
        const queryLower = query.toLowerCase();
        return Array.from(this.components.values()).filter(
            (c) =>
                c.name.toLowerCase().includes(queryLower) ||
                c.description.toLowerCase().includes(queryLower) ||
                c.tags.some((t) => t.toLowerCase().includes(queryLower))
        );
    }

    /**
     * Install a stack (collection of components)
     */
    installStack(stackId: string, components: AitmplComponent[]): void {
        for (const component of components) {
            this.register(component);
        }
        this.installedStacks.add(stackId);
        this.emit("stack:installed", { stackId, components });
    }

    /**
     * Get stats
     */
    getStats(): {
        total: number;
        byType: Record<ComponentType, number>;
        stacks: number;
    } {
        const byType: Record<ComponentType, number> = {
            agent: 0,
            command: 0,
            setting: 0,
            hook: 0,
            mcp: 0,
            skill: 0,
            template: 0,
        };

        for (const component of this.components.values()) {
            byType[component.type]++;
        }

        return {
            total: this.components.size,
            byType,
            stacks: this.installedStacks.size,
        };
    }

    /**
     * Export registry to JSON
     */
    export(): string {
        return JSON.stringify(
            {
                components: Array.from(this.components.values()),
                stacks: Array.from(this.installedStacks),
                exportedAt: new Date().toISOString(),
            },
            null,
            2
        );
    }

    /**
     * Import registry from JSON
     */
    import(json: string): number {
        const data = JSON.parse(json);
        let imported = 0;

        if (data.components && Array.isArray(data.components)) {
            for (const component of data.components) {
                this.register(component);
                imported++;
            }
        }

        if (data.stacks && Array.isArray(data.stacks)) {
            for (const stack of data.stacks) {
                this.installedStacks.add(stack);
            }
        }

        return imported;
    }
}

// ========== Analytics Tracker ==========

/**
 * AnalyticsTracker - Track Claude Code performance metrics
 */
export class AnalyticsTracker extends EventEmitter {
    private metrics: AnalyticsMetric[] = [];
    private toolStats: Map<string, ToolUsageStats> = new Map();
    private enabled: boolean;

    constructor(enabled = true) {
        super();
        this.enabled = enabled;
    }

    /**
     * Record a metric
     */
    record(name: string, value: number, unit: string, tags?: Record<string, string>): void {
        if (!this.enabled) return;

        const metric: AnalyticsMetric = {
            name,
            value,
            unit,
            timestamp: new Date(),
            tags,
        };

        this.metrics.push(metric);

        // Keep only last 10000 metrics
        if (this.metrics.length > 10000) {
            this.metrics = this.metrics.slice(-10000);
        }

        this.emit("metric:recorded", metric);
    }

    /**
     * Track tool usage
     */
    trackToolCall(toolName: string, duration: number, success: boolean): void {
        if (!this.enabled) return;

        let stats = this.toolStats.get(toolName);
        if (!stats) {
            stats = {
                toolName,
                callCount: 0,
                successRate: 1,
                avgDuration: 0,
                lastUsed: new Date(),
            };
            this.toolStats.set(toolName, stats);
        }

        // Update stats
        const prevTotal = stats.callCount * stats.avgDuration;
        stats.callCount++;
        stats.avgDuration = (prevTotal + duration) / stats.callCount;
        stats.successRate = (stats.successRate * (stats.callCount - 1) + (success ? 1 : 0)) / stats.callCount;
        stats.lastUsed = new Date();

        this.emit("tool:tracked", stats);
    }

    /**
     * Get performance report
     */
    getReport(period: "hour" | "day" | "week" | "month" = "day"): PerformanceReport {
        const now = Date.now();
        const periodMs = {
            hour: 60 * 60 * 1000,
            day: 24 * 60 * 60 * 1000,
            week: 7 * 24 * 60 * 60 * 1000,
            month: 30 * 24 * 60 * 60 * 1000,
        };

        const cutoff = now - periodMs[period];
        const recentMetrics = this.metrics.filter((m) => m.timestamp.getTime() > cutoff);

        // Calculate aggregates
        const tokenMetrics = recentMetrics.filter((m) => m.name === "tokens");
        const responseTimeMetrics = recentMetrics.filter((m) => m.name === "response_time");

        const topTools = Array.from(this.toolStats.values())
            .filter((s) => s.lastUsed.getTime() > cutoff)
            .sort((a, b) => b.callCount - a.callCount)
            .slice(0, 10);

        const totalCalls = topTools.reduce((sum, t) => sum + t.callCount, 0);
        const avgSuccess = topTools.length > 0 ? topTools.reduce((sum, t) => sum + t.successRate, 0) / topTools.length : 1;

        return {
            period,
            tokenUsage: tokenMetrics.reduce((sum, m) => sum + m.value, 0),
            toolCalls: totalCalls,
            successRate: avgSuccess,
            avgResponseTime:
                responseTimeMetrics.length > 0
                    ? responseTimeMetrics.reduce((sum, m) => sum + m.value, 0) / responseTimeMetrics.length
                    : 0,
            topTools,
            costEstimate: tokenMetrics.reduce((sum, m) => sum + m.value, 0) * 0.00001, // Rough estimate
        };
    }

    /**
     * Get tool stats
     */
    getToolStats(): ToolUsageStats[] {
        return Array.from(this.toolStats.values()).sort((a, b) => b.callCount - a.callCount);
    }

    /**
     * Clear old metrics
     */
    cleanup(maxAge: number = 7 * 24 * 60 * 60 * 1000): number {
        const cutoff = Date.now() - maxAge;
        const before = this.metrics.length;
        this.metrics = this.metrics.filter((m) => m.timestamp.getTime() > cutoff);
        return before - this.metrics.length;
    }
}

// ========== Health Checker ==========

export interface HealthCheckResult {
    component: string;
    status: "healthy" | "degraded" | "unhealthy";
    message: string;
    latency?: number;
    checkedAt: Date;
}

/**
 * HealthChecker - Verify Claude Code installation health
 */
export class HealthChecker extends EventEmitter {
    private checks: Map<string, () => Promise<HealthCheckResult>> = new Map();

    /**
     * Register a health check
     */
    registerCheck(name: string, check: () => Promise<HealthCheckResult>): void {
        this.checks.set(name, check);
    }

    /**
     * Run all health checks
     */
    async runAll(): Promise<HealthCheckResult[]> {
        const results: HealthCheckResult[] = [];

        for (const [name, check] of this.checks) {
            try {
                const start = Date.now();
                const result = await check();
                result.latency = Date.now() - start;
                results.push(result);
            } catch (error) {
                results.push({
                    component: name,
                    status: "unhealthy",
                    message: error instanceof Error ? error.message : "Check failed",
                    checkedAt: new Date(),
                });
            }
        }

        this.emit("checks:completed", results);
        return results;
    }

    /**
     * Run a specific check
     */
    async run(name: string): Promise<HealthCheckResult | null> {
        const check = this.checks.get(name);
        if (!check) return null;

        try {
            const start = Date.now();
            const result = await check();
            result.latency = Date.now() - start;
            return result;
        } catch (error) {
            return {
                component: name,
                status: "unhealthy",
                message: error instanceof Error ? error.message : "Check failed",
                checkedAt: new Date(),
            };
        }
    }

    /**
     * Get overall status
     */
    async getOverallStatus(): Promise<"healthy" | "degraded" | "unhealthy"> {
        const results = await this.runAll();

        if (results.some((r) => r.status === "unhealthy")) {
            return "unhealthy";
        }
        if (results.some((r) => r.status === "degraded")) {
            return "degraded";
        }
        return "healthy";
    }
}

// ========== Plugin Manager ==========

export interface Plugin {
    id: string;
    name: string;
    version: string;
    description: string;
    enabled: boolean;
    components: AitmplComponent[];
    config?: Record<string, unknown>;
    installedAt: Date;
}

/**
 * PluginManager - Manage Claude Code plugins
 */
export class PluginManager extends EventEmitter {
    private plugins: Map<string, Plugin> = new Map();
    private registry: TemplateRegistry;

    constructor(registry: TemplateRegistry) {
        super();
        this.registry = registry;
    }

    /**
     * Install a plugin
     */
    install(plugin: Omit<Plugin, "installedAt" | "enabled">): Plugin {
        const installed: Plugin = {
            ...plugin,
            enabled: true,
            installedAt: new Date(),
        };

        this.plugins.set(plugin.id, installed);

        // Register all components
        for (const component of plugin.components) {
            this.registry.register(component);
        }

        this.emit("plugin:installed", installed);
        return installed;
    }

    /**
     * Uninstall a plugin
     */
    uninstall(pluginId: string): boolean {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) return false;

        // Unregister all components
        for (const component of plugin.components) {
            this.registry.unregister(component.id);
        }

        this.plugins.delete(pluginId);
        this.emit("plugin:uninstalled", plugin);
        return true;
    }

    /**
     * Enable/disable a plugin
     */
    setEnabled(pluginId: string, enabled: boolean): boolean {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) return false;

        plugin.enabled = enabled;
        this.emit("plugin:toggled", { plugin, enabled });
        return true;
    }

    /**
     * Get all plugins
     */
    getAll(): Plugin[] {
        return Array.from(this.plugins.values());
    }

    /**
     * Get enabled plugins
     */
    getEnabled(): Plugin[] {
        return Array.from(this.plugins.values()).filter((p) => p.enabled);
    }

    /**
     * Get plugin by ID
     */
    get(pluginId: string): Plugin | null {
        return this.plugins.get(pluginId) || null;
    }

    /**
     * Get stats
     */
    getStats(): {
        total: number;
        enabled: number;
        disabled: number;
        totalComponents: number;
    } {
        const plugins = Array.from(this.plugins.values());
        return {
            total: plugins.length,
            enabled: plugins.filter((p) => p.enabled).length,
            disabled: plugins.filter((p) => !p.enabled).length,
            totalComponents: plugins.reduce((sum, p) => sum + p.components.length, 0),
        };
    }
}

// ========== AITMPL Client ==========

export interface AitmplConfig {
    enableAnalytics?: boolean;
    enableHealthChecks?: boolean;
    autoSync?: boolean;
    syncInterval?: number; // ms
}

/**
 * AitmplClient - Main entry point for aitmpl.com integration
 */
export class AitmplClient extends EventEmitter {
    public registry: TemplateRegistry;
    public analytics: AnalyticsTracker;
    public healthChecker: HealthChecker;
    public pluginManager: PluginManager;
    private config: AitmplConfig;
    private platforms: Map<string, PlatformIntegration>;

    constructor(config: AitmplConfig = {}) {
        super();
        this.config = {
            enableAnalytics: true,
            enableHealthChecks: true,
            autoSync: false,
            syncInterval: 60000,
            ...config,
        };

        this.registry = new TemplateRegistry();
        this.analytics = new AnalyticsTracker(config.enableAnalytics);
        this.healthChecker = new HealthChecker();
        this.pluginManager = new PluginManager(this.registry);

        // Initialize platforms
        this.platforms = new Map();
        for (const platform of PLATFORM_INTEGRATIONS) {
            this.platforms.set(platform.id, { ...platform });
        }

        // Register default health checks
        this.registerDefaultHealthChecks();

        // Forward events
        this.registry.on("component:registered", (c) => this.emit("component:registered", c));
        this.pluginManager.on("plugin:installed", (p) => this.emit("plugin:installed", p));
        this.analytics.on("metric:recorded", (m) => this.emit("metric:recorded", m));
    }

    private registerDefaultHealthChecks(): void {
        // Registry check
        this.healthChecker.registerCheck("registry", async () => ({
            component: "registry",
            status: "healthy",
            message: `${this.registry.getStats().total} components registered`,
            checkedAt: new Date(),
        }));

        // Analytics check
        this.healthChecker.registerCheck("analytics", async () => ({
            component: "analytics",
            status: this.config.enableAnalytics ? "healthy" : "degraded",
            message: this.config.enableAnalytics ? "Analytics enabled" : "Analytics disabled",
            checkedAt: new Date(),
        }));

        // Plugin check
        this.healthChecker.registerCheck("plugins", async () => {
            const stats = this.pluginManager.getStats();
            return {
                component: "plugins",
                status: "healthy",
                message: `${stats.enabled}/${stats.total} plugins enabled`,
                checkedAt: new Date(),
            };
        });
    }

    /**
     * Install a platform integration
     */
    installPlatform(platformId: string): boolean {
        const platform = this.platforms.get(platformId);
        if (!platform) return false;

        // Check if required env vars are set
        const missing = platform.requiredEnvVars.filter((v) => !process.env[v]);
        if (missing.length > 0) {
            this.emit("platform:missing_vars", { platform, missing });
            return false;
        }

        platform.installed = true;
        this.emit("platform:installed", platform);
        return true;
    }

    /**
     * Get platform status
     */
    getPlatformStatus(): { installed: PlatformIntegration[]; available: PlatformIntegration[] } {
        const all = Array.from(this.platforms.values());
        return {
            installed: all.filter((p) => p.installed),
            available: all.filter((p) => !p.installed),
        };
    }

    /**
     * Quick component install
     */
    install(component: AitmplComponent): void {
        this.registry.register(component);
        this.analytics.record("component_installed", 1, "count", { type: component.type });
    }

    /**
     * Track a tool call (for analytics)
     */
    trackTool(toolName: string, duration: number, success: boolean): void {
        this.analytics.trackToolCall(toolName, duration, success);
    }

    /**
     * Get performance report
     */
    getReport(period: "hour" | "day" | "week" | "month" = "day"): PerformanceReport {
        return this.analytics.getReport(period);
    }

    /**
     * Run health checks
     */
    async checkHealth(): Promise<HealthCheckResult[]> {
        return this.healthChecker.runAll();
    }

    /**
     * Get overall status
     */
    getStatus(): {
        registry: ReturnType<TemplateRegistry["getStats"]>;
        plugins: ReturnType<PluginManager["getStats"]>;
        platforms: { installed: number; available: number };
    } {
        const platformStatus = this.getPlatformStatus();
        return {
            registry: this.registry.getStats(),
            plugins: this.pluginManager.getStats(),
            platforms: {
                installed: platformStatus.installed.length,
                available: platformStatus.available.length,
            },
        };
    }
}

// ========== Global Instance ==========

let aitmplClient: AitmplClient | null = null;

/**
 * Get or create AITMPL client instance
 */
export function getAitmplClient(config?: AitmplConfig): AitmplClient {
    if (!aitmplClient) {
        aitmplClient = new AitmplClient(config);
    }
    return aitmplClient;
}

/**
 * Initialize AITMPL from environment
 */
export function initAitmpl(config?: AitmplConfig): AitmplClient {
    return getAitmplClient(config);
}

// ========== Exports ==========

export { PLATFORM_INTEGRATIONS as AITMPL_PLATFORMS };
