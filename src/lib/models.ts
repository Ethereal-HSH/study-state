export const levels = {
  A: "未建立",
  B: "理解",
  C: "基础独立完成",
  D: "迁移",
  E: "稳定掌握",
} as const;
export const stages = {
  NOT_STARTED: "未开始",
  IN_PROGRESS: "学习中",
  COVERED: "已学过",
} as const;
export const bases = {
  UNASSESSED: "暂未评估",
  SELF_REPORTED: "用户自评",
  EVIDENCE: "复测证据",
} as const;
export type Level = keyof typeof levels;
export type Stage = keyof typeof stages;
export interface Subject {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}
export interface Chapter extends Subject {
  subjectId: string;
}
export interface Point extends Subject {
  chapterId: string;
  importance: number;
  masteryLevel: Level;
  masteryBasis: keyof typeof bases;
  learningStage: Stage;
  suspectedForgetting: boolean;
  aiSummary: string | null;
  summarySource: string | null;
  summaryUpdatedAt: string | null;
  summaryBasedOnVersion: number | null;
}
export interface Event {
  id: string;
  sequence: number;
  eventType: string;
  occurredAt: string;
  recordedAt: string;
  reason: string;
  beforeJson: string | null;
  afterJson: string | null;
}
export interface Catalog {
  subjects: Subject[];
  chapters: Chapter[];
  points: Point[];
}
