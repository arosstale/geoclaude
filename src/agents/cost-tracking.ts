/**
 * Class 3.15: Cost Tracking System
 * TAC Pattern: Token/API cost monitoring and budget management
 *
 * Features:
 * - Token usage tracking per model/provider
 * - API call cost estimation
 * - Budget limits with alerts
 * - Usage reports and analytics
 * - Cost optimization suggestions
 * - Per-user and per-channel tracking
 */

import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import { join } from 'path';

// ============================================================================
// Types
// ============================================================================

export type CostProvider = 'openrouter' | 'openai' | 'anthropic' | 'groq' | 'cerebras' | 'zai' | 'ollama' | 'custom';
export type CostPeriod = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type BudgetScope = 'global' | 'user' | 'channel' | 'agent';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface ModelPricing {
  modelId: string;
  provider: CostProvider;
  inputCostPer1k: number;   // Cost per 1000 input tokens
  outputCostPer1k: number;  // Cost per 1000 output tokens
  cachedInputCostPer1k?: number;  // Discounted cached input cost
  currency: string;
  effectiveDate: Date;
  notes?: string;
}

export interface UsageRecord {
  id: string;
  timestamp: Date;
  provider: CostProvider;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCost: number;
  actualCost?: number;
  userId?: string;
  channelId?: string;
  agentId?: string;
  operationType: string;
  metadata?: Record<string, unknown>;
}

export interface Budget {
  id: string;
  name: string;
  scope: BudgetScope;
  scopeId?: string;  // userId, channelId, or agentId
  limit: number;
  period: CostPeriod;
  currency: string;
  alertThresholds: number[];  // Percentages to alert at (e.g., [50, 75, 90])
  createdAt: Date;
  createdBy: string;
  isActive: boolean;
}

export interface BudgetStatus {
  budget: Budget;
  currentSpend: number;
  remainingBudget: number;
  percentUsed: number;
  periodStart: Date;
  periodEnd: Date;
  projectedSpend: number;
  isOverBudget: boolean;
  triggeredThresholds: number[];
}

export interface CostAlert {
  id: string;
  budgetId: string;
  severity: AlertSeverity;
  threshold: number;
  currentSpend: number;
  budgetLimit: number;
  message: string;
  timestamp: Date;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
}

export interface CostReport {
  period: CostPeriod;
  startDate: Date;
  endDate: Date;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  byProvider: Record<string, ProviderCostSummary>;
  byModel: Record<string, ModelCostSummary>;
  byUser?: Record<string, number>;
  byChannel?: Record<string, number>;
  byAgent?: Record<string, number>;
  topOperations: OperationCostSummary[];
  costTrend: CostTrendPoint[];
}

export interface ProviderCostSummary {
  provider: CostProvider;
  totalCost: number;
  totalCalls: number;
  inputTokens: number;
  outputTokens: number;
  averageCostPerCall: number;
}

export interface ModelCostSummary {
  modelId: string;
  provider: CostProvider;
  totalCost: number;
  totalCalls: number;
  inputTokens: number;
  outputTokens: number;
  averageCostPerCall: number;
}

export interface OperationCostSummary {
  operationType: string;
  totalCost: number;
  callCount: number;
  averageCost: number;
}

export interface CostTrendPoint {
  timestamp: Date;
  cost: number;
  cumulative: number;
}

export interface CostOptimization {
  id: string;
  type: 'model_switch' | 'caching' | 'batching' | 'prompt_optimization' | 'provider_switch';
  currentCost: number;
  projectedSavings: number;
  savingsPercent: number;
  recommendation: string;
  details: Record<string, unknown>;
  priority: 'low' | 'medium' | 'high';
  createdAt: Date;
}

export interface CostTrackingConfig {
  dataDir: string;
  defaultCurrency: string;
  alertWebhook?: string;
  retentionDays: number;
  enableOptimizations: boolean;
}

// ============================================================================
// Default Pricing (as of 2024)
// ============================================================================

