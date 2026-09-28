import importlib


def test_assignment_eval_modules_import():
    modules = [
        'assignment_evaluation.routes.assign_eval_routes',
        'assignment_evaluation.pipelines.orchestrator',
        'assignment_evaluation.utils.file_extractor',
    ]

    for module_name in modules:
        module = importlib.import_module(module_name)
        assert module is not None
