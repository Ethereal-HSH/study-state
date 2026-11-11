import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSourceQuote } from "../src/lib/source-quotes";

test("原文摘录允许空格和换行差异，但返回的是原文连续片段", () => {
  const source =
    "原文前段。\r\n首次作答：\r\n  uo(t)=50 + 20sin(50πt) V。\n另一段。";
  const match = resolveSourceQuote(source, "首次作答：uo(t)=50+20sin(50πt)V。");
  assert.equal(match, "首次作答：\r\n  uo(t)=50 + 20sin(50πt) V。");
  assert.ok(source.includes(match!));
  assert.equal(resolveSourceQuote(source, "另一段。"), "另一段。");
});
test("改写意思、拼接片段、改动符号或公式不能冒充原文", () => {
  const source = "首次不会。提示：固定D。结果为-2，公式x²。后来正确。";
  for (const quote of [
    "首次正确。",
    "首次不会。后来正确。",
    "首次不会。…后来正确。",
    "结果为+2",
    "结果为−2",
    "公式x2",
    "固定D.钟",
    "   ",
    "",
  ])
    assert.equal(resolveSourceQuote(source, quote), null, quote);
});
test("空白归一化不把过长原文跨度变成可保存的短引用", () => {
  assert.equal(
    resolveSourceQuote("起点" + " ".repeat(2200) + "终点", "起点终点"),
    null,
  );
  assert.equal(resolveSourceQuote("甲".repeat(2001), "甲".repeat(2001)), null);
});
