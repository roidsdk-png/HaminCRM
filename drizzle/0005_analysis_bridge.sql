CREATE TABLE `analysis_bridge_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`change_sequence` integer DEFAULT 0 NOT NULL,
	`snapshot_sequence` integer DEFAULT 0 NOT NULL,
	`last_synced_at` integer
);
--> statement-breakpoint
CREATE TABLE `analysis_changes` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`record_id` text NOT NULL,
	`operation` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analysis_export_rows` (
	`ordinal` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` text NOT NULL,
	`record_id` text NOT NULL,
	`record_json` text,
	FOREIGN KEY (`snapshot_id`) REFERENCES `analysis_exports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_analysis_export_page` ON `analysis_export_rows` (`snapshot_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_analysis_export_record` ON `analysis_export_rows` (`snapshot_id`,`record_id`);--> statement-breakpoint
CREATE TABLE `analysis_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`generation` text NOT NULL,
	`mode` text NOT NULL,
	`sequence` integer NOT NULL,
	`change_sequence` integer NOT NULL,
	`sources_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	`last_cursor` integer DEFAULT 0 NOT NULL
);

--> statement-breakpoint
INSERT INTO analysis_bridge_state (id,generation) VALUES (1,lower(hex(randomblob(16))));

--> statement-breakpoint
CREATE TRIGGER analysis_messages_insert
AFTER INSERT ON messages
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('message',NEW."id",'insert',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_messages_update
AFTER UPDATE ON messages
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('message',NEW."id",'update',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_messages_delete
AFTER DELETE ON messages
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('message',OLD."id",'delete',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_test_attempts_insert
AFTER INSERT ON test_attempts
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('test',NEW."id",'insert',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_test_attempts_update
AFTER UPDATE ON test_attempts
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('test',NEW."id",'update',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_test_attempts_delete
AFTER DELETE ON test_attempts
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('test',OLD."id",'delete',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_test_answers_insert
AFTER INSERT ON test_answers
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('test',NEW."attempt_id",'insert',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_test_answers_update
AFTER UPDATE ON test_answers
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('test',NEW."attempt_id",'update',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_test_answers_delete
AFTER DELETE ON test_answers
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('test',OLD."attempt_id",'delete',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_match_profiles_insert
AFTER INSERT ON match_profiles
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('match',NEW."id",'insert',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_match_profiles_update
AFTER UPDATE ON match_profiles
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('match',NEW."id",'update',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_match_profiles_delete
AFTER DELETE ON match_profiles
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('match',OLD."id",'delete',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_match_answers_insert
AFTER INSERT ON match_answers
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('match',NEW."profile_id",'insert',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_match_answers_update
AFTER UPDATE ON match_answers
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('match',NEW."profile_id",'update',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_match_answers_delete
AFTER DELETE ON match_answers
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('match',OLD."profile_id",'delete',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_contacts_insert
AFTER INSERT ON contacts
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('contact',NEW."id",'insert',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_contacts_update
AFTER UPDATE OF name,province,city,gender,age,education,external_user_id,anonymous_id,ip_hash,phone ON contacts
WHEN NEW.name IS NOT OLD.name OR NEW.province IS NOT OLD.province OR NEW.city IS NOT OLD.city OR NEW.gender IS NOT OLD.gender OR NEW.age IS NOT OLD.age OR NEW.education IS NOT OLD.education OR NEW.external_user_id IS NOT OLD.external_user_id OR NEW.anonymous_id IS NOT OLD.anonymous_id OR NEW.ip_hash IS NOT OLD.ip_hash OR NEW.phone IS NOT OLD.phone
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('contact',NEW."id",'update',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_contacts_delete
AFTER DELETE ON contacts
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('contact',OLD."id",'delete',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_sources_insert
AFTER INSERT ON sources
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('source',NEW."id",'insert',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_sources_update
AFTER UPDATE OF name,slug,kind,platform,status ON sources
WHEN NEW.name IS NOT OLD.name OR NEW.slug IS NOT OLD.slug OR NEW.kind IS NOT OLD.kind OR NEW.platform IS NOT OLD.platform OR NEW.status IS NOT OLD.status
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('source',NEW."id",'update',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_sources_delete
AFTER DELETE ON sources
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('source',OLD."id",'delete',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_app_settings_insert
AFTER INSERT ON app_settings
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('settings',NEW."key",'insert',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_app_settings_update
AFTER UPDATE ON app_settings
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('settings',NEW."key",'update',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_app_settings_delete
AFTER DELETE ON app_settings
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('settings',OLD."key",'delete',unixepoch());
END;

--> statement-breakpoint
CREATE TRIGGER analysis_ingestion_completed
AFTER UPDATE OF processing_status ON ingestion_events
WHEN NEW.processing_status='processed' AND OLD.processing_status <> 'processed'
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('event',NEW.id,'update',unixepoch());
END;
