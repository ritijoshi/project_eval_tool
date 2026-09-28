import asyncio
import json
import os
import re
from datetime import datetime

import httpx
from langchain_core.prompts import ChatPromptTemplate
from langchain_groq import ChatGroq

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '..', '.env'), override=False)
except ImportError:
    pass

from assignment_evaluation.utils.file_extractor import extract_text_from_submission
from summary_evaluation.services.groq_circuit import GroqCircuitBreaker

GROQ_EVAL_CONCURRENCY = 3
DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b'
RETIRED_GROQ_MODELS = {'llama-3.1-8b-instant'}


def _groq_model():
    configured_model = os.environ.get('GROQ_MODEL', '').strip()
    if not configured_model or configured_model in RETIRED_GROQ_MODELS:
        return DEFAULT_GROQ_MODEL
    return configured_model


async def _broadcast(webhook_url: str, payload: dict):
    if not webhook_url:
        return
    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            await client.post(webhook_url, json=payload)
        except Exception as exc:
            print(f"Assignment eval webhook failed: {exc}")


def _normalize_score_breakdown(raw: dict):
    if not isinstance(raw, dict):
        return {}
    normalized = {}
    for key, value in raw.items():
        if isinstance(value, dict):
            normalized[str(key)] = {
                'score': value.get('score', 0),
                'maxScore': value.get('maxScore', value.get('max_score', 0)),
                'reason': value.get('reason', ''),
            }
        else:
            normalized[str(key)] = {'score': value, 'maxScore': 0, 'reason': ''}
    return normalized


def _parse_json_object(raw):
    if isinstance(raw, dict):
        return raw
    text = str(raw or '').strip()
    text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text, flags=re.IGNORECASE | re.DOTALL)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', text, flags=re.DOTALL)
        if not match:
            raise ValueError('LLM response did not contain a JSON object')
        return json.loads(match.group(0))


def parse_rubric(rubric_text: str):
    """Extract point-based criteria without imposing universal criterion names."""
    text = (rubric_text or '').strip()
    criteria = []
    pattern = re.compile(
        r'^(?:\d+[.)]\s*|[-*]\s*)?(.+?)\s*[-:]\s*(\d+(?:\.\d+)?)\s*(?:points?|marks?)\b',
        re.IGNORECASE,
    )
    for line in (line.strip() for line in text.splitlines() if line.strip()):
        match = pattern.search(line)
        if not match:
            continue
        name = re.sub(r'^(?:criteria|criterion)\s*:?\s*', '', match.group(1), flags=re.IGNORECASE).strip()
        description = line[match.end():].strip(' -:')
        if name and not name.lower().startswith(('total score', 'total marks')):
            criteria.append({'name': name, 'maxScore': float(match.group(2)), 'description': description})

    if not criteria:
        total_match = re.search(r'(?:total\s*(?:score|marks?)|out\s*of)\s*[:=-]?\s*(\d+(?:\.\d+)?)', text, re.IGNORECASE)
        total = float(total_match.group(1)) if total_match else 100.0
        criteria = [{'name': 'Rubric Evaluation', 'maxScore': total, 'description': text[:4000]}]
    return criteria


def _llm_enabled():
    key = os.environ.get('GROQ_API_KEY', '').strip()
    return bool(key) and key != 'gsk-placeholder'


