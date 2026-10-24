import asyncio
import json
import math
import os
import re
import shutil
import zipfile
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
from summary_evaluation.services.groq_circuit import (
    GroqCircuitBreaker,
    is_request_too_large_error,
)

GROQ_EVAL_CONCURRENCY = 3
DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b'
RETIRED_GROQ_MODELS = {'llama-3.1-8b-instant'}
PROMPT_CHAR_BUDGET = 15000
COMPACT_PROMPT_CHAR_BUDGET = 10000
MINIMAL_PROMPT_CHAR_BUDGET = 7000
MAX_COMPLETION_TOKENS = 800


def _truncate_for_prompt(value: str, max_chars: int) -> str:
    """Keep both the beginning and end of long source files and documents."""
    text = str(value or '')
    if len(text) <= max_chars:
        return text
    head_chars = max_chars // 2
    tail_chars = max_chars - head_chars
    omitted = len(text) - max_chars
    return (
        f'{text[:head_chars]}\n\n'
        f'[... {omitted} characters omitted to fit the model context ...]\n\n'
        f'{text[-tail_chars:]}'
    )


def _prompt_values(
    rubric_package: dict,
    criteria: list,
    student_name: str,
    file_name: str,
    text: str,
    budget: int = PROMPT_CHAR_BUDGET,
) -> dict:
    """Build a bounded prompt so one submission cannot exhaust Groq TPM."""
    limits = {
        'assignmentQuestion': min(1800, budget // 8),
        'rubric': min(4500, budget // 3),
        'criteria': min(2200, budget // 6),
        'modelAnswer': min(3500, budget // 4),
        'studentAnswer': budget,
    }
    values = {
        'assignmentQuestion': rubric_package.get('assignmentQuestion', 'Not provided'),
        'rubric': rubric_package.get('rubricText', 'Not provided'),
        'criteria': json.dumps(criteria, ensure_ascii=False),
        'modelAnswer': rubric_package.get('modelAnswer', 'Not provided'),
        'studentName': student_name,
        'fileName': file_name,
        'studentAnswer': text,
    }
    for key, limit in limits.items():
        values[key] = _truncate_for_prompt(values[key], limit)

    fixed_chars = sum(len(values[key]) for key in limits if key != 'studentAnswer')
    student_limit = max(500, budget - fixed_chars - 128)
    values['studentAnswer'] = _truncate_for_prompt(values['studentAnswer'], student_limit)
    return values


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


def _response_content(raw):
    """Return text from LangChain string or content-block responses."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, list):
        parts = []
        for block in raw:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and isinstance(block.get('text'), str):
                parts.append(block['text'])
        return ''.join(parts)
    return str(raw or '')


def _parse_json_object(raw):
    if isinstance(raw, dict):
        return raw
    text = _response_content(raw).strip()
    if not text:
        raise ValueError('LLM response was empty')
    text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\s*```$', '', text).strip()
    decoder = json.JSONDecoder()
    try:
        return json.loads(text)
    except json.JSONDecodeError as first_error:
        # Permit harmless prose around one JSON object, but never accept a
        # partially decoded or non-object response.
        for start, character in enumerate(text):
            if character != '{':
                continue
            try:
                value, end = decoder.raw_decode(text[start:])
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                return value
        if '{' not in text:
            raise ValueError('LLM response did not contain a JSON object') from first_error
        raise ValueError('LLM response contained malformed JSON') from first_error


def _validate_llm_payload(payload, criteria):
    if not isinstance(payload, dict):
        raise ValueError('LLM response must be a JSON object')
    returned = payload.get('criteria')
    if not isinstance(returned, list):
        raise ValueError('LLM response is missing the criteria array')
    by_name = {}
    for item in returned:
        if not isinstance(item, dict) or not str(item.get('name', '')).strip():
            raise ValueError('Each criterion must have a name')
        key = str(item['name']).strip().casefold()
        if key in by_name:
            raise ValueError(f'Duplicate criterion: {item["name"]}')
        by_name[key] = item

    expected = {str(item['name']).strip().casefold() for item in criteria}
    missing = expected - by_name.keys()
    if missing:
        raise ValueError(f'Missing rubric criteria: {", ".join(sorted(missing))}')
    for criterion in criteria:
        item = by_name[str(criterion['name']).strip().casefold()]
        try:
            score = float(item.get('score'))
            maximum = float(criterion['maxScore'])
        except (TypeError, ValueError) as exc:
            raise ValueError(f'Invalid score for criterion {criterion["name"]}') from exc
        if not math.isfinite(score) or score < 0 or score > maximum:
            raise ValueError(f'Score for criterion {criterion["name"]} must be between 0 and {maximum}')
        if not isinstance(item.get('feedback'), str) or not item['feedback'].strip():
            raise ValueError(f'Criterion {criterion["name"]} requires feedback')
    confidence = payload.get('confidence')
    try:
        confidence = float(confidence)
    except (TypeError, ValueError) as exc:
        raise ValueError('confidence must be a number between 0 and 1') from exc
    if not math.isfinite(confidence) or not 0 <= confidence <= 1:
        raise ValueError('confidence must be a number between 0 and 1')
    for field in ('strengths', 'weakAreas', 'mistakes', 'missingConcepts', 'missingKeyPoints',
                  'requiredConcepts', 'conceptsCovered'):
        if not isinstance(payload.get(field), list):
            raise ValueError(f'{field} must be an array')
    if not isinstance(payload.get('feedback'), str) or not payload['feedback'].strip():
        raise ValueError('feedback is required')
    return payload


def parse_rubric(rubric_text: str):
    """Extract point-based criteria without imposing universal criterion names."""
    text = (rubric_text or '').strip()
    criteria = []
    pattern = re.compile(
        r'^(?:\d+[.)]\s*|[-*]\s*)?(.+?)\s*(?:[-:]\s*|(?:\u2014|\u2013)\s*)'
        r'(\d+(?:\.\d+)?)\s*(?:points?|marks?)\b',
        re.IGNORECASE,
    )
    for line in (line.strip() for line in text.splitlines() if line.strip()):
        match = pattern.search(line)
        if not match:
            continue
        name = re.sub(r'^(?:criteria|criterion)\s*:?\s*', '', match.group(1), flags=re.IGNORECASE).strip()
        description = line[match.end():].strip(' -:\u2013\u2014')
        if name and not name.lower().startswith(('total score', 'total marks')):
            criteria.append({'name': name, 'maxScore': float(match.group(2)), 'description': description})

    if not criteria:
        part_pattern = re.compile(
            r'\bPart\s+([A-Z])\s*[\s:.)\-–—]*'
            r'([A-Za-z][^:\n()]{2,100}?)\s*'
            r'(?:\(\s*|\s*[-:]\s*|\s+)'
            r'(\d+(?:\.\d+)?)\s*(?:points?|marks?)\b',
            re.IGNORECASE,
        )
        for match in part_pattern.finditer(text):
            name = f'Part {match.group(1).upper()} — {match.group(2).strip(" -–—:")}'
            criteria.append({
                'name': name,
                'maxScore': float(match.group(3)),
                'description': '',
            })

    if not criteria:
        total_match = re.search(r'(?:total\s*(?:score|marks?)|out\s*of)\s*[:=-]?\s*(\d+(?:\.\d+)?)', text, re.IGNORECASE)
        total = float(total_match.group(1)) if total_match else 100.0
        criteria = [{'name': 'Rubric Evaluation', 'maxScore': total, 'description': text[:4000]}]
    return criteria


SUPPORTED_SUBMISSION_EXTENSIONS = {
    '.ipynb', '.pdf', '.docx', '.pptx', '.txt', '.md', '.py', '.js', '.ts',
    '.tsx', '.jsx', '.java', '.c', '.cpp', '.cs', '.sql', '.json', '.csv',
    '.html', '.css', '.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.webp',
}

MAX_ARCHIVE_FILES = 1000
MAX_ARCHIVE_MEMBER_SIZE = 25 * 1024 * 1024
MAX_ARCHIVE_TOTAL_SIZE = 500 * 1024 * 1024
IGNORED_ARCHIVE_BASENAMES = {
    'readme', 'readme.txt', 'readme.md', 'metadata', 'metadata.json',
    '.ds_store', 'thumbs.db',
}


def _safe_extract_zip(zip_path: str, destination: str):
    destination_path = os.path.abspath(destination)
    with zipfile.ZipFile(zip_path, 'r') as archive:
        members = []
        seen_paths = set()
        total_size = 0
        for member in archive.infolist():
            member_name = member.filename.replace('\\', '/')
            normalized_name = os.path.normpath(member_name)
            if (
                not member_name
                or member_name.startswith(('/', '\\'))
                or re.match(r'^[A-Za-z]:', member_name)
                or normalized_name in ('.', '..')
                or normalized_name.startswith(f'..{os.sep}')
            ):
                raise ValueError(f'Unsafe archive path: {member.filename}')
            if member.is_dir():
                continue
            if normalized_name in seen_paths:
                raise ValueError(f'Duplicate archive path: {member.filename}')
            seen_paths.add(normalized_name)
            if member.file_size > MAX_ARCHIVE_MEMBER_SIZE:
                raise ValueError(f'Archive member exceeds size limit: {member.filename}')
            total_size += member.file_size
            if total_size > MAX_ARCHIVE_TOTAL_SIZE:
                raise ValueError('Archive exceeds the total extraction size limit')
            if len(members) >= MAX_ARCHIVE_FILES:
                raise ValueError('Archive contains too many files')

            member_path = os.path.abspath(os.path.join(destination_path, normalized_name))
            if os.path.commonpath((destination_path, member_path)) != destination_path:
                raise ValueError(f'Unsafe archive path: {member.filename}')
            if os.path.basename(normalized_name).casefold() in IGNORED_ARCHIVE_BASENAMES:
                continue
            if os.path.splitext(normalized_name)[1].lower() in SUPPORTED_SUBMISSION_EXTENSIONS:
                members.append(normalized_name)
                os.makedirs(os.path.dirname(member_path), exist_ok=True)
                with archive.open(member) as source, open(member_path, 'wb') as target:
                    shutil.copyfileobj(source, target)
        return members


def _submission_groups(root: str, extracted_files):
    # Every supported archive member is an independent submission. The
    # directory containing a file is transport structure, not student identity.
    groups = {}
    for relative_path in extracted_files:
        normalized_path = relative_path.replace('\\', '/')
        groups[normalized_path] = [os.path.join(root, normalized_path)]
    return groups


def _student_label(relative_path: str) -> str:
    return os.path.splitext(os.path.basename(relative_path))[0] or relative_path


def _llm_enabled():
    key = os.environ.get('GROQ_API_KEY', '').strip()
    return bool(key) and key != 'gsk-placeholder'


def _is_transient_llm_error(exc):
    message = str(exc).lower()
    return any(token in message for token in (
        '429', 'rate limit', 'timeout', 'timed out', 'temporarily unavailable',
        'service unavailable', 'connection reset', 'connection error', '502', '503', '504',
    ))


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

    llm = ChatGroq(
        model_name=_groq_model(),
        temperature=0.0,
        max_tokens=max(MAX_COMPLETION_TOKENS, 1600),
        model_kwargs={'response_format': {'type': 'json_object'}},
    )
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
    prompt_values = _prompt_values(rubric_package, criteria, student_name, file_name, text)
    response = None
    payload = None
    last_error = None
    for attempt in range(3):
        try:
            values = prompt_values if attempt == 0 else _prompt_values(
                rubric_package, criteria, student_name, file_name, text,
                budget=COMPACT_PROMPT_CHAR_BUDGET if attempt == 1 else MINIMAL_PROMPT_CHAR_BUDGET,
            )
            if attempt:
                values['studentAnswer'] += (
                    '\n\nCORRECTION: Your previous response was rejected because it was '
                    f'{last_error}. Return one complete JSON object matching the requested schema.'
                )
            response = await asyncio.to_thread(llm.invoke, prompt.format_messages(**values))
            payload = _validate_llm_payload(
                _parse_json_object(getattr(response, 'content', response)), criteria
            )
            break
        except Exception as exc:
            last_error = exc
            retryable = (
                is_request_too_large_error(exc)
                or isinstance(exc, ValueError)
                or _is_transient_llm_error(exc)
            )
            if attempt == 2 or not retryable:
                raise
            await asyncio.sleep(2 ** attempt)
    if payload is None:
        raise ValueError(f'LLM evaluation failed validation: {last_error}')
    returned = {str(item.get('name', '')).strip().lower(): item for item in payload.get('criteria', []) if isinstance(item, dict)}
    breakdown = {}
    score_total = 0.0
    max_total = 0.0
    for criterion in criteria:
        name = criterion['name']
        max_score = float(criterion['maxScore'])
        item = returned.get(name.lower(), {})
        score = float(item['score'])
        breakdown[name] = {'score': round(score, 2), 'maxScore': round(max_score, 2), 'reason': str(item.get('feedback', '')).strip()}
        score_total += score
        max_total += max_score

    overall_score = round(score_total, 2)
    return {
        'score': overall_score,
        'overallScore': overall_score,
        'maxScore': round(max_total, 2),
        'gradeLabel': (
            'A' if (overall_score / max_total * 100 if max_total else 0) >= 85
            else 'B' if (overall_score / max_total * 100 if max_total else 0) >= 70
            else 'C' if (overall_score / max_total * 100 if max_total else 0) >= 55
            else 'D' if (overall_score / max_total * 100 if max_total else 0) >= 40
            else 'F'
        ),
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

        extracted_files = _safe_extract_zip(zip_path, temp_dir)
        student_groups = _submission_groups(temp_dir, extracted_files)
        total_students = len(student_groups)
        print(json.dumps({
            'stage': 'archive_discovery',
            'supportedFileCount': len(extracted_files),
            'studentCount': total_students,
            'studentFiles': {
                student: [os.path.relpath(path, temp_dir) for path in paths]
                for student, paths in student_groups.items()
            },
        }, ensure_ascii=False))

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
        if not rubric_text.strip():
            raise ValueError('Rubric file is missing or contains no extractable text')
        if not extracted_files:
            with zipfile.ZipFile(zip_path, 'r') as archive:
                archive_entries = [
                    name for name in archive.namelist()
                    if not name.endswith('/')
                ]
            preview = ', '.join(archive_entries[:10]) or '(archive is empty)'
            raise ValueError(
                'Submission archive contains no supported student files. '
                f'Found entries: {preview}'
            )

        parsed_criteria = parse_rubric(rubric_text)
        rubric_package = {
            'criteria': parsed_criteria,
            'totalMaxScore': sum(item['maxScore'] for item in parsed_criteria),
            'rubricText': rubric_text,
            'assignmentQuestion': assignment_question,
            'modelAnswer': model_answer,
        }

        results = []
        for index, (submission_path, file_paths) in enumerate(student_groups.items(), start=1):
            file_name = submission_path
            student_name = _student_label(file_name)
            try:
                source_path = file_paths[0]
                extracted = extract_text_from_submission(source_path, file_name)
                student_text = (extracted.get('text') or '').strip()
                detected_type = extracted.get('detectedType', 'text')
                if not student_text:
                    raise ValueError(f'No extractable content in submission: {file_name}')
                result = await evaluate_single_submission_with_llm(student_text, rubric_package, assignment_type, student_name, file_name)
                result['studentName'] = student_name
                result['fileName'] = file_name
                result['rollNumber'] = 'UNKNOWN'
                result['rollNo'] = 'UNKNOWN'
                result['submissionContent'] = student_text[:10000]
                result['submissionType'] = assignment_type or detected_type
                result['maxScore'] = result.get('maxScore', 100)
                result['scoreBreakdown'] = _normalize_score_breakdown(result.get('scoreBreakdown', {}))
                results.append(result)
            except Exception as exc:
                results.append({
                    'studentName': student_name,
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

        completed_count = sum(1 for result in results if result.get('success') is not False)
        failed_count = len(results) - completed_count
        final_status = 'COMPLETED' if failed_count == 0 else 'PARTIAL'
        await _broadcast(webhook_url, {
            'sessionId': session_id,
            'status': final_status,
            'processedStudents': len(results),
            'totalStudents': total_students,
            'progressPercent': 100,
            'results': results,
            'rubricCriteria': parsed_criteria,
            'errorInfo': (
                {'message': f'{failed_count} of {len(results)} submissions failed', 'stage': 'STUDENT_EVALUATION'}
                if failed_count else None
            ),
        })
        return {'status': final_status, 'results': results}
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
