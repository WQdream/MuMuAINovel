"""邀请码生成与规范化工具。"""
import re
import secrets


INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
INVITE_CODE_LENGTH = 12


def normalize_invite_code(value: str) -> str:
    """只保留邀请码字母和数字，避免大小写及分隔符造成不一致。"""
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def format_invite_code(value: str) -> str:
    """将邀请码格式化为四字符一组的展示形式。"""
    canonical = normalize_invite_code(value)
    return "-".join(
        canonical[index:index + 4]
        for index in range(0, len(canonical), 4)
    )


def generate_invite_code() -> str:
    """生成不含易混淆字符的一次性邀请码。"""
    return "".join(secrets.choice(INVITE_ALPHABET) for _ in range(INVITE_CODE_LENGTH))
