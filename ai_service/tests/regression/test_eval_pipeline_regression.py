"""
Regression test suite for Assignment Evaluation Pipeline.
Verifies:
1. Contract consistency across LLM, backend, and frontend
2. Safe normalization of strengths, mistakes, and missingConcepts
3. Dynamic rubric parsing and criterion matching
4. Score clamping and calculation
5. Representative submissions: Strong, Partial, Missing requirements, Incomplete, Execution errors
"""

import pytest
from unittest.mock import patch, MagicMock
from assignment_evaluation.pipelines.orchestrator import (
    _validate_llm_payload,
    _normalize_string_list,
    _match_criterion,
    parse_rubric,
    evaluate_single_submission_with_llm,
)


class TestPayloadNormalizationAndContracts:
    """Verify JSON contract consistency and safe normalization."""

    def test_strengths_and_mistakes_string_normalized_to_array(self):
        criteria = [
            {'name': 'Part A — Data Preparation', 'maxScore': 2.0, 'description': ''},
            {'name': 'Part B — Baseline Model Development', 'maxScore': 3.0, 'description': ''},
        ]
        raw_payload = {
            'overallScore': 4.5,
            'confidence': 0.85,
            'criteria': [
                {'name': 'Part A — Data Preparation', 'score': 2.0, 'feedback': 'Good preprocessing', 'evidence': 'tokenization done'},
                {'name': 'Part B — Baseline Model Development', 'score': 2.5, 'feedback': 'RNN trained', 'evidence': 'model.fit()'},
            ],
            'strengths': '1. Clean preprocessing pipeline\n2. Trained baseline RNN model',
            'mistakes': 'Omitted LSTM baseline comparison; validation loss not plotted',
            'missingConcepts': 'LSTM baseline architecture',
            'feedback': 'Solid submission with good initial baseline results.',
        }
        validated = _validate_llm_payload(raw_payload, criteria)
        assert isinstance(validated['strengths'], list)
        assert len(validated['strengths']) == 2
        assert 'Clean preprocessing pipeline' in validated['strengths'][0]
        assert isinstance(validated['mistakes'], list)
        assert len(validated['mistakes']) == 2
        assert isinstance(validated['missingConcepts'], list)
        assert len(validated['missingConcepts']) == 1

    def test_criteria_as_dict_normalized_to_list(self):
        criteria = [
            {'name': 'Part A', 'maxScore': 5.0, 'description': ''},
            {'name': 'Part B', 'maxScore': 5.0, 'description': ''},
        ]
        raw_payload = {
            'overallScore': 8.0,
            'confidence': 0.9,
            'criteria': {
                'Part A': {'score': 4.0, 'feedback': 'Well implemented', 'evidence': 'data loaded'},
                'Part B': {'score': 4.0, 'feedback': 'Good model', 'evidence': 'model built'},
            },
            'strengths': ['Clear code'],
            'mistakes': [],
            'missingConcepts': [],
            'feedback': 'Good work.',
        }
        validated = _validate_llm_payload(raw_payload, criteria)
        assert isinstance(validated['criteria'], list)
        assert len(validated['criteria']) == 2
        assert validated['criteria'][0]['score'] == 4.0
        assert validated['criteria'][1]['score'] == 4.0

    def test_score_clamping_and_validation(self):
        criteria = [{'name': 'Data Prep', 'maxScore': 2.0, 'description': ''}]
        # Score exceeding maxScore should raise ValueError
        raw_payload = {
            'criteria': [{'name': 'Data Prep', 'score': 5.0, 'feedback': 'Exceeded'}],
            'confidence': 0.8,
            'feedback': 'Done',
            'strengths': [],
            'mistakes': [],
            'missingConcepts': [],
        }
        with pytest.raises(ValueError, match='between 0 and 2'):
            _validate_llm_payload(raw_payload, criteria)

    def test_canonical_criterion_matching(self):
        criteria = [
            {'name': 'Part A — Data Preparation', 'maxScore': 2.0, 'description': ''},
        ]
        # LLM returns hyphen instead of em-dash and no prefix
        raw_payload = {
            'overallScore': 2.0,
            'confidence': 0.9,
            'criteria': [
                {'name': 'Part A - Data Preparation', 'score': 2.0, 'feedback': 'Complete', 'evidence': 'loaded'},
            ],
            'strengths': ['Done'],
            'mistakes': [],
            'missingConcepts': [],
            'feedback': 'Good.',
        }
        validated = _validate_llm_payload(raw_payload, criteria)
        assert validated['criteria'][0]['name'] == 'Part A — Data Preparation'
        assert validated['criteria'][0]['score'] == 2.0


