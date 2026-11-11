import { databasePath, openDatabase } from "../src/server/db/client";
import { createBackup, restoreDatabase } from "../src/server/backup";
async function main() {
  const [command, argument] = process.argv.slice(2);
  if (command === "restore") {
    if (!argument)
      throw new Error("用法：pnpm db:restore <备份文件>；请先停止应用服务");
    console.log(await restoreDatabase(argument, databasePath()));
    return;
  }
  const store = openDatabase();
  try {
    if (command === "migrate") console.log(`数据库已就绪：${store.file}`);
    else if (command === "backup")
      console.log(`备份完成：${await createBackup(store, argument)}`);
    else throw new Error("未知命令");
  } finally {
    store.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
