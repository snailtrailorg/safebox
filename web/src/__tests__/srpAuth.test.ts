/**
 * performSrpLogin 封装测试（基本验证 + 边界）
 * mock generatePrivateEphemeral 固定 a=12345 + apiClient 返固定 B/M2（复用 srp.test.ts 向量）
 */
import { describe, it, expect, vi } from "vitest";

const MNEMONIC = "abandon ability able about above absent absorb abstract accuse achieve acid acoustic";
const PASSWORD = "MasterPass123!";
const SALT_HEX = "00112233445566778899aabbccddeeff";
const EMAIL = "test@safebox.example.com";
const B_HEX = "54fd388b53f97823245838d1982c51eaecad12a5322d74ce36c752f24c73269b76a88beb856284f925572ac78ebfca769016f63d77d9a547904ff97d605e7c5307506c82017e21056323696f7716abc8276ac67e05fb78419f5b5b6a16533a24b8ba9cdbce42fef8204bf1398cdc50305043ef209dd8529abbd3b981be079b6a8d5413178e8f6ea3e22ac74bca4657f345e110aca6311095019441eb57436f53df277edbb7741028f857f69e67b4b9f925539caa66efb7be8d9f964ae8689ef6f1013bc7af048093a82ba75a5374df4ef44ec52c68df0d1750046e2309e13b616db29d7d4883174b939996acc86373c08af96bd8e75380f73e2f1cb9c232ec6108c346b790da1f6bb3671c1518e0ebff80cffd4cc306b2328b1081134d0236ad4f3900d301ab1c578bfb106519cc257dadf0090f3c1e84b1c75df0f86c9603f67e69d0ce6626aa03ea1c039654fc34f32e08af911c81c01f251c9aad1b55eec3f984876cd1682937d0e252c05ccbddd8082c44011993fe57a750fcc3745576b25d1eb1b8c95059567b1c1257fb21f01ba90545737aa440d34db53eb71e66389fb197bf8f0ad85a1e52c9f4106bb45ec9290cbd35723b98748240ed50409f6146da57cc0b0409801a9521ec357606c6791794a3b37754db1339c677a53586cd26590bd24f984e954ece53754cca14c6055cb879612c88cfd476cfdc82b9caf3cf";
const M2_HEX = "3439f20e2c0a8402bd63293e342150af5f28befa18456558ddbcf9f8673ed325";
const K_HEX = "1a68ca4dd904483abd033d620e45badbf9233122f4831a56be4fb43bfa23f9f8";

vi.mock("../services/api", () => ({
  apiClient: {
    loginSrpChallenge: vi.fn(),
    loginSrpVerify: vi.fn(),
  },
}));

// mock generatePrivateEphemeral 固定 a=12345（与 srp.test.ts 向量一致，使 K 可预测）
vi.mock("../crypto/srp", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, generatePrivateEphemeral: () => 12345n };
});

import { performSrpLogin } from "../services/srpAuth";
import { apiClient } from "../services/api";
import { bytesToHex } from "../crypto/srp";

const SALT = { srp_salt: SALT_HEX, local_salt: "", mnemonic_salt: "" };

describe("performSrpLogin", () => {
  it("challenge + verify + K 派生（封装正确）", async () => {
    apiClient.loginSrpChallenge.mockResolvedValue({ session_id: "s1", B: B_HEX });
    apiClient.loginSrpVerify.mockResolvedValue({ access_token: "tok", refresh_token: "ref", M2: M2_HEX, device_id: "d1", devices: [] });
    const { resp, K } = await performSrpLogin("email", EMAIL, PASSWORD, MNEMONIC, SALT);
    expect(bytesToHex(K)).toBe(K_HEX);
    expect(resp.access_token).toBe("tok");
    expect(apiClient.loginSrpChallenge).toHaveBeenCalledWith(expect.objectContaining({ target_type: "email", target: EMAIL }));
  });

  it("错 M2 -> throw（边界）", async () => {
    apiClient.loginSrpChallenge.mockResolvedValue({ session_id: "s1", B: B_HEX });
    apiClient.loginSrpVerify.mockResolvedValue({ M2: "00".repeat(32) });
    await expect(performSrpLogin("email", EMAIL, PASSWORD, MNEMONIC, SALT)).rejects.toThrow("M2");
  });

  it("B%N=0 -> throw（边界，SRP 规范防恶意服务端）", async () => {
    apiClient.loginSrpChallenge.mockResolvedValue({ session_id: "s1", B: "0" });
    await expect(performSrpLogin("email", EMAIL, PASSWORD, MNEMONIC, SALT)).rejects.toThrow("Invalid server public B");
  });
});
