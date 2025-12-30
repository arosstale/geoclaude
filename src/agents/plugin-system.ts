/**
 * Class 3.44: Plugin System
 * TAC Pattern: Extensible plugin architecture for agent capabilities
 *
 * Provides comprehensive plugin management:
 * - Plugin lifecycle (load/enable/disable/unload)
 * - Dependency resolution with version constraints
 * - Hook points for extensibility
 * - Sandboxing for isolated execution
 * - Versioning with semantic version support
 * - Hot reload for development
 */

import { EventEmitter } from "events";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";

// ============================================================================
// Types
// ============================================================================

export type PluginStatus =
  | "unloaded"
  | "loaded"
  | "enabled"
  | "disabled"
  | "error"
  | "incompatible";

export type HookPhase = "before" | "after" | "around" | "replace";

export interface PluginVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

export interface PluginDependency {
  pluginId: string;
  versionConstraint: string; // semver constraint: ^1.0.0, >=2.0.0, etc.
  optional: boolean;
}

export interface PluginCapability {
  name: string;
  version: string;
  description: string;
}

export interface PluginHook {
  id: string;
  pluginId: string;
  hookPoint: string;
  phase: HookPhase;
  priority: number; // Higher = runs first
  handler: HookHandler;
}

export type HookHandler = (context: HookContext) => Promise<HookResult>;

export interface HookContext {
  hookPoint: string;
  phase: HookPhase;
  args: unknown[];
  metadata: Record<string, unknown>;
  previousResult?: unknown;
}

export interface HookResult {
  proceed: boolean;
  result?: unknown;
  modifiedArgs?: unknown[];
  error?: Error;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  license?: string;
  homepage?: string;
  repository?: string;
  main: string; // Entry point file
  dependencies: PluginDependency[];
  capabilities: PluginCapability[];
  hooks: string[]; // Hook points this plugin registers
  permissions: string[];
  minSystemVersion?: string;
  maxSystemVersion?: string;
  tags: string[];
}

export interface Plugin {
  manifest: PluginManifest;
  status: PluginStatus;
  version: PluginVersion;
  loadedAt?: number;
  enabledAt?: number;
  disabledAt?: number;
  errorMessage?: string;
  instance?: PluginInstance;
  sandbox?: PluginSandbox;
  hooks: PluginHook[];
  configSchema?: Record<string, unknown>;
  config: Record<string, unknown>;
}

export interface PluginInstance {
  onLoad?: () => Promise<void>;
  onEnable?: () => Promise<void>;
  onDisable?: () => Promise<void>;
  onUnload?: () => Promise<void>;
  onConfigChange?: (config: Record<string, unknown>) => Promise<void>;
  registerHooks?: (registry: HookRegistry) => void;
  getCapabilities?: () => PluginCapability[];
  [key: string]: unknown;
}

export interface PluginSandbox {
  context: vm.Context;
  timeout: number;
  memoryLimit: number;
  allowedModules: string[];
}

export interface HookRegistry {
  register(hookPoint: string, phase: HookPhase, handler: HookHandler, priority?: number): string;
  unregister(hookId: string): boolean;
  getHooks(hookPoint: string): PluginHook[];
}

export interface PluginSystemConfig {
  pluginDir: string;
  sandboxTimeout: number;
  sandboxMemoryLimit: number;
  allowedModules: string[];
  autoLoadPlugins: boolean;
  autoEnablePlugins: boolean;
  systemVersion: string;
  hotReloadEnabled: boolean;
  hotReloadDebounceMs: number;
}

export interface PluginStats {
  totalPlugins: number;
  loadedPlugins: number;
  enabledPlugins: number;
  disabledPlugins: number;
  errorPlugins: number;
  totalHooks: number;
  totalCapabilities: number;
}

