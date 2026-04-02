# Agentic Virtual Classroom

This application uses a robust microservices architecture spanning three interconnected servers.

## How to Run the Project Locally
To start the entire application in a **single terminal window**, you can use the super convenient root command:

### Quick Start
Open a single terminal at `C:\GenAI-Agent` and run:
```bash
npm install
npm start
```
This single command uses `concurrently` to automatically boot up the Frontend, Node.js Backend, and Python AI Engine, displaying all their logs color-coded in one place!

## AI Service Configuration (Groq + Free Embeddings)

The AI microservice now uses:
- Groq-hosted LLMs (Llama 3 / Mixtral)
- Free local embeddings via HuggingFace sentence-transformers for RAG

### Required environment variable
Set this before starting the Python service:

```bash
GROQ_API_KEY=your_groq_api_key
```

### Optional environment variables

```bash
# Default model is llama3-8b-8192
GROQ_MODEL=llama3-8b-8192

# Default embedding model is sentence-transformers/all-MiniLM-L6-v2
HF_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
```

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
