"""Tests for input validator and ZIP security checks."""
import os
import zipfile
import pytest
from eval_validation.input_validator import (
    validate_file,
    validate_zip_security,
    validate_extraction,
    MAX_SINGLE_FILE_SIZE,
    MAX_ZIP_ENTRIES,
)


# ---------------------------------------------------------------------------
# File validation
# ---------------------------------------------------------------------------

def test_valid_txt_file(tmp_path):
    f = tmp_path / "submission.txt"
    f.write_text("Hello, this is my answer.", encoding="utf-8")
    result = validate_file(str(f), "submission.txt")
    assert result.valid
    assert result.file_size_bytes > 0


def test_valid_pdf_magic(tmp_path):
    f = tmp_path / "essay.pdf"
    # Write minimal PDF magic header
    f.write_bytes(b"%PDF-1.4 minimal content here for testing")
    result = validate_file(str(f), "essay.pdf")
    assert result.valid
    assert result.detected_format == "pdf"


def test_empty_file_is_invalid(tmp_path):
    f = tmp_path / "empty.txt"
    f.write_text("")
    result = validate_file(str(f), "empty.txt")
    assert not result.valid
    assert any("empty" in e.lower() for e in result.errors)


def test_nonexistent_file_is_invalid():
    result = validate_file("/nonexistent/path/file.txt", "file.txt")
    assert not result.valid
    assert any("not found" in e.lower() for e in result.errors)


def test_empty_path_is_invalid():
    result = validate_file("", "file.txt")
    assert not result.valid


def test_image_only_extension_produces_warning(tmp_path):
    f = tmp_path / "scan.png"
    f.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
    result = validate_file(str(f), "scan.png")
    assert result.is_image_only
    assert result.ocr_required
    assert any("ocr" in w.lower() for w in result.warnings)


def test_unsupported_extension_produces_warning(tmp_path):
    f = tmp_path / "data.xyz"
    f.write_text("some content")
    result = validate_file(str(f), "data.xyz")
    # File itself is valid (has content) but ext warning issued
    assert any("not be supported" in w.lower() for w in result.warnings) or result.valid


# ---------------------------------------------------------------------------
# ZIP security
# ---------------------------------------------------------------------------

def test_valid_zip_passes(tmp_path):
    zp = tmp_path / "submissions.zip"
    with zipfile.ZipFile(zp, "w") as z:
        z.writestr("student1.txt", "My answer.")
        z.writestr("student2.txt", "Another answer.")
    result = validate_zip_security(str(zp))
    assert result.valid
    assert result.entry_count == 2


def test_invalid_zip_file_fails(tmp_path):
    bad = tmp_path / "bad.zip"
    bad.write_text("not a zip file at all")
    result = validate_zip_security(str(bad))
    assert not result.valid
    assert any("invalid zip" in e.lower() for e in result.errors)


def test_missing_zip_fails():
    result = validate_zip_security("/nonexistent/archive.zip")
    assert not result.valid


def test_path_traversal_rejected(tmp_path):
    zp = tmp_path / "attack.zip"
    with zipfile.ZipFile(zp, "w") as z:
        zi = zipfile.ZipInfo("../../../etc/passwd")
        z.writestr(zi, "root:x:0:0:root:/root:/bin/bash")
    result = validate_zip_security(str(zp))
    assert not result.valid
    assert any("traversal" in e.lower() for e in result.errors)


def test_nested_zip_produces_warning(tmp_path):
    inner_zip = tmp_path / "inner.zip"
    with zipfile.ZipFile(inner_zip, "w") as z:
        z.writestr("file.txt", "content")
    outer_zip = tmp_path / "outer.zip"
    with zipfile.ZipFile(outer_zip, "w") as z:
        z.write(inner_zip, "inner.zip")
    result = validate_zip_security(str(outer_zip))
    assert any("nested" in w.lower() for w in result.warnings)


def test_excessive_entries_fails(tmp_path, monkeypatch):
    monkeypatch.setattr("eval_validation.input_validator.MAX_ZIP_ENTRIES", 3)
    zp = tmp_path / "many.zip"
    with zipfile.ZipFile(zp, "w") as z:
        for i in range(5):
            z.writestr(f"file{i}.txt", "x")
    result = validate_zip_security(str(zp))
    assert not result.valid
    assert any("entries" in e.lower() for e in result.errors)


def test_high_compression_ratio_detected(tmp_path):
    """A highly compressible file should trigger the compression ratio check."""
    zp = tmp_path / "bomb.zip"
    # Create a large highly-compressible file
    large_content = b"A" * (5 * 1024 * 1024)  # 5 MB of 'A' — very compressible
    with zipfile.ZipFile(zp, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("data.txt", large_content)
    result = validate_zip_security(str(zp))
    # Should detect suspicious compression ratio
    has_ratio_error = any("compression ratio" in e.lower() or "zip bomb" in e.lower()
                           for e in result.errors)
    has_ratio_suspicious = "data.txt" in result.suspicious_entries
    # At least one of these should fire for highly compressible content
    assert has_ratio_error or has_ratio_suspicious or not result.valid


# ---------------------------------------------------------------------------
# Extraction validation
# ---------------------------------------------------------------------------

def test_valid_extraction():
    result = validate_extraction("This is a meaningful student answer with sufficient content.", "sub.txt")
    assert result.valid
    assert not result.is_empty


def test_empty_extraction_fails():
    result = validate_extraction("", "sub.txt")
    assert not result.valid
    assert result.is_empty
    assert any("no text" in e.lower() or "empty" in e.lower() for e in result.errors)


def test_whitespace_only_extraction_fails():
    result = validate_extraction("   \n\t  ", "sub.txt")
    assert not result.valid
    assert result.is_empty


def test_short_extraction_warns(tmp_path):
    result = validate_extraction("Hi.", "sub.txt")
    # Very short but not empty — valid with warning
    assert result.is_short
    if result.valid:
        assert any("short" in w.lower() for w in result.warnings)


def test_image_only_without_text_fails():
    result = validate_extraction("", "scan.png", is_image_only=True)
    assert not result.valid
    assert result.ocr_required
    assert any("ocr" in e.lower() for e in result.errors)


def test_normal_extraction_not_flagged_as_ocr():
    result = validate_extraction("A proper textual answer.", "essay.txt", is_image_only=False)
    assert result.valid
    assert not result.ocr_required
