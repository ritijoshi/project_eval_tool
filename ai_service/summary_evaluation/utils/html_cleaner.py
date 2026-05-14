import re
import os
from bs4 import BeautifulSoup
from typing import Dict, Tuple

def extract_identity_from_filename(filename: str) -> Tuple[str, str]:
    """
    Extracts Student Name and Roll Number from LMS filenames or parent folders.
    Preferred format: studentName_rollNo_onlinetext (folder or file stem).
    Returns: (student_name, roll_number)
    """
    base_name = os.path.splitext(os.path.basename(filename))[0]
    candidate = base_name

    # If the file is the expected onlinetext.html, use the parent directory name.
    if base_name.lower() == 'onlinetext':
        parent = os.path.basename(os.path.dirname(filename))
        if parent:
            candidate = parent

    # Primary pattern: studentName_rollNo_onlinetext (use right-split to preserve underscores in names)
    lower_candidate = candidate.lower()
    if lower_candidate.endswith('_onlinetext'):
        base = candidate[: -len('_onlinetext')]
        roll_number = ""
        student_name = base.strip()

        if '_' in base:
            student_name, roll_number = base.rsplit('_', 1)
        elif ' ' in base:
            student_name, roll_number = base.rsplit(' ', 1)

        student_name = student_name.strip()
        roll_number = roll_number.strip()

        if not roll_number or not re.match(r'^[A-Za-z0-9\-]+$', roll_number):
            roll_number = ""
    else:
        # Fallback: studentName_rollNo
        match = re.match(r'^(.+)_([\w\-]+)$', candidate)
        if match:
            student_name = match.group(1).strip()
            roll_number = match.group(2).strip()
        else:
            return candidate.strip(), "UNKNOWN"

    # Normalize whitespace for readability while preserving special characters.
    student_name = re.sub(r'\s+', ' ', student_name.replace('_', ' ')).strip()
    return student_name, roll_number or "UNKNOWN"

def clean_html_submission(html_content: str) -> Dict[str, str]:
    """
    Parses messy HTML using BeautifulSoup, falling back to meta tags for identity if regex failed.
    Normalizes whitespace but preserves paragraph structure.
    Returns { 'text': str, 'meta_author': str }
    """
    soup = BeautifulSoup(html_content, 'html.parser')

    # Remove non-content elements before text extraction.
    for tag in soup(['script', 'style', 'noscript']):
        tag.decompose()
    
    meta_author = ""
    author_tag = soup.find('meta', attrs={'name': 'author'})
    if author_tag and author_tag.get('content'):
        meta_author = author_tag['content'].strip()

    # Extract text block by block to preserve semantic paragraphs
    paragraphs = []
    for p in soup.find_all(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']):
        text = p.get_text(separator=' ', strip=True)
        if text:
            paragraphs.append(text)
    
    # If it was just raw text without block tags, fallback to overall text extraction
    if not paragraphs:
        paragraphs = [soup.get_text(separator='\n', strip=True)]
    
    # Clean up massive spaces
    cleaned_text = "\n\n".join([re.sub(r'\s+', ' ', p) for p in paragraphs])
    return {
        "text": cleaned_text,
        "meta_author": meta_author
    }
