import asyncio
import json
import os
import zipfile

import httpx
import pytest

from assignment_evaluation.pipelines import orchestrator


CRITERIA = [{'name': 'Accuracy', 'maxScore': 10.0, 'description': 'Correctness'}]
RUBRIC = {
    'criteria': CRITERIA,
    'rubricText': 'Accuracy - 10 points',
    'assignmentQuestion': 'Explain the answer',
    'modelAnswer': 'A correct answer',
}


def _valid_payload():
    return json.dumps({
        'criteria': [{'name': 'Accuracy', 'score': 8, 'feedback': 'Correct core idea.'}],
        'confidence': 0.8,
        'requiredConcepts': ['core idea'],
        'strengths': ['Correct core idea'],
        'weakAreas': [],
        'mistakes': [],
        'missingConcepts': [],
        'missingKeyPoints': [],
        'requiredConcepts': ['core idea'],
        'conceptsCovered': ['core idea'],
        'feedback': 'Good answer.',
    })


class QuotaError(Exception):
    status_code = 429

    def __str__(self):
        return '429 daily token quota exceeded'


def test_groq_daily_quota_switches_to_ollama(monkeypatch):
    monkeypatch.setenv('GROQ_API_KEY', 'configured')
    monkeypatch.setenv('OLLAMA_ENABLED', 'true')

    async def quota(_messages):
        raise QuotaError()

    async def local(_messages):
        return _valid_payload()

    monkeypatch.setattr(orchestrator, '_invoke_groq', quota)
    monkeypatch.setattr(orchestrator, '_invoke_ollama', local)

    result = asyncio.run(orchestrator.evaluate_single_submission_with_llm(
        'student answer', RUBRIC, 'text', 'student', 'answer.txt',
    ))

    assert result['success'] is True
    assert result['score'] == 8


def test_successful_local_fallback_without_groq(monkeypatch):
    monkeypatch.delenv('GROQ_API_KEY', raising=False)
    monkeypatch.setenv('OLLAMA_ENABLED', 'true')
    called = []

    async def local(_messages):
        called.append(True)
        return _valid_payload()

    monkeypatch.setattr(orchestrator, '_invoke_ollama', local)

    result = asyncio.run(orchestrator.evaluate_single_submission_with_llm(
        'student answer', RUBRIC, 'text', 'student', 'answer.txt',
    ))

    assert result['success'] is True
    assert called == [True]


def test_ollama_unavailable_is_reported(monkeypatch):
    monkeypatch.delenv('GROQ_API_KEY', raising=False)
    monkeypatch.setenv('OLLAMA_ENABLED', 'true')

    async def unavailable(_messages):
        raise httpx.ConnectError('Ollama is unavailable')

    monkeypatch.setattr(orchestrator, '_invoke_ollama', unavailable)

    with pytest.raises(httpx.ConnectError, match='unavailable'):
        asyncio.run(orchestrator.evaluate_single_submission_with_llm(
            'student answer', RUBRIC, 'text', 'student', 'answer.txt',
        ))


def test_malformed_local_response_fails_after_bounded_repair(monkeypatch):
    monkeypatch.delenv('GROQ_API_KEY', raising=False)
    monkeypatch.setenv('OLLAMA_ENABLED', 'true')
    calls = []

    async def malformed(_messages):
        calls.append(True)
        return '{"criteria":'

    monkeypatch.setattr(orchestrator, '_invoke_ollama', malformed)

    with pytest.raises(ValueError, match='malformed JSON'):
        asyncio.run(orchestrator.evaluate_single_submission_with_llm(
            'student answer', RUBRIC, 'text', 'student', 'answer.txt',
        ))
    assert len(calls) == 2


def test_batch_preserves_completed_and_failed_submissions(monkeypatch, tmp_path):
    monkeypatch.delenv('GROQ_API_KEY', raising=False)
    monkeypatch.setenv('OLLAMA_ENABLED', 'true')
    rubric_path = tmp_path / 'rubric.txt'
    zip_path = tmp_path / 'submissions.zip'
    rubric_path.write_text('Accuracy - 10 points', encoding='utf-8')
    with zipfile.ZipFile(zip_path, 'w') as archive:
        archive.writestr('good.txt', 'good student answer')
        archive.writestr('bad.txt', 'bad student answer')

    async def local(messages):
        content = ' '.join(str(message.content) for message in messages)
        return '{"criteria":' if 'bad.txt' in content else _valid_payload()

    events = []
    monkeypatch.setattr(orchestrator, '_invoke_ollama', local)

    async def broadcast(_url, payload):
        events.append(payload)

    monkeypatch.setattr(orchestrator, '_broadcast', broadcast)

    result = asyncio.run(orchestrator.run_assignment_eval_pipeline(
        'session-1', str(rubric_path), str(zip_path), 'text', '',
    ))

    assert result['status'] == 'PARTIAL'
    assert [item['success'] for item in result['results']] == [True, False]
    assert events[-1]['status'] == 'PARTIAL'
