import os
import re
from urllib.parse import urlparse

from dotenv import load_dotenv
from github import Github

load_dotenv()


def get_github_client():
    token = os.getenv("GITHUB_TOKEN")

    if not token:
        raise RuntimeError("GITHUB_TOKEN is not set")

    return Github(token)


def parse_repo_url(repo_url):
    parsed = urlparse(repo_url)

    path = parsed.path.strip("/")

    if path.endswith(".git"):
        path = path[:-4]

    parts = path.split("/")

    if len(parts) < 2:
        raise ValueError("Invalid GitHub repository URL")

    return parts[0], parts[1]


def get_repo_data(repo_url, rubric=None):
    owner, repo_name = parse_repo_url(repo_url)

    github = get_github_client()
    repo = github.get_repo(f"{owner}/{repo_name}")

    commits = list(repo.get_commits()[:20])

    files = get_file_tree(repo)
    readme = get_readme(repo)
    file_contents = get_file_contents(repo, files, rubric=rubric)

    return {
        "name": repo.name,
        "owner": owner,
        "description": repo.description,
        "default_branch": repo.default_branch,

        "languages": repo.get_languages(),
        "topics": repo.get_topics(),

        "stars": repo.stargazers_count,
        "last_push": (
            repo.pushed_at.isoformat()
            if repo.pushed_at else None
        ),

        "files": files,
        "readme": readme,
        "file_contents": file_contents,

        "has_tests": detect_has_tests(files),

        "commits": [
            {
                "sha": commit.sha,
                "message": commit.commit.message,
                "date": (
                    commit.commit.author.date.isoformat()
                    if commit.commit.author
                    else None
                ),
            }
            for commit in commits
        ],
    }

def get_file_tree(repo):
    contents = repo.get_contents("")
    files = []

    def collect(items):
        for item in items:
            if item.type == "file":
                files.append(item.path)
            elif item.type == "dir":
                try:
                    collect(repo.get_contents(item.path))
                except Exception:
                    pass

    collect(contents)
    return files


def get_readme(repo):
    try:
        readme = repo.get_readme()
        return readme.decoded_content.decode("utf-8", errors="ignore")
    except Exception:
        return ""


def detect_has_tests(files):
    test_keywords = [
        "test",
        "tests",
        "__tests__",
        "spec"
    ]

    return any(
        any(keyword in file_path.lower() for keyword in test_keywords)
        for file_path in files
    )

def get_file_contents(repo, files, max_files=5, rubric=None):
    contents = {}

    important_extensions = (
        ".py", ".js", ".jsx", ".ts", ".tsx",
        ".java", ".cpp", ".h", ".sql", ".md"
    )

    important_files = [
        path for path in files
        if path.lower().endswith(important_extensions)
    ]

    selected_files = _select_relevant_files(
        important_files,
        rubric,
        max_files
    )

    for path in selected_files:
        try:
            file = repo.get_contents(path)

            if file.type == "file":
                content = file.decoded_content.decode(
                    "utf-8",
                    errors="ignore"
                )

                # Keep each file small
                contents[path] = content[:3000]

        except Exception:
            continue

    return contents


def _select_relevant_files(files, rubric, max_files):
    if not rubric or not rubric.get("criteria"):
        return files[:max_files]

    def tokenize(value):
        terms = re.findall(r"[a-z0-9]+", value.lower())
        normalized = set()
        for term in terms:
            if len(term) > 4 and term.endswith("ies"):
                term = term[:-3] + "y"
            elif len(term) > 3 and term.endswith("s"):
                term = term[:-1]
            normalized.add(term)
        return normalized

    alias_groups = (
        {"api", "endpoint", "route", "server", "app", "fastapi", "flask"},
        {"machine", "learning", "ml", "train", "training", "classifier", "model", "predict", "prediction", "inference"},
        {"database", "db", "sql", "sqlite", "postgres", "mysql", "schema", "seed", "model"},
        {"test", "tests", "testing", "spec", "pytest", "unittest"},
        {"documentation", "docs", "readme", "guide"},
    )
    stop_words = {
        "a", "an", "and", "are", "as", "for", "in", "of", "on",
        "the", "to", "using", "with", "write", "provide", "build",
        "create", "application", "project",
    }

    requirement_terms = []
    for criterion in rubric.get("criteria", []):
        for requirement in criterion.get("requirements", []):
            if not isinstance(requirement, str):
                continue
            terms = tokenize(requirement) - stop_words
            for aliases in alias_groups:
                if terms & aliases:
                    terms.update(aliases)
            if terms:
                requirement_terms.append(terms)

    if not requirement_terms:
        return files[:max_files]

    file_terms = [tokenize(path) for path in files]
    selected_indices = []
    covered_requirements = set()

    while len(selected_indices) < min(max_files, len(files)):
        best_index = None
        best_score = (0, 0, 0)

        for index, terms in enumerate(file_terms):
            if index in selected_indices:
                continue
            matches = [
                requirement_index
                for requirement_index, required_terms in enumerate(requirement_terms)
                if terms & required_terms
            ]
            new_coverage = sum(
                requirement_index not in covered_requirements
                for requirement_index in matches
            )
            term_matches = sum(
                len(terms & required_terms)
                for required_terms in requirement_terms
            )
            score = (new_coverage, len(matches), term_matches)
            if score > best_score:
                best_index = index
                best_score = score

        if best_index is None:
            break
        if best_score == (0, 0, 0):
            for index in range(len(files)):
                if index not in selected_indices:
                    selected_indices.append(index)
                    if len(selected_indices) == max_files:
                        break
            break

        selected_indices.append(best_index)
        covered_requirements.update(
            requirement_index
            for requirement_index, required_terms in enumerate(requirement_terms)
            if file_terms[best_index] & required_terms
        )

    return [files[index] for index in selected_indices]