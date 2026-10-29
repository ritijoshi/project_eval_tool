import sys
from pathlib import Path

# Ensure ai_service root is on the path so `validation.*` imports work
AI_SERVICE_ROOT = Path(__file__).resolve().parents[2]
if str(AI_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVICE_ROOT))
