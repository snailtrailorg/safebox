import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./locales/zh.json";
import en from "./locales/en.json";

const detectLang = (): "zh" | "en" => {
  const nav = navigator.language;
  return nav.startsWith("zh") ? "zh" : "en";
};

const lang = detectLang();

i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng: lang,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

// 同步设置 HTML lang 属性
document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";

export default i18n;
export { lang as currentLang };
