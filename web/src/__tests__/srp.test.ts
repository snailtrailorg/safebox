/**
 * SRP-6a 前后端一致性测试（固定向量，与 server/app/services/srp_service.py 对齐）
 *
 * 固定输入：master_password + mnemonic + srp_salt(hex) + email + a + b
 * 预期值由后端 srp_service.py（RFC 3526 4096-bit N）跑同样输入产生。
 * 前后端任一改动此向量都需同步更新。
 */
import { describe, it, expect } from "vitest";
import {
  deriveX, computeVerifier, computeClientPublic, computeServerPublic, computeU,
  computeClientS, computeK, computeM1, computeM2, verifyM2,
  hexToBigInt, bigIntToHex, hexToBytes, bytesToHex,
} from "../crypto/srp";

const MNEMONIC = "abandon ability able about above absent absorb abstract accuse achieve acid acoustic";
const PASSWORD = "MasterPass123!";
const SALT_HEX = "00112233445566778899aabbccddeeff";
const EMAIL = "test@safebox.example.com";

// 后端 srp_service.py 固定输入输出（a=12345, b=67890，RFC 3526 4096-bit N）
const X_HEX = "86ab7db81ae46c3311777095a451f123024a8d68293618d72409077f0bc0d324";
const V_HEX = "ab81cc0e4d469eb4fd203716494a00568234200f561225431d75affc05130cbbc67b261f195be52ee0109cf858bbc116c07f777aeb42cd0938384f0b9eff969f84b532c6563f3deb83cdda8c5c75d8d18eeee79e33227e68beaa03b7c80a4a622664b38ccede9ef672bbea10969c863d6bbac71e178fec4b734017c9296442f8379fa23d0988553251f45b35bfdb18f5b681e4b298373b03936bad154d44a30e19d12680d80806e188878209b377cbbe7d2d60c6373c4f302015a59f121cc9184698e849e57a9084a88af1c8e46dbd95820396f6fd9d11b1170a23888dd531ef5cfeb3d8f59f99e8ce62de89e0f799553cd75cd159ff7032ebd1126f0caaeb1f0d99801bd18f3cc5da73eeecf2499ddcaab3009cd3a4c36e1424d683a64030e6fdab5209097d3cc832d26818ba68bc71afc1c851f10a41cb9f5d8f79f6d6e4edae64d721377105847bc1d98da23eada98159b4c2d51c366cd2eb0157d8f52de14f5436eef56f3a64225368e12e113a52cf74fd5295ad03bf3ce482e97ffd7b1059553435f8f4016bfade07f1b3ae901e14d9666caa48ffe8b1e2bb5fef4bffbd59aab9f6b44c5ed70d03e10617fb32a8756cc1baee266a77c0a5c9b8fe957cbf56ea7a80e2f89297d107279e5dacff7375bb96b2a529cc3722d2b097a092bef3733d3ca3b126dd7ac6a1b340a481837689d7657bc131dff9bb9973ed5411be07";
const A_HEX = "32474fe1614ffd670544670dbed06472ee9c87b19d823499fce0bb839906eeebbd0ac3f63e7856a2527a9a92b92cbae3f680429d8a78f3ef3a8ed5df86f026bdeaa8c337be68bffe0a42154890cb5a027c4a08e06ecbe35597c6d4de2f607283bb1d90246847406201f258d2456a0d42117bbcd06e763583cd365b694b69438d63ffbf5b75420ff94587a975cad2389c7cbc48efa8c06225bd32a27aad62a677b485552ae2a021b181d5334442bc9d66b6a1e6a6dd726ab88d1291153301de3261fef7b217811e151ebd337dc33cbc6faa662122a013056c47a0583723c12b99cc1e59a3f19542dda0b186df987066125351c1af669e04f68489dd1057acd5bc960c3fd491d2e81029bf0c377d6d4e2043a0c5af0d628b294b904a8fbaadd736d64c4d455bcd44ed1be38b697a809d0d95ea471a38e669038b5a88ec14145a99a99ac12253152584c4052ea26120d49dca6acd185fb5c9486f83cb0c1ad9df19bc82f649d209af6fb5b72dc3b9c053aaef196ca963245ab3c0bd9bd9a5f724160481722eecd6f80f69fb19fdb1f4c59a9392495e609b698dffb44ef16593e49afb5df12a0432448e0c02fc84089c4df704c0bac4be68ce0d6f8c889441385dfffd2893fe53c8f0e642b2b897a25b735f41b19fe6c3ad556616a499e035c7394118038f170fb8a0a41bf403508c9c3e5068fb2f0ccd53a2e1271c63b59908ee27";
const B_HEX = "54fd388b53f97823245838d1982c51eaecad12a5322d74ce36c752f24c73269b76a88beb856284f925572ac78ebfca769016f63d77d9a547904ff97d605e7c5307506c82017e21056323696f7716abc8276ac67e05fb78419f5b5b6a16533a24b8ba9cdbce42fef8204bf1398cdc50305043ef209dd8529abbd3b981be079b6a8d5413178e8f6ea3e22ac74bca4657f345e110aca6311095019441eb57436f53df277edbb7741028f857f69e67b4b9f925539caa66efb7be8d9f964ae8689ef6f1013bc7af048093a82ba75a5374df4ef44ec52c68df0d1750046e2309e13b616db29d7d4883174b939996acc86373c08af96bd8e75380f73e2f1cb9c232ec6108c346b790da1f6bb3671c1518e0ebff80cffd4cc306b2328b1081134d0236ad4f3900d301ab1c578bfb106519cc257dadf0090f3c1e84b1c75df0f86c9603f67e69d0ce6626aa03ea1c039654fc34f32e08af911c81c01f251c9aad1b55eec3f984876cd1682937d0e252c05ccbddd8082c44011993fe57a750fcc3745576b25d1eb1b8c95059567b1c1257fb21f01ba90545737aa440d34db53eb71e66389fb197bf8f0ad85a1e52c9f4106bb45ec9290cbd35723b98748240ed50409f6146da57cc0b0409801a9521ec357606c6791794a3b37754db1339c677a53586cd26590bd24f984e954ece53754cca14c6055cb879612c88cfd476cfdc82b9caf3cf";
const K_HEX = "1a68ca4dd904483abd033d620e45badbf9233122f4831a56be4fb43bfa23f9f8";
const M1_HEX = "aa3e5060e642f2dd7d6089bb514c638a833aa4c428aaf2c028c465ae8bace077";
const M2_HEX = "3439f20e2c0a8402bd63293e342150af5f28befa18456558ddbcf9f8673ed325";

