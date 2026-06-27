"""阿里云短信服务。"""

import json
import hmac
import hashlib
import base64
import uuid
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx

from app.config import settings


def _sign(secret: str, string_to_sign: str) -> str:
    """HMAC-SHA1 签名并 Base64 编码。"""
    h = hmac.new(f"{secret}&".encode(), string_to_sign.encode(), hashlib.sha1)
    return base64.b64encode(h.digest()).decode()


def _build_common_params() -> dict:
    """构建阿里云短信 API 公共参数。"""
    return {
        "Format": "JSON",
        "Version": "2017-05-25",
        "AccessKeyId": settings.sms_access_key_id,
        "SignatureMethod": "HMAC-SHA1",
        "Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "SignatureVersion": "1.0",
        "SignatureNonce": str(uuid.uuid4()),
        "RegionId": "cn-hangzhou",
    }


async def send_sms(phone: str, code: str) -> bool:
    """发送短信验证码。

    Returns:
        True 如果发送成功。
    """
    if not settings.sms_access_key_id:
        print(f"[DEV] 短信未配置，验证码 {code} 应发送到 {phone}")
        return True

    params = _build_common_params()
    params.update({
        "Action": "SendSms",
        "PhoneNumbers": phone,
        "SignName": settings.sms_sign_name,
        "TemplateCode": settings.sms_template_code,
        "TemplateParam": json.dumps({"code": code}),
    })

    # 签名
    sorted_params = sorted(params.items())
    query_string = urlencode(sorted_params, safe="%-_.~")
    string_to_sign = f"GET&%2F&{urlencode(query_string, safe='')}"
    signature = _sign(settings.sms_access_key_secret, string_to_sign)
    params["Signature"] = signature

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://dysmsapi.aliyuncs.com/",
            params=params,
        )
        data = resp.json()
        return data.get("Code") == "OK"