export interface DependencyResolution {
  resolved: Plugin[];
  missing: PluginDependency[];
  circular: string[];
  incompatible: Array<{ dependency: PluginDependency; actual: string }>;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: PluginSystemConfig = {
  pluginDir: "./plugins",
  sandboxTimeout: 5000,
  sandboxMemoryLimit: 128 * 1024 * 1024, // 128MB
  allowedModules: ["path", "url", "querystring", "crypto", "util"],
  autoLoadPlugins: true,
  autoEnablePlugins: false,
  systemVersion: "1.0.0",
  hotReloadEnabled: false,
  hotReloadDebounceMs: 500,
};

// ============================================================================
// Plugin System
// ============================================================================

export class PluginSystem extends EventEmitter {
  private db: Database.Database;
  private config: PluginSystemConfig;
  private plugins: Map<string, Plugin> = new Map();
  private hookRegistry: Map<string, PluginHook[]> = new Map();
  private fileWatcher?: fs.FSWatcher;
  private hotReloadDebounce?: NodeJS.Timeout;

  constructor(dataDir: string, config: Partial<PluginSystemConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    const dbPath = path.join(dataDir, "plugin-system.db");
    fs.mkdirSync(dataDir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();

    // Ensure plugin directory exists
    const pluginDir = path.resolve(dataDir, this.config.pluginDir);
    fs.mkdirSync(pluginDir, { recursive: true });

    // Auto-load plugins if configured
    if (this.config.autoLoadPlugins) {
      this.loadAllPlugins();
    }

    // Start hot reload watcher if enabled
    if (this.config.hotReloadEnabled) {
      this.startHotReloadWatcher();
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        manifest TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unloaded',
        config TEXT NOT NULL DEFAULT '{}',
        loaded_at INTEGER,
        enabled_at INTEGER,
        disabled_at INTEGER,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plugin_hooks (
        id TEXT PRIMARY KEY,
        plugin_id TEXT NOT NULL,
        hook_point TEXT NOT NULL,
        phase TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 100,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS hook_executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hook_point TEXT NOT NULL,
        plugin_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        success INTEGER NOT NULL,
        error_message TEXT,
        executed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_plugins_status ON plugins(status);
      CREATE INDEX IF NOT EXISTS idx_hooks_point ON plugin_hooks(hook_point);
      CREATE INDEX IF NOT EXISTS idx_hooks_plugin ON plugin_hooks(plugin_id);
      CREATE INDEX IF NOT EXISTS idx_executions_hook ON hook_executions(hook_point);
      CREATE INDEX IF NOT EXISTS idx_executions_time ON hook_executions(executed_at DESC);
    `);
  }

  /**
   * Load all plugins from the plugin directory
   */
  loadAllPlugins(): void {
    const pluginDir = path.resolve(this.config.pluginDir);
    if (!fs.existsSync(pluginDir)) return;

    const entries = fs.readdirSync(pluginDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const manifestPath = path.join(pluginDir, entry.name, "manifest.json");
        if (fs.existsSync(manifestPath)) {
          try {
            this.loadPlugin(entry.name);
          } catch (error) {
            this.emit("plugin:load-error", {
              pluginId: entry.name,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }
  }

  /**
   * Load a plugin by ID
   */
  loadPlugin(pluginId: string): Plugin {
    // Check if already loaded
    const existing = this.plugins.get(pluginId);
    if (existing && existing.status !== "unloaded") {
      return existing;
    }

    const pluginDir = path.resolve(this.config.pluginDir, pluginId);
    const manifestPath = path.join(pluginDir, "manifest.json");

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Plugin manifest not found: ${manifestPath}`);
    }

    // Read and parse manifest
    const manifestContent = fs.readFileSync(manifestPath, "utf-8");
    const manifest: PluginManifest = JSON.parse(manifestContent);
    manifest.id = pluginId; // Ensure ID matches directory name

    // Validate manifest
    this.validateManifest(manifest);

    // Check system version compatibility
    if (!this.checkSystemCompatibility(manifest)) {
      const plugin = this.createPluginRecord(manifest, "incompatible");
      plugin.errorMessage = `Incompatible with system version ${this.config.systemVersion}`;
      this.plugins.set(pluginId, plugin);
      this.savePluginState(plugin);
      return plugin;
    }

    // Parse version
    const version = this.parseVersion(manifest.version);

    // Create plugin record
    const plugin: Plugin = {
      manifest,
      status: "loaded",
      version,
      loadedAt: Date.now(),
      hooks: [],
      config: this.loadPluginConfig(pluginId),
    };

    // Create sandbox if needed
    plugin.sandbox = this.createSandbox(pluginId);

    // Load plugin instance
    try {
      const mainPath = path.join(pluginDir, manifest.main);
      if (fs.existsSync(mainPath)) {
        plugin.instance = this.loadPluginModule(mainPath, plugin.sandbox);

        // Call onLoad if defined
        if (plugin.instance?.onLoad) {
          // Run asynchronously but don't block
          plugin.instance.onLoad().catch((error) => {
            this.emit("plugin:load-error", {
              pluginId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }
    } catch (error) {
      plugin.status = "error";
      plugin.errorMessage = error instanceof Error ? error.message : String(error);
    }

    this.plugins.set(pluginId, plugin);
    this.savePluginState(plugin);

    this.emit("plugin:loaded", { plugin });

    // Auto-enable if configured
    if (this.config.autoEnablePlugins && plugin.status === "loaded") {
      this.enablePlugin(pluginId);
    }

    return plugin;
  }

  /**
   * Unload a plugin
   */
  async unloadPlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    // Disable first if enabled
    if (plugin.status === "enabled") {
      await this.disablePlugin(pluginId);
    }

    // Call onUnload
    if (plugin.instance?.onUnload) {
      try {
        await plugin.instance.onUnload();
      } catch (error) {
        this.emit("plugin:unload-error", {
          pluginId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Remove from memory
    this.plugins.delete(pluginId);

    // Update database
    this.db
      .prepare(`UPDATE plugins SET status = 'unloaded', updated_at = ? WHERE id = ?`)
      .run(Date.now(), pluginId);

    this.emit("plugin:unloaded", { pluginId });
    return true;
  }

  /**
   * Enable a plugin
   */
  async enablePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (plugin.status === "enabled") return true;
    if (plugin.status !== "loaded" && plugin.status !== "disabled") {
      throw new Error(`Cannot enable plugin in status: ${plugin.status}`);
    }

    // Resolve dependencies
    const resolution = this.resolveDependencies(pluginId);
    if (resolution.missing.length > 0) {
      throw new Error(`Missing dependencies: ${resolution.missing.map((d) => d.pluginId).join(", ")}`);
    }
    if (resolution.incompatible.length > 0) {
      throw new Error(
        `Incompatible dependencies: ${resolution.incompatible
          .map((d) => `${d.dependency.pluginId}@${d.dependency.versionConstraint} (found ${d.actual})`)
          .join(", ")}`
      );
    }

    // Enable dependencies first
    for (const dep of resolution.resolved) {
      if (dep.manifest.id !== pluginId && dep.status !== "enabled") {
        await this.enablePlugin(dep.manifest.id);
      }
    }

    // Register hooks
    if (plugin.instance?.registerHooks) {
      const registry = this.createHookRegistry(pluginId);
      plugin.instance.registerHooks(registry);
    }

    // Call onEnable
    if (plugin.instance?.onEnable) {
      try {
        await plugin.instance.onEnable();
      } catch (error) {
        plugin.status = "error";
        plugin.errorMessage = error instanceof Error ? error.message : String(error);
        this.savePluginState(plugin);
        throw error;
      }
    }

    plugin.status = "enabled";
    plugin.enabledAt = Date.now();
    this.savePluginState(plugin);

    this.emit("plugin:enabled", { plugin });
    return true;
  }

  /**
   * Disable a plugin
   */
  async disablePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    if (plugin.status !== "enabled") return true;

    // Check if other enabled plugins depend on this
    const dependents = this.getDependentPlugins(pluginId);
    const enabledDependents = dependents.filter((p) => p.status === "enabled");
    if (enabledDependents.length > 0) {
      throw new Error(
        `Cannot disable: required by ${enabledDependents.map((p) => p.manifest.id).join(", ")}`
      );
    }

    // Unregister hooks
    this.unregisterPluginHooks(pluginId);

    // Call onDisable
    if (plugin.instance?.onDisable) {
      try {
        await plugin.instance.onDisable();
      } catch (error) {
        this.emit("plugin:disable-error", {
          pluginId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    plugin.status = "disabled";
    plugin.disabledAt = Date.now();
    this.savePluginState(plugin);

    this.emit("plugin:disabled", { plugin });
    return true;
  }

  /**
   * Hot reload a plugin
   */
  async hotReload(pluginId: string): Promise<Plugin> {
    const plugin = this.plugins.get(pluginId);
    const wasEnabled = plugin?.status === "enabled";

    // Unload current version
    if (plugin) {
      await this.unloadPlugin(pluginId);
    }

    // Load fresh
    const newPlugin = this.loadPlugin(pluginId);

    // Re-enable if was enabled
    if (wasEnabled && newPlugin.status === "loaded") {
      await this.enablePlugin(pluginId);
    }

    this.emit("plugin:hot-reloaded", { plugin: newPlugin });
    return newPlugin;
  }

  /**
   * Execute hooks for a hook point
   */
  async executeHooks(hookPoint: string, args: unknown[]): Promise<unknown> {
    const hooks = this.hookRegistry.get(hookPoint) || [];
    if (hooks.length === 0) return args[0];

    // Sort by priority (descending) and phase order
    const sortedHooks = [...hooks].sort((a, b) => {
      const phaseOrder = { before: 0, around: 1, replace: 2, after: 3 };
      const phaseDiff = phaseOrder[a.phase] - phaseOrder[b.phase];
      if (phaseDiff !== 0) return phaseDiff;
      return b.priority - a.priority;
    });

    let currentArgs = args;
    let result: unknown = args[0];
    let replaced = false;

    for (const hook of sortedHooks) {
      if (replaced && hook.phase !== "after") continue;

      const context: HookContext = {
        hookPoint,
        phase: hook.phase,
        args: currentArgs,
        metadata: {},
        previousResult: result,
      };

      const startTime = Date.now();
      let hookResult: HookResult;
      let success = true;
      let errorMessage: string | undefined;

      try {
        hookResult = await this.executeHookWithTimeout(hook, context);

        if (!hookResult.proceed && hook.phase !== "after") {
          // Hook aborted the chain
          result = hookResult.result;
          break;
        }

        if (hookResult.modifiedArgs) {
          currentArgs = hookResult.modifiedArgs;
        }

        if (hook.phase === "replace" || hook.phase === "around") {
          result = hookResult.result ?? result;
          if (hook.phase === "replace") {
            replaced = true;
          }
        }

        if (hook.phase === "after") {
          result = hookResult.result ?? result;
        }
      } catch (error) {
        success = false;
        errorMessage = error instanceof Error ? error.message : String(error);
        this.emit("hook:error", { hookPoint, pluginId: hook.pluginId, error: errorMessage });
      }

      // Record execution
      this.recordHookExecution(hookPoint, hook.pluginId, hook.phase, Date.now() - startTime, success, errorMessage);
    }

    return result;
  }

  /**
   * Register a hook point (for documentation/validation)
   */
  registerHookPoint(hookPoint: string): void {
    if (!this.hookRegistry.has(hookPoint)) {
      this.hookRegistry.set(hookPoint, []);
      this.emit("hookpoint:registered", { hookPoint });
    }
  }

  /**
   * Get plugin by ID
   */
  getPlugin(pluginId: string): Plugin | null {
    return this.plugins.get(pluginId) ?? null;
  }

  /**
   * List all plugins
   */
  listPlugins(status?: PluginStatus): Plugin[] {
    const plugins = Array.from(this.plugins.values());
    if (status) {
      return plugins.filter((p) => p.status === status);
    }
    return plugins;
  }

  /**
   * Get plugin configuration
   */
  getPluginConfig(pluginId: string): Record<string, unknown> {
    const plugin = this.plugins.get(pluginId);
    return plugin?.config ?? {};
  }

  /**
   * Set plugin configuration
   */
  async setPluginConfig(pluginId: string, config: Record<string, unknown>): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    plugin.config = { ...plugin.config, ...config };

    // Persist config
    this.db
      .prepare(`UPDATE plugins SET config = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(plugin.config), Date.now(), pluginId);

    // Notify plugin
    if (plugin.instance?.onConfigChange) {
      await plugin.instance.onConfigChange(plugin.config);
    }

    this.emit("plugin:config-changed", { pluginId, config: plugin.config });
  }

  /**
   * Resolve dependencies for a plugin
   */
  resolveDependencies(pluginId: string): DependencyResolution {
    const result: DependencyResolution = {
      resolved: [],
      missing: [],
      circular: [],
      incompatible: [],
    };

    const visited = new Set<string>();
    const visiting = new Set<string>();

    const resolve = (id: string): boolean => {
      if (visited.has(id)) return true;
      if (visiting.has(id)) {
        result.circular.push(id);
        return false;
      }

      visiting.add(id);

      const plugin = this.plugins.get(id);
      if (!plugin) {
        return false;
      }

      for (const dep of plugin.manifest.dependencies) {
        const depPlugin = this.plugins.get(dep.pluginId);

        if (!depPlugin) {
          if (!dep.optional) {
            result.missing.push(dep);
          }
          continue;
        }

        // Check version constraint
        if (!this.checkVersionConstraint(depPlugin.manifest.version, dep.versionConstraint)) {
          result.incompatible.push({
            dependency: dep,
            actual: depPlugin.manifest.version,
          });
          continue;
        }

        resolve(dep.pluginId);
      }

      visiting.delete(id);
      visited.add(id);
      result.resolved.push(plugin);
      return true;
    };

    resolve(pluginId);
    return result;
  }

  /**
   * Get plugins that depend on a given plugin
   */
  getDependentPlugins(pluginId: string): Plugin[] {
    return Array.from(this.plugins.values()).filter((p) =>
      p.manifest.dependencies.some((d) => d.pluginId === pluginId && !d.optional)
    );
  }

  /**
   * Get all registered hook points
   */
  getHookPoints(): string[] {
    return Array.from(this.hookRegistry.keys());
  }

  /**
   * Get hooks for a specific hook point
   */
  getHooks(hookPoint: string): PluginHook[] {
    return this.hookRegistry.get(hookPoint) ?? [];
  }

  /**
   * Get plugin system statistics
   */
  getStats(): PluginStats {
    const plugins = Array.from(this.plugins.values());
    const allHooks = Array.from(this.hookRegistry.values()).flat();

    return {
      totalPlugins: plugins.length,
      loadedPlugins: plugins.filter((p) => p.status === "loaded").length,
      enabledPlugins: plugins.filter((p) => p.status === "enabled").length,
      disabledPlugins: plugins.filter((p) => p.status === "disabled").length,
      errorPlugins: plugins.filter((p) => p.status === "error").length,
      totalHooks: allHooks.length,
      totalCapabilities: plugins.reduce((sum, p) => sum + p.manifest.capabilities.length, 0),
    };
  }

  /**
   * Search plugins by capability
   */
  findPluginsByCapability(capabilityName: string): Plugin[] {
    return Array.from(this.plugins.values()).filter((p) =>
      p.manifest.capabilities.some((c) => c.name === capabilityName)
    );
  }

  /**
   * Search plugins by tag
   */
  findPluginsByTag(tag: string): Plugin[] {
    return Array.from(this.plugins.values()).filter((p) => p.manifest.tags.includes(tag));
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private validateManifest(manifest: PluginManifest): void {
    const required = ["id", "name", "version", "main"];
    for (const field of required) {
      if (!(field in manifest)) {
        throw new Error(`Missing required manifest field: ${field}`);
      }
    }

    // Validate version format
    if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(manifest.version)) {
      throw new Error(`Invalid version format: ${manifest.version}`);
    }

    // Set defaults
    manifest.description = manifest.description ?? "";
    manifest.author = manifest.author ?? "Unknown";
    manifest.dependencies = manifest.dependencies ?? [];
    manifest.capabilities = manifest.capabilities ?? [];
    manifest.hooks = manifest.hooks ?? [];
    manifest.permissions = manifest.permissions ?? [];
    manifest.tags = manifest.tags ?? [];
  }

  private checkSystemCompatibility(manifest: PluginManifest): boolean {
    const sysVersion = this.parseVersion(this.config.systemVersion);

    if (manifest.minSystemVersion) {
      const minVersion = this.parseVersion(manifest.minSystemVersion);
      if (this.compareVersions(sysVersion, minVersion) < 0) {
        return false;
      }
    }

    if (manifest.maxSystemVersion) {
      const maxVersion = this.parseVersion(manifest.maxSystemVersion);
      if (this.compareVersions(sysVersion, maxVersion) > 0) {
        return false;
      }
    }

    return true;
  }

  private parseVersion(version: string): PluginVersion {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(-(.+))?$/);
    if (!match) {
      return { major: 0, minor: 0, patch: 0 };
    }

    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
      prerelease: match[5],
    };
  }

  private compareVersions(a: PluginVersion, b: PluginVersion): number {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    if (a.patch !== b.patch) return a.patch - b.patch;
    return 0;
  }

  private checkVersionConstraint(actual: string, constraint: string): boolean {
    const actualV = this.parseVersion(actual);

    // Parse constraint (simplified semver)
    if (constraint.startsWith("^")) {
      // Compatible with major version
      const target = this.parseVersion(constraint.slice(1));
      return actualV.major === target.major && this.compareVersions(actualV, target) >= 0;
    }

    if (constraint.startsWith("~")) {
      // Compatible with minor version
      const target = this.parseVersion(constraint.slice(1));
      return (
        actualV.major === target.major &&
        actualV.minor === target.minor &&
        this.compareVersions(actualV, target) >= 0
      );
    }

    if (constraint.startsWith(">=")) {
      const target = this.parseVersion(constraint.slice(2));
      return this.compareVersions(actualV, target) >= 0;
    }

    if (constraint.startsWith(">")) {
      const target = this.parseVersion(constraint.slice(1));
      return this.compareVersions(actualV, target) > 0;
    }

    if (constraint.startsWith("<=")) {
      const target = this.parseVersion(constraint.slice(2));
      return this.compareVersions(actualV, target) <= 0;
    }

    if (constraint.startsWith("<")) {
      const target = this.parseVersion(constraint.slice(1));
      return this.compareVersions(actualV, target) < 0;
    }

    if (constraint.startsWith("=")) {
      const target = this.parseVersion(constraint.slice(1));
      return this.compareVersions(actualV, target) === 0;
    }

    // Exact match
    const target = this.parseVersion(constraint);
    return this.compareVersions(actualV, target) === 0;
  }

  private createPluginRecord(manifest: PluginManifest, status: PluginStatus): Plugin {
    return {
      manifest,
      status,
      version: this.parseVersion(manifest.version),
      hooks: [],
      config: {},
    };
  }

  private createSandbox(pluginId: string): PluginSandbox {
    const context = vm.createContext({
      console: {
        log: (...args: unknown[]) => this.emit("plugin:log", { pluginId, level: "info", args }),
        warn: (...args: unknown[]) => this.emit("plugin:log", { pluginId, level: "warn", args }),
        error: (...args: unknown[]) => this.emit("plugin:log", { pluginId, level: "error", args }),
      },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Promise,
      Buffer,
      // Add allowed modules
      require: (moduleName: string) => {
        if (this.config.allowedModules.includes(moduleName)) {
          return require(moduleName);
        }
        throw new Error(`Module not allowed: ${moduleName}`);
      },
    });

    return {
      context,
      timeout: this.config.sandboxTimeout,
      memoryLimit: this.config.sandboxMemoryLimit,
      allowedModules: this.config.allowedModules,
    };
  }

  private loadPluginModule(mainPath: string, sandbox: PluginSandbox): PluginInstance {
    const code = fs.readFileSync(mainPath, "utf-8");

    // Wrap code in a module-like structure
    const wrappedCode = `
      (function(exports, module) {
        ${code}
        return module.exports;
      })({}, { exports: {} })
    `;

    const script = new vm.Script(wrappedCode, {
      filename: mainPath,
    });

    const result = script.runInContext(sandbox.context, {
      timeout: sandbox.timeout,
    });

    return result as PluginInstance;
  }

  private loadPluginConfig(pluginId: string): Record<string, unknown> {
    const row = this.db
      .prepare(`SELECT config FROM plugins WHERE id = ?`)
      .get(pluginId) as { config: string } | undefined;

    if (row) {
      try {
        return JSON.parse(row.config);
      } catch {
        return {};
      }
    }
    return {};
  }

  private savePluginState(plugin: Plugin): void {
    const now = Date.now();

    this.db
      .prepare(
        `
      INSERT INTO plugins (id, manifest, status, config, loaded_at, enabled_at, disabled_at, error_message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        manifest = excluded.manifest,
        status = excluded.status,
        config = excluded.config,
        loaded_at = excluded.loaded_at,
        enabled_at = excluded.enabled_at,
        disabled_at = excluded.disabled_at,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at
    `
      )
      .run(
        plugin.manifest.id,
        JSON.stringify(plugin.manifest),
        plugin.status,
        JSON.stringify(plugin.config),
        plugin.loadedAt ?? null,
        plugin.enabledAt ?? null,
        plugin.disabledAt ?? null,
        plugin.errorMessage ?? null,
        now,
        now
      );
  }

  private createHookRegistry(pluginId: string): HookRegistry {
    const self = this;

    return {
      register(hookPoint: string, phase: HookPhase, handler: HookHandler, priority = 100): string {
        const id = `hook-${pluginId}-${hookPoint}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        const hook: PluginHook = {
          id,
          pluginId,
          hookPoint,
          phase,
          priority,
          handler,
        };

        // Add to plugin's hooks
        const plugin = self.plugins.get(pluginId);
        if (plugin) {
          plugin.hooks.push(hook);
        }

        // Add to registry
        if (!self.hookRegistry.has(hookPoint)) {
          self.hookRegistry.set(hookPoint, []);
        }
        self.hookRegistry.get(hookPoint)!.push(hook);

        // Persist
        self.db
          .prepare(
            `
          INSERT INTO plugin_hooks (id, plugin_id, hook_point, phase, priority, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
          )
          .run(id, pluginId, hookPoint, phase, priority, Date.now());

        self.emit("hook:registered", { hook });
        return id;
      },

      unregister(hookId: string): boolean {
        const entries = Array.from(self.hookRegistry.entries());
        for (const [, hooks] of entries) {
          const idx = hooks.findIndex((h) => h.id === hookId);
          if (idx !== -1) {
            hooks.splice(idx, 1);
            self.db.prepare(`DELETE FROM plugin_hooks WHERE id = ?`).run(hookId);
            self.emit("hook:unregistered", { hookId });
            return true;
          }
        }
        return false;
      },

      getHooks(hookPoint: string): PluginHook[] {
        return self.hookRegistry.get(hookPoint) ?? [];
      },
    };
  }

  private unregisterPluginHooks(pluginId: string): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    for (const hook of plugin.hooks) {
      const hooks = this.hookRegistry.get(hook.hookPoint);
      if (hooks) {
        const idx = hooks.findIndex((h) => h.id === hook.id);
        if (idx !== -1) {
          hooks.splice(idx, 1);
        }
      }
    }

    plugin.hooks = [];

    // Remove from database
    this.db.prepare(`DELETE FROM plugin_hooks WHERE plugin_id = ?`).run(pluginId);
  }

  private async executeHookWithTimeout(hook: PluginHook, context: HookContext): Promise<HookResult> {
    const plugin = this.plugins.get(hook.pluginId);
    const timeout = plugin?.sandbox?.timeout ?? this.config.sandboxTimeout;

    return Promise.race([
      hook.handler(context),
      new Promise<HookResult>((_, reject) =>
        setTimeout(() => reject(new Error("Hook execution timeout")), timeout)
      ),
    ]);
  }

  private recordHookExecution(
    hookPoint: string,
    pluginId: string,
    phase: HookPhase,
    durationMs: number,
    success: boolean,
    errorMessage?: string
  ): void {
    this.db
      .prepare(
        `
      INSERT INTO hook_executions (hook_point, plugin_id, phase, duration_ms, success, error_message, executed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(hookPoint, pluginId, phase, durationMs, success ? 1 : 0, errorMessage ?? null, Date.now());

    // Cleanup old executions (keep last 10000)
    this.db
      .prepare(
        `
      DELETE FROM hook_executions WHERE id NOT IN (
        SELECT id FROM hook_executions ORDER BY executed_at DESC LIMIT 10000
      )
    `
      )
      .run();
  }

  private startHotReloadWatcher(): void {
    const pluginDir = path.resolve(this.config.pluginDir);

    this.fileWatcher = fs.watch(pluginDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      // Debounce hot reload
      if (this.hotReloadDebounce) {
        clearTimeout(this.hotReloadDebounce);
      }

      this.hotReloadDebounce = setTimeout(() => {
        const pluginId = filename.split(path.sep)[0];
        const plugin = this.plugins.get(pluginId);

        if (plugin) {
          this.hotReload(pluginId).catch((error) => {
            this.emit("plugin:hot-reload-error", {
              pluginId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }, this.config.hotReloadDebounceMs);
    });
  }

  private stopHotReloadWatcher(): void {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = undefined;
    }

    if (this.hotReloadDebounce) {
      clearTimeout(this.hotReloadDebounce);
      this.hotReloadDebounce = undefined;
    }
  }

  /**
   * Close the plugin system
   */
  async close(): Promise<void> {
    // Stop hot reload watcher
    this.stopHotReloadWatcher();

    // Disable all enabled plugins
    const plugins = Array.from(this.plugins.values());
    for (const plugin of plugins) {
      if (plugin.status === "enabled") {
        try {
          await this.disablePlugin(plugin.manifest.id);
        } catch (error) {
          this.emit("plugin:close-error", {
            pluginId: plugin.manifest.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Unload all plugins
    const pluginIds = Array.from(this.plugins.keys());
    for (const pluginId of pluginIds) {
      try {
        await this.unloadPlugin(pluginId);
      } catch (error) {
        this.emit("plugin:close-error", {
          pluginId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.db.close();
    this.emit("system:closed");
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let instance: PluginSystem | null = null;

export function getPluginSystem(
  dataDir: string,
  config?: Partial<PluginSystemConfig>
): PluginSystem {
  if (!instance) {
    instance = new PluginSystem(dataDir, config);
  }
  return instance;
}

export function resetPluginSystem(): void {
  if (instance) {
    instance.close().catch(() => {
      // Ignore errors during reset
    });
    instance = null;
  }
}