async def evaluate_single_submission_with_llm(
    student_text: str,
    rubric_package: dict,
    assignment_type: str,
    student_name: str,
    file_name: str,
):
    text = (student_text or '').strip()
    criteria = rubric_package.get('criteria') or parse_rubric(rubric_package.get('rubricText', ''))
    if not text:
        raise ValueError(f'No extractable student answer for {file_name}')
    if not _llm_enabled():
        raise RuntimeError('LLM evaluation is unavailable because GROQ_API_KEY is not configured')

    print(json.dumps({
        'stage': 'before_llm',
        'studentName': student_name,
        'fileName': file_name,
        'assignmentQuestion': rubric_package.get('assignmentQuestion', ''),
        'rubric': rubric_package.get('rubricText', ''),
        'modelAnswer': rubric_package.get('modelAnswer', ''),
        'studentAnswer': text,
    }, ensure_ascii=False))

    llm = ChatGroq(model_name=_groq_model(), temperature=0.0)
    prompt = ChatPromptTemplate.from_messages([
        ('system', '''You are an academic assignment evaluator. Evaluate exactly one student's submission using the assignment question, rubric, and reference answer.
Return ONLY valid JSON. Do not copy rubric text into concepts. Do not invent criteria. Include every rubric criterion exactly once, even when its score is zero.
Each criterion score must be between 0 and its maxScore. overallScore must equal the sum of criterion scores when the rubric is point-based, normalized to 0-100 when needed. Use evidence from the actual student submission. Never use a generic evaluation.'''),
        ('human', '''ASSIGNMENT QUESTION:
{assignmentQuestion}

RUBRIC:
{rubric}

STRUCTURED CRITERIA:
{criteria}

REFERENCE ANSWER:
{modelAnswer}

STUDENT:
{studentName}

SUBMISSION FILE:
{fileName}

STUDENT SUBMISSION:
{studentAnswer}

Return JSON with: overallScore, criteria (name, score, maxScore, feedback), requiredConcepts, strengths, weakAreas, mistakes, missingKeyPoints, missingConcepts, conceptsCovered, scoreExplanation, feedback, confidence.'''),
    ])
    response = await asyncio.to_thread(llm.invoke, prompt.format_messages(
        assignmentQuestion=rubric_package.get('assignmentQuestion', 'Not provided'),
        rubric=rubric_package.get('rubricText', 'Not provided'),
        criteria=json.dumps(criteria, ensure_ascii=False),
        modelAnswer=rubric_package.get('modelAnswer', 'Not provided'),
        studentName=student_name,
        fileName=file_name,
        studentAnswer=text,
    ))
    payload = _parse_json_object(getattr(response, 'content', response))
    returned = {str(item.get('name', '')).strip().lower(): item for item in payload.get('criteria', []) if isinstance(item, dict)}
    breakdown = {}
    score_total = 0.0
    max_total = 0.0
    for criterion in criteria:
        name = criterion['name']
        max_score = float(criterion['maxScore'])
        item = returned.get(name.lower(), {})
        score = max(0.0, min(max_score, float(item.get('score', 0) or 0)))
        breakdown[name] = {'score': round(score, 2), 'maxScore': round(max_score, 2), 'reason': str(item.get('feedback', '')).strip()}
        score_total += score
        max_total += max_score

    overall_score = round((score_total / max_total) * 100, 2) if max_total else 0
    return {
        'score': overall_score,
        'overallScore': overall_score,
        'maxScore': 100,
        'gradeLabel': 'A' if overall_score >= 85 else 'B' if overall_score >= 70 else 'C' if overall_score >= 55 else 'D' if overall_score >= 40 else 'F',
        'confidence': payload.get('confidence'),
        'scoreBreakdown': breakdown,
        'requiredConcepts': payload.get('requiredConcepts', []),
        'strengths': payload.get('strengths', []),
        'weakAreas': payload.get('weakAreas', []),
        'mistakes': payload.get('mistakes', []),
        'missingConcepts': payload.get('missingConcepts', []),
        'missingKeyPoints': payload.get('missingKeyPoints', []),
        'conceptsCovered': payload.get('conceptsCovered', []),
        'scoreExplanation': payload.get('scoreExplanation', ''),
        'overallFeedback': payload.get('feedback', ''),
        'submissionType': assignment_type or 'text',
        'success': True,
    }


