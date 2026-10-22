# Assignment evaluation integration test

This procedure uses real files and a real provider request. Unit tests with
mocked responses are separate and must not be described as provider tests.

## Configuration

1. Copy `ai_service/.env.example` to `ai_service/.env`.
2. Set `GROQ_API_KEY` to a valid key. Keep it server-side.
3. Set `GROQ_MODEL` to a model enabled for the account and JSON mode.
4. Copy `backend/.env.example` to `backend/.env`.
5. Set `MONGO_URI`, `JWT_SECRET`, and `AI_SERVICE_URL`.
6. Run the safe diagnostic:

```powershell
& .venv\Scripts\python.exe ai_service\diagnose_config.py --env-file ai_service\.env
```

The command reports only booleans, model names, and capability flags. It does
not print keys.

## Test inputs

The UI batch endpoint expects:

- One rubric file in the `rubric` multipart field.
- One ZIP file in the `submissions` multipart field.
- The ZIP may contain a student folder with one or more supported files,
  including `.ipynb`, `.pdf`, `.docx`, `.md`, `.txt`, and source-code files.
- Multiple files under one top-level student folder are evaluated as one
  submission.

The assignment is selected in the frontend before upload. The uploaded rubric
is authoritative for criterion names and maximum marks.

## One-student test

1. Start MongoDB, the AI service on port 8000, the backend on port 5000, and
   the frontend on port 5173.
2. Upload a rubric and ZIP containing exactly one student.
3. Record the returned session ID.
4. Poll:

```text
GET /api/assignment-eval/<sessionId>/results
```

5. Confirm:
   - The session reaches `COMPLETED` or `PARTIAL`.
   - The student result is `COMPLETED`.
   - Criterion scores are within their rubric maxima.
   - The overall score equals the sum of criterion scores.
   - The maximum score equals the rubric total.
   - Feedback and evidence refer to the submitted file.
6. Confirm the same result is returned after refreshing the dashboard.
7. Download the Excel report and compare its criterion columns and total with
   the API response.

## Failure checks

Repeat with a missing key, invalid model, malformed mock response, empty
submission, and a ZIP containing an unsafe `../` path. These must produce a
specific failed result or rejected request; none may produce a fabricated
completed score.

## Required evidence for completion

Record the provider model, session ID, number discovered, completed, and
failed, API result payload (with secrets removed), database result count, and
Excel export result. A mocked unit test does not satisfy the real-provider
requirement.
