/**
 * SRP 登录公共逻辑：challenge + verify + 派生 K。
 * 调用方准备 mnemonic（缓存解出/用户输入/注册内存）+ salt（getSalt）+ saveSession device_id/session_K。
 * 返回 { resp: LoginResponse, K: 通信密钥（bytesToHex(K) 存 session_K）}。
 */
import { apiClient } from "./api";
import {
  generatePrivateEphemeral, computeClientPublic, computeU, computeClientS,
  computeK, computeM1, verifyM2, deriveX,
  bigIntToHex, hexToBigInt, hexToBytes, bytesToHex,
} from "../crypto/srp";
import type { LoginResponse, SaltResponse } from "../types/api";

export async function performSrpLogin(
  targetType: "email" | "phone",
  target: string,
  password: string,
  mnemonic: string,
  salt: SaltResponse,
  deviceId?: string,
): Promise<{ resp: LoginResponse; K: Uint8Array }> {
  const a = generatePrivateEphemeral();
  const A = computeClientPublic(a);
  // 同设备传 device_id（验未 revoked），新设备传 device_name 建 UserDevice
  const chal = await apiClient.loginSrpChallenge({
    target_type: targetType, target, A: bigIntToHex(A),
    ...(deviceId ? { device_id: deviceId } : { device_name: "Web Browser" }),
  });
  const B = hexToBigInt(chal.B);
  const x = await deriveX(password, mnemonic, hexToBytes(salt.srp_salt), target);
  const u = await computeU(A, B);
  const S = await computeClientS(B, a, u, x);
  const K = await computeK(S);
  const M1 = await computeM1(A, B, K);
  const resp = await apiClient.loginSrpVerify({ session_id: chal.session_id, M1: bytesToHex(M1) });
  if (!await verifyM2(A, M1, K, resp.M2)) {
    throw new Error("SRP M2 verification failed");
  }
  return { resp, K };
}
