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
    assert len(groups) == 2
    assert all(len(paths) == 1 for paths in groups.values())


def test_submission_groups_assignsubmission_files_as_individual_students(tmp_path):
    orchestrator = importlib.import_module('assignment_evaluation.pipelines.orchestrator')
    extracted = [
        'agentic_ai_test_2/ABHISHAKE_S_54046_assignsubmission_file.ipynb',
        'agentic_ai_test_2/Aditi_Sahay_54131_assignsubmission_file.ipynb',
    ]

    groups = orchestrator._submission_groups(str(tmp_path), extracted)

    assert list(groups) == [
        'agentic_ai_test_2/ABHISHAKE_S_54046_assignsubmission_file.ipynb',
        'agentic_ai_test_2/Aditi_Sahay_54131_assignsubmission_file.ipynb',
    ]
    assert all(len(paths) == 1 for paths in groups.values())


def test_batch_pipeline_evaluates_each_notebook_independently_and_continues_after_failure(
    tmp_path, monkeypatch
):
    import asyncio
    import zipfile

    orchestrator = importlib.import_module('assignment_evaluation.pipelines.orchestrator')
    archive_path = tmp_path / 'submissions.zip'
    rubric_path = tmp_path / 'rubric.txt'
    rubric_path.write_text('Q1: Analysis - 5 marks', encoding='utf-8')

    with zipfile.ZipFile(archive_path, 'w') as archive:
        for index in range(20):
            notebook = {
                'cells': [{
                    'cell_type': 'code',
                    'source': [f'print("submission-{index}")'],
                    'outputs': [],
                }],
                'metadata': {},
                'nbformat': 4,
                'nbformat_minor': 5,
            }
            archive.writestr(
                f'Statistical Programming Lab Exercise/student_{index:02d}.ipynb',
                json.dumps(notebook),
            )
        archive.writestr(
            'Statistical Programming Lab Exercise/README.md',
            'not a submission',
        )

    evaluated = []

    async def fake_evaluator(student_text, rubric_package, assignment_type, student_name, file_name):
        evaluated.append((student_name, file_name, student_text))
        if file_name.endswith('student_03.ipynb'):
            raise ValueError('invalid notebook')
        return {
            'overallScore': 5,
            'maxScore': 5,
            'scoreBreakdown': {'Q1': {'score': 5, 'maxScore': 5, 'reason': 'ok'}},
            'confidence': 1,
            'success': True,
        }

    monkeypatch.setattr(orchestrator, 'evaluate_single_submission_with_llm', fake_evaluator)
    result = asyncio.run(orchestrator.run_assignment_eval_pipeline(
        session_id='test-session',
        rubric_path=str(rubric_path),
        zip_path=str(archive_path),
        assignment_type='code',
        webhook_url='',
    ))

    assert len(evaluated) == 20
    assert len({file_name for _, file_name, _ in evaluated}) == 20
    assert len(result['results']) == 20
    assert sum(item.get('success') is not False for item in result['results']) == 19
    assert sum(item.get('success') is False for item in result['results']) == 1
    assert all(text.count('submission-') == 1 for _, _, text in evaluated)


def test_submission_groups_keep_same_filename_in_different_directories_separate(tmp_path):
    import zipfile

    orchestrator = importlib.import_module('assignment_evaluation.pipelines.orchestrator')
    archive_path = tmp_path / 'submissions.zip'
    with zipfile.ZipFile(archive_path, 'w') as archive:
        archive.writestr('batch-a/answer.ipynb', '{}')
        archive.writestr('batch-b/answer.ipynb', '{}')

    extracted = orchestrator._safe_extract_zip(str(archive_path), str(tmp_path / 'out'))
    groups = orchestrator._submission_groups(str(tmp_path / 'out'), extracted)

    assert len(extracted) == 2
    assert len(groups) == 2
    assert set(groups) == {'batch-a/answer.ipynb', 'batch-b/answer.ipynb'}


def test_invalid_notebook_is_reported_as_an_individual_failure(tmp_path):
    orchestrator = importlib.import_module('assignment_evaluation.pipelines.orchestrator')
    invalid_path = tmp_path / 'broken.ipynb'
    invalid_path.write_text('{not valid json', encoding='utf-8')

    with pytest.raises(ValueError, match='Invalid Jupyter notebook'):
        orchestrator.extract_text_from_submission(str(invalid_path), invalid_path.name)
