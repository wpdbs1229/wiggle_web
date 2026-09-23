CREATE TABLE `hand_raises` (
	`student_id` text PRIMARY KEY NOT NULL,
	`classroom_id` text NOT NULL,
	`raised_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hand_raises_classroom_idx` ON `hand_raises` (`classroom_id`,`raised_at`);--> statement-breakpoint
CREATE TABLE `teacher_marks` (
	`id` text PRIMARY KEY NOT NULL,
	`classroom_id` text NOT NULL,
	`student_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	`artwork_id` text NOT NULL,
	`strokes_json` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`answer` text,
	`answered_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artwork_id`) REFERENCES `artworks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `teacher_marks_student_idx` ON `teacher_marks` (`student_id`,`answered_at`,`created_at`);--> statement-breakpoint
ALTER TABLE `artworks` ADD `arc_id` text;--> statement-breakpoint
ALTER TABLE `artworks` ADD `episode_id` text;--> statement-breakpoint
ALTER TABLE `artworks` ADD `arc_version` integer;--> statement-breakpoint
ALTER TABLE `classrooms` ADD `current_arc_id` text;--> statement-breakpoint
ALTER TABLE `classrooms` ADD `current_episode_id` text;--> statement-breakpoint
ALTER TABLE `student_profiles` ADD `entry_code` text;