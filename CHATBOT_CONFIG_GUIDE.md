# Chatbot Configuration Guide

## Issue Fixed
The chatbot was returning mock/template responses instead of meaningful answers. This has been improved with better fallback responses that actually extract and present course materials.

## Current Behavior

### 🟢 Without GROQ API Key (Current Default)
The chatbot now provides **intelligent fallback responses** that:
- ✅ Extract relevant course materials matching your question
- ✅ Display material chunks from uploaded course content
- ✅ Adapt responses to student level (Beginner/Intermediate/Advanced)
- ✅ Include professor's teaching style guidelines
- ✅ Suggest related course materials for deeper learning

**This works offline without needing API keys!**

### 🔵 With GROQ API Key (Recommended)
For the most advanced AI-powered responses:
- ✅ Full natural language understanding
- ✅ Context-aware RAG-based answers
- ✅ Professor-style teaching mimicry
- ✅ Multi-turn conversation memory
- ✅ Smart follow-up suggestions

## Setup Instructions

### Step 1: Get a GROQ API Key
1. Visit [Groq Console](https://console.groq.com)
2. Sign up for a free account
3. Navigate to **API Keys** section
4. Copy your API key (starts with `gsk-`)

### Step 2: Configure the Environment

#### Option A: Create `.env` file (Recommended for Development)
Create a file at `ai_service/.env`:

```env
# Get from https://console.groq.com/keys
GROQ_API_KEY=gsk-your-actual-api-key-here

# Optional: For OpenAI embeddings (production RAG)
OPENAI_API_KEY=sk-your-openai-key-here

# Audio transcription model (base/small/medium/large)
WHISPER_MODEL=base
```

#### Option B: Set System Environment Variables
On **Windows PowerShell**:
```powershell
$env:GROQ_API_KEY="gsk-your-actual-api-key-here"
$env:OPENAI_API_KEY="sk-your-openai-key-here"
```

On **Linux/Mac**:
```bash
export GROQ_API_KEY="gsk-your-actual-api-key-here"
export OPENAI_API_KEY="sk-your-openai-key-here"
```

### Step 3: Restart the AI Service
```bash
# Kill current service if running (Ctrl+C in the terminal)

# Restart with activated environment
cd ai_service
. .venv/Scripts/Activate  # Windows
python main.py
```

## Testing the Setup

### Test Connection
```bash
curl http://localhost:8000/health
curl http://localhost:8000/ready
```

Expected response:
```json
{
  "status": "ready",
  "dependencies": {
    "llm_available": true,
    "groq_key_configured": true,
    "openai_key_configured": true,
    "vectors_available": true
  }
}
```

### Test Chat Endpoint
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "dummy_test_connection"
  }'
```

Expected: `{"reply":"Agent Microservice is ALIVE and connected."}`

## Troubleshooting

### Symptom: Still getting generic responses
**Cause:** API key not loaded or invalid  
**Fix:**
1. Verify `.env` file exists in `ai_service/` directory
2. Check API key doesn't have typos
3. Restart Python service after creating/editing `.env`
4. Verify with: `curl http://localhost:8000/ready` and check `llm_available: true`

### Symptom: "Course materials not found" message
**Cause:** No materials uploaded to that course  
**Fix:**
1. Go to Student Dashboard
2. Upload PDF/DOC materials via Professor Materials Uploader
3. Wait for processing to complete
4. Try asking again

### Symptom: Connection refused to ai_service
**Cause:** Python service not running  
**Fix:**
```bash
cd c:\genAI\GenAI-Agent\ai_service
. .venv\Scripts\Activate
python main.py
# Should see: "Uvicorn running on http://127.0.0.1:8000"
```

### Symptom: "The AI Microservice is currently offline" message
**Cause:** Backend can't connect to Python service  
**Fix:**
1. Ensure Python service is running on port 8000
2. Check `backend/.env` has correct `AI_SERVICE_URL=http://localhost:8000`
3. Verify firewall allows localhost:8000 access
4. Check backend logs for details

## Performance Notes

- **First request:** May take 5-10 seconds while service loads models
- **Subsequent requests:** Usually 2-3 seconds response time
- **Groq API:** Rate limited to prevent abuse
- **Course materials:** Indexed automatically on first upload

## Free vs Paid

**GROQ (Always Free)**
- 30 requests/minute (free tier)
- Unlimited inference tokens
- Perfect for educational use

**OpenAI (Optional, Paid)**
- Currently uses GROQ LLM, not OpenAI
- Can be added for premium embeddings later
- ~$0.01-0.05 per 1K tokens

## Architecture

```
Frontend (React)
    ↓ /api/student/course-chat
Backend (Node.js/Express)
    ↓ axios.post(AI_SERVICE_URL/course/chat)
AI Service (Python/FastAPI)
    ├─ retrieve_course_context() → FAISS/JSON chunks
    ├─ system_prompt + chat history
    └─ ChatGroq LLM → natural language response
```

## Next Steps

1. ✅ Upload course materials (PDF/DOCX)
2. ✅ Configure GROQ API key (or use fallback)
3. ✅ Test chatbot with a question
4. ✅ Monitor `/ready` endpoint for health status

---

**Questions?** Check the [API Architecture Guide](./API_ARCHITECTURE.md) or [WebSocket Guide](./WEBSOCKET_IMPLEMENTATION_GUIDE.md)
