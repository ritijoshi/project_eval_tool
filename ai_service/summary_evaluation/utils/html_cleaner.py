import re
import os
from bs4 import BeautifulSoup
from typing import Dict, Tuple

def extract_identity_from_filename(filename: str) -> Tuple[str, str]:
    """
    Attempts to deterministically extract Student Name and Roll Number from LMS filenames.
    Typical format: StudentName_RollNumber_Assignment.html
    Returns: (student_name, roll_number)
    """
    base_name = os.path.splitext(os.path.basename(filename))[0]
    
    # Regex: Letters/Spaces for name, followed by underscore, followed by Alphanumeric roll
    # Example: "John Doe_CS102_Summary" -> "John Doe", "CS102"
    match = re.match(r'^([a-zA-Z\s\-]+)_([a-zA-Z0-9]+)_?', base_name)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    
    # Fallback: take the whole base name as the student name, Unknown for roll
    return base_name.strip(), "UNKNOWN"

def clean_html_submission(html_content: str) -> Dict[str, str]:
    """
    Parses messy HTML using BeautifulSoup, falling back to meta tags for identity if regex failed.
    Normalizes whitespace but preserves paragraph structure.
    Returns { 'text': str, 'meta_author': str }
    """
    soup = BeautifulSoup(html_content, 'html.parser')
    
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
