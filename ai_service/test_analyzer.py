from project_evaluation.utils.github_client import get_repo_data
from project_evaluation.agents.github_analyzer import analyze_github_repo


REPO_URL = "https://github.com/ritijoshi/josaa_ml_counsellor"


rubric = {
    "projectGoal": (
        "Build an ML based college prediction application "
        "with a trained model, data processing pipeline, "
        "web API, database and testing."
    ),

    "criteria": [
        {
            "name": "Machine Learning Model",
            "requirements": [
                "Train a machine learning model",
                "Use appropriate preprocessing",
                "Save the trained model for inference"
            ]
        },
        {
            "name": "API",
            "requirements": [
                "Provide an API for predictions"
            ]
        },
        {
            "name": "Database",
            "requirements": [
                "Store and retrieve application data using a database"
            ]
        },
        {
            "name": "Testing",
            "requirements": [
                "Write tests for the application"
            ]
        },
        {
            "name": "Documentation",
            "requirements": [
                "Provide documentation explaining the project"
            ]
        }
        
    ]
}


print("Fetching repository...")
repo_data = get_repo_data(REPO_URL, rubric=rubric)

print("Analyzing repository...")
result = analyze_github_repo(repo_data, rubric)

print("\n=== REQUIREMENT RESULTS ===")

for item in result["requirementMapping"]:
    print("\nCriterion:", item["criterion"])
    print("Requirement:", item["requirement"])
    print("Status:", item["status"])
    print("Evidence:", item["evidence"])
    print("Reason:", item["reason"])

print("\n=== SUMMARY ===")
print("Tech Stack:", result["techStack"])
print("Tests:", result["testsPresent"])
print("Documentation:", result["documentationPresent"])
print("Quality:", result["overallRepositoryQuality"])
