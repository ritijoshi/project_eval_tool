import json
from types import SimpleNamespace

import pytest

from project_evaluation.agents import weekly_doc_parser


def test_parse_weekly_report_text_returns_claims_and_exact_raw_text(monkeypatch):
    raw_text = (
        "This week I completed the prediction API and trained the Random Forest model.\n"
        "I faced issues connecting PostgreSQL.\n"
        "Next week I will implement testing."
    )
    llm_result = {
        "workCompleted": ["Implemented prediction API", "Trained Random Forest model"],
        "problemsFaced": ["PostgreSQL connection issues"],
        "plannedWork": ["Implement testing"],
        "currentStatus": "API and model completed; database integration has issues",
    }

    class FakeChatGroq:
        def __init__(self, **kwargs):
            pass

        def invoke(self, prompt):
            return SimpleNamespace(content=json.dumps(llm_result))

    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setattr(weekly_doc_parser, "ChatGroq", FakeChatGroq)

    result = weekly_doc_parser.parse_weekly_report_text(raw_text)

    assert result == {**llm_result, "rawText": raw_text}


def test_extract_weekly_report_text_reads_utf8_text(tmp_path):
    report_path = tmp_path / "weekly.txt"
    report_path.write_text("Completed API work", encoding="utf-8")

    assert weekly_doc_parser.extract_weekly_report_text(report_path) == "Completed API work"


def test_extract_weekly_report_text_reads_pdf_pages(tmp_path, monkeypatch):
    report_path = tmp_path / "weekly.pdf"
    report_path.write_bytes(b"pdf fixture")

    class FakePage:
        def __init__(self, text):
            self.text = text

        def extract_text(self):
            return self.text

    monkeypatch.setattr(
        weekly_doc_parser,
        "PdfReader",
        lambda path: SimpleNamespace(pages=[FakePage("Week one"), FakePage("Week two")]),
    )

    assert weekly_doc_parser.extract_weekly_report_text(report_path) == "Week one\nWeek two"


def test_extract_weekly_report_text_reads_docx_paragraphs_and_tables(
    tmp_path,
    monkeypatch,
):
    report_path = tmp_path / "weekly.docx"
    report_path.write_bytes(b"docx fixture")
    document = SimpleNamespace(
        paragraphs=[SimpleNamespace(text="Completed API work")],
        tables=[
            SimpleNamespace(
                rows=[
                    SimpleNamespace(
                        cells=[SimpleNamespace(text="Issue"), SimpleNamespace(text="Database")]
                    )
                ]
            )
        ],
    )
    monkeypatch.setattr(weekly_doc_parser, "Document", lambda path: document)

    assert weekly_doc_parser.extract_weekly_report_text(report_path) == (
        "Completed API work\nIssue | Database"
    )


def test_extract_weekly_report_text_rejects_unsupported_file(tmp_path):
    report_path = tmp_path / "weekly.rtf"
    report_path.write_text("Report", encoding="utf-8")

    with pytest.raises(ValueError, match="PDF, DOCX, or TXT"):
        weekly_doc_parser.extract_weekly_report_text(report_path)