/**
 * i18n 翻译文件完整性测试
 */
import { describe, it, expect } from "vitest";
import zh from "../i18n/locales/zh.json";
import en from "../i18n/locales/en.json";

/** 递归提取所有 key 路径 */
function extractKeys(
  obj: Record<string, unknown>,
  prefix = "",
): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      keys.push(...extractKeys(v as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

const zhKeys = extractKeys(zh);
const enKeys = extractKeys(en);

describe("i18n translation completeness", () => {
  it("zh and en have same keys", () => {
    const zhSet = new Set(zhKeys);
    const enSet = new Set(enKeys);

    const onlyZh = zhKeys.filter((k) => !enSet.has(k));
    const onlyEn = enKeys.filter((k) => !zhSet.has(k));

    if (onlyZh.length > 0) {
      console.error("Keys only in zh.json:", onlyZh);
    }
    if (onlyEn.length > 0) {
      console.error("Keys only in en.json:", onlyEn);
    }

    expect(onlyZh).toEqual([]);
    expect(onlyEn).toEqual([]);
  });

  it("all keys have non-empty values", () => {
    function checkValues(obj: Record<string, unknown>, path = ""): string[] {
      const empty: string[] = [];
      for (const [k, v] of Object.entries(obj)) {
        const fullPath = path ? `${path}.${k}` : k;
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          empty.push(...checkValues(v as Record<string, unknown>, fullPath));
        } else if (typeof v === "string" && v.trim() === "") {
          empty.push(fullPath);
        }
      }
      return empty;
    }

    const emptyZh = checkValues(zh);
    const emptyEn = checkValues(en);

    if (emptyZh.length > 0) {
      console.error("Empty values in zh.json:", emptyZh);
    }
    if (emptyEn.length > 0) {
      console.error("Empty values in en.json:", emptyEn);
    }

    expect(emptyZh).toEqual([]);
    expect(emptyEn).toEqual([]);
  });

  it("language detection: zh starts with 'zh'", () => {
    const detectLang = (nav: string): "zh" | "en" =>
      nav.startsWith("zh") ? "zh" : "en";

    expect(detectLang("zh-CN")).toBe("zh");
    expect(detectLang("zh-TW")).toBe("zh");
    expect(detectLang("zh")).toBe("zh");
    expect(detectLang("en-US")).toBe("en");
    expect(detectLang("en")).toBe("en");
    expect(detectLang("ja")).toBe("en");
    expect(detectLang("fr")).toBe("en");
  });

  it("all interpolation placeholders match between zh and en", () => {
    const placeholderRe = /\{(\w+)\}/g;

    for (const key of zhKeys) {
      const zhVal = getNestedValue(zh, key);
      const enVal = getNestedValue(en, key);
      if (typeof zhVal !== "string" || typeof enVal !== "string") continue;

      const zhParams = new Set(
        [...zhVal.matchAll(placeholderRe)].map((m) => m[1]),
      );
      const enParams = new Set(
        [...enVal.matchAll(placeholderRe)].map((m) => m[1]),
      );

      const onlyZh = [...zhParams].filter((p) => !enParams.has(p));
      const onlyEn = [...enParams].filter((p) => !zhParams.has(p));

      if (onlyZh.length > 0 || onlyEn.length > 0) {
        console.error(
          `Placeholder mismatch for key "${key}": zh=${JSON.stringify([...zhParams])} en=${JSON.stringify([...enParams])}`,
        );
      }
      expect(onlyZh).toEqual([]);
      expect(onlyEn).toEqual([]);
    }
  });

  it("total key count is reasonable", () => {
    // 确保翻译文件有合理数量的 key（不是空文件）
    expect(zhKeys.length).toBeGreaterThan(50);
    expect(enKeys.length).toBeGreaterThan(50);
  });
});

function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  return path.split(".").reduce((o: any, k) => o?.[k], obj);
}
