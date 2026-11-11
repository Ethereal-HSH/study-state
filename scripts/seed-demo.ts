import path from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase, databasePath } from "../src/server/db/client";
import { executeCommand, readCatalog } from "../src/server/catalog";
const target = process.argv[2];
if (
  !target ||
  !path.basename(target).includes("demo") ||
  path.resolve(target) === databasePath()
)
  throw new Error(
    "请显式指定独立演示库，例如 pnpm db:seed-demo ./data/demo.sqlite；不会写入正式库。",
  );
const store = openDatabase(path.resolve(target));
try {
  if (readCatalog(store).subjects.length)
    throw new Error("演示库已有数据，拒绝重复填充");
  const subjectId = randomUUID();
  executeCommand(
    {
      commandId: randomUUID(),
      action: "create",
      entity: "subject",
      id: subjectId,
      name: "高等数学",
      description: "示例科目，可用于体验知识树",
    },
    store,
  );
  for (const [chapterName, names] of [
    ["极限", ["极限定义", "等价无穷小", "洛必达法则", "连续性"]],
    ["导数", ["导数定义", "复合函数求导", "中值定理"]],
  ] as const) {
    const chapterId = randomUUID();
    executeCommand(
      {
        commandId: randomUUID(),
        action: "create",
        entity: "chapter",
        id: chapterId,
        parentId: subjectId,
        name: chapterName,
      },
      store,
    );
    names.forEach((name, index) =>
      executeCommand(
        {
          commandId: randomUUID(),
          action: "create",
          entity: "point",
          id: randomUUID(),
          parentId: chapterId,
          name,
          initialLevel:
            index === 0
              ? "D"
              : index === 1
                ? "C"
                : index === 2
                  ? "B"
                  : "UNASSESSED",
          learningStage: index === 3 ? "NOT_STARTED" : "IN_PROGRESS",
          importance: index === 2 ? 5 : 3,
          description: "这是演示记录；自评等级不代表已有复测证据。",
        },
        store,
      ),
    );
  }
  console.log(`演示数据已保存到 ${target}`);
} finally {
  store.close();
}
