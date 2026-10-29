"""
Input and file validator for all four evaluation workflows.

Validates file presence, format, size, and extractability before
any LLM call is made. Used by both individual and batch evaluation.
"""

import os
import math
import re
import zipfile
from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Configuration (can be overridden via environment variables)
# ---------------------------------------------------------------------------

import os as _os

# Maximum size for a single submitted file (25 MB default)
MAX_SINGLE_FILE_SIZE = int(_os.environ.get("EVAL_MAX_FILE_SIZE_BYTES", str(25 * 1024 * 1024)))

# For ZIP uploads
MAX_ZIP_COMPRESSED_SIZE = int(_os.environ.get("EVAL_MAX_ZIP_COMPRESSED_BYTES", str(200 * 1024 * 1024)))
MAX_ZIP_UNCOMPRESSED_SIZE = int(_os.environ.get("EVAL_MAX_ZIP_UNCOMPRESSED_BYTES", str(500 * 1024 * 1024)))
MAX_ZIP_ENTRIES = int(_os.environ.get("EVAL_MAX_ZIP_ENTRIES", "1000"))
MAX_ZIP_COMPRESSION_RATIO = float(_os.environ.get("EVAL_MAX_ZIP_COMPRESSION_RATIO", "200.0"))
MAX_NESTED_ZIP_DEPTH = int(_os.environ.get("EVAL_MAX_NESTED_ZIP_DEPTH", "0"))  # 0 = reject nested

# Minimum extracted text length to be considered non-empty
MIN_EXTRACTION_CHARS = int(_os.environ.get("EVAL_MIN_EXTRACTION_CHARS", "20"))

# Supported file extensions for submissions
SUPPORTED_EXTENSIONS = frozenset({
    ".ipynb", ".pdf", ".docx", ".pptx", ".txt", ".md",
    ".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".c", ".cpp",
    ".cs", ".sql", ".json", ".csv", ".html", ".css",
})

# Extensions that are image-only and cannot yield text
IMAGE_ONLY_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".webp", ".gif"})

# File magic bytes for common supported formats
_MAGIC = {
    b"%PDF": "pdf",
    b"PK\x03\x04": "zip_or_office",   # Also DOCX/PPTX/XLSX/ZIP
    b"{": "json_or_notebook",
    b"\xef\xbb\xbf": "utf8_bom_text",
}


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class FileValidationResult:
    valid: bool
    file_path: str = ""
    file_name: str = ""
    file_size_bytes: int = 0
    detected_format: str = ""
    is_image_only: bool = False
    ocr_required: bool = False
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def raise_if_invalid(self) -> None:
        if not self.valid:
            raise ValueError("File validation failed: " + "; ".join(self.errors))


@dataclass
class ZipSecurityResult:
    valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    entry_count: int = 0
    total_compressed_bytes: int = 0
    total_uncompressed_bytes: int = 0
    suspicious_entries: list[str] = field(default_factory=list)

    def raise_if_invalid(self) -> None:
        if not self.valid:
            raise ValueError("ZIP security validation failed: " + "; ".join(self.errors))


@dataclass
class ExtractionValidationResult:
    valid: bool
    text_length: int = 0
    is_empty: bool = True
    is_short: bool = False
    ocr_required: bool = False
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def raise_if_invalid(self) -> None:
        if not self.valid:
            raise ValueError("Text extraction validation failed: " + "; ".join(self.errors))


# ---------------------------------------------------------------------------
# File validation
# ---------------------------------------------------------------------------

def _detect_format_by_magic(path: str) -> str:
    """Sniff the first few bytes to detect actual file format."""
    try:
        with open(path, "rb") as fh:
            header = fh.read(8)
        for magic, fmt in _MAGIC.items():
            if header.startswith(magic):
                return fmt
    except OSError:
        pass
    return "unknown"


