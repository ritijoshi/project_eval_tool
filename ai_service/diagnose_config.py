"""Safe AI-service configuration diagnostics.

This module reports configuration shape and placeholder status only. It never
prints credential values.
"""

import argparse
import json
import os
from pathlib import Path

try:
    from key_rotator import parse_key_list
except ImportError:
    import sys
    _ai_root = str(Path(__file__).resolve().parent)
    if _ai_root not in sys.path:
        sys.path.insert(0, _ai_root)
    from key_rotator import parse_key_list


def _configured(value: str | None, placeholder: str) -> bool:
    return bool(value and value.strip() and value.strip() != placeholder)


def build_diagnostics(environment=None):
    environment = environment or os.environ
    raw_groq = environment.get("GROQ_API_KEYS") or environment.get("GROQ_API_KEY") or ""
    groq_keys = parse_key_list(raw_groq)
    raw_openai = environment.get("OPENAI_API_KEYS") or environment.get("OPENAI_API_KEY") or ""
    openai_keys = parse_key_list(raw_openai)

    groq_key = environment.get("GROQ_API_KEY")
    openai_key = environment.get("OPENAI_API_KEY")
    model = (environment.get("GROQ_MODEL") or "openai/gpt-oss-20b").strip()
    return {
        "service": "ai-service",
        "groq": {
            "key_configured": len(groq_keys) > 0 if raw_groq else _configured(groq_key, "gsk-placeholder"),
            "key_count": len(groq_keys),
            "multi_key_enabled": len(groq_keys) > 1,
            "model": model,
            "structured_json_requested": True,
        },
        "openai": {
            "key_configured": len(openai_keys) > 0 if raw_openai else _configured(openai_key, "sk-placeholder"),
            "key_count": len(openai_keys),
            "multi_key_enabled": len(openai_keys) > 1,
        },
        "required_variables": {
            "GROQ_API_KEY": bool(groq_key or groq_keys),
            "GROQ_MODEL": bool(model),
        },
        "notes": [
            "This diagnostic does not make a provider request.",
            "A configured key does not prove that it is valid or that the model is available.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description="Check AI-service configuration safely")
    parser.add_argument("--env-file", type=Path, help="Optional dotenv file to load")
    args = parser.parse_args()
    if args.env_file:
        try:
            from dotenv import dotenv_values
            values = dotenv_values(args.env_file)
        except ImportError:
            values = {}
            for line in args.env_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    values[key.strip()] = value.strip().strip('"').strip("'")
        environment = dict(os.environ)
        environment.update({key: value for key, value in values.items() if value is not None})
    else:
        environment = os.environ
    print(json.dumps(build_diagnostics(environment), indent=2))


if __name__ == "__main__":
    main()
