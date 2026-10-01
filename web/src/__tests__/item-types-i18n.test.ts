/**
 * P2-16 回归测试 — itemTypes 配置必须随语言变化重建，不能永久固化。
 *
 * 缺陷原形：`let _configs = null; if (_configs) return _configs;`
 * —— `t()` 只在首次调用时求值，之后永久返回同一份。切换语言后所有
 * label/hint 仍是旧语言，且**不报错、不警告**，是典型静默失效。
 *
 * 修法：缓存按语言分桶（`_configsByLang[lang]`）。
 *
 * 注意：当前应用语言在启动时由 navigator.language 一次性决定、无运行时
 * 切换入口，故该缺陷当前不可达。本测试锁的是**契约**——将来加语言切换
 * （settings 页很自然会有）时，这里会守住行为。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// 用可控的 fake i18n 驱动：我们测的是缓存键行为，不测翻译内容
const langState = { resolvedLanguage: "en", language: "en" };

vi.mock("../i18n", () => ({
  default: {
    get resolvedLanguage() { return langState.resolvedLanguage; },
    get language() { return langState.language; },
  },
}));

describe("itemTypes 配置缓存 (P2-16)", () => {
  beforeEach(async () => {
    langState.resolvedLanguage = "en";
    langState.language = "en";
    vi.resetModules();  // 清掉模块级缓存，保证用例独立
  });

  it("同一语言重复调用返回同一实例（缓存仍生效，不是每次重建）", async () => {
    const { buildItemTypeConfigs } = await import("../config/itemTypes");
    const t = (k: string) => `en:${k}`;
    const a = buildItemTypeConfigs(t);
    const b = buildItemTypeConfigs(t);
    expect(a).toBe(b);
  });

  it("语言变化后必须重建：label 不得残留旧语言（原缺陷的核心断言）", async () => {
    const { buildItemTypeConfigs } = await import("../config/itemTypes");

    const tEn = (k: string) => `en:${k}`;
    const enConfigs = buildItemTypeConfigs(tEn);
    const enLogin = enConfigs.find((c) => c.type === "login");
    expect(enLogin?.label).toBe("en:vault.edit.typeLogin");

    // 切到中文
    langState.resolvedLanguage = "zh";
    langState.language = "zh";

    const tZh = (k: string) => `zh:${k}`;
    const zhConfigs = buildItemTypeConfigs(tZh);
    const zhLogin = zhConfigs.find((c) => c.type === "login");

    // 若缓存未 key 化，这里会拿到 en:vault.edit.typeLogin —— 静默失效
    expect(zhLogin?.label).toBe("zh:vault.edit.typeLogin");
    // 且是不同实例（确实重建了）
    expect(zhConfigs).not.toBe(enConfigs);
  });

  it("切回原语言时命中旧缓存（分桶缓存，不会无限增长）", async () => {
    const { buildItemTypeConfigs } = await import("../config/itemTypes");

    const tEn = (k: string) => `en:${k}`;
    const first = buildItemTypeConfigs(tEn);

    langState.resolvedLanguage = "zh";
    buildItemTypeConfigs((k) => `zh:${k}`);

    langState.resolvedLanguage = "en";
    const back = buildItemTypeConfigs(tEn);
    expect(back).toBe(first);
  });

  it("resolvedLanguage 缺失时回落到 language", async () => {
    const { buildItemTypeConfigs } = await import("../config/itemTypes");
    langState.resolvedLanguage = undefined as unknown as string;
    langState.language = "zh";
    const configs = buildItemTypeConfigs((k) => `zh:${k}`);
    expect(configs.find((c) => c.type === "login")?.label).toBe("zh:vault.edit.typeLogin");
  });

  it("getTypeConfig 同样随语言变化（走同一缓存路径）", async () => {
    const { getTypeConfig } = await import("../config/itemTypes");
    langState.resolvedLanguage = "en";
    expect(getTypeConfig((k) => `en:${k}`, "note")?.label).toBe("en:vault.edit.typeNote");

    langState.resolvedLanguage = "zh";
    expect(getTypeConfig((k) => `zh:${k}`, "note")?.label).toBe("zh:vault.edit.typeNote");
  });
});
