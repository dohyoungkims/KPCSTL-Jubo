import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
export const members=sqliteTable('members',{
  id:text('id').primaryKey(),name:text('name').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()
});
export const issues=sqliteTable('issues',{
  id:text('id').primaryKey(),version:integer('version').notNull(),document:text('document').notNull(),mutationId:text('mutation_id').notNull(),updatedAt:text('updated_at').notNull()
});
export const issueVersions=sqliteTable('issue_versions',{
  issueId:text('issue_id').notNull(),version:integer('version').notNull(),document:text('document').notNull(),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull()
},t=>[primaryKey({columns:[t.issueId,t.version]})]);
