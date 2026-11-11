export const taskKinds = {
  LEARN: "学习",
  REVIEW: "复习复测",
  SPOT_CHECK: "抽查",
} as const;
export const taskStatuses = {
  PENDING: "待处理",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
} as const;
export type TaskKind = keyof typeof taskKinds;
export interface TaskRow {
  id: string;
  knowledge_point_id: string;
  kind: TaskKind;
  due_on: string;
  status: keyof typeof taskStatuses;
  reason: string;
  source: "MANUAL" | "RULE_CONFIRMED";
  rule_version: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  completed_assessment_id: string | null;
  completed_session_id: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  point_name: string;
  subject_id: string;
  subject_name: string;
  archived_at: string | null;
  importance: number;
  mastery_level: string;
  suspected_forgetting: number;
  open_errors: number;
  recent_errors: number;
}
export interface ReviewSuggestion {
  pointId: string;
  pointVersion: number;
  pointName: string;
  subjectId: string;
  kind: TaskKind;
  dueOn: string | null;
  reason: string;
  token: string;
}
