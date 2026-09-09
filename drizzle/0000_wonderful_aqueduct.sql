CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`external_user_id` text,
	`anonymous_id` text,
	`ip_hash` text,
	`name` text,
	`phone` text,
	`province` text,
	`city` text,
	`gender` text,
	`age` integer,
	`education` text,
	`metadata` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_contacts_source_external` ON `contacts` (`source_id`,`external_user_id`);--> statement-breakpoint
CREATE INDEX `idx_contacts_source_anonymous` ON `contacts` (`source_id`,`anonymous_id`);--> statement-breakpoint
CREATE INDEX `idx_contacts_phone` ON `contacts` (`phone`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`contact_id` text,
	`external_session_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`last_message_at` integer NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_conversations_source_session` ON `conversations` (`source_id`,`external_session_id`);--> statement-breakpoint
CREATE INDEX `idx_conversations_last_message` ON `conversations` (`last_message_at`);--> statement-breakpoint
CREATE TABLE `ingestion_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`external_event_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`processing_status` text DEFAULT 'received' NOT NULL,
	`processing_error` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ingestion_events_source_external` ON `ingestion_events` (`source_id`,`external_event_id`);--> statement-breakpoint
CREATE INDEX `idx_ingestion_events_status_received` ON `ingestion_events` (`processing_status`,`received_at`);--> statement-breakpoint
CREATE TABLE `match_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`position` integer NOT NULL,
	`question_text` text NOT NULL,
	`answer_value` text,
	`answer_label` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `match_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_match_answers_profile_position` ON `match_answers` (`profile_id`,`position`);--> statement-breakpoint
CREATE TABLE `match_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`contact_id` text,
	`external_profile_id` text NOT NULL,
	`attempt_number` integer DEFAULT 1 NOT NULL,
	`profile` text NOT NULL,
	`traits` text,
	`archetype` text,
	`consent` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_match_profiles_source_external_attempt` ON `match_profiles` (`source_id`,`external_profile_id`,`attempt_number`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`contact_id` text,
	`external_message_id` text,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`latency_ms` integer,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_messages_conversation_time` ON `messages` (`conversation_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_messages_source_role_time` ON `messages` (`source_id`,`role`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`platform` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`credential_hash` text,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sources_slug` ON `sources` (`slug`);--> statement-breakpoint
CREATE TABLE `test_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`position` integer NOT NULL,
	`question_key` text,
	`question_text` text NOT NULL,
	`answer_value` text,
	`answer_label` text,
	`score` integer,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `test_attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_test_answers_attempt_position` ON `test_answers` (`attempt_id`,`position`);--> statement-breakpoint
CREATE TABLE `test_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`contact_id` text,
	`external_attempt_id` text NOT NULL,
	`test_key` text NOT NULL,
	`tracking_code` text,
	`profile` text,
	`scores` text,
	`result` text,
	`ai_analysis` text,
	`started_at` integer,
	`completed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_test_attempts_source_external` ON `test_attempts` (`source_id`,`external_attempt_id`);--> statement-breakpoint
CREATE INDEX `idx_test_attempts_key_completed` ON `test_attempts` (`test_key`,`completed_at`);
--> statement-breakpoint
INSERT INTO `sources` (`id`,`slug`,`name`,`kind`,`platform`,`status`,`credential_hash`,`created_at`,`updated_at`) VALUES
  ('src_bale_advisor','bale-advisor','مشاور هوشمند بله','chatbot','bale','pending',NULL,unixepoch(),unixepoch()),
  ('src_eitaa_advisor','eitaa-advisor','مشاور هوشمند ایتا','chatbot','eitaa','pending',NULL,unixepoch(),unixepoch()),
  ('src_psytest_1','psytest-1','آزمون شخصیت','test','web','pending',NULL,unixepoch(),unixepoch()),
  ('src_psytest_2','psytest-2','آزمون اضطراب','test','web','pending',NULL,unixepoch(),unixepoch()),
  ('src_psytest_3','psytest-3','آزمون افسردگی','test','web','pending',NULL,unixepoch(),unixepoch()),
  ('src_matchhamin','matchhamin','کی مناسب منه؟','matchmaking','bale','pending',NULL,unixepoch(),unixepoch());
--> statement-breakpoint
PRAGMA optimize;
