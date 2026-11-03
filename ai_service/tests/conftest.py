import os
import sys
from pathlib import Path

os.environ.setdefault("GROQ_API_KEY", "gsk_test_mock_key_for_unit_tests")
os.environ.setdefault("OLLAMA_ENABLED", "false")

AI_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(AI_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVICE_ROOT))
