/**
 * SRP-6a 认证（对标 1Password 2SKD，自实现，与后端 srp_service.py 逐字节一致）。
 *
 * x 派生（2SKD，双秘密）：
 *   pbkdf2_out = PBKDF2-HMAC-SHA256(主密码, HKDF拉伸(srp_salt, 邮箱), 600_000, 32)
 *   hkdf_out   = HKDF-SHA256(助记词, salt=邮箱, info="safebox-srp-auth", 32)
 *   x = int(pbkdf2_out XOR hkdf_out)
 *   对标 1Password：PBKDF2(主密码) XOR HKDF(SecretKey)，助记词即 Secret Key。
 *
 * SRP-6a：RFC 3526 4096-bit + SHA-256
 *   k = H(PAD(N) | PAD(g))；u = H(PAD(A) | PAD(B))
 *   A = g^a mod N；B = (k·v + g^b) mod N
 *   S_client = (B - k·g^x)^(a + u·x) mod N；K = H(S)
 *   M1 = H(PAD(A) | PAD(B) | K)；M2 = H(PAD(A) | M1 | K)
 *
 * 全 BigInt（modPow）+ Web Crypto（sha256/hkdf/pbkdf2）。无第三方库。
 */

// RFC 3526 4096-bit MODP prime（与后端 srp_service._N_HEX 完全一致）
const N_HEX =
  "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A92108011A723C12A787E6D788719A10BDBA5B2699C327186AF4E23C1A946834B6150BDA2583E9CA2AD44CE8DBBBC2DB04DE8EF92E8EFC141FBECAA6287C59474E6BC05D99B2964FA090C3A2233BA186515BE7ED1F612970CEE2D7AFB81BDD762170481CD0069127D5B05AA993B4EA988D8FDDC186FFB7DC90A6C08F4DF435C934063199FFFFFFFFFFFFFFFF";

export const N: bigint = BigInt("0x" + N_HEX);
export const G: bigint = 2n;
const N_BYTES = 512; // (N.bit_length()+7)//8 = 4096/8

export const PBKDF2_ITERATIONS = 600_000;
const AUTH_INFO = new TextEncoder().encode("safebox-srp-auth");
const SALT_STRETCH_INFO = new TextEncoder().encode("safebox-srp-salt");

// ── BigInt <-> bytes ─────────────────────────────────────

function bigIntToBytes(n: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let v = n;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}
function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = 0; i < bytes.length; i++) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

/** 整数 pad 到 N 字节长度（SRP 规范，大端），对齐后端 _pad。 */
function pad(n: bigint): Uint8Array {
  return bigIntToBytes(n, N_BYTES);
}

// ── SHA-256（Web Crypto）─────────────────────────────────

async function sha256(...args: Uint8Array[]): Promise<Uint8Array> {
  const total = args.reduce((s, a) => s + a.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const a of args) { buf.set(a, off); off += a.length; }
  const digest = await crypto.subtle.digest("SHA-256", buf as unknown as BufferSource);
  return new Uint8Array(digest);
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key as unknown as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data as unknown as BufferSource);
  return new Uint8Array(sig);
}

// ── HKDF-SHA256（RFC 5869，对齐后端 hkdf_extract/expand）──

async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  return hmacSha256(salt, ikm);
}
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const out: number[] = [];
  let t: Uint8Array = new Uint8Array(0);
  let i = 1;
  while (out.length < length) {
    const input = new Uint8Array(t.length + info.length + 1);
    input.set(t, 0);
    input.set(info, t.length);
    input[t.length + info.length] = i;
    t = await hmacSha256(prk, input);
    for (const b of t) out.push(b);
    i++;
  }
  return new Uint8Array(out.slice(0, length));
}
async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hkdfExtract(salt, ikm);
  return hkdfExpand(prk, info, length);
}

// ── modPow（BigInt square-and-multiply）──────────────────

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

// ── SRP-6a multiplier k = H(PAD(N) | PAD(g))，lazy 缓存 ──

