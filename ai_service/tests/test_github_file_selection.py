from project_evaluation.utils.github_client import _select_relevant_files


def test_selects_files_that_match_distinct_rubric_requirements():
    files = [
        "notes/random.txt",
        "src/train_model.py",
        "src/api.py",
        "src/models.py",
        "tests/test_app.py",
        "README.md",
        "src/unrelated.py",
    ]
    rubric = {
        "criteria": [
            {"requirements": ["Train a machine learning model"]},
            {"requirements": ["Provide an API for predictions"]},
            {"requirements": ["Store data using a database"]},
            {"requirements": ["Write tests for the application"]},
            {"requirements": ["Provide project documentation"]},
        ]
    }

    selected = _select_relevant_files(files, rubric, max_files=5)

    assert set(selected) == {
        "src/train_model.py",
        "src/api.py",
        "src/models.py",
        "tests/test_app.py",
        "README.md",
    }


def test_without_rubric_preserves_original_file_order():
    files = ["first.py", "second.py", "third.py"]

    assert _select_relevant_files(files, None, max_files=2) == [
        "first.py",
        "second.py",
    ]