class TestRepresentativeSubmissionEvaluations:
    """Evaluate representative student submissions with mocked and verified LLM responses."""

    @patch('assignment_evaluation.pipelines.orchestrator._invoke_groq')
    def test_strong_submission_gets_high_score_and_detailed_strengths(self, mock_invoke):
        import asyncio
        mock_invoke.return_value = '''{
            "overallScore": 19.5,
            "confidence": 0.95,
            "criteria": [
                {"name": "Part A — Data Preparation", "score": 2.0, "maxScore": 2.0, "feedback": "Dataset loaded, padded, and split properly.", "evidence": "x_train, y_train = imdb.load_data()"},
                {"name": "Part B — Baseline Model Development", "score": 3.0, "maxScore": 3.0, "feedback": "Both Simple RNN and LSTM baselines trained.", "evidence": "baseline_rnn.fit(); baseline_lstm.fit()"},
                {"name": "Part C — Hyperparameter Tuning", "score": 8.0, "maxScore": 8.0, "feedback": "Exhaustive grid search across hidden units, batch size, lr, and epochs.", "evidence": "for hu in hidden_units: for bs in batch_sizes:"},
                {"name": "Part D — Experimental Results", "score": 3.0, "maxScore": 3.0, "feedback": "Comprehensive results table generated.", "evidence": "results_df = pd.DataFrame(results)"},
                {"name": "Part E — Visualization and Analysis", "score": 1.75, "maxScore": 2.0, "feedback": "Heatmaps and loss curves generated.", "evidence": "sns.heatmap(pivot)"},
                {"name": "Part F — Discussion and Conclusion", "score": 1.75, "maxScore": 2.0, "feedback": "Detailed discussion on RNN vs LSTM convergence.", "evidence": "LSTM provides stable long-range memory"}
            ],
            "strengths": ["Exhaustive hyperparameter grid search", "Insightful heatmaps and visualization", "Rigorous comparative discussion"],
            "mistakes": ["Minor formatting discrepancy in test split"],
            "missingConcepts": [],
            "feedback": "Outstanding submission demonstrating deep understanding of sequence classification.",
            "scoreExplanation": "Earned near-perfect marks with rigorous experimental methodology."
        }'''
        rubric_pkg = {
            'criteria': [
                {'name': 'Part A — Data Preparation', 'maxScore': 2.0},
                {'name': 'Part B — Baseline Model Development', 'maxScore': 3.0},
                {'name': 'Part C — Hyperparameter Tuning', 'maxScore': 8.0},
                {'name': 'Part D — Experimental Results', 'maxScore': 3.0},
                {'name': 'Part E — Visualization and Analysis', 'maxScore': 2.0},
                {'name': 'Part F — Discussion and Conclusion', 'maxScore': 2.0},
            ],
            'totalMaxScore': 20.0,
            'rubricText': 'Full deep learning rubric',
        }
        res = asyncio.run(evaluate_single_submission_with_llm(
            student_text='import tensorflow as tf\n# Complete code with baseline, grid search, heatmaps',
            rubric_package=rubric_pkg,
            assignment_type='code',
            student_name='Strong Student',
            file_name='strong_submission.ipynb',
        ))
        assert res['success'] is True
        assert res['overallScore'] == 19.5
        assert res['maxScore'] == 20.0
        assert res['gradeLabel'] == 'A'
        assert len(res['strengths']) == 3
        assert len(res['criteria']) == 6
        assert 'scoreBreakdown' in res

    @patch('assignment_evaluation.pipelines.orchestrator._invoke_groq')
    def test_partially_correct_submission_gets_partial_credit(self, mock_invoke):
        import asyncio
        mock_invoke.return_value = '''{
            "overallScore": 10.0,
            "confidence": 0.8,
            "criteria": [
                {"name": "Part A — Data Preparation", "score": 2.0, "maxScore": 2.0, "feedback": "Preprocessing implemented.", "evidence": "pad_sequences(x_train)"},
                {"name": "Part B — Baseline Model Development", "score": 3.0, "maxScore": 3.0, "feedback": "Baselines built.", "evidence": "rnn.fit()"},
                {"name": "Part C — Hyperparameter Tuning", "score": 5.0, "maxScore": 8.0, "feedback": "Only varied hidden units and batch size; learning rates not tuned.", "evidence": "for hu in hidden_units:"},
                {"name": "Part D — Experimental Results", "score": 0.0, "maxScore": 3.0, "feedback": "No experimental results table provided.", "evidence": "No evidence found"},
                {"name": "Part E — Visualization and Analysis", "score": 0.0, "maxScore": 2.0, "feedback": "No plots or charts found.", "evidence": "No evidence found"},
                {"name": "Part F — Discussion and Conclusion", "score": 0.0, "maxScore": 2.0, "feedback": "No conclusion written.", "evidence": "No evidence found"}
            ],
            "strengths": ["Solid baseline setup", "Clear code structure"],
            "mistakes": ["Did not explore learning rate or epochs", "Omitted results table and all visualizations"],
            "missingConcepts": ["Experimental results table", "Training/validation visualization", "Hyperparameter analysis report"],
            "feedback": "Good initial model training, but results reporting, visualizations, and discussion are missing.",
            "scoreExplanation": "Partial credit awarded for implemented models; missing documentation and analysis scored 0."
        }'''
        rubric_pkg = {
            'criteria': [
                {'name': 'Part A — Data Preparation', 'maxScore': 2.0},
                {'name': 'Part B — Baseline Model Development', 'maxScore': 3.0},
                {'name': 'Part C — Hyperparameter Tuning', 'maxScore': 8.0},
                {'name': 'Part D — Experimental Results', 'maxScore': 3.0},
                {'name': 'Part E — Visualization and Analysis', 'maxScore': 2.0},
                {'name': 'Part F — Discussion and Conclusion', 'maxScore': 2.0},
            ],
            'totalMaxScore': 20.0,
            'rubricText': 'Full deep learning rubric',
        }
        res = asyncio.run(evaluate_single_submission_with_llm(
            student_text='import tensorflow as tf\n# Partial code with baselines and partial tuning',
            rubric_package=rubric_pkg,
            assignment_type='code',
            student_name='Partial Student',
            file_name='partial_submission.ipynb',
        ))
        assert res['success'] is True
        assert res['overallScore'] == 10.0
        assert res['maxScore'] == 20.0
        assert res['scoreBreakdown']['Part D — Experimental Results']['score'] == 0.0
        assert len(res['mistakes']) == 2
        assert len(res['missingConcepts']) == 3
