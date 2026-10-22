import importlib
import json

import pytest


def test_assignment_eval_modules_import():
    modules = [
        'assignment_evaluation.routes.assign_eval_routes',
        'assignment_evaluation.pipelines.orchestrator',
        'assignment_evaluation.utils.file_extractor',
    ]

    for module_name in modules:
        module = importlib.import_module(module_name)
        assert module is not None


def test_assignment_response_parser_accepts_fence_and_surrounding_text():
    orchestrator = importlib.import_module('assignment_evaluation.pipelines.orchestrator')
    payload = {'criteria': [], 'feedback': 'ok'}

    assert orchestrator._parse_json_object(
        f'Here is the result:\n```json\n{json.dumps(payload)}\n```\n'
    ) == payload


def test_assignment_response_parser_accepts_content_blocks():
    orchestrator = importlib.import_module('assignment_evaluation.pipelines.orchestrator')
    assert orchestrator._parse_json_object([
        {'type': 'text', 'text': '{"criteria": [], "feedback": "ok"}'}
    ]) == {'criteria': [], 'feedback': 'ok'}


@pytest.mark.parametrize('response, message', [
    ('', 'empty'),
    ('not json', 'did not contain'),
    ('{"criteria": ', 'malformed'),
])
def test_assignment_response_parser_rejects_invalid_responses(response, message):
    orchestrator = importlib.import_module('assignment_evaluation.pipelines.orchestrator')
    with pytest.raises(ValueError, match=message):
        orchestrator._parse_json_object(response)


def test_assignment_payload_validation_rejects_invalid_score_and_missing_fields():
    orchestrator = importlib.import_module('assignment_evaluation.pipelines.orchestrator')
    criteria = [{'name': 'Correctness', 'maxScore': 5, 'description': 'Accuracy'}]
    valid = {
        'criteria': [{'name': 'Correctness', 'score': 4, 'feedback': 'Mostly correct.'}],
        'confidence': 0.8,
        'feedback': 'Good answer.',
        'strengths': [],
        'weakAreas': [],
        'mistakes': [],
        'missingConcepts': [],
        'missingKeyPoints': [],
        'requiredConcepts': [],
        'conceptsCovered': [],
    }
    assert orchestrator._validate_llm_payload(valid, criteria) == valid

    invalid = {**valid, 'criteria': [{'name': 'Correctness', 'score': 6, 'feedback': 'Too high.'}]}
    with pytest.raises(ValueError, match='between 0 and 5'):
        orchestrator._validate_llm_payload(invalid, criteria)

    invalid = {**valid, 'criteria': []}
    with pytest.raises(ValueError, match='Missing rubric criteria'):
        orchestrator._validate_llm_payload(invalid, criteria)


def test_assignment_rubric_parser_preserves_part_marks():
    orchestrator = importlib.import_module('assignment_evaluation.pipelines.orchestrator')
    criteria = orchestrator.parse_rubric(
        'Part A — Data Preparation: 2 marks\n'
        'Part B — Baseline Model Development: 3 marks\n'
        'Part C — Hyperparameter Tuning: 8 marks\n'
        'Part D — Experimental Results: 3 marks\n'
        'Part E — Visualization and Analysis: 2 marks\n'
        'Part F — Discussion and Conclusion: 2 marks'
    )
    assert [criterion['maxScore'] for criterion in criteria] == [2, 3, 8, 3, 2, 2]
    assert sum(criterion['maxScore'] for criterion in criteria) == 20


def test_assignment_rubric_parser_accepts_inline_part_format():
    orchestrator = importlib.import_module('assignment_evaluation.pipelines.orchestrator')
    criteria = orchestrator.parse_rubric(
        'Part A: Data Preparation (2 marks) '
        'Part B: Baseline Model Development (3 marks) '
        'Part C: Hyperparameter Tuning (8 marks)'
    )
    assert [criterion['maxScore'] for criterion in criteria] == [2, 3, 8]


def test_submission_archive_accepts_notebooks_and_nested_student_files(tmp_path):
    import zipfile

    orchestrator = importlib.import_module('assignment_evaluation.pipelines.orchestrator')
    archive_path = tmp_path / 'submissions.zip'
    with zipfile.ZipFile(archive_path, 'w') as archive:
        archive.writestr('Student One/answer.ipynb', '{}')
        archive.writestr('Student One/notes.md', 'evidence')

    extracted = orchestrator._safe_extract_zip(str(archive_path), str(tmp_path / 'out'))
    groups = orchestrator._submission_groups(str(tmp_path / 'out'), extracted)
    assert len(extracted) == 2
    assert list(groups) == ['Student One']


def test_submission_groups_assignsubmission_files_as_individual_students(tmp_path):
    orchestrator = importlib.import_module('assignment_evaluation.pipelines.orchestrator')
    extracted = [
        'agentic_ai_test_2/ABHISHAKE_S_54046_assignsubmission_file.ipynb',
        'agentic_ai_test_2/Aditi_Sahay_54131_assignsubmission_file.ipynb',
    ]

    groups = orchestrator._submission_groups(str(tmp_path), extracted)

    assert list(groups) == ['ABHISHAKE_S_54046', 'Aditi_Sahay_54131']
    assert all(len(paths) == 1 for paths in groups.values())