const DEFAULT_PRICING: ModelPricing[] = [
  // OpenRouter
  { modelId: 'anthropic/claude-3.5-sonnet', provider: 'openrouter', inputCostPer1k: 0.003, outputCostPer1k: 0.015, currency: 'USD', effectiveDate: new Date() },
  { modelId: 'anthropic/claude-3-opus', provider: 'openrouter', inputCostPer1k: 0.015, outputCostPer1k: 0.075, currency: 'USD', effectiveDate: new Date() },
  { modelId: 'anthropic/claude-3-haiku', provider: 'openrouter', inputCostPer1k: 0.00025, outputCostPer1k: 0.00125, currency: 'USD', effectiveDate: new Date() },
  { modelId: 'openai/gpt-4-turbo', provider: 'openrouter', inputCostPer1k: 0.01, outputCostPer1k: 0.03, currency: 'USD', effectiveDate: new Date() },
  { modelId: 'openai/gpt-4o', provider: 'openrouter', inputCostPer1k: 0.005, outputCostPer1k: 0.015, currency: 'USD', effectiveDate: new Date() },
  { modelId: 'openai/gpt-4o-mini', provider: 'openrouter', inputCostPer1k: 0.00015, outputCostPer1k: 0.0006, currency: 'USD', effectiveDate: new Date() },
  { modelId: 'google/gemini-pro-1.5', provider: 'openrouter', inputCostPer1k: 0.00125, outputCostPer1k: 0.005, currency: 'USD', effectiveDate: new Date() },
  { modelId: 'meta-llama/llama-3.1-405b', provider: 'openrouter', inputCostPer1k: 0.003, outputCostPer1k: 0.003, currency: 'USD', effectiveDate: new Date() },
  { modelId: 'deepseek/deepseek-chat', provider: 'openrouter', inputCostPer1k: 0.00014, outputCostPer1k: 0.00028, currency: 'USD', effectiveDate: new Date() },

  // Direct Anthropic
  { modelId: 'claude-3-5-sonnet-20241022', provider: 'anthropic', inputCostPer1k: 0.003, outputCostPer1k: 0.015, cachedInputCostPer1k: 0.0003, currency: 'USD', effectiveDate: new Date() },
  { modelId: 'claude-3-opus-20240229', provider: 'anthropic', inputCostPer1k: 0.015, outputCostPer1k: 0.075, cachedInputCostPer1k: 0.0015, currency: 'USD', effectiveDate: new Date() },

  // Free tiers
  { modelId: 'llama-3.3-70b-versatile', provider: 'groq', inputCostPer1k: 0, outputCostPer1k: 0, currency: 'USD', effectiveDate: new Date(), notes: 'Free tier' },
  { modelId: 'llama3.3-70b', provider: 'cerebras', inputCostPer1k: 0, outputCostPer1k: 0, currency: 'USD', effectiveDate: new Date(), notes: 'Free tier' },
  { modelId: 'glm-4-plus', provider: 'zai', inputCostPer1k: 0, outputCostPer1k: 0, currency: 'USD', effectiveDate: new Date(), notes: 'Free tier' },

  // Local
  { modelId: 'ollama/*', provider: 'ollama', inputCostPer1k: 0, outputCostPer1k: 0, currency: 'USD', effectiveDate: new Date(), notes: 'Local inference' },
];

// ============================================================================
// Cost Tracking System
// ============================================================================

