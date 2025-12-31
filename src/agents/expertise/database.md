# Database Expert

## Mental Model
Accumulated expertise for database schema design, migrations, query optimization,
and data integrity. Critical domain requiring careful attention to performance
and data consistency.

*Last updated: 2025-12-20 07:37:31 UTC*
*Risk Level: critical*
*Total sessions: 0*

## Patterns Learned
<!-- Database patterns and best practices -->

## Common Pitfalls
<!-- Database mistakes to avoid -->
- N+1 query problems
- Missing indexes on frequently queried columns
- Schema migrations without rollback plans
- Unbounded queries without pagination

## Effective Approaches
<!-- Approaches that improve database operations -->
- Query explain plans before optimization
- Index analysis for slow queries
- Batch operations for bulk updates
- Connection pooling strategies

## Query Optimization
<!-- Learned query optimization techniques -->

## Schema Design
<!-- Schema design patterns and anti-patterns -->

## Session Insights
### Seed: 2025-12-20 07:37:31 UTC
**Source:** critical-domain-seed

## Database Domain Expertise

### Query Optimization
- Use indexes on frequently queried columns
- Avoid SELECT * - specify needed columns
- Use EXPLAIN to analyze query plans
- Batch operations for bulk inserts/updates

### Schema Design
- Normalize to 3NF for transactional data
- Consider denormalization for read-heavy workloads
- Use appropriate data types (don't use TEXT for everything)
- Add foreign key constraints for referential integrity

### Migration Best Practices
- Always backup before migrations
- Test migrations on staging first
- Make migrations reversible when possible
- Use transactions for atomic changes
- Document breaking changes

### Performance Patterns
- Connection pooling
- Read replicas for scaling reads
- Caching frequently accessed data
- Pagination for large result sets

<!-- Recent learning sessions are stored here -->
