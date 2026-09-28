import json
import os
import re
import zipfile

from main import extract_text_from_file


CODE_EXTENSIONS = {
    '.py': 'python',
    '.js': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.jsx': 'javascript',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.cs': 'csharp',
    '.sql': 'sql',
}


def detect_submission_type(text: str, filename: str = '') -> str:
    if filename.lower().endswith(('.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.c', '.cpp', '.cs', '.sql')):
        return 'code'
    return 'text'


def extract_text_from_submission(filepath: str, filename: str = '') -> dict:
    text = ''
    detected_type = detect_submission_type(text, filename or filepath)
    language = None

    lower_name = (filename or filepath).lower()
    for ext, lang in CODE_EXTENSIONS.items():
        if lower_name.endswith(ext):
            language = lang
            break

    if lower_name.endswith('.ipynb'):
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as handle:
                payload = json.load(handle)
            parts = []
            for cell in payload.get('cells', []):
                source = cell.get('source', [])
                if isinstance(source, list):
                    parts.append(''.join(source))
                elif isinstance(source, str):
                    parts.append(source)
            text = '\n\n'.join(parts)
            detected_type = 'code' if any(text.strip()) else 'text'
            return {'text': text, 'detectedType': detected_type, 'language': language}
        except Exception:
            text = ''

    if lower_name.endswith('.zip'):
        try:
            with zipfile.ZipFile(filepath) as archive:
                inner_parts = []
                for member in archive.namelist():
                    if member.endswith('/'):
                        continue
                    member_name = os.path.basename(member)
                    if not member_name:
                        continue
                    inner_path = os.path.join(os.path.dirname(filepath), f"__inner__{abs(hash(member_name))}_{member_name}")
                    with archive.open(member) as src, open(inner_path, 'wb') as dst:
                        dst.write(src.read())
                    inner_result = extract_text_from_submission(inner_path, member_name)
                    if inner_result['text']:
                        inner_parts.append(f"### {member_name}\n{inner_result['text'][:20000]}")
                    try:
                        os.remove(inner_path)
                    except OSError:
                        pass
                text = '\n\n'.join(inner_parts)
        except Exception:
            text = ''

    if not text:
        text = extract_text_from_file(filepath, filename or os.path.basename(filepath)) or ''
        detected_type = detect_submission_type(text, filename or filepath)

    if not language and lower_name.endswith(('.py', '.java', '.c', '.cpp', '.js', '.ts', '.sql')):
        language = CODE_EXTENSIONS.get(os.path.splitext(lower_name)[1])

    return {'text': text.strip(), 'detectedType': detected_type, 'language': language}


def extract_identity_from_filename(filename: str):
    base = os.path.basename(filename)
    stem = os.path.splitext(base)[0]
    if '_' in stem:
        parts = stem.split('_')
        if len(parts) >= 2:
            return ' '.join(parts[:-1]), parts[-1]
    return stem, 'UNKNOWN'
