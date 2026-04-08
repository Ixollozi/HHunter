from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from .config import settings


def _fernet() -> Fernet:
    key = (settings.groq_key_fernet_secret or "").strip()
    if not key:
        raise RuntimeError("GROQ_KEY_FERNET_SECRET не задан (нужно для шифрования Groq API ключа).")
    return Fernet(key.encode("utf-8"))


def encrypt_secret(plaintext: str) -> str:
    s = (plaintext or "").strip()
    if not s:
        return ""
    token = _fernet().encrypt(s.encode("utf-8"))
    return token.decode("utf-8")


def decrypt_secret(ciphertext: str) -> str:
    s = (ciphertext or "").strip()
    if not s:
        return ""
    try:
        raw = _fernet().decrypt(s.encode("utf-8"))
    except InvalidToken as e:
        raise RuntimeError("Не удалось расшифровать Groq API ключ (проверьте GROQ_KEY_FERNET_SECRET).") from e
    return raw.decode("utf-8")

