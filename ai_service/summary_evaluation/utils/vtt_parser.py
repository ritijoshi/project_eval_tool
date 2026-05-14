import re

def parse_transcript(file_path: str) -> str:
    """
    Parses a `.vtt` or `.txt` file, stripping timecodes and normalizing text.
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # If it's a VTT file, remove WEBVTT headers and timecodes
        if "WEBVTT" in content or "-->" in content:
            # Remove WEBVTT header
            content = re.sub(r'WEBVTT[\r\n]+', '', content)
            # Remove UUIDs or Sequence Numbers (digits standing alone on a line)
            content = re.sub(r'(?m)^[\w-]+\s*$', '', content)
            # Remove Timecodes line like 00:00:23.000 --> 00:00:26.500
            content = re.sub(r'\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}', '', content)
            # Remove styling tags like <v Speaker Name> or <c.color>
            content = re.sub(r'<[^>]+>', '', content)

        # Normalize whitespace (replace multiple newlines/spaces with a single space)
        # However, keep paragraphs separated if there are double newlines.
        paragraphs = re.split(r'\n\s*\n', content)
        cleaned_paragraphs = []
        for p in paragraphs:
            p = re.sub(r'\s+', ' ', p).strip()
            if p:
                cleaned_paragraphs.append(p)

        return "\n\n".join(cleaned_paragraphs)
    except Exception as e:
        print(f"Error parsing transcript {file_path}: {str(e)}")
        raise e
