import { z } from "zod";
import type { Catalog, Stage, Point } from "./models";

export const reportedLevels = ["UNASSESSED", "A", "B", "C", "D", "E"] as const;
export type ReportedLevel = (typeof reportedLevels)[number];
export const reportedLevelSchema = z
  .object({
    level: z.enum(reportedLevels),
    quote: z.string().trim().min(1).max(2000),
  })
  .strict();
export type LevelSuggestion = z.infer<typeof reportedLevelSchema>;

export const importOutputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            pointId: z.uuid().nullable(),
            chapterId: z.uuid().nullable(),
            chapterName: z.string().trim().max(100).nullable(),
            name: z.string().trim().min(1).max(100),
            summary: z.string().trim().min(1).max(4000),
            stage: z.enum(["IN_PROGRESS", "COVERED"]).nullable(),
            quote: z.string().trim().min(1).max(2000),
            reason: z.string().trim().min(1).max(1000),
            reportedLevel: reportedLevelSchema.nullable().default(null),
            review: z
              .object({
                action: z.string().trim().min(1).max(500),
                quote: z.string().trim().min(1).max(500),
              })
              .strict()
              .nullable()
              .default(null),
          })
          .strict(),
      )
      .max(20),
    warnings: z.array(z.string().trim().min(1).max(1000)).max(20),
  })
  .strict();
export type ImportOutput = z.infer<typeof importOutputSchema>;
export type ImportItem = ImportOutput["items"][number] & {
  id: string;
  levelCandidate?: LevelSuggestion | null;
};
export interface ImportSource {
  id: string;
  subject: { id: string | null; name: string };
  // Omitted: entire subject; empty: new chapter; otherwise selected chapters.
  chapterIds?: string[];
  chapterMode?: "AUTO";
  text: string;
  textFileName?: string | null;
  attachment: {
    name: string;
    mime: "image/png" | "image/jpeg" | "image/webp";
    base64: string;
  } | null;
}
export interface ImportDraft {
  id: string;
  status: "RUNNING" | "READY" | "FAILED" | "APPLIED" | "DISCARDED";
  version: number;
  provider: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  source: Omit<ImportSource, "attachment"> & {
    attachment: { name: string; mime: string } | null;
  };
  context: Catalog;
  items: ImportItem[];
  warnings: string[];
  learningDate: string | null;
  applied: { pointIds: string[]; sessionId: string | null } | null;
  levelReview?: {
    id: string;
    pointId: string;
    expectedPointVersion: number;
    currentLevel: Point["masteryLevel"];
    currentBasis: Point["masteryBasis"];
  }[];
}
export interface ReviewedItem {
  id: string;
  selected: boolean;
  pointId: string | null;
  chapterId: string | null;
  chapterName: string;
  name: string;
  summary: string;
  stage: Stage | null;
  level?: ReportedLevel | null;
  levelReason?: string;
  reviewTask?: { dueOn: string; action: string; quote: string } | null;
}
export const importStatuses = {
  RUNNING: "正在整理",
  READY: "待确认",
  FAILED: "整理失败",
  APPLIED: "已保存",
  DISCARDED: "已放弃",
} as const;
