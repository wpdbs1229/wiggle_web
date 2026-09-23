CREATE TABLE `book_feedback_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`storybook_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	`revision` integer NOT NULL,
	`rubric_version` text NOT NULL,
	`rubric_json` text NOT NULL,
	`prompt` text NOT NULL,
	`document_json` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`feedback_json` text,
	`error` text,
	`lease` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`storybook_id`) REFERENCES `storybooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_feedback_jobs_version_uq` ON `book_feedback_jobs` (`storybook_id`,`teacher_id`,`revision`,`rubric_version`);--> statement-breakpoint
CREATE INDEX `book_feedback_jobs_queue` ON `book_feedback_jobs` (`teacher_id`,`classroom_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `book_print_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`storybook_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	`revision` integer NOT NULL,
	`environment` text NOT NULL,
	`spec_uid` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`book_uid` text,
	`layout_json` text,
	`error` text,
	`lease` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`storybook_id`) REFERENCES `storybooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_print_jobs_version_uq` ON `book_print_jobs` (`storybook_id`,`teacher_id`,`revision`,`environment`,`spec_uid`);--> statement-breakpoint
CREATE TABLE `book_print_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`environment` text NOT NULL,
	`request_json` text NOT NULL,
	`status` text DEFAULT 'submitting' NOT NULL,
	`response_json` text,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `classroom_book_settings` (
	`classroom_id` text PRIMARY KEY NOT NULL,
	`grade` integer,
	`class_number` integer,
	`rubric_json` text,
	`rubric_version` text,
	`rubric_filename` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE cascade
);
