/** 条目类型常量 — 集中配置所有类型的字段模板和显示信息 */
import type { ItemType } from "../types/domain";
import i18n from "../i18n";

export interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "password" | "url" | "email" | "textarea" | "file";
  optional?: boolean;
  enableGenerate?: boolean;
}

export interface ItemTypeConfig {
  type: ItemType;
  icon: string;
  label: string;
  hint: string;
  fields: FieldDef[];
}

/**
 * 配置缓存 —— **按语言分桶**。
 *
 * 早期实现是单变量 `let _configs = null; if (_configs) return _configs;`，
 * 即"首次调用后永久固化"。因为 t() 只在首次被求值，**切换语言后
 * 所有 label/hint 仍是旧语言**，且不会有任何报错 —— 静默失效。
 *
 * 现在以语言为 key：语言不变则命中缓存（保留原意），语言变化则重建。
 * 注：当前语言由 navigator.language 在启动时决定、暂无运行时切换入口，
 * 故此缺陷当前不可达；但把缓存 key 化是零成本的防雷 —— 将来加语言切换
 * （settings 页很自然会有）时不会踩到。
 */
const _configsByLang: Record<string, ItemTypeConfig[]> = {};

export function buildItemTypeConfigs(t: (key: string) => string): ItemTypeConfig[] {
  const lang = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const cached = _configsByLang[lang];
  if (cached) return cached;
  const configs = buildFresh(t);
  _configsByLang[lang] = configs;
  return configs;
}

function buildFresh(t: (key: string) => string): ItemTypeConfig[] {
  return [
    {
      type: "login",
      icon: "🔑",
      label: t("vault.edit.typeLogin"),
      hint: t("vault.edit.typeLoginHint"),
      fields: [
        { key: "username", label: t("vault.edit.loginUsername"), placeholder: t("vault.edit.loginUsernamePlaceholder"), type: "text" },
        { key: "password", label: t("vault.edit.localPassword"), placeholder: t("vault.edit.localPasswordPlaceholder"), type: "password", enableGenerate: true },
        { key: "url", label: t("vault.edit.loginUrl"), placeholder: t("vault.edit.loginUrlPlaceholder"), type: "url", optional: true },
        { key: "package", label: t("vault.edit.loginPackage"), placeholder: t("vault.edit.loginPackagePlaceholder"), type: "text", optional: true },
      ],
    },
    {
      type: "card",
      icon: "💳",
      label: t("vault.edit.typeCard"),
      hint: t("vault.edit.typeCardHint"),
      fields: [
        { key: "cardholderName", label: t("vault.edit.cardHolder"), placeholder: t("vault.edit.cardHolderPlaceholder"), type: "text" },
        { key: "cardNumber", label: t("vault.edit.cardNumber"), placeholder: t("vault.edit.cardNumberPlaceholder"), type: "text" },
        { key: "expiry", label: t("vault.edit.cardExpiry"), placeholder: t("vault.edit.cardExpiryPlaceholder"), type: "text" },
        { key: "cvv", label: t("vault.edit.cardCvv"), placeholder: t("vault.edit.cardCvvPlaceholder"), type: "password" },
        { key: "pin", label: t("vault.edit.cardPin"), placeholder: t("vault.edit.cardPinPlaceholder"), type: "password", optional: true, enableGenerate: true },
      ],
    },
    {
      type: "identity",
      icon: "🪪",
      label: t("vault.edit.typeIdentity"),
      hint: t("vault.edit.typeIdentityHint"),
      fields: [
        { key: "fullName", label: t("vault.edit.identityFullName"), placeholder: t("vault.edit.identityFullNamePlaceholder"), type: "text", optional: true },
        { key: "idNumber", label: t("vault.edit.identityIdNumber"), placeholder: t("vault.edit.identityIdNumberPlaceholder"), type: "text", optional: true },
        { key: "address", label: t("vault.edit.identityAddress"), placeholder: t("vault.edit.identityAddressPlaceholder"), type: "text", optional: true },
        { key: "phone", label: t("vault.edit.identityPhone"), placeholder: t("vault.edit.identityPhonePlaceholder"), type: "text", optional: true },
        { key: "email", label: t("vault.edit.identityEmail"), placeholder: t("vault.edit.identityEmailPlaceholder"), type: "email", optional: true },
      ],
    },
    {
      type: "note",
      icon: "📝",
      label: t("vault.edit.typeNote"),
      hint: t("vault.edit.typeNoteHint"),
      fields: [
        { key: "content", label: t("vault.edit.noteContent"), placeholder: t("vault.edit.noteContentPlaceholder"), type: "textarea" },
      ],
    },
    {
      type: "file",
      icon: "📁",
      label: t("vault.edit.typeFile"),
      hint: t("vault.edit.typeFileHint"),
      fields: [
        { key: "file", label: "", placeholder: "", type: "file" },
      ],
    },
  ];
}

/** 获取某个类型的配置 */
export function getTypeConfig(t: (key: string) => string, type: ItemType): ItemTypeConfig | undefined {
  return buildItemTypeConfigs(t).find((c) => c.type === type);
}
