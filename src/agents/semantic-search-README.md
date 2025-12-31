# Semantic Search System

Vector-based memory storage and retrieval using embeddings for natural language search.

## Overview

The semantic search system enables Discord bot agents to store and retrieve memories using vector embeddings, allowing semantic similarity search rather than just keyword matching. This powers intelligent agent memory, pattern recognition, and knowledge retrieval.

## Architecture

```
┌──────────────┐
│  Text Input  │
└──────┬───────┘
       │
       ▼
┌─────────────────────┐
│ Xenova Transformers │
│  all-MiniLM-L6-v2   │ ← Embedding Model (384-dim)
└──────┬──────────────┘
       │
       ▼
┌──────────────┐
│ Float32Array │ ← Normalized vector
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ SQLite BLOB  │ ← Persistent storage
└──────────────┘

Query Flow:
┌──────────┐     ┌─────────────┐     ┌──────────────┐
│  Query   │────▶│  Embedding  │────▶│   Cosine     │
└──────────┘     └─────────────┘     │  Similarity  │
                                      │   Search     │
                                      └──────┬───────┘
                                             │
                                             ▼
                                      ┌──────────────┐
                                      │  Top-K with  │
                                      │  Scores      │
                                      └──────────────┘
```

## Quick Start

```typescript
import { getSemanticSearchService } from "./agents/index.js";
import { getDatabase } from "./database.js";

const db = getDatabase();
const search = getSemanticSearchService(db);

// Add memory
await search.addMemory("my-agent", "Bitcoin reached $50,000 today");

// Search semantically
const results = await search.search("my-agent", "crypto prices", {
  topK: 5,
  threshold: 0.6,
});

console.log(results[0].similarity); // e.g., 0.85
console.log(results[0].content);    // "Bitcoin reached $50,000 today"
```

## API Reference

### `SemanticSearchService`

#### `addMemory(agentId, content, metadata?)`
Store a new memory with automatic embedding generation.

```typescript
const id = await search.addMemory("trading-agent", "BTC bullish breakout", {
  type: "signal",
  confidence: 0.95,
  timestamp: Date.now(),
});
```

**Parameters:**
- `agentId` (string): Agent identifier
- `content` (string): Text content to remember
- `metadata` (object, optional): Structured metadata for filtering

**Returns:** Memory ID (string)

#### `addMemoriesBatch(agentId, items)`
Store multiple memories efficiently.

```typescript
await search.addMemoriesBatch("agent-id", [
  { content: "Memory 1", metadata: { tag: "important" } },
  { content: "Memory 2", metadata: { tag: "info" } },
]);
```

**Parameters:**
- `agentId` (string): Agent identifier
- `items` (array): Array of `{ content, metadata? }` objects

**Returns:** Array of memory IDs

#### `search(agentId, query, options?)`
Search memories by semantic similarity.

```typescript
const results = await search.search("agent-id", "market patterns", {
  topK: 10,              // Return top 10 results
  threshold: 0.6,        // Minimum similarity (0-1)
  metadata: {            // Optional filter
    type: "signal",
    confidence: 0.8,
  },
});
```

**Parameters:**
- `agentId` (string): Agent identifier
- `query` (string): Natural language search query
- `options` (object, optional):
  - `topK` (number, default: 5): Maximum results to return
  - `threshold` (number, default: 0.0): Minimum similarity score (0-1)
  - `metadata` (object, optional): Filter by metadata fields

**Returns:** Array of `SemanticSearchResult`:
```typescript
{
  id: string;
  agentId: string;
  content: string;
  embedding: Float32Array;
  metadata?: Record<string, any>;
  createdAt: Date;
  similarity: number;  // 0-1 score
}
```

#### `getMemory(id)`
Retrieve memory by ID.

```typescript
const memory = await search.getMemory("mem_123");
```

#### `updateMemory(id, content, metadata?)`
Update existing memory (re-generates embedding).

```typescript
await search.updateMemory(id, "Updated content", { status: "revised" });
```

#### `deleteMemory(id)`
Delete a single memory.

```typescript
await search.deleteMemory(id);
```

#### `deleteAllMemories(agentId)`
Delete all memories for an agent.

```typescript
const deleted = await search.deleteAllMemories("agent-id");
console.log(`Deleted ${deleted} memories`);
```

#### `pruneOldMemories(agentId, keepRecent)`
Keep only N most recent memories.

```typescript
// Keep only 100 most recent
const pruned = await search.pruneOldMemories("agent-id", 100);
```

#### `getMemoryCount(agentId)`
Get total memory count for agent.

```typescript
const count = search.getMemoryCount("agent-id");
```

#### `getStats()`
Get global statistics.

```typescript
const stats = search.getStats();
// {
//   totalMemories: 500,
//   agentCounts: [
//     { agentId: "trading-agent", count: 200 },
//     { agentId: "research-agent", count: 300 }
//   ]
// }
```

### Embedding Functions

#### `generateEmbedding(text)`
Convert text to 384-dimensional vector.

```typescript
import { generateEmbedding } from "./agents/index.js";

const embedding = await generateEmbedding("Bitcoin is rising");
console.log(embedding.length); // 384
```

#### `cosineSimilarity(a, b)`
Calculate similarity between vectors (0 = unrelated, 1 = identical).

```typescript
import { cosineSimilarity } from "./agents/index.js";

const sim = cosineSimilarity(embedding1, embedding2);
console.log(sim); // e.g., 0.87
```

#### `generateEmbeddingsBatch(texts)`
Batch generate embeddings.

