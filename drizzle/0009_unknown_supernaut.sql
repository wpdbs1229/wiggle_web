CREATE TABLE `classroom_profiles` (
	`classroom_id` text PRIMARY KEY NOT NULL,
	`school_name` text NOT NULL,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `operations_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `participant_presence` (
	`actor_key` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`actor_id` text NOT NULL,
	`classroom_id` text,
	`seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `participant_presence_recent` ON `participant_presence` (`seen_at`);--> statement-breakpoint
CREATE TABLE `print_request_items` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`document_json` text NOT NULL,
	`book_uid` text,
	`remote_started_at` integer,
	`ready` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `print_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `print_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`environment` text NOT NULL,
	`document_json` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`provider_json` text,
	`error` text,
	`lease` text,
	`lease_at` integer,
	`order_started_at` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `print_requests_teacher` ON `print_requests` (`teacher_id`,`classroom_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `print_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`environment` text NOT NULL,
	`title` text NOT NULL,
	`layout_json` text NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE no action
);
