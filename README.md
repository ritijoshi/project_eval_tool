# Agentic Virtual Classroom

This application uses a robust microservices architecture spanning three interconnected servers.

## Demo and Viva Preparation

For the complete project explanation, live demo sequence, architecture summary,
and likely professor questions with answers, see
[PROJECT_DEMO_AND_VIVA_GUIDE.md](PROJECT_DEMO_AND_VIVA_GUIDE.md).

## How to Run the Project Locally
To start the entire application in a **single terminal window**, you can use the super convenient root command:

### Quick Start
Open a single terminal at `C:\project_eval_tool` and run:
```bash
npm install
npm start
```
This single command uses `concurrently` to automatically boot up the Frontend, Node.js Backend, and Python AI Engine, displaying all their logs color-coded in one place!

## AI Service Configuration (Groq + Ollama + Free Embeddings)

The AI microservice now uses:
- Groq-hosted LLMs (Llama 3 / Mixtral)
- Ollama (`qwen3:4b`) as a local fallback for zero-cost inference
- Free local embeddings via HuggingFace sentence-transformers for RAG

### Provider environment variables

Groq is optional. Set it if you want Groq tried first:

```bash
GROQ_API_KEY=your_groq_api_key
```

For zero-cost local-only inference, omit `GROQ_API_KEY` and keep Ollama enabled.
The existing `OPENAI_API_KEY` is not used as an assignment-evaluation fallback.

### Optional environment variables

```bash
# Groq is tried first when GROQ_API_KEY is configured.
GROQ_MODEL=openai/gpt-oss-20b

# Ollama is used when Groq daily quota/authentication fails or is not configured.
OLLAMA_ENABLED=true
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:4b

# Default embedding model is sentence-transformers/all-MiniLM-L6-v2
HF_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
```

Ollama is never replaced by OpenAI automatically. Start it before the application:

```powershell
ollama serve
ollama run qwen3:4b
```

The evaluator sends one local request at a time for batch submissions. It validates every
criterion score against the rubric and makes one bounded JSON repair attempt; invalid output
is recorded as a failed submission rather than fabricated. To verify fallback end to end,
keep Ollama running, temporarily use an exhausted/invalid Groq key (or unset `GROQ_API_KEY`),
start the application with `npm start`, submit a rubric and ZIP, and confirm the session
progresses through `EVALUATING` and stores completed results or explicit failed results.

### Assistant capabilities implemented
- Course-material grounded answers using RAG (FAISS + HuggingFace embeddings)
- Conversational memory across turns (client history + server-side session memory)
- Adaptive teaching depth using auto student-level detection (beginner/intermediate/advanced)
- Professor-style response shaping, including reuse of example patterns from uploaded notes

---

## Backend Setup (Database Persistence)
The backend is pre-configured to use **MongoDB** for real data storage.

### Linking your MongoDB Atlas Cloud DB:
If you want accounts to persist from anywhere on any device, you need to provide your free hosted database URL:

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and create a free account & Free Cluster.
2. Create a Database User and whitelist your IP (or `0.0.0.0/0` for universal testing).
3. Click **Connect** and choose **Drivers** (Node.js) to get your connection string.
4. In this project, open: `c:\GenAI-Agent\backend\.env`
5. Replace `MONGO_URI` with your connection string:
   `MONGO_URI=mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/virtual-classroom?retryWrites=true&w=majority`
6. Restart the Node.js backend server!

You can now click **"Create Account"** on the Frontend UI, and it will permanently save to your cloud!
