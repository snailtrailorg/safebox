"""解密 SafeBox 旧备份文件，输出明文 JSON。"""

import json
import hashlib
import base64
from Crypto.Cipher import DES3
from Crypto.PublicKey import RSA
from Crypto.Util.Padding import unpad

# ── 常量（从旧 Utilities.java 复制） ──
INITIAL_VECTOR = b"SNAILEYE"
ARBITRARY_PHRASE = "SafeBox"
PADDING_LENGTH = 8
RSA_CHUNK = 512


def generate_secret_key(password: str) -> bytes:
    """SHA-256("SafeBox:" + password) → 第 8~31 字节（24 字节）。"""
    message = f"{ARBITRARY_PHRASE}:{password}"
    digest = hashlib.sha256(message.encode()).digest()
    return digest[8:32]


def triple_des_decrypt(encoded: str, password: str) -> str | None:
    """3DES-CBC-PKCS5Padding 解密，跳过前 8 字节随机 padding。"""
    try:
        key = generate_secret_key(password)
        cipher = DES3.new(key, DES3.MODE_CBC, iv=INITIAL_VECTOR)
        raw = base64.b64decode(encoded)
        decrypted = cipher.decrypt(raw)
        decrypted = unpad(decrypted, DES3.block_size)
        if len(decrypted) <= PADDING_LENGTH:
            return None
        return decrypted[PADDING_LENGTH:].decode("utf-8")
    except Exception as e:
        print(f"  3DES 解密失败: {e}")
        return None


def calculate_digest(email: str, password: str) -> str:
    """SHA-256("SafeBox:" + email + ":" + password) → hex。"""
    message = f"{ARBITRARY_PHRASE}:{email}:{password}"
    return hashlib.sha256(message.encode()).hexdigest()


def rsa_decrypt_raw(private_key_der_base64: str, encoded: str) -> str | None:
    """RSA-4096 NoPadding 裸解密（直接 pow(c, d, n)）。

    Java Cipher("RSA") 在 Android 上的默认行为是 RSA/ECB/NoPadding，
    不是 PKCS1Padding。数据按 rsaMaxEncryptLength=501 分块加密，
    每块 512 字节密文。
    """
    try:
        der_bytes = base64.b64decode(private_key_der_base64)
        key = RSA.import_key(der_bytes)
        # 去掉 Base64 中的换行符再解码
        clean = "".join(encoded.split())
        data = base64.b64decode(clean)
        output = b""
        offset = 0
        while offset < len(data):
            chunk_len = min(RSA_CHUNK, len(data) - offset)
            chunk = data[offset : offset + chunk_len]
            c = int.from_bytes(chunk, "big")
            m = pow(c, key.d, key.n)
            # NoPadding → 去掉前导零即为明文
            raw = m.to_bytes(512, "big").lstrip(b"\x00")
            output += raw
            offset += RSA_CHUNK
        return output.decode("utf-8")
    except Exception as e:
        print(f"  RSA 解密失败: {e}")
        return None


def main():
    password = "1111111A"
    input_path = "/home/michael/safebox-backup-20260623.txt"
    output_path = "/home/michael/safebox-backup-20260623-decrypted.json"

    with open(input_path) as f:
        data = json.load(f)

    users = data.get("user", [])
    items = data.get("item", [])

    if not users:
        print("错误: 备份文件中没有用户数据")
        return

    user = users[0]
    email = user["email"]
    shadow = user["shadow"]
    encrypted_private = user["private_key"]

    print(f"用户: {email}")
    print(f"条目数: {len(items)}")

    digest = calculate_digest(email, password)
    print(f"\nShadow 比对: {digest == shadow}")
    if digest != shadow:
        print("错误: 密码不正确！")
        return

    print("\n解密 RSA 私钥...")
    private_key_der_b64 = triple_des_decrypt(encrypted_private, password)
    if private_key_der_b64 is None:
        print("错误: 无法解密私钥")
        return
    print(f"私钥长度: {len(private_key_der_b64)} 字符")

    print("\n解密条目...")
    decrypted_items = []
    for item in items:
        did = item["did"]
        item_type = item["type"]
        name = item["name"]
        desc = item.get("description", "")
        encrypted_data = item.get("data", "")

        plain_data = ""
        if encrypted_data:
            plain_data = rsa_decrypt_raw(private_key_der_b64, encrypted_data)
            if plain_data is None:
                plain_data = f"[解密失败: {len(encrypted_data)} 字节密文]"

        decrypted_items.append({
            "did": did,
            "type": item_type,
            "icon": item.get("icon", ""),
            "name": name,
            "description": desc,
            "data_plain": plain_data,
        })
        print(f"  did={did} type={item_type:8s} name={name[:20]:20s} data={plain_data[:80]}")

    output = {
        "user": {"uid": user["uid"], "email": email},
        "items": decrypted_items,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n明文已写入: {output_path}")
    print(f"共 {len(decrypted_items)} 条条目")


if __name__ == "__main__":
    main()
