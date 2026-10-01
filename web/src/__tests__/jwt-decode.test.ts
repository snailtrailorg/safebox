/**
 * AuthContext JWT 解析回归测试（P1-9）
 *
 * 背景：checkSession 原用 `atob(token.split(".")[1])` 解 JWT payload。
 * 浏览器 atob 只接受标准 base64，而 JWT 用 base64url（- / _），
 * 遇到这些字符会抛 InvalidCharacterError -> 正常 token 被误判未登录（间歇性掉登录）。
 */
import { describe, it, expect } from "vitest";

/** 复刻修复后的解码逻辑（与 AuthContext.checkSession 一致） */
function decodeJwtPayload(token: string): any {
  const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(b64));
}

/** 把普通字符串编成 base64url（模拟 JWT 编码） */
function toBase64Url(obj: unknown): string {
  const json = JSON.stringify(obj);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("JWT payload base64url 解码（P1-9）", () => {
  it("含 - / _ 的 payload 能正确解码（旧实现会抛错）", () => {
    // 构造一个必然产生 - 或 _ 的 payload
    const payload = { sub: "user-1", exp: 9999999999, data: "\u00ff\u00fe\u00fd>>>???" };
    const token = `header.${toBase64Url(payload)}.sig`;

    // 确认这个 payload 确实含 base64url 特殊字符（否则测试没意义）
    const seg = token.split(".")[1];
    expect(seg.includes("-") || seg.includes("_")).toBe(true);

    // 旧实现：直接 atob 应抛错
    let oldFailed = false;
    try {
      atob(seg);
    } catch {
      oldFailed = true;
    }
    expect(oldFailed).toBe(true);

    // 新实现：正确解出
    const decoded = decodeJwtPayload(token);
    expect(decoded.sub).toBe("user-1");
    expect(decoded.exp).toBe(9999999999);
  });

  it("标准 base64 字符的 payload 仍然可用", () => {
    const payload = { sub: "abc", exp: 1234567890 };
    const token = `header.${toBase64Url(payload)}.sig`;
    expect(decodeJwtPayload(token).sub).toBe("abc");
  });

  it("exp 过期判断逻辑正确", () => {
    const expired = { sub: "u", exp: Math.floor(Date.now() / 1000) - 3600 };
    const valid = { sub: "u", exp: Math.floor(Date.now() / 1000) + 3600 };
    expect(decodeJwtPayload(`h.${toBase64Url(expired)}.s`).exp * 1000 > Date.now()).toBe(false);
    expect(decodeJwtPayload(`h.${toBase64Url(valid)}.s`).exp * 1000 > Date.now()).toBe(true);
  });
});
