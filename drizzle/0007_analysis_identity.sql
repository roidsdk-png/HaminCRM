CREATE TABLE `analysis_identity_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`basis` text NOT NULL,
	`members_json` text NOT NULL,
	`verified_by` text NOT NULL,
	`verified_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by` text
);
--> statement-breakpoint
CREATE TABLE `analysis_identity_members` (
	`contact_id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `analysis_identity_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_analysis_identity_group` ON `analysis_identity_members` (`group_id`);
--> statement-breakpoint
CREATE TRIGGER analysis_identity_member_insert AFTER INSERT ON analysis_identity_members
BEGIN
  INSERT INTO analysis_changes(entity,record_id,operation,created_at)
  VALUES('contact',NEW.contact_id,'update',unixepoch()*1000);
END;
--> statement-breakpoint
CREATE TRIGGER analysis_identity_member_delete AFTER DELETE ON analysis_identity_members
BEGIN
  INSERT INTO analysis_changes(entity,record_id,operation,created_at)
  VALUES('contact',OLD.contact_id,'update',unixepoch()*1000);
END;
--> statement-breakpoint
CREATE TRIGGER analysis_conversation_contact_update AFTER UPDATE OF contact_id ON conversations
WHEN OLD.contact_id IS NOT NEW.contact_id
BEGIN
  INSERT INTO analysis_changes(entity,record_id,operation,created_at)
  SELECT 'message',id,'update',unixepoch()*1000 FROM messages WHERE conversation_id=NEW.id AND contact_id IS NULL;
END;
