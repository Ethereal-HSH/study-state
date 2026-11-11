export const results = {
  PASS: "通过",
  PARTIAL: "部分完成",
  FAIL: "未通过",
  UNASSESSED: "尚未判定",
} as const;
export const taskTypes = {
  UNKNOWN: "未记录",
  CONCEPT: "概念解释",
  TYPICAL: "典型题",
  VARIANT: "变式题",
  TRANSFER: "迁移题",
} as const;
export const errorTypes = {
  UNKNOWN: "证据不足，暂不分类",
  CONCEPT: "概念型",
  CONDITION: "条件型",
  METHOD: "方法型",
  MODELING: "建模型",
  CALCULATION: "计算型",
  READING: "阅读型",
  MEMORY: "记忆型",
  TRANSFER: "迁移型",
} as const;
export const causeStatuses = {
  PENDING_EVIDENCE: "待补充证据",
  HYPOTHESIS: "暂时推测",
  CONFIRMED: "已确认",
} as const;
export const resolutions = {
  OPEN: "待订正",
  AWAITING_RETEST: "等待复测",
  RESOLVED: "已解决",
} as const;
export interface SessionRow {
  id: string;
  subject_id: string;
  subject_name: string;
  started_at: string;
  ended_at: string;
  duration_minutes: number;
  content: string | null;
  raw_note: string | null;
  version: number;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  points: { id: string; name: string; activity_type: string }[];
}
export interface AssessmentRow {
  id: string;
  knowledge_point_id: string;
  point_name: string;
  session_id: string | null;
  occurred_at: string;
  question_ref: string | null;
  question_description: string;
  response_excerpt: string | null;
  result: keyof typeof results;
  independent: number | null;
  hint_count: number | null;
  answer_viewed: number | null;
  task_type: keyof typeof taskTypes;
  difficulty: string;
  is_new_question: number | null;
  can_explain: number | null;
  note: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
}
export interface ErrorRow {
  id: string;
  knowledge_point_id: string;
  point_name: string;
  assessment_id: string | null;
  occurred_at: string;
  question_description: string;
  error_type: keyof typeof errorTypes;
  cause_status: keyof typeof causeStatuses;
  cause: string | null;
  correction: string | null;
  pattern_key: string | null;
  resolution_status: keyof typeof resolutions;
  resolved_at: string | null;
  resolved_assessment_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  voided_at: string | null;
  void_reason: string | null;
  repeated_count: number;
  last_retested_at: string | null;
  archived_at: string | null;
}