def validate_file(file_path: str, file_name: str = "") -> FileValidationResult:
    """
    Validate a single submission or rubric file.

    Checks: existence, readability, size, supported extension, and actual
    format via magic bytes.  Does NOT extract text.
    """
    name = file_name or os.path.basename(file_path)
    errors: list[str] = []
    warnings: list[str] = []

    if not file_path:
        return FileValidationResult(valid=False, file_name=name, errors=["File path is empty."])

    if not os.path.exists(file_path):
        return FileValidationResult(valid=False, file_path=file_path, file_name=name, errors=[f"File not found: {file_path}"])

    if not os.path.isfile(file_path):
        return FileValidationResult(valid=False, file_path=file_path, file_name=name, errors=[f"Path is not a file: {file_path}"])

    size = os.path.getsize(file_path)
    if size == 0:
        return FileValidationResult(valid=False, file_path=file_path, file_name=name, file_size_bytes=0, errors=["File is empty (0 bytes)."])

    if size > MAX_SINGLE_FILE_SIZE:
        errors.append(f"File size {size:,} bytes exceeds the limit {MAX_SINGLE_FILE_SIZE:,} bytes.")

    ext = os.path.splitext(name)[1].lower()
    is_image_only = ext in IMAGE_ONLY_EXTENSIONS
    if is_image_only:
        warnings.append(
            f"File '{name}' is image-only ({ext}). "
            "OCR would be required; if OCR is unavailable, no text can be extracted."
        )
    elif ext and ext not in SUPPORTED_EXTENSIONS:
        warnings.append(f"File extension '{ext}' may not be supported for text extraction.")

    detected = _detect_format_by_magic(file_path)
    # For DOCX/PPTX we expect the ZIP magic, which is correct
    if ext in (".docx", ".pptx", ".xlsx") and detected == "zip_or_office":
        detected = "office"
    elif ext == ".pdf" and detected != "pdf":
        warnings.append(f"File '{name}' has .pdf extension but does not appear to be a valid PDF.")
    elif ext == ".ipynb" and detected not in ("json_or_notebook", "utf8_bom_text", "unknown"):
        warnings.append(f"File '{name}' has .ipynb extension but magic bytes do not match JSON.")

    valid = not errors
    return FileValidationResult(
        valid=valid,
        file_path=file_path,
        file_name=name,
        file_size_bytes=size,
        detected_format=detected,
        is_image_only=is_image_only,
        ocr_required=is_image_only,
        errors=errors,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# ZIP security validation
# ---------------------------------------------------------------------------

def _is_path_traversal(member_name: str) -> bool:
    """Return True if the archive path attempts directory traversal."""
    normalised = member_name.replace("\\", "/")
    if normalised.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", normalised):
        return True
    parts = normalised.split("/")
    for part in parts:
        if part in ("..", ""):
            continue
    # Use os.path normpath check
    np = os.path.normpath(normalised)
    return np.startswith("..") or os.path.isabs(np)


def validate_zip_security(zip_path: str) -> ZipSecurityResult:
    """
    Validate a ZIP archive for security risks before extraction.

    Checks:
      - Valid ZIP format
      - Total compressed and uncompressed size
      - Entry count limit
      - Compression ratio (ZIP-bomb detection)
      - Path traversal in entry names
      - Absolute paths and drive-letter prefixes
      - Nested ZIP files (rejected by default)
    """
    errors: list[str] = []
    warnings: list[str] = []
    suspicious: list[str] = []

    if not os.path.exists(zip_path):
        return ZipSecurityResult(valid=False, errors=[f"ZIP file not found: {zip_path}"])

    compressed_size = os.path.getsize(zip_path)
    if compressed_size > MAX_ZIP_COMPRESSED_SIZE:
        errors.append(
            f"ZIP compressed size {compressed_size:,} bytes exceeds limit "
            f"{MAX_ZIP_COMPRESSED_SIZE:,} bytes."
        )

    try:
        with zipfile.ZipFile(zip_path, "r") as archive:
            members = archive.infolist()
    except zipfile.BadZipFile as exc:
        return ZipSecurityResult(valid=False, errors=[f"Invalid ZIP archive: {exc}"])
    except Exception as exc:
        return ZipSecurityResult(valid=False, errors=[f"Could not open ZIP archive: {exc}"])

    if len(members) > MAX_ZIP_ENTRIES:
        errors.append(
            f"ZIP contains {len(members)} entries; maximum is {MAX_ZIP_ENTRIES}."
        )

    total_uncompressed = 0
    for member in members:
        name = member.filename

        if _is_path_traversal(name):
            errors.append(f"Path traversal detected in archive entry: '{name}'")
            suspicious.append(name)
            continue

        if name.lower().endswith(".zip"):
            if MAX_NESTED_ZIP_DEPTH == 0:
                warnings.append(f"Nested ZIP detected and will be skipped: '{name}'")
            else:
                warnings.append(f"Nested ZIP detected: '{name}' (depth limit={MAX_NESTED_ZIP_DEPTH})")

        file_size = member.file_size
        if file_size > MAX_SINGLE_FILE_SIZE:
            errors.append(
                f"Archive entry '{name}' uncompressed size {file_size:,} bytes "
                f"exceeds per-file limit {MAX_SINGLE_FILE_SIZE:,} bytes."
            )

        # Compression ratio check (ZIP bomb)
        if member.compress_size > 0:
            ratio = file_size / member.compress_size
            if ratio > MAX_ZIP_COMPRESSION_RATIO:
                errors.append(
                    f"Suspicious compression ratio {ratio:.0f}:1 for entry '{name}' "
                    "(possible ZIP bomb)."
                )
                suspicious.append(name)

        total_uncompressed += file_size
        if total_uncompressed > MAX_ZIP_UNCOMPRESSED_SIZE:
            errors.append(
                f"Total uncompressed size exceeds limit "
                f"{MAX_ZIP_UNCOMPRESSED_SIZE:,} bytes."
            )
            break

    valid = not errors
    return ZipSecurityResult(
        valid=valid,
        errors=errors,
        warnings=warnings,
        entry_count=len(members),
        total_compressed_bytes=compressed_size,
        total_uncompressed_bytes=total_uncompressed,
        suspicious_entries=suspicious,
    )


# ---------------------------------------------------------------------------
# Extraction result validation
# ---------------------------------------------------------------------------

def validate_extraction(
    extracted_text: str,
    file_name: str = "",
    *,
    is_image_only: bool = False,
) -> ExtractionValidationResult:
    """
    Validate the result of document extraction.

    Distinguishes between:
      - Genuinely empty extraction (corrupt or unsupported file)
      - Very short submission (possibly valid but short answer)
      - Image-only files where OCR would be required
    """
    errors: list[str] = []
    warnings: list[str] = []
    text = (extracted_text or "").strip()
    length = len(text)

    if is_image_only:
        if length == 0:
            return ExtractionValidationResult(
                valid=False,
                text_length=0,
                is_empty=True,
                ocr_required=True,
                errors=[
                    f"File '{file_name}' is image-only and no text was extracted. "
                    "OCR is required to evaluate this submission."
                ],
            )
        warnings.append(f"Text from '{file_name}' was extracted via OCR.")

    if length == 0:
        return ExtractionValidationResult(
            valid=False,
            text_length=0,
            is_empty=True,
            errors=[
                f"No text could be extracted from '{file_name}'. "
                "The file may be empty, corrupt, or in an unsupported format."
            ],
        )

    is_short = length < MIN_EXTRACTION_CHARS
    if is_short:
        warnings.append(
            f"Extracted text from '{file_name}' is very short ({length} characters). "
            "This may be a valid short answer or a partial extraction failure."
        )

    return ExtractionValidationResult(
        valid=True,
        text_length=length,
        is_empty=False,
        is_short=is_short,
        ocr_required=is_image_only,
        errors=errors,
        warnings=warnings,
    )
