/** 条目类型常量 — 在需要 t() 的组件中映射为翻译字符串 */
import type { ItemType } from "../types/domain";

export const ITEM_TYPES: ItemType[] = ["android", "account", "file"];

export const TYPE_ICONS: Record<ItemType, string> = {
  android: "🤖",
  account: "🔑",
  file: "📁",
};
