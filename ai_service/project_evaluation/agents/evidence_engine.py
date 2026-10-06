import re


def build_evidence(repo_data, github_analysis, rubric, weekly_report=None):
    """
    Combine repository evidence and rubric analysis
    into a single evaluation evidence object.
    """

    requirement_mapping = github_analysis.get(
        "requirementMapping", []
    )

    complete = sum(
        1 for r in requirement_mapping
        if r.get("status") == "COMPLETE"
    )

    partial = sum(
        1 for r in requirement_mapping
        if r.get("status") == "PARTIAL"
    )

    missing = sum(
        1 for r in requirement_mapping
        if r.get("status") == "MISSING"
    )

    total = len(requirement_mapping)

    if total == 0:
        coverage = 0
    else:
        coverage = (
            (complete + 0.5 * partial) / total
        ) * 100

    # Determine project health
    if coverage >= 70 and not missing:
        health_status = "ON_TRACK"

    elif coverage < 40 or missing > 2:
        health_status = "BEHIND"

    else:
        health_status = "AT_RISK"

    weekly_claim_mapping = _map_weekly_claims(
        weekly_report,
        requirement_mapping
    )

    return {
        "requirementMapping": requirement_mapping,

        "weeklyReport": weekly_report,
        "weeklyClaimMapping": weekly_claim_mapping,

        "coverage": round(coverage, 2),

        "completeRequirements": complete,
        "partialRequirements": partial,
        "missingRequirements": missing,

        "healthStatus": health_status,

        "techStack": github_analysis.get(
            "techStack",
            repo_data.get("languages", {})
        ),

        "testsPresent": github_analysis.get(
            "testsPresent",
            repo_data.get("has_tests", False)
        ),

        "documentationPresent": github_analysis.get(
            "documentationPresent",
            bool(repo_data.get("readme"))
        ),

        "lastPush": repo_data.get("last_push"),

        "repository": repo_data.get("name"),
    }


def _map_weekly_claims(weekly_report, requirement_mapping):
    if not weekly_report:
        return []

    claims = weekly_report.get("workCompleted", [])
    if not isinstance(claims, list):
        return []

    mappings = []
    for claim in claims:
        if not isinstance(claim, str):
            continue

        claim_terms = _evidence_terms(claim)
        best_match = None
        best_score = 0

        for requirement in requirement_mapping:
            requirement_text = " ".join(
                str(requirement.get(field, ""))
                for field in ("criterion", "requirement")
            )
            overlap = claim_terms & _evidence_terms(requirement_text)
            if len(overlap) > best_score:
                best_match = requirement
                best_score = len(overlap)

        if best_match is None:
            mappings.append({
                "claim": claim,
                "status": "UNSUPPORTED",
                "matchedRequirement": None,
                "githubEvidence": "",
                "reviewNote": (
                    "No matching GitHub evidence was identified; this is not "
                    "a misconduct finding and should be reviewed by the professor."
                ),
            })
            continue

        requirement_status = best_match.get("status")
        if requirement_status == "COMPLETE":
            claim_status = "SUPPORTED"
        elif requirement_status == "PARTIAL":
            claim_status = "PARTIAL"
        else:
            claim_status = "UNSUPPORTED"

        mappings.append({
            "claim": claim,
            "status": claim_status,
            "matchedRequirement": best_match.get("requirement"),
            "githubEvidence": best_match.get("evidence", ""),
            "reviewNote": (
                "This status reflects available repository evidence only; "
                "unsupported claims are not misconduct findings."
            ),
        })

    return mappings


def _evidence_terms(text):
    stop_words = {
        "a", "an", "and", "are", "as", "at", "by", "for", "from",
        "i", "in", "into", "is", "it", "of", "on", "or", "the",
        "this", "to", "was", "we", "with", "week", "will", "completed",
        "complete", "implement", "implemented", "build", "built", "work",
        "provide", "provided", "create", "created",
    }
    aliases = {
        "api": "api",
        "endpoint": "api",
        "endpoints": "api",
        "route": "api",
        "routes": "api",
        "prediction": "predict",
        "predictions": "predict",
        "predicting": "predict",
        "tests": "test",
        "testing": "test",
        "automated": "test",
        "database": "database",
        "databases": "database",
        "db": "database",
        "postgres": "database",
        "postgresql": "database",
        "mysql": "database",
        "sqlite": "database",
        "authentication": "auth",
        "auth": "auth",
        "login": "auth",
        "models": "model",
        "trained": "train",
        "training": "train",
    }

    terms = set()
    for term in re.findall(r"[a-z0-9]+", text.lower()):
        if term in stop_words:
            continue
        if term.endswith("s") and len(term) > 4:
            term = term[:-1]
        terms.add(aliases.get(term, term))
    return terms