-- Migration 0008: Remove AI assistant tables
-- The AI assistant feature has been removed. Drop all related tables.
-- Uses CASCADE so any FK references are handled automatically.
-- IF EXISTS makes this safe to run against databases already cleaned up manually.

DROP TABLE IF EXISTS assistant_analytics_events CASCADE;
DROP TABLE IF EXISTS assistant_messages CASCADE;
DROP TABLE IF EXISTS assistant_conversations CASCADE;
DROP TABLE IF EXISTS office_assistant_knowledge CASCADE;
DROP TABLE IF EXISTS office_assistant_settings CASCADE;
