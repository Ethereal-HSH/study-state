export function localInput(date: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (key: string) => p.find((x) => x.type === key)?.value;
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}
export function localDay(value: string, timeZone: string) {
  return localInput(new Date(value), timeZone).slice(0, 10);
}
export function parseLocal(value: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("请填写完整日期和时间");
  const wall = Date.parse(value + ":00.000Z");
  if (
    !Number.isFinite(wall) ||
    new Date(wall).toISOString().slice(0, 16) !== value
  )
    throw new Error("日期或时间无效");
  let guess = wall;
  for (let i = 0; i < 4; i++) {
    const shown = Date.parse(
      localInput(new Date(guess), timeZone) + ":00.000Z",
    );
    guess += wall - shown;
  }
  if (localInput(new Date(guess), timeZone) !== value)
    throw new Error("该时区不存在这个时刻，请更换时间");
  return new Date(guess).toISOString();
}
