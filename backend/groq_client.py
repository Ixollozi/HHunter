from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from groq import Groq


@dataclass(frozen=True)
class GroqResult:
    text: str
    model_used: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    requests_remaining: int | None = None


def groq_chat_completion(
    *,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.3,
    max_tokens: int = 650,
) -> GroqResult:
    client = Groq(api_key=api_key)
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
    )

    text = ""
    try:
        text = (resp.choices[0].message.content or "").strip()
    except Exception:  # noqa: BLE001
        text = ""

    usage = getattr(resp, "usage", None)
    pt = getattr(usage, "prompt_tokens", None) if usage else None
    ct = getattr(usage, "completion_tokens", None) if usage else None
    tt = getattr(usage, "total_tokens", None) if usage else None

    # Groq SDK does not reliably expose rate-limit headers in the response object.
    # Keep as optional field for future improvement.
    return GroqResult(
        text=text,
        model_used=str(getattr(resp, "model", None) or model),
        prompt_tokens=int(pt) if pt is not None else None,
        completion_tokens=int(ct) if ct is not None else None,
        total_tokens=int(tt) if tt is not None else None,
        requests_remaining=None,
    )

