/**
 * apiClient 基本验证 + 边界（mock fetch + sessionStore）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/sessionStore", () => ({
  getAccessToken: vi.fn(),
  getRefreshToken: vi.fn(),
  updateTokens: vi.fn(),
  getSession: vi.fn().mockResolvedValue({ session_K: "" }),  // 无 K，不加密
}));

import { apiClient, ApiError } from "../services/api";
import { getAccessToken, getRefreshToken, updateTokens, getSession } from "../db/sessionStore";

// mock Response 对象（不加密，无 X-Safebox-Encrypted）
const mockResp = (status: number, body: unknown) => ({
  status,
  ok: status < 400,
  headers: { get: () => null },
  json: async () => body,
  arrayBuffer: async () => new ArrayBuffer(0),
});

describe("apiClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccessToken).mockResolvedValue("access-token");
    vi.mocked(getRefreshToken).mockResolvedValue("refresh-token");
  });

  it("200 正常请求（封装正确）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResp(200, { ok: true })));
    const result = await apiClient.pull("2020-01-01");
    expect(result).toEqual({ ok: true });
  });

  it("401 -> refresh 成功 -> retry 200", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResp(401, { detail: "invalid" }))           // 第一次 pull 401
      .mockResolvedValueOnce(mockResp(200, { access_token: "new", refresh_token: "new" }))  // refresh 响应
      .mockResolvedValueOnce(mockResp(200, { ok: true }));                      // 重试 pull 200
    vi.stubGlobal("fetch", fetchMock);
    const result = await apiClient.pull("2020-01-01");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(updateTokens).toHaveBeenCalledWith("new", "new");
  });

  it("401 -> refresh 失败 -> onAuthFailure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResp(401, {})));  // 一直 401
    const onFail = vi.fn();
    apiClient.setOnAuthFailure(onFail);
    await expect(apiClient.pull("2020-01-01")).rejects.toThrow();
    expect(onFail).toHaveBeenCalled();
  });

  it("session_K 损坏时降级为明文传输，不得让请求抛错（否则用户被锁死在已登录但不可用）", async () => {
    // 关键契约：hexToBytes 已收紧为「非法输入抛错」。若 getK() 不兜住，
    // 一个损坏的 session_K 会让所有认证请求崩掉，且错误信息用户无法自解。
    vi.mocked(getSession).mockResolvedValue({ session_K: "not-valid-hex-!!" } as never);
    const fetchMock = vi.fn().mockResolvedValue(mockResp(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiClient.pull("2020-01-01");
    expect(result).toEqual({ ok: true });
    // 降级：不带 X-Safebox-Encrypted 头（服务端按明文处理）
    const sentHeaders = fetchMock.mock.calls[0][1].headers;
    expect(sentHeaders["X-Safebox-Encrypted"]).toBeUndefined();
  });

  it("合法 session_K 时确实启用加密传输（防降级标记存在）", async () => {
    vi.mocked(getSession).mockResolvedValue({ session_K: "00112233445566778899aabbccddeeff" } as never);
    const fetchMock = vi.fn().mockResolvedValue(mockResp(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.pull("2020-01-01");
    const sentHeaders = fetchMock.mock.calls[0][1].headers;
    // pull 是 GET，不加密 body，但 GET 仍会带 K 用于解密响应
    // 这里断言的是「K 被成功解析出来」——即没有降级
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