async def run_assignment_eval_pipeline(session_id: str, rubric_path: str, zip_path: str, assignment_type: str, webhook_url: str, assignment_question: str = '', model_answer: str = ''):
    circuit_breaker = GroqCircuitBreaker(session_id=session_id)
    temp_dir = os.path.join(os.path.dirname(zip_path), f"assignment_session_{session_id}")
    os.makedirs(temp_dir, exist_ok=True)

    try:
        await _broadcast(webhook_url, {
            'sessionId': session_id,
            'status': 'EXTRACTING',
            'progressPercent': 5,
            'totalStudents': 0,
        })

        for root, _, files in os.walk(temp_dir):
            for file_to_delete in files:
                try:
                    os.remove(os.path.join(root, file_to_delete))
                except Exception:
                    pass

        import zipfile
        with zipfile.ZipFile(zip_path, 'r') as archive:
            archive.extractall(temp_dir)

        files = []
        for root, _, filenames in os.walk(temp_dir):
            for filename in filenames:
                if not filename.startswith('.'):
                    files.append(os.path.join(root, filename))

        total_students = len(files)

        await _broadcast(webhook_url, {
            'sessionId': session_id,
            'status': 'PARSING_RUBRIC',
            'progressPercent': 20,
            'totalStudents': total_students,
        })

        rubric_text = ''
        if os.path.exists(rubric_path):
            rubric_result = extract_text_from_submission(rubric_path, os.path.basename(rubric_path))
            rubric_text = rubric_result.get('text', '')

        parsed_criteria = parse_rubric(rubric_text)
        rubric_package = {
            'criteria': parsed_criteria,
            'totalMaxScore': sum(item['maxScore'] for item in parsed_criteria),
            'rubricText': rubric_text,
            'assignmentQuestion': assignment_question,
            'modelAnswer': model_answer,
        }

        results = []
        for index, file_path in enumerate(files, start=1):
            try:
                file_name = os.path.basename(file_path)
                student_name = os.path.splitext(file_name)[0]
                extracted = extract_text_from_submission(file_path, file_name)
                student_text = extracted.get('text', '')
                result = await evaluate_single_submission_with_llm(student_text, rubric_package, assignment_type, student_name, file_name)
                result['studentName'] = student_name
                result['fileName'] = file_name
                result['rollNumber'] = 'UNKNOWN'
                result['rollNo'] = 'UNKNOWN'
                result['submissionContent'] = student_text[:10000]
                result['submissionType'] = assignment_type or extracted.get('detectedType', 'text')
                result['maxScore'] = result.get('maxScore', 100)
                result['scoreBreakdown'] = _normalize_score_breakdown(result.get('scoreBreakdown', {}))
                results.append(result)
            except Exception as exc:
                file_name = os.path.basename(file_path)
                results.append({
                    'studentName': os.path.splitext(file_name)[0],
                    'fileName': file_name,
                    'rollNumber': 'UNKNOWN',
                    'rollNo': 'UNKNOWN',
                    'submissionType': assignment_type,
                    'success': False,
                    'evaluationStatus': 'FAILED',
                    'score': None,
                    'overallScore': None,
                    'errorMessage': str(exc),
                })

            await _broadcast(webhook_url, {
                'sessionId': session_id,
                'status': 'EVALUATING',
                'processedStudents': index,
                'totalStudents': total_students,
                'progressPercent': min(99, int((index / total_students) * 100)) if total_students else 0,
                'latestResult': results[-1],
            })

        await _broadcast(webhook_url, {
            'sessionId': session_id,
            'status': 'COMPLETED',
            'processedStudents': len(results),
            'totalStudents': total_students,
            'progressPercent': 100,
            'results': results,
        })
        return {'status': 'COMPLETED', 'results': results}
    except Exception as exc:
        await _broadcast(webhook_url, {
            'sessionId': session_id,
            'status': 'FAILED',
            'progressPercent': 100,
            'errorInfo': {'message': str(exc), 'stage': 'PIPELINE'},
        })
        raise
    finally:
        try:
            if os.path.exists(temp_dir):
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass
