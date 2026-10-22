"""Safe AI-service configuration diagnostics.

This module reports configuration shape and placeholder status only. It never
prints credential values.
"""

import argparse
import json
import os
from pathlib import Path


def _configured(value: str | None, placeholder: str) -> bool:
    return bool(value and value.strip() and value.strip() != placeholder)


def build_diagnostics(environment=None):
    environment = environment or os.environ
    groq_key = environment.get("GROQ_API_KEY")
    openai_key = environment.get("OPENAI_API_KEY")
    model = (environment.get("GROQ_MODEL") or "openai/gpt-oss-20b").strip()
    return {
        "service": "ai-service",
        "groq": {
            "key_configured": _configured(groq_key, "gsk-placeholder"),
            "model": model,
            "structured_json_requested": True,
        },
        "openai": {
            "key_configured": _configured(openai_key, "sk-placeholder"),
        },
        "required_variables": {
            "GROQ_API_KEY": bool(groq_key),
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
