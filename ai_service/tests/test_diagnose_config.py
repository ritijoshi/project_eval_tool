from diagnose_config import build_diagnostics


def test_diagnostics_never_exposes_key_values():
    result = build_diagnostics({
        'GROQ_API_KEY': 'secret-value',
        'GROQ_MODEL': 'openai/gpt-oss-20b',
        'OPENAI_API_KEY': 'sk-secret',
    })

    rendered = str(result)
    assert 'secret-value' not in rendered
    assert 'sk-secret' not in rendered
    assert result['groq']['key_configured'] is True
    assert result['groq']['structured_json_requested'] is True


def test_diagnostics_marks_placeholding_configuration():
    result = build_diagnostics({
        'GROQ_API_KEY': 'gsk-placeholder',
        'OPENAI_API_KEY': 'sk-placeholder',
    })

    assert result['groq']['key_configured'] is False
    assert result['openai']['key_configured'] is False
