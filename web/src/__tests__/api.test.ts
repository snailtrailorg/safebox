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
import { getAccessToken, getRefreshToken, updateTokens } from "../db/sessionStore";

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
});