let _K: bigint | null = null;
async function getK(): Promise<bigint> {
  if (_K === null) _K = bytesToBigInt(await sha256(pad(N), pad(G)));
  return _K;
}

// ── 2SKD x 派生 ─────────────────────────────────────────

export async function deriveX(
  masterPassword: string, mnemonic: string, srpSalt: Uint8Array, email: string,
): Promise<bigint> {
  const emailLower = new TextEncoder().encode(email.toLowerCase());
  const password = new TextEncoder().encode(masterPassword.normalize("NFKD"));
  const mnemonicBytes = new TextEncoder().encode(mnemonic);

  // 1. srp_salt 经 HKDF 拉伸（salt=小写邮箱）
  const stretchedSalt = await hkdf(srpSalt, emailLower, SALT_STRETCH_INFO, 32);
  // 2. PBKDF2(主密码, 拉伸salt, 600k)
  const keyMaterial = await crypto.subtle.importKey("raw", password as unknown as BufferSource, "PBKDF2", false, ["deriveBits"]);
  const pbkdf2Out = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: stretchedSalt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial, 256,
  ));
  // 3. HKDF(助记词, salt=邮箱, info=AUTH_INFO)
  const hkdfOut = await hkdf(mnemonicBytes, emailLower, AUTH_INFO, 32);
  // 4. XOR
  const xBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) xBytes[i] = pbkdf2Out[i] ^ hkdfOut[i];
  return bytesToBigInt(xBytes);
}

export function generateSrpSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

export function computeVerifier(x: bigint): bigint {
  return modPow(G, x, N);
}

// ── SRP-6a 握手数学 ─────────────────────────────────────

export function generatePrivateEphemeral(): bigint {
  const bytes = new Uint8Array(N_BYTES);
  crypto.getRandomValues(bytes);
  let r = bytesToBigInt(bytes) % (N - 1n) + 1n; // [1, N-1]
  return r;
}

export function computeClientPublic(a: bigint): bigint {
  return modPow(G, a, N);
}

/** B = (k·v + g^b) mod N（服务端公开值；前端客户端不调，此处供测试验证一致性）。 */
export async function computeServerPublic(v: bigint, b: bigint): Promise<bigint> {
  const k = await getK();
  return (k * v + modPow(G, b, N)) % N;
}

export async function computeU(A: bigint, B: bigint): Promise<bigint> {
  return bytesToBigInt(await sha256(pad(A), pad(B)));
}

export async function computeClientS(B: bigint, a: bigint, u: bigint, x: bigint): Promise<bigint> {
  const k = await getK();
  // S = (B - k·g^x)^(a+u·x) mod N；BigInt % 对负数取负，需规范化到 [0,N)
  const base = ((B - k * modPow(G, x, N)) % N + N) % N;
  return modPow(base, a + u * x, N);
}

export async function computeK(S: bigint): Promise<Uint8Array> {
  return sha256(pad(S));
}

export async function computeM1(A: bigint, B: bigint, K: Uint8Array): Promise<Uint8Array> {
  return sha256(pad(A), pad(B), K);
}

export async function computeM2(A: bigint, M1: Uint8Array, K: Uint8Array): Promise<Uint8Array> {
  return sha256(pad(A), M1, K);
}

/** 常量时间验证服务端 M2。 */
export async function verifyM2(A: bigint, M1: Uint8Array, K: Uint8Array, serverM2Hex: string): Promise<boolean> {
  const expected = await computeM2(A, M1, K);
  const serverM2 = hexToBytes(serverM2Hex);
  if (expected.length !== serverM2.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ serverM2[i];
  return diff === 0;
}

export function isValidPublic(value: bigint): boolean {
  return value % N !== 0n;
}

// ── hex 工具（A/B/M1/M2/v/srp_salt 传输用 hex 字符串）──

export function bigIntToHex(n: bigint): string {
  return n.toString(16);
}
export function hexToBigInt(hex: string): bigint {
  return BigInt("0x" + hex);
}
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