describe("SRP-6a 前后端一致性", () => {
  it("deriveX 与后端一致", async () => {
    const x = await deriveX(PASSWORD, MNEMONIC, hexToBytes(SALT_HEX), EMAIL);
    expect(bigIntToHex(x)).toBe(X_HEX);
  });

  it("computeVerifier 与后端一致", async () => {
    const x = await deriveX(PASSWORD, MNEMONIC, hexToBytes(SALT_HEX), EMAIL);
    expect(bigIntToHex(computeVerifier(x))).toBe(V_HEX);
  });

  it("computeClientPublic(a=12345) 与后端一致", () => {
    expect(bigIntToHex(computeClientPublic(12345n))).toBe(A_HEX);
  });

  it("computeServerPublic(v, b=67890) 与后端一致", async () => {
    const x = await deriveX(PASSWORD, MNEMONIC, hexToBytes(SALT_HEX), EMAIL);
    const v = computeVerifier(x);
    expect(bigIntToHex(await computeServerPublic(v, 67890n))).toBe(B_HEX);
  });

  it("完整握手：client S -> K -> M1，服务端 M2 验证通过", async () => {
    const x = await deriveX(PASSWORD, MNEMONIC, hexToBytes(SALT_HEX), EMAIL);
    const A = computeClientPublic(12345n);
    const B = hexToBigInt(B_HEX);
    const u = await computeU(A, B);
    const S = await computeClientS(B, 12345n, u, x);
    const K = await computeK(S);
    expect(bytesToHex(K)).toBe(K_HEX);
    const M1 = await computeM1(A, B, K);
    expect(bytesToHex(M1)).toBe(M1_HEX);
    const M2 = await computeM2(A, M1, K);
    expect(bytesToHex(M2)).toBe(M2_HEX);
    expect(await verifyM2(A, M1, K, M2_HEX)).toBe(true);
  });

  it("错密码 -> deriveX 不同（2SKD：主密码参与）", async () => {
    const x1 = await deriveX(PASSWORD, MNEMONIC, hexToBytes(SALT_HEX), EMAIL);
    const x2 = await deriveX("wrong-password", MNEMONIC, hexToBytes(SALT_HEX), EMAIL);
    expect(bigIntToHex(x1)).not.toBe(bigIntToHex(x2));
  });

  it("错助记词 -> deriveX 不同（2SKD：助记词参与）", async () => {
    const x1 = await deriveX(PASSWORD, MNEMONIC, hexToBytes(SALT_HEX), EMAIL);
    const x2 = await deriveX(PASSWORD, "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", hexToBytes(SALT_HEX), EMAIL);
    expect(bigIntToHex(x1)).not.toBe(bigIntToHex(x2));
  });
});