```typescript
const embeddings = await generateEmbeddingsBatch([
  "Text 1",
  "Text 2",
  "Text 3",
]);
```

## Database Schema

```sql
CREATE TABLE semantic_memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB NOT NULL,     -- 384 floats as Buffer
  metadata TEXT,               -- JSON object
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_semantic_agent ON semantic_memories(agent_id);
CREATE INDEX idx_semantic_created ON semantic_memories(created_at);
```

## Use Cases

### 1. Agent Long-Term Memory
```typescript
// Store agent experiences
await search.addMemory("assistant", "User prefers technical explanations", {
  type: "preference",
  user_id: "123",
});

// Later recall
const prefs = await search.search("assistant", "user communication style", {
  metadata: { type: "preference", user_id: "123" },
});
```

### 2. Trading Signal History
```typescript
// Store signals
await search.addMemory("trading", "BTC bullish divergence at $48k", {
  type: "signal",
  action: "BUY",
  price: 48000,
});

// Find similar patterns
const similar = await search.search("trading", "bitcoin bull pattern", {
  metadata: { type: "signal" },
  topK: 10,
});
```

### 3. Knowledge Base Search
```typescript
// Store documentation
await search.addMemory("docs", "REST API authentication uses JWT tokens", {
  category: "auth",
  doc: "api-guide.md",
});

// Semantic search
const docs = await search.search("docs", "how to authenticate API requests");
```

### 4. Pattern Recognition
```typescript
// Store events
await search.addMemory("events", "Server crash after memory spike", {
  type: "incident",
  severity: "critical",
});

// Find similar incidents
const incidents = await search.search("events", "memory issues causing failures");
```

## Performance

| Metric | Value |
|--------|-------|
| Model Size | ~23MB (downloads on first use) |
| Embedding Dimension | 384 |
| Generation Speed | ~50ms/text (CPU) |
| Search Speed | <10ms for 1,000 vectors |
| Storage per Memory | ~1.5KB (384 floats + metadata) |
| Similarity Range | 0.0 (unrelated) to 1.0 (identical) |

## Best Practices

### 1. Memory Hygiene
```typescript
// Prune old memories periodically
setInterval(async () => {
  await search.pruneOldMemories("agent-id", 1000);
}, 24 * 60 * 60 * 1000); // Daily
```

### 2. Similarity Thresholds
```typescript
// High precision (strict matching)
const strict = await search.search(agentId, query, { threshold: 0.8 });

// High recall (find anything related)
const broad = await search.search(agentId, query, { threshold: 0.5 });

// Balanced
const balanced = await search.search(agentId, query, { threshold: 0.6 });
```

### 3. Metadata Strategy
```typescript
// Structure metadata for filtering
await search.addMemory(agentId, content, {
  type: "signal",           // Category
  subtype: "technical",     // Subcategory
  confidence: 0.95,         // Numeric values
  tags: ["btc", "bullish"], // Arrays as JSON
  timestamp: Date.now(),    // Temporal ordering
});
```

### 4. Batch Operations
```typescript
// More efficient than loop
const memories = messages.map((m) => ({
  content: m.content,
  metadata: { user: m.userId, timestamp: m.timestamp },
}));

await search.addMemoriesBatch(agentId, memories);
```

## Troubleshooting

### Model Download Issues
First run downloads ~23MB from Hugging Face. If it fails:

```typescript
// Pre-download manually
import { getEmbedder } from "./agents/index.js";
await getEmbedder(); // Downloads and caches model
```

### Out of Memory
For very large result sets:

```typescript
// Use stricter threshold
const results = await search.search(agentId, query, {
  topK: 100,
  threshold: 0.7, // Reduce result count
});
```

### Slow Search
If >10k vectors, search becomes slower:

```typescript
// Solution: Multiple agents or aggressive pruning
await search.pruneOldMemories(agentId, 5000);
```

## Integration Examples

### With Agent Memory Blocks
```typescript
import { getMemoryManager } from "./agents/index.js";

const memory = getMemoryManager(agentId, dataDir);
const search = getSemanticSearchService(db);

// Store structured + semantic
await memory.updateBlock("persona", "I am a trading analyst");
await search.addMemory(agentId, "I am a trading analyst", {
  block: "persona",
});

// Recall
const similar = await search.search(agentId, "agent personality");
```

### With Trading System
```typescript
import { TradingOrchestrator } from "./trading/index.js";

orchestrator.on("signal", async (signal) => {
  await search.addMemory("trading", signal.analysis, {
    type: "signal",
    symbol: signal.symbol,
    action: signal.action,
    confidence: signal.confidence,
  });
});

// Find similar past signals
const historical = await search.search("trading", "BTC bullish breakout");
```

## Testing

Run tests:
```bash
npx vitest run semantic-search.test.ts
```

Tests cover:
- Embedding generation and dimensionality
- Cosine similarity calculation
- CRUD operations
- Semantic search accuracy
- Metadata filtering
- Batch operations
- Memory pruning
- Statistics

## Future Enhancements

Potential improvements:
1. **HNSW Index**: Add approximate nearest neighbor for >10k vectors
2. **Multi-Model**: Support OpenAI ada-002, sentence-transformers
3. **Hybrid Search**: Combine semantic + BM25 keyword search
4. **Clustering**: Auto-cluster related memories
5. **Reranking**: Add cross-encoder for result refinement
6. **Temporal Decay**: Weight recent memories higher

## License

MIT - Part of pi-mono Discord bot package.
