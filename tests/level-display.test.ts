import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LevelBadge } from "../src/components/level-badge";
import { EventChanges } from "../src/features/knowledge/event-changes";

test("暂未评估徽章不显示 A，明确的 A 级仍显示未建立", () => {
  const unknown = renderToStaticMarkup(
    createElement(LevelBadge, { level: "A", unassessed: true }),
  );
  assert.match(unknown, /暂未评估/);
  assert.doesNotMatch(unknown, /<b>A<\/b>|未建立/);
  const known = renderToStaticMarkup(createElement(LevelBadge, { level: "A" }));
  assert.match(known, /<b>A<\/b>/);
  assert.match(known, /未建立/);
});
test("历史区分暂未评估和 A，存储等级相同的状态切换也清楚显示", () => {
  const change = (
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ) =>
    renderToStaticMarkup(
      createElement(EventChanges, {
        beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify(after),
      }),
    );
  const unset = change(
    { masteryLevel: "C", masteryBasis: "EVIDENCE" },
    { masteryLevel: "A", masteryBasis: "UNASSESSED" },
  );
  assert.match(unset, /C · 基础独立完成/);
  assert.match(unset, /暂未评估/);
  assert.doesNotMatch(unset, /A · 未建立/);
  const set = change(
    { masteryLevel: "A", masteryBasis: "UNASSESSED" },
    { masteryLevel: "A", masteryBasis: "SELF_REPORTED" },
  );
  assert.match(set, /掌握等级/);
  assert.match(set, /暂未评估/);
  assert.match(set, /A · 未建立/);
});
