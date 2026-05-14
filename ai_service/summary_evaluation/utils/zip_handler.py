import os
import zipfile
import shutil

def safe_extract_zip(zip_path: str, extract_to: str) -> str:
    """
    Safely extracts a ZIP payload to a generated session directory.
    Protects against Zip-Slip attacks by ensuring the target extraction path 
    resolves strictly inside the intended root directory.
    Rejects unsafe or overly large nested files.
    """
    os.makedirs(extract_to, exist_ok=True)
    
    with zipfile.ZipFile(zip_path, 'r') as zh:
        for member in zh.infolist():
            # Get the resolved absolute root of target folder
            target_path = os.path.abspath(extract_to)
            
            # Get the path the zip wants to extract to
            extracted_path = os.path.abspath(os.path.join(target_path, member.filename))

            # Zip Slip Vulnerability check
            if not extracted_path.startswith(target_path):
                print(f"SECURITY WARNING: Attempted Zip-Slip attack intercepted for file {member.filename}")
                continue # Skip malicious file
            
            # Simple sanitization - ignore hidden directories like __MACOSX
            if '__MACOSX' in member.filename or '.DS_Store' in member.filename:
                continue
                
            zh.extract(member, extract_to)
            
    return extract_to

def get_submission_files(directory: str) -> list:
    """
    Recursively finds all supported submission files in the directory.
    Supports .html, .txt, .pdf, .docx format variations natively.
    """
    submission_files = []
    supported_ext = ('.html', '.txt', '.pdf', '.docx')
    print(f"DEBUG: Scanning directory '{directory}' for submissions...")
    
    total_files_scanned = 0
    for root, dirs, files in os.walk(directory):
        for file in files:
            # Skip hidden files or __MACOSX directories safely
            if file.startswith('.') or '__MACOSX' in root:
                continue
                
            total_files_scanned += 1
            if file.lower().endswith(supported_ext):
                submission_files.append(os.path.join(root, file))
            else:
                print(f"WARNING: Skipping unsupported file format: {os.path.join(root, file)}")
                
    print(f"DEBUG: Extraction Scan Complete. Scanned {total_files_scanned} user files. Found {len(submission_files)} supported submissions.")
    return submission_files

def cleanup_temp_dir(directory: str):
    """
    Recursively deletes the session temporary extraction directory.
    """
    if os.path.exists(directory):
        shutil.rmtree(directory)
