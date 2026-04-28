from __future__ import annotations

import json
from typing import Any


def encode_str_list(val: list[str] | None) -> str | None:
    if val is None:
        return None
    return json.dumps(val, ensure_ascii=False)


def decode_str_list(raw: str | None) -> list[str] | None:
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    s = raw.strip()
    if s.startswith("["):
        try:
            data = json.loads(s)
            if isinstance(data, list):
                return [x for x in data if isinstance(x, str) and x]
        except json.JSONDecodeError:
            pass
    return [s]


def search_config_dict_from_row(cfg: Any) -> dict[str, Any]:
    """Сериализация SearchConfig в JSON для API (списки вместо JSON-строк в БД)."""
    return {
        "search_text": cfg.search_text,
        "search_fields": decode_str_list(getattr(cfg, "search_fields", None)),
        "area": cfg.area,
        "experience": cfg.experience,
        "employment": decode_str_list(cfg.employment),
        "schedule": decode_str_list(cfg.schedule),
        "work_format": decode_str_list(getattr(cfg, "work_format", None)),
        "period": cfg.period,
        "salary": cfg.salary,
        "salary_currency_code": (getattr(cfg, "salary_currency_code", None) or "RUR"),
        "only_with_salary": bool(getattr(cfg, "only_with_salary", False)),
        "order_by": getattr(cfg, "order_by", None),
        "search_url": getattr(cfg, "search_url", None),
        "hh_origin": getattr(cfg, "hh_origin", None),
        "delay_min": cfg.delay_min,
        "delay_max": cfg.delay_max,
        "daily_limit": cfg.daily_limit,
        "hourly_limit": int(getattr(cfg, "hourly_limit", 35) or 35),
    }