export class CostTrackingSystem extends EventEmitter {
  private db: Database.Database;
  private config: CostTrackingConfig;
  private pricing: Map<string, ModelPricing> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: CostTrackingConfig) {
    super();
    this.config = config;
    this.db = new Database(join(config.dataDir, 'cost_tracking.db'));
    this.initializeDatabase();
    this.loadDefaultPricing();
    this.startCleanupScheduler();
  }

  private initializeDatabase(): void {
    this.db.pragma('journal_mode = WAL');

    // Model pricing table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS model_pricing (
        model_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        input_cost_per_1k REAL NOT NULL,
        output_cost_per_1k REAL NOT NULL,
        cached_input_cost_per_1k REAL,
        currency TEXT NOT NULL DEFAULT 'USD',
        effective_date TEXT NOT NULL,
        notes TEXT,
        PRIMARY KEY (model_id, provider)
      )
    `);

    // Usage records table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost REAL NOT NULL,
        actual_cost REAL,
        user_id TEXT,
        channel_id TEXT,
        agent_id TEXT,
        operation_type TEXT NOT NULL,
        metadata TEXT
      )
    `);

    // Budgets table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS budgets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_id TEXT,
        limit_amount REAL NOT NULL,
        period TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        alert_thresholds TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `);

    // Cost alerts table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cost_alerts (
        id TEXT PRIMARY KEY,
        budget_id TEXT NOT NULL,
        severity TEXT NOT NULL,
        threshold REAL NOT NULL,
        current_spend REAL NOT NULL,
        budget_limit REAL NOT NULL,
        message TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0,
        acknowledged_by TEXT,
        acknowledged_at TEXT,
        FOREIGN KEY (budget_id) REFERENCES budgets(id)
      )
    `);

    // Optimizations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cost_optimizations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        current_cost REAL NOT NULL,
        projected_savings REAL NOT NULL,
        savings_percent REAL NOT NULL,
        recommendation TEXT NOT NULL,
        details TEXT,
        priority TEXT NOT NULL,
        created_at TEXT NOT NULL,
        dismissed INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_records(timestamp);
      CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_records(provider);
      CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_records(user_id);
      CREATE INDEX IF NOT EXISTS idx_usage_channel ON usage_records(channel_id);
      CREATE INDEX IF NOT EXISTS idx_usage_agent ON usage_records(agent_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_budget ON cost_alerts(budget_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON cost_alerts(timestamp);
    `);
  }

  private loadDefaultPricing(): void {
    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO model_pricing
      (model_id, provider, input_cost_per_1k, output_cost_per_1k, cached_input_cost_per_1k, currency, effective_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      for (const pricing of DEFAULT_PRICING) {
        insertStmt.run(
          pricing.modelId,
          pricing.provider,
          pricing.inputCostPer1k,
          pricing.outputCostPer1k,
          pricing.cachedInputCostPer1k ?? null,
          pricing.currency,
          pricing.effectiveDate.toISOString(),
          pricing.notes ?? null
        );
        this.pricing.set(`${pricing.provider}:${pricing.modelId}`, pricing);
      }
    });
    transaction();
  }

  private startCleanupScheduler(): void {
    // Run cleanup daily
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldRecords();
    }, 24 * 60 * 60 * 1000);
  }

  private cleanupOldRecords(): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

    const stmt = this.db.prepare(`
      DELETE FROM usage_records WHERE timestamp < ?
    `);
    const result = stmt.run(cutoffDate.toISOString());

    if (result.changes > 0) {
      this.emit('cleanup', { deletedRecords: result.changes });
    }
  }

  // ============================================================================
  // Pricing Management
  // ============================================================================

  setPricing(pricing: ModelPricing): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO model_pricing
      (model_id, provider, input_cost_per_1k, output_cost_per_1k, cached_input_cost_per_1k, currency, effective_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      pricing.modelId,
      pricing.provider,
      pricing.inputCostPer1k,
      pricing.outputCostPer1k,
      pricing.cachedInputCostPer1k ?? null,
      pricing.currency,
      pricing.effectiveDate.toISOString(),
      pricing.notes ?? null
    );

    this.pricing.set(`${pricing.provider}:${pricing.modelId}`, pricing);
    this.emit('pricing:updated', pricing);
  }

  getPricing(provider: CostProvider, modelId: string): ModelPricing | null {
    // Try exact match first
    const key = `${provider}:${modelId}`;
    if (this.pricing.has(key)) {
      return this.pricing.get(key)!;
    }

    // Try wildcard match (e.g., ollama/*)
    const wildcardKey = `${provider}:${provider}/*`;
    if (this.pricing.has(wildcardKey)) {
      return this.pricing.get(wildcardKey)!;
    }

    // Try loading from database
    const stmt = this.db.prepare(`
      SELECT * FROM model_pricing WHERE provider = ? AND (model_id = ? OR model_id = ?)
    `);
    const row = stmt.get(provider, modelId, `${provider}/*`) as Record<string, unknown> | undefined;

    if (row) {
      const pricing: ModelPricing = {
        modelId: row.model_id as string,
        provider: row.provider as CostProvider,
        inputCostPer1k: row.input_cost_per_1k as number,
        outputCostPer1k: row.output_cost_per_1k as number,
        cachedInputCostPer1k: row.cached_input_cost_per_1k as number | undefined,
        currency: row.currency as string,
        effectiveDate: new Date(row.effective_date as string),
        notes: row.notes as string | undefined,
      };
      this.pricing.set(key, pricing);
      return pricing;
    }

    return null;
  }

  getAllPricing(): ModelPricing[] {
    const stmt = this.db.prepare(`SELECT * FROM model_pricing ORDER BY provider, model_id`);
    const rows = stmt.all() as Record<string, unknown>[];

    return rows.map(row => ({
      modelId: row.model_id as string,
      provider: row.provider as CostProvider,
      inputCostPer1k: row.input_cost_per_1k as number,
      outputCostPer1k: row.output_cost_per_1k as number,
      cachedInputCostPer1k: row.cached_input_cost_per_1k as number | undefined,
      currency: row.currency as string,
      effectiveDate: new Date(row.effective_date as string),
      notes: row.notes as string | undefined,
    }));
  }

  // ============================================================================
  // Usage Tracking
  // ============================================================================

  recordUsage(params: {
    provider: CostProvider;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    actualCost?: number;
    userId?: string;
    channelId?: string;
    agentId?: string;
    operationType: string;
    metadata?: Record<string, unknown>;
  }): UsageRecord {
    const id = `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date();
    const cachedTokens = params.cachedTokens ?? 0;

    // Calculate estimated cost
    const pricing = this.getPricing(params.provider, params.modelId);
    let estimatedCost = 0;

    if (pricing) {
      const inputCost = ((params.inputTokens - cachedTokens) / 1000) * pricing.inputCostPer1k;
      const cachedCost = pricing.cachedInputCostPer1k
        ? (cachedTokens / 1000) * pricing.cachedInputCostPer1k
        : 0;
      const outputCost = (params.outputTokens / 1000) * pricing.outputCostPer1k;
      estimatedCost = inputCost + cachedCost + outputCost;
    }

    const record: UsageRecord = {
      id,
      timestamp,
      provider: params.provider,
      modelId: params.modelId,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      cachedTokens,
      estimatedCost,
      actualCost: params.actualCost,
      userId: params.userId,
      channelId: params.channelId,
      agentId: params.agentId,
      operationType: params.operationType,
      metadata: params.metadata,
    };

    const stmt = this.db.prepare(`
      INSERT INTO usage_records
      (id, timestamp, provider, model_id, input_tokens, output_tokens, cached_tokens,
       estimated_cost, actual_cost, user_id, channel_id, agent_id, operation_type, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.timestamp.toISOString(),
      record.provider,
      record.modelId,
      record.inputTokens,
      record.outputTokens,
      record.cachedTokens,
      record.estimatedCost,
      record.actualCost ?? null,
      record.userId ?? null,
      record.channelId ?? null,
      record.agentId ?? null,
      record.operationType,
      record.metadata ? JSON.stringify(record.metadata) : null
    );

    this.emit('usage:recorded', record);

    // Check budgets
    this.checkBudgets(record);

    return record;
  }

  getUsage(params: {
    startDate?: Date;
    endDate?: Date;
    provider?: CostProvider;
    modelId?: string;
    userId?: string;
    channelId?: string;
    agentId?: string;
    limit?: number;
  }): UsageRecord[] {
    let query = 'SELECT * FROM usage_records WHERE 1=1';
    const queryParams: unknown[] = [];

    if (params.startDate) {
      query += ' AND timestamp >= ?';
      queryParams.push(params.startDate.toISOString());
    }
    if (params.endDate) {
      query += ' AND timestamp <= ?';
      queryParams.push(params.endDate.toISOString());
    }
    if (params.provider) {
      query += ' AND provider = ?';
      queryParams.push(params.provider);
    }
    if (params.modelId) {
      query += ' AND model_id = ?';
      queryParams.push(params.modelId);
    }
    if (params.userId) {
      query += ' AND user_id = ?';
      queryParams.push(params.userId);
    }
    if (params.channelId) {
      query += ' AND channel_id = ?';
      queryParams.push(params.channelId);
    }
    if (params.agentId) {
      query += ' AND agent_id = ?';
      queryParams.push(params.agentId);
    }

    query += ' ORDER BY timestamp DESC';

    if (params.limit) {
      query += ' LIMIT ?';
      queryParams.push(params.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...queryParams) as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      timestamp: new Date(row.timestamp as string),
      provider: row.provider as CostProvider,
      modelId: row.model_id as string,
      inputTokens: row.input_tokens as number,
      outputTokens: row.output_tokens as number,
      cachedTokens: row.cached_tokens as number,
      estimatedCost: row.estimated_cost as number,
      actualCost: row.actual_cost as number | undefined,
      userId: row.user_id as string | undefined,
      channelId: row.channel_id as string | undefined,
      agentId: row.agent_id as string | undefined,
      operationType: row.operation_type as string,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    }));
  }

  // ============================================================================
  // Budget Management
  // ============================================================================

  createBudget(params: {
    name: string;
    scope: BudgetScope;
    scopeId?: string;
    limit: number;
    period: CostPeriod;
    alertThresholds?: number[];
    createdBy: string;
  }): Budget {
    const id = `budget_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const alertThresholds = params.alertThresholds ?? [50, 75, 90];

    const budget: Budget = {
      id,
      name: params.name,
      scope: params.scope,
      scopeId: params.scopeId,
      limit: params.limit,
      period: params.period,
      currency: this.config.defaultCurrency,
      alertThresholds,
      createdAt: new Date(),
      createdBy: params.createdBy,
      isActive: true,
    };

    const stmt = this.db.prepare(`
      INSERT INTO budgets
      (id, name, scope, scope_id, limit_amount, period, currency, alert_thresholds, created_at, created_by, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      budget.id,
      budget.name,
      budget.scope,
      budget.scopeId ?? null,
      budget.limit,
      budget.period,
      budget.currency,
      JSON.stringify(budget.alertThresholds),
      budget.createdAt.toISOString(),
      budget.createdBy,
      budget.isActive ? 1 : 0
    );

    this.emit('budget:created', budget);
    return budget;
  }

  getBudget(budgetId: string): Budget | null {
    const stmt = this.db.prepare('SELECT * FROM budgets WHERE id = ?');
    const row = stmt.get(budgetId) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      id: row.id as string,
      name: row.name as string,
      scope: row.scope as BudgetScope,
      scopeId: row.scope_id as string | undefined,
      limit: row.limit_amount as number,
      period: row.period as CostPeriod,
      currency: row.currency as string,
      alertThresholds: JSON.parse(row.alert_thresholds as string),
      createdAt: new Date(row.created_at as string),
      createdBy: row.created_by as string,
      isActive: Boolean(row.is_active),
    };
  }

  getAllBudgets(activeOnly: boolean = true): Budget[] {
    const query = activeOnly
      ? 'SELECT * FROM budgets WHERE is_active = 1 ORDER BY created_at DESC'
      : 'SELECT * FROM budgets ORDER BY created_at DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all() as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      name: row.name as string,
      scope: row.scope as BudgetScope,
      scopeId: row.scope_id as string | undefined,
      limit: row.limit_amount as number,
      period: row.period as CostPeriod,
      currency: row.currency as string,
      alertThresholds: JSON.parse(row.alert_thresholds as string),
      createdAt: new Date(row.created_at as string),
      createdBy: row.created_by as string,
      isActive: Boolean(row.is_active),
    }));
  }

  deactivateBudget(budgetId: string): boolean {
    const stmt = this.db.prepare('UPDATE budgets SET is_active = 0 WHERE id = ?');
    const result = stmt.run(budgetId);

    if (result.changes > 0) {
      this.emit('budget:deactivated', { budgetId });
      return true;
    }
    return false;
  }

  getBudgetStatus(budgetId: string): BudgetStatus | null {
    const budget = this.getBudget(budgetId);
    if (!budget) return null;

    const { start, end } = this.getPeriodBounds(budget.period);
    const currentSpend = this.calculateSpendForBudget(budget, start, end);
    const percentUsed = (currentSpend / budget.limit) * 100;

    // Calculate projected spend based on time elapsed
    const now = Date.now();
    const periodDuration = end.getTime() - start.getTime();
    const elapsed = now - start.getTime();
    const projectedSpend = elapsed > 0 ? (currentSpend / elapsed) * periodDuration : currentSpend;

    const triggeredThresholds = budget.alertThresholds.filter(t => percentUsed >= t);

    return {
      budget,
      currentSpend,
      remainingBudget: Math.max(0, budget.limit - currentSpend),
      percentUsed,
      periodStart: start,
      periodEnd: end,
      projectedSpend,
      isOverBudget: currentSpend > budget.limit,
      triggeredThresholds,
    };
  }

  private getPeriodBounds(period: CostPeriod): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    switch (period) {
      case 'hourly':
        start.setMinutes(0, 0, 0);
        end.setMinutes(59, 59, 999);
        break;
      case 'daily':
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'weekly':
        const day = start.getDay();
        start.setDate(start.getDate() - day);
        start.setHours(0, 0, 0, 0);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        break;
      case 'monthly':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        end.setMonth(end.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'yearly':
        start.setMonth(0, 1);
        start.setHours(0, 0, 0, 0);
        end.setMonth(11, 31);
        end.setHours(23, 59, 59, 999);
        break;
    }

    return { start, end };
  }

  private calculateSpendForBudget(budget: Budget, start: Date, end: Date): number {
    let query = `
      SELECT COALESCE(SUM(COALESCE(actual_cost, estimated_cost)), 0) as total
      FROM usage_records
      WHERE timestamp >= ? AND timestamp <= ?
    `;
    const params: unknown[] = [start.toISOString(), end.toISOString()];

    switch (budget.scope) {
      case 'user':
        query += ' AND user_id = ?';
        params.push(budget.scopeId);
        break;
      case 'channel':
        query += ' AND channel_id = ?';
        params.push(budget.scopeId);
        break;
      case 'agent':
        query += ' AND agent_id = ?';
        params.push(budget.scopeId);
        break;
      // 'global' has no additional filter
    }

    const stmt = this.db.prepare(query);
    const result = stmt.get(...params) as { total: number };
    return result.total;
  }

  private checkBudgets(record: UsageRecord): void {
    const budgets = this.getAllBudgets(true);

    for (const budget of budgets) {
      // Check if this record applies to this budget
      let applies = false;
      switch (budget.scope) {
        case 'global':
          applies = true;
          break;
        case 'user':
          applies = record.userId === budget.scopeId;
          break;
        case 'channel':
          applies = record.channelId === budget.scopeId;
          break;
        case 'agent':
          applies = record.agentId === budget.scopeId;
          break;
      }

      if (!applies) continue;

      const status = this.getBudgetStatus(budget.id);
      if (!status) continue;

      // Check for threshold crossings
      for (const threshold of budget.alertThresholds) {
        if (status.percentUsed >= threshold) {
          // Check if we already have an unacknowledged alert for this threshold
          const existingAlert = this.getExistingAlert(budget.id, threshold);
          if (!existingAlert) {
            this.createAlert(budget, status, threshold);
          }
        }
      }
    }
  }

  private getExistingAlert(budgetId: string, threshold: number): CostAlert | null {
    const { start } = this.getPeriodBounds(this.getBudget(budgetId)?.period ?? 'monthly');

    const stmt = this.db.prepare(`
      SELECT * FROM cost_alerts
      WHERE budget_id = ? AND threshold = ? AND timestamp >= ? AND acknowledged = 0
    `);
    const row = stmt.get(budgetId, threshold, start.toISOString()) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      id: row.id as string,
      budgetId: row.budget_id as string,
      severity: row.severity as AlertSeverity,
      threshold: row.threshold as number,
      currentSpend: row.current_spend as number,
      budgetLimit: row.budget_limit as number,
      message: row.message as string,
      timestamp: new Date(row.timestamp as string),
      acknowledged: Boolean(row.acknowledged),
      acknowledgedBy: row.acknowledged_by as string | undefined,
      acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at as string) : undefined,
    };
  }

  private createAlert(budget: Budget, status: BudgetStatus, threshold: number): CostAlert {
    const id = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    let severity: AlertSeverity = 'info';
    if (threshold >= 90 || status.isOverBudget) severity = 'critical';
    else if (threshold >= 75) severity = 'warning';

    const message = status.isOverBudget
      ? `Budget "${budget.name}" exceeded! Spent $${status.currentSpend.toFixed(2)} of $${budget.limit.toFixed(2)} limit.`
      : `Budget "${budget.name}" reached ${threshold}% threshold. Spent $${status.currentSpend.toFixed(2)} of $${budget.limit.toFixed(2)} limit.`;

    const alert: CostAlert = {
      id,
      budgetId: budget.id,
      severity,
      threshold,
      currentSpend: status.currentSpend,
      budgetLimit: budget.limit,
      message,
      timestamp: new Date(),
      acknowledged: false,
    };

    const stmt = this.db.prepare(`
      INSERT INTO cost_alerts
      (id, budget_id, severity, threshold, current_spend, budget_limit, message, timestamp, acknowledged)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      alert.id,
      alert.budgetId,
      alert.severity,
      alert.threshold,
      alert.currentSpend,
      alert.budgetLimit,
      alert.message,
      alert.timestamp.toISOString(),
      0
    );

    this.emit('alert:created', alert);
    return alert;
  }

  getAlerts(params: {
    budgetId?: string;
    severity?: AlertSeverity;
    acknowledged?: boolean;
    limit?: number;
  } = {}): CostAlert[] {
    let query = 'SELECT * FROM cost_alerts WHERE 1=1';
    const queryParams: unknown[] = [];

    if (params.budgetId) {
      query += ' AND budget_id = ?';
      queryParams.push(params.budgetId);
    }
    if (params.severity) {
      query += ' AND severity = ?';
      queryParams.push(params.severity);
    }
    if (params.acknowledged !== undefined) {
      query += ' AND acknowledged = ?';
      queryParams.push(params.acknowledged ? 1 : 0);
    }

    query += ' ORDER BY timestamp DESC';

    if (params.limit) {
      query += ' LIMIT ?';
      queryParams.push(params.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...queryParams) as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      budgetId: row.budget_id as string,
      severity: row.severity as AlertSeverity,
      threshold: row.threshold as number,
      currentSpend: row.current_spend as number,
      budgetLimit: row.budget_limit as number,
      message: row.message as string,
      timestamp: new Date(row.timestamp as string),
      acknowledged: Boolean(row.acknowledged),
      acknowledgedBy: row.acknowledged_by as string | undefined,
      acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at as string) : undefined,
    }));
  }

  acknowledgeAlert(alertId: string, userId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE cost_alerts
      SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = ?
      WHERE id = ?
    `);
    const result = stmt.run(userId, new Date().toISOString(), alertId);

    if (result.changes > 0) {
      this.emit('alert:acknowledged', { alertId, userId });
      return true;
    }
    return false;
  }

  // ============================================================================
  // Reporting
  // ============================================================================

  generateReport(params: {
    period: CostPeriod;
    startDate?: Date;
    endDate?: Date;
    includeByUser?: boolean;
    includeByChannel?: boolean;
    includeByAgent?: boolean;
  }): CostReport {
    const { start, end } = params.startDate && params.endDate
      ? { start: params.startDate, end: params.endDate }
      : this.getPeriodBounds(params.period);

    // Get all records for the period
    const records = this.getUsage({ startDate: start, endDate: end });

    // Calculate totals
    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedTokens = 0;
    const byProvider: Record<string, ProviderCostSummary> = {};
    const byModel: Record<string, ModelCostSummary> = {};
    const byUser: Record<string, number> = {};
    const byChannel: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    const operationCosts: Record<string, { cost: number; count: number }> = {};

    for (const record of records) {
      const cost = record.actualCost ?? record.estimatedCost;
      totalCost += cost;
      totalInputTokens += record.inputTokens;
      totalOutputTokens += record.outputTokens;
      totalCachedTokens += record.cachedTokens;

      // By provider
      if (!byProvider[record.provider]) {
        byProvider[record.provider] = {
          provider: record.provider,
          totalCost: 0,
          totalCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          averageCostPerCall: 0,
        };
      }
      byProvider[record.provider].totalCost += cost;
      byProvider[record.provider].totalCalls++;
      byProvider[record.provider].inputTokens += record.inputTokens;
      byProvider[record.provider].outputTokens += record.outputTokens;

      // By model
      const modelKey = `${record.provider}:${record.modelId}`;
      if (!byModel[modelKey]) {
        byModel[modelKey] = {
          modelId: record.modelId,
          provider: record.provider,
          totalCost: 0,
          totalCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          averageCostPerCall: 0,
        };
      }
      byModel[modelKey].totalCost += cost;
      byModel[modelKey].totalCalls++;
      byModel[modelKey].inputTokens += record.inputTokens;
      byModel[modelKey].outputTokens += record.outputTokens;

      // By user
      if (record.userId) {
        byUser[record.userId] = (byUser[record.userId] ?? 0) + cost;
      }

      // By channel
      if (record.channelId) {
        byChannel[record.channelId] = (byChannel[record.channelId] ?? 0) + cost;
      }

      // By agent
      if (record.agentId) {
        byAgent[record.agentId] = (byAgent[record.agentId] ?? 0) + cost;
      }

      // By operation
      if (!operationCosts[record.operationType]) {
        operationCosts[record.operationType] = { cost: 0, count: 0 };
      }
      operationCosts[record.operationType].cost += cost;
      operationCosts[record.operationType].count++;
    }

    // Calculate averages for providers and models
    for (const provider of Object.values(byProvider)) {
      provider.averageCostPerCall = provider.totalCalls > 0
        ? provider.totalCost / provider.totalCalls
        : 0;
    }
    for (const model of Object.values(byModel)) {
      model.averageCostPerCall = model.totalCalls > 0
        ? model.totalCost / model.totalCalls
        : 0;
    }

    // Top operations
    const topOperations: OperationCostSummary[] = Object.entries(operationCosts)
      .map(([type, data]) => ({
        operationType: type,
        totalCost: data.cost,
        callCount: data.count,
        averageCost: data.count > 0 ? data.cost / data.count : 0,
      }))
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 10);

    // Cost trend
    const costTrend = this.calculateCostTrend(records, start, end);

    return {
      period: params.period,
      startDate: start,
      endDate: end,
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      totalCachedTokens,
      byProvider,
      byModel,
      byUser: params.includeByUser ? byUser : undefined,
      byChannel: params.includeByChannel ? byChannel : undefined,
      byAgent: params.includeByAgent ? byAgent : undefined,
      topOperations,
      costTrend,
    };
  }

  private calculateCostTrend(records: UsageRecord[], start: Date, end: Date): CostTrendPoint[] {
    // Group by hour for short periods, by day for longer
    const duration = end.getTime() - start.getTime();
    const hourMs = 60 * 60 * 1000;
    const dayMs = 24 * hourMs;
    const groupByHour = duration <= 7 * dayMs;

    const buckets: Map<number, number> = new Map();

    for (const record of records) {
      const time = record.timestamp.getTime();
      const bucketKey = groupByHour
        ? Math.floor(time / hourMs) * hourMs
        : Math.floor(time / dayMs) * dayMs;

      const cost = record.actualCost ?? record.estimatedCost;
      buckets.set(bucketKey, (buckets.get(bucketKey) ?? 0) + cost);
    }

    const sortedKeys = Array.from(buckets.keys()).sort((a, b) => a - b);
    let cumulative = 0;

    return sortedKeys.map(key => {
      const cost = buckets.get(key) ?? 0;
      cumulative += cost;
      return {
        timestamp: new Date(key),
        cost,
        cumulative,
      };
    });
  }

  // ============================================================================
  // Cost Optimization
  // ============================================================================

  analyzeOptimizations(): CostOptimization[] {
    if (!this.config.enableOptimizations) return [];

    const optimizations: CostOptimization[] = [];
    const report = this.generateReport({ period: 'monthly' });

    // Analyze model usage for potential switches
    for (const [modelKey, summary] of Object.entries(report.byModel)) {
      // Check if using expensive models for simple tasks
      if (summary.modelId.includes('opus') || summary.modelId.includes('gpt-4-turbo')) {
        const avgTokens = (summary.inputTokens + summary.outputTokens) / summary.totalCalls;
        if (avgTokens < 2000) {
          // Suggest cheaper model for short conversations
          const cheaperModel = summary.modelId.includes('opus')
            ? 'claude-3-haiku'
            : 'gpt-4o-mini';
          const cheaperPricing = this.getPricing(summary.provider, cheaperModel);

          if (cheaperPricing) {
            const projectedCost = (summary.inputTokens / 1000) * cheaperPricing.inputCostPer1k +
                                 (summary.outputTokens / 1000) * cheaperPricing.outputCostPer1k;
            const savings = summary.totalCost - projectedCost;

            if (savings > 1) {  // Only suggest if savings > $1
              optimizations.push({
                id: `opt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'model_switch',
                currentCost: summary.totalCost,
                projectedSavings: savings,
                savingsPercent: (savings / summary.totalCost) * 100,
                recommendation: `Switch from ${summary.modelId} to ${cheaperModel} for short conversations (avg ${Math.round(avgTokens)} tokens). Potential savings: $${savings.toFixed(2)}/month`,
                details: {
                  currentModel: summary.modelId,
                  suggestedModel: cheaperModel,
                  avgTokensPerCall: avgTokens,
                  totalCalls: summary.totalCalls,
                },
                priority: savings > 50 ? 'high' : savings > 10 ? 'medium' : 'low',
                createdAt: new Date(),
              });
            }
          }
        }
      }
    }

    // Check for free tier opportunities
    const paidUsage = Object.values(report.byProvider)
      .filter(p => ['openrouter', 'openai', 'anthropic'].includes(p.provider));

    if (paidUsage.length > 0) {
      const totalPaidCost = paidUsage.reduce((sum, p) => sum + p.totalCost, 0);
      if (totalPaidCost > 0) {
        optimizations.push({
          id: `opt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'provider_switch',
          currentCost: totalPaidCost,
          projectedSavings: totalPaidCost * 0.3,  // Estimate 30% could move to free
          savingsPercent: 30,
          recommendation: `Consider using free-tier providers (Groq, Cerebras, Z.ai) for non-critical tasks. Potential savings: $${(totalPaidCost * 0.3).toFixed(2)}/month`,
          details: {
            currentProviders: paidUsage.map(p => p.provider),
            suggestedProviders: ['groq', 'cerebras', 'zai'],
          },
          priority: totalPaidCost > 100 ? 'high' : 'medium',
          createdAt: new Date(),
        });
      }
    }

    // Store optimizations
    for (const opt of optimizations) {
      this.saveOptimization(opt);
    }

    return optimizations;
  }

  private saveOptimization(opt: CostOptimization): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO cost_optimizations
      (id, type, current_cost, projected_savings, savings_percent, recommendation, details, priority, created_at, dismissed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    stmt.run(
      opt.id,
      opt.type,
      opt.currentCost,
      opt.projectedSavings,
      opt.savingsPercent,
      opt.recommendation,
      JSON.stringify(opt.details),
      opt.priority,
      opt.createdAt.toISOString()
    );
  }

  getOptimizations(includeDismissed: boolean = false): CostOptimization[] {
    const query = includeDismissed
      ? 'SELECT * FROM cost_optimizations ORDER BY created_at DESC'
      : 'SELECT * FROM cost_optimizations WHERE dismissed = 0 ORDER BY created_at DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all() as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      type: row.type as CostOptimization['type'],
      currentCost: row.current_cost as number,
      projectedSavings: row.projected_savings as number,
      savingsPercent: row.savings_percent as number,
      recommendation: row.recommendation as string,
      details: JSON.parse(row.details as string),
      priority: row.priority as 'low' | 'medium' | 'high',
      createdAt: new Date(row.created_at as string),
    }));
  }

  dismissOptimization(optimizationId: string): boolean {
    const stmt = this.db.prepare('UPDATE cost_optimizations SET dismissed = 1 WHERE id = ?');
    const result = stmt.run(optimizationId);
    return result.changes > 0;
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  getStats(): {
    totalRecords: number;
    totalCost: number;
    totalTokens: number;
    activeBudgets: number;
    unacknowledgedAlerts: number;
    pendingOptimizations: number;
    topProvider: string | null;
    topModel: string | null;
  } {
    const recordsStmt = this.db.prepare(`
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(COALESCE(actual_cost, estimated_cost)), 0) as total_cost,
        COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens
      FROM usage_records
    `);
    const recordsResult = recordsStmt.get() as Record<string, unknown>;

    const budgetsStmt = this.db.prepare('SELECT COUNT(*) as count FROM budgets WHERE is_active = 1');
    const budgetsResult = budgetsStmt.get() as Record<string, number>;

    const alertsStmt = this.db.prepare('SELECT COUNT(*) as count FROM cost_alerts WHERE acknowledged = 0');
    const alertsResult = alertsStmt.get() as Record<string, number>;

    const optsStmt = this.db.prepare('SELECT COUNT(*) as count FROM cost_optimizations WHERE dismissed = 0');
    const optsResult = optsStmt.get() as Record<string, number>;

    const topProviderStmt = this.db.prepare(`
      SELECT provider, SUM(COALESCE(actual_cost, estimated_cost)) as total
      FROM usage_records
      GROUP BY provider
      ORDER BY total DESC
      LIMIT 1
    `);
    const topProviderResult = topProviderStmt.get() as Record<string, unknown> | undefined;

    const topModelStmt = this.db.prepare(`
      SELECT model_id, SUM(COALESCE(actual_cost, estimated_cost)) as total
      FROM usage_records
      GROUP BY model_id
      ORDER BY total DESC
      LIMIT 1
    `);
    const topModelResult = topModelStmt.get() as Record<string, unknown> | undefined;

    return {
      totalRecords: recordsResult.count as number,
      totalCost: recordsResult.total_cost as number,
      totalTokens: recordsResult.total_tokens as number,
      activeBudgets: budgetsResult.count,
      unacknowledgedAlerts: alertsResult.count,
      pendingOptimizations: optsResult.count,
      topProvider: topProviderResult?.provider as string | null ?? null,
      topModel: topModelResult?.model_id as string | null ?? null,
    };
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.db.close();
    this.emit('shutdown');
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let costTrackingInstance: CostTrackingSystem | null = null;

export function getCostTracking(config?: CostTrackingConfig): CostTrackingSystem {
  if (!costTrackingInstance) {
    if (!config) {
      throw new Error('CostTrackingSystem requires config on first initialization');
    }
    costTrackingInstance = new CostTrackingSystem(config);
  }
  return costTrackingInstance;
}

export function resetCostTracking(): void {
  if (costTrackingInstance) {
    costTrackingInstance.shutdown();
    costTrackingInstance = null;
  }
}
