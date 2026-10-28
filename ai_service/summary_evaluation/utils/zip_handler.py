"""
ZIP handler for batch summary evaluation.

Wraps the shared eval_validation.input_validator.validate_zip_security
check before calling the original safe_extract_zip logic so that all
security limits (entry count, per-file size, total uncompressed size,
compression-ratio / ZIP-bomb, path traversal) are enforced consistently
with the assignment evaluation pipeline.
"""

import os
import re
import zipfile
import shutil

# ---------------------------------------------------------------------------
# Shared security check (with graceful fallback if package unavailable)
# ---------------------------------------------------------------------------
try:
    from eval_validation.input_validator import validate_zip_security as _shared_zip_security
    _SHARED_SECURITY_AVAILABLE = True
except ImportError:
    _SHARED_SECURITY_AVAILABLE = False
    print('[zip_handler] WARNING: eval_validation not found; using basic ZIP security only.')


def _basic_path_traversal(member_name: str) -> bool:
    """Return True if the entry name attempts directory traversal."""
    normalised = member_name.replace('\\', '/')
    if normalised.startswith(('/', '\\')) or re.match(r'^[A-Za-z]:', normalised):
        return True
    return os.path.normpath(normalised).startswith('..')


def safe_extract_zip(zip_path: str, extract_to: str) -> str:
    """
    Safely extracts a ZIP payload to a session directory.

    Security steps (in order):
      1. Run the shared eval_validation ZIP security scan (entry count,
         per-file size, total uncompressed, compression-ratio bomb,
         path traversal).  Raises ValueError on any failure.
      2. Extract only entries that pass the resolved-path containment check.
    """
    os.makedirs(extract_to, exist_ok=True)
    target_path = os.path.abspath(extract_to)

    # Step 1: shared security scan
    if _SHARED_SECURITY_AVAILABLE:
        result = _shared_zip_security(zip_path)
        if not result.valid:
            raise ValueError(
                'ZIP archive failed security validation: ' + '; '.join(result.errors)
            )
        for w in result.warnings:
            print(f'[zip_handler] WARNING: {w}')
    else:
        try:
            with zipfile.ZipFile(zip_path, 'r') as zh:
                for member in zh.infolist():
                    if _basic_path_traversal(member.filename):
                        raise ValueError(
                            f'SECURITY: Path traversal detected: {member.filename}'
                        )
        except zipfile.BadZipFile as exc:
            raise ValueError(f'Invalid ZIP archive: {exc}') from exc

    # Step 2: extraction with containment check
    with zipfile.ZipFile(zip_path, 'r') as zh:
        for member in zh.infolist():
            if '__MACOSX' in member.filename or '.DS_Store' in member.filename:
                continue

            extracted_path = os.path.abspath(os.path.join(target_path, member.filename))

            if not extracted_path.startswith(target_path + os.sep) and extracted_path != target_path:
                print(f'SECURITY WARNING: Containment check rejected: {member.filename}')
                continue

            zh.extract(member, extract_to)

    return extract_to


def get_submission_files(directory: str) -> list:
    """
    Recursively finds all supported submission files in the directory.
    Supports .html, .txt, .pdf, .docx format variations natively.
    """
    submission_files = []
    onlinetext_files = []
    supported_ext = ('.html', '.txt', '.pdf', '.docx')
    print(f"DEBUG: Scanning directory '{directory}' for submissions...")

    total_files_scanned = 0
    expected_submission_dirs = set()
    found_onlinetext_dirs = set()
    for root, dirs, files in os.walk(directory):
        dir_name = os.path.basename(root)
        if dir_name.lower().endswith('_onlinetext'):
            expected_submission_dirs.add(root)

        for file in files:
            if file.startswith('.') or '__MACOSX' in root:
                continue
            total_files_scanned += 1
            if file.lower() == 'onlinetext.html':
                onlinetext_files.append(os.path.join(root, file))
                found_onlinetext_dirs.add(root)
            elif file.lower().endswith(supported_ext):
                submission_files.append(os.path.join(root, file))
            else:
                print(f"WARNING: Skipping unsupported file format: {os.path.join(root, file)}")

    if onlinetext_files:
        missing_expected = expected_submission_dirs - found_onlinetext_dirs
        for missing_dir in sorted(missing_expected):
            print(f"WARNING: Missing onlinetext.html in submission folder: {missing_dir}")
        print(f"DEBUG: Found {len(onlinetext_files)} onlinetext.html submissions.")
        return onlinetext_files

    print("WARNING: No onlinetext.html files found. Falling back to generic supported submissions.")
    print(f"DEBUG: Scanned {total_files_scanned} files. Found {len(submission_files)} submissions.")
    return submission_files


def cleanup_temp_dir(directory: str):
    """Recursively deletes the session temporary extraction directory."""
    if os.path.exists(directory):
        shutil.rmtree(directory)
