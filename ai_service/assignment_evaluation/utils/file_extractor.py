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

    notebook_candidate = lower_name.endswith('.ipynb')
    if not notebook_candidate:
        try:
            with open(filepath, 'r', encoding='utf-8', errors='strict') as handle:
                candidate_payload = json.load(handle)
                notebook_candidate = isinstance(candidate_payload, dict) and 'cells' in candidate_payload
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            notebook_candidate = False

    if notebook_candidate:
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as handle:
                payload = json.load(handle)
            if not isinstance(payload, dict) or not isinstance(payload.get('cells'), list):
                raise ValueError(f'Invalid Jupyter notebook structure: {filename or filepath}')
            parts = []
            for index, cell in enumerate(payload.get('cells', []), start=1):
                source = cell.get('source', [])
                if isinstance(source, list):
                    source_text = ''.join(source)
                elif isinstance(source, str):
                    source_text = source
                else:
                    source_text = ''
                cell_parts = [f'## Notebook cell {index}', source_text]
                outputs = cell.get('outputs', [])
                for output in outputs if isinstance(outputs, list) else []:
                    if isinstance(output, dict) and output.get('text'):
                        output_text = output['text']
                        cell_parts.append('OUTPUT:\n' + (
                            ''.join(output_text) if isinstance(output_text, list) else str(output_text)
                        ))
                    if isinstance(output, dict) and output.get('ename'):
                        cell_parts.append(
                            f"ERROR: {output.get('ename')}: {output.get('evalue', '')}"
                        )
                parts.append('\n'.join(part for part in cell_parts if part))
            text = '\n\n'.join(parts)
            detected_type = 'code' if any(text.strip()) else 'text'
            return {'text': text, 'detectedType': detected_type, 'language': language}
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError(f'Invalid Jupyter notebook: {filename or filepath}') from exc
        except ValueError:
            raise
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
    if not text and not lower_name.endswith(('.zip', '.pdf', '.docx', '.pptx')):
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as handle:
                text = handle.read().strip()
        except OSError:
            text = ''

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
