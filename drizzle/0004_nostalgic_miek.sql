DROP INDEX `uq_conversations_source_session`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_conversations_source_contact_session` ON `conversations` (`source_id`,`contact_id`,`external_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contacts_source_ip` ON `contacts` (`source_id`,`ip_hash`);