import sys
import asyncio
sys.path.insert(0, "/Users/monika/Downloads/cotinue project/project_eval_tool/ai_service")
from summary_evaluation.pipelines.orchestrator import run_evaluation_pipeline

async def test():
    await run_evaluation_pipeline(
        session_id="123",
        transcript_path="/tmp/t.txt",
        zip_path="/tmp/z.zip",
        webhook_url="http://localhost:5001/api/evaluations/webhook"
    )

asyncio.run(test())
