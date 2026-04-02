from dotenv import load_dotenv
from pathlib import Path
load_dotenv(dotenv_path=Path(__file__).parent / ".env")
import os
import shutil
import json
import re
import zipfile
from datetime import datetime
import xml.etree.ElementTree as ET
from typing import List, Dict, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pdfplumber

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "ai-service",
    }


@app.get("/ready")
async def readiness_check():
    openai_key = os.environ.get("OPENAI_API_KEY")
    groq_key = os.environ.get("GROQ_API_KEY")
    print(f"DEBUG GROQ KEY: '{groq_key}'")  
    return {
        "status": "ready",
        "dependencies": {
            "vectors_available": VECTORS_AVAILABLE,
            "llm_available": LLM_AVAILABLE,
            "openai_key_configured": bool(openai_key) and openai_key != "sk-placeholder",
            "groq_key_configured": bool(groq_key) and groq_key != "gsk-placeholder",
        },
    }


FAISS_INDEX_PATH = "faiss_index"

COURSE_FAISS_ROOT = "course_faiss_indexes"
COURSE_STYLE_ROOT = "course_profiles"
COURSE_CHUNKS_ROOT = "course_chunks"

os.makedirs(COURSE_FAISS_ROOT, exist_ok=True)
os.makedirs(COURSE_STYLE_ROOT, exist_ok=True)
os.makedirs(COURSE_CHUNKS_ROOT, exist_ok=True)

class ChatRequest(BaseModel):
    message: str
    professor_style: str = "Focus on practical examples, encourage students to read documentations, and explain concepts step-by-step."
    student_level: str = "intermediate"
    history: List[Dict[str, str]] = []

class ChatResponse(BaseModel):
    reply: str

class PersonalizeRequest(BaseModel):
    quiz_scores: Dict[str, int]
    weak_topics: List[str]
    recent_interactions: List[str]

class PersonalizeResponse(BaseModel):
    next_best_topic: str
    topics_to_revise: List[str]
    practice_questions: List[str]
    adaptive_message: str

class EvalRequest(BaseModel):
    submission_text: str
    rubric: str

class CriterionResult(BaseModel):
    criterion: str
    weight: int
    score: int
    evidence: str
    rationale: str

class EvalResponse(BaseModel):
    score: str
    strengths: List[str]
    weaknesses: List[str]
    suggestions: List[str]
    explanation: str
    criterion_breakdown: List[CriterionResult] = []

# Robust Import Block
VECTORS_AVAILABLE = False
LLM_AVAILABLE = False

try:
    from langchain_community.document_loaders import PyPDFLoader, Docx2txtLoader
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    from langchain_huggingface import HuggingFaceEmbeddings
    from langchain_community.vectorstores import FAISS
    from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
    from langchain_core.runnables import RunnablePassthrough
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.messages import HumanMessage, AIMessage
    from langchain_core.output_parsers import JsonOutputParser
    VECTORS_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Vector / embedding integration unavailable ({e}). Fallback Mock AI active.")

try:
    from langchain_groq import ChatGroq
    LLM_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Groq LLM integration unavailable ({e}). Mock AI will be used.")

def get_vector_store():
    if not VECTORS_AVAILABLE: return None
    embeddings = HuggingFaceEmbeddingsEmbeddings()
    if os.path.exists(FAISS_INDEX_PATH):
        return FAISS.load_local(FAISS_INDEX_PATH, embeddings, allow_dangerous_deserialization=True)
    return None

@app.post("/upload")
async def upload_material(file: UploadFile = File(...)):
    if not file.filename.endswith(('.pdf', '.docx', '.pptx')):
        raise HTTPException(status_code=400, detail="Invalid file type. Send standard course materials.")

    file_location = f"temp_{file.filename}"
    with open(file_location, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    if not VECTORS_AVAILABLE:
        os.remove(file_location)
        return {"message": "[MOCK] Document uploaded safely. LangChain pipeline bypassed due to local dependencies."}

    documents = []
    try:
        if file.filename.endswith('.pdf'):
            loader = PyPDFLoader(file_location)
            documents = loader.load()
        elif file.filename.endswith('.docx'):
            loader = Docx2txtLoader(file_location)
            documents = loader.load()
            
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
        chunks = text_splitter.split_documents(documents)
        
        embeddings = HuggingFaceEmbeddings()
        if os.path.exists(FAISS_INDEX_PATH):
            vector_store = FAISS.load_local(FAISS_INDEX_PATH, embeddings, allow_dangerous_deserialization=True)
            vector_store.add_documents(chunks)
        else:
            vector_store = FAISS.from_documents(chunks, embeddings)
            
        vector_store.save_local(FAISS_INDEX_PATH)
        
    except Exception as e:
        if os.path.exists(file_location): os.remove(file_location)
        raise HTTPException(status_code=500, detail=str(e))
        
    os.remove(file_location)
    return {"message": "Document processed, chunked, and stored into FAISS vector space successfully."}

@app.post("/chat", response_model=ChatResponse)
async def chat_with_agent(req: ChatRequest):
    if req.message == "dummy_test_connection":
        return ChatResponse(reply="Agent Microservice is ALIVE and connected.")
        
    if not VECTORS_AVAILABLE:
        # Graceful fallback logic so UI remains functional
        fallback_reply = (
            f"🧠 **Course Agent Response Mode**: "
            f"You asked: '{req.message}'. "
            f"\\n\\nSince the vector database isn't available, I can still help based on general knowledge. "
            f"\\n\\nProfessor's Teaching Style: {req.professor_style[:200]}... "
            f"\\n\\nYour Level: {req.student_level}. "
            f"\\n\\nFor better, course-specific answers, please make sure materials are uploaded to the course and try asking again."
        )
        return ChatResponse(reply=fallback_reply)

    vector_store = get_vector_store()
    if not vector_store:
        return ChatResponse(reply="I am your Course Agent. Please upload the syllabus and course materials so I can study them for context!")

    retriever = vector_store.as_retriever(search_kwargs={"k": 4})
    
    # 2. Advanced Prompt Engineering
    system_prompt = (
        "You are an expert AI teaching assistant answering contextually about this material: {context}\n\n"
        "Your Goals:\n"
        f"1. Mimic the Professor's Style: {req.professor_style}\n"
        f"2. Adapt to Student Level: The student is a '{req.student_level}'. Adjust your explanation depth. "
        "If beginner, use analogies and simple definitions. If intermediate/advanced, go deeper into technical specifics.\n"
        "3. Use memory context from the chat history if needed.\n\n"
        "If the answer isn't in the context, gently guide the student toward standard learning resources in character."
    )
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        MessagesPlaceholder(variable_name="chat_history"),
        ("human", "{input}")
    ])
    
    try:
        # Mock mode if Groq isn't available or API key is placeholder.
        if (not LLM_AVAILABLE) or os.environ.get("GROQ_API_KEY") == "gsk-placeholder":
            docs = retriever.invoke(req.message)
            source_content = docs[0].page_content if docs else "No specific documents found."
            
            # Improved mock response
            mock_reply = (
                f"**Course Material Found**\\n\\n"
                f"Your question: \"{req.message}\"\\n\\n"
                f"**Relevant Course Content:**\\n{source_content[:400]}...\\n\\n"
                f"**Teaching Style:** {req.professor_style[:150]}...\\n\\n"
                f"**For {req.student_level} level students:** "
                f"Review the material above, break it down into key concepts, and practice with examples."
            )
            return ChatResponse(reply=mock_reply)

        # 3. Groq LLM (Llama 3 8b or Mixtral)
        llm = ChatGroq(model_name="llama3-8b-8192", temperature=0.7)
            
        # 4. Langchain Memory Generation
        chat_history_messages = []
        for msg in req.history:
            if msg.get("sender") == "user":
                chat_history_messages.append(HumanMessage(content=msg.get("text", "")))
            elif msg.get("sender") == "agent":
                chat_history_messages.append(AIMessage(content=msg.get("text", "")))

        rag_chain = (
            {"context": retriever, "input": RunnablePassthrough()}
            | prompt
            | llm
            | StrOutputParser()
        )
        
        response = rag_chain.invoke(req.message)
        return ChatResponse(reply=response)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

############################################################
# Course-specific RAG (professor uploads -> per-course FAISS)
############################################################

class CourseChatRequest(BaseModel):
    course_key: str
    message: str
    professor_style: Optional[str] = None
    student_level: str = "intermediate"
    history: List[Dict[str, str]] = []

class WeeklyUpdateRequest(BaseModel):
    course_key: str
    week_label: str = "Weekly Update"
    new_topics: List[str] = []
    announcements: List[str] = []
    revised_expectations: List[str] = []
    update_text: str = ""

def normalize_course_key(course_key: str) -> str:
    s = str(course_key).strip().lower()
    s = re.sub(r"[^a-z0-9\\-_]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "default"

def huggingface_embeddings_enabled() -> bool:
    if not VECTORS_AVAILABLE:
        return False
    return True

def groq_llm_enabled() -> bool:
    if not LLM_AVAILABLE:
        return False
    groq_key = os.environ.get("GROQ_API_KEY")
    return bool(groq_key) and groq_key != "gsk-placeholder"

def course_style_path(course_key: str) -> str:
    return os.path.join(COURSE_STYLE_ROOT, f"{course_key}.json")

def course_chunks_path(course_key: str) -> str:
    return os.path.join(COURSE_CHUNKS_ROOT, f"{course_key}.json")

def course_faiss_path(course_key: str) -> str:
    return os.path.join(COURSE_FAISS_ROOT, course_key)

def load_course_style(course_key: str) -> str:
    try:
        p = course_style_path(course_key)
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            return str(data.get("teaching_style", "") or "")
    except Exception:
        pass
    return ""

def save_course_style(course_key: str, teaching_style: str) -> None:
    p = course_style_path(course_key)
    with open(p, "w", encoding="utf-8") as f:
        json.dump({ "teaching_style": teaching_style or "" }, f)

def tokenize_for_scoring(text: str) -> List[str]:
    return re.findall(r"[a-zA-Z0-9]+", str(text).lower())

def split_text_into_chunks(text: str, chunk_size: int = 1000, chunk_overlap: int = 200) -> List[str]:
    cleaned = re.sub(r"\\s+", " ", str(text)).strip()
    if not cleaned:
        return []

    # Use LangChain splitter when available; otherwise fallback to a simple sliding window.
    if VECTORS_AVAILABLE and "RecursiveCharacterTextSplitter" in globals():
        splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
        return splitter.split_text(cleaned)

    step = max(1, chunk_size - chunk_overlap)
    chunks = []
    for i in range(0, len(cleaned), step):
        chunk = cleaned[i : i + chunk_size]
        if chunk:
            chunks.append(chunk)
    return chunks

def extract_text_from_file(file_location: str, filename: str) -> str:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        texts = []
        with pdfplumber.open(file_location) as pdf:
            for page in pdf.pages:
                t = page.extract_text() or ""
                if t:
                    texts.append(t)
        return "\\n".join(texts).strip()

    if lower.endswith(".docx"):
        try:
            from docx import Document
            doc = Document(file_location)
            return "\\n".join([p.text for p in doc.paragraphs if p.text]).strip()
        except Exception:
            # Fallback: extract raw XML text runs (works without python-docx).
            try:
                with zipfile.ZipFile(file_location) as z:
                    xml_bytes = z.read("word/document.xml")
                root = ET.fromstring(xml_bytes)
                texts = []
                for node in root.iter():
                    # Most Word runs store text in w:t
                    if node.tag.endswith("}t") and node.text:
                        texts.append(node.text)
                cleaned = "\\n".join(texts).strip()
                if cleaned:
                    return cleaned
            except Exception:
                pass

            # Fallback to LangChain loader if available.
            if VECTORS_AVAILABLE and "Docx2txtLoader" in globals():
                loader = Docx2txtLoader(file_location)
                docs = loader.load()
                return "\\n".join([d.page_content for d in docs]).strip()
            return ""

    if lower.endswith(".pptx"):
        try:
            from pptx import Presentation
            prs = Presentation(file_location)
            parts = []
            for slide in prs.slides:
                for shape in slide.shapes:
                    if hasattr(shape, "text") and shape.text:
                        parts.append(shape.text)
            return "\\n".join(parts).strip()
        except Exception:
            # Fallback: extract slide XML texts directly from the pptx zip.
            try:
                with zipfile.ZipFile(file_location) as z:
                    slide_xml_files = [n for n in z.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml")]
                    parts = []
                    for name in slide_xml_files:
                        xml_bytes = z.read(name)
                        root = ET.fromstring(xml_bytes)
                        for node in root.iter():
                            # Text is commonly in a:t
                            if node.tag.endswith("}t") and node.text:
                                parts.append(node.text)
                    cleaned = "\\n".join(parts).strip()
                    if cleaned:
                        return cleaned
            except Exception:
                pass
            return ""

    if lower.endswith((".mp3", ".wav", ".m4a")):
        # Audio transcription is optional; supported when openai-whisper is installed.
        try:
            import whisper
            model_name = os.environ.get("WHISPER_MODEL", "base")
            model = whisper.load_model(model_name)
            result = model.transcribe(file_location)
            return str(result.get("text", "")).strip()
        except Exception:
            return ""

    return ""

def append_chunks_offline(course_key: str, new_items: List[Dict[str, str]]) -> None:
    p = course_chunks_path(course_key)
    existing = []
    if os.path.exists(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                existing = json.load(f) or []
        except Exception:
            existing = []
    existing.extend(new_items)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(existing, f)

def course_faiss_exists(course_key: str) -> bool:
    p = course_faiss_path(course_key)
    return os.path.exists(p) and len(os.listdir(p)) > 0

def add_chunks_to_course_faiss(course_key: str, chunks: List[str], metadatas: List[Dict]) -> None:
    if not huggingface_embeddings_enabled():
        return

    embeddings = HuggingFaceEmbeddings()
    path = course_faiss_path(course_key)

    if course_faiss_exists(course_key):
        vector_store = FAISS.load_local(path, embeddings, allow_dangerous_deserialization=True)
        vector_store.add_texts(chunks, metadatas=metadatas)
    else:
        vector_store = FAISS.from_texts(chunks, embeddings, metadatas=metadatas)

    vector_store.save_local(path)

def retrieve_course_context(course_key: str, query: str, k: int = 4) -> List[str]:
    course_key = normalize_course_key(course_key)

    # Prefer FAISS retrieval when embeddings are enabled.
    if huggingface_embeddings_enabled() and course_faiss_exists(course_key):
        try:
            embeddings = HuggingFaceEmbeddings()
            vector_store = FAISS.load_local(course_faiss_path(course_key), embeddings, allow_dangerous_deserialization=True)
            docs = vector_store.similarity_search(query, k=k)
            return [d.page_content for d in docs if getattr(d, "page_content", None)]
        except Exception:
            pass

    # Offline fallback: naive token overlap scoring.
    try:
        p = course_chunks_path(course_key)
        if not os.path.exists(p):
            return []
        with open(p, "r", encoding="utf-8") as f:
            items = json.load(f) or []

        q_tokens = set(tokenize_for_scoring(query))
        if not q_tokens:
            return [items[i].get("text", "") for i in range(min(k, len(items)))]

        scored = []
        for it in items:
            t = str(it.get("text", "") or "")
            chunk_tokens = set(tokenize_for_scoring(t))
            score = len(q_tokens.intersection(chunk_tokens))
            scored.append((score, t))
        scored.sort(key=lambda x: x[0], reverse=True)
        top = [t for s, t in scored[:k] if t]
        return top
    except Exception:
        return []

def parse_rubric_criteria(rubric_text: str) -> List[Dict[str, int]]:
    rubric = str(rubric_text or "").strip()
    if not rubric:
        return [
            {"criterion": "Clarity", "weight": 30},
            {"criterion": "Technical Accuracy", "weight": 40},
            {"criterion": "Completeness", "weight": 30},
        ]

    # Supports patterns like: "Clarity (20%)" or "1. Accuracy 50%".
    matches = re.findall(r"(?:\d+[.)]\s*)?([^\n,;]+?)\s*\(?\s*(\d{1,3})\s*%\s*\)?", rubric)
    criteria = []
    for name, weight_str in matches:
        criterion = re.sub(r"\s+", " ", name).strip(" -:\t")
        if not criterion:
            continue
        weight = max(1, min(100, int(weight_str)))
        criteria.append({"criterion": criterion, "weight": weight})

    if not criteria:
        lines = [re.sub(r"\s+", " ", ln).strip() for ln in re.split(r"\n+", rubric) if ln.strip()]
        if not lines:
            lines = ["Clarity", "Technical Accuracy", "Completeness"]
        equal = max(1, int(round(100 / len(lines))))
        criteria = [{"criterion": ln[:80], "weight": equal} for ln in lines[:6]]

    total = sum(c["weight"] for c in criteria)
    if total <= 0:
        return [
            {"criterion": "Clarity", "weight": 30},
            {"criterion": "Technical Accuracy", "weight": 40},
            {"criterion": "Completeness", "weight": 30},
        ]

    # Normalize to exactly 100.
    normalized = []
    acc = 0
    for i, c in enumerate(criteria):
        if i == len(criteria) - 1:
            w = max(1, 100 - acc)
        else:
            w = max(1, int(round(c["weight"] * 100.0 / total)))
            acc += w
        normalized.append({"criterion": c["criterion"], "weight": w})

    # Fix possible overflow after rounding.
    overflow = sum(x["weight"] for x in normalized) - 100
    if overflow > 0:
        normalized[-1]["weight"] = max(1, normalized[-1]["weight"] - overflow)
    return normalized

def summarize_submission_signal(submission_text: str) -> Dict[str, int]:
    text = str(submission_text or "")
    words = re.findall(r"\w+", text)
    lines = text.splitlines()
    code_blocks = len(re.findall(r"```", text)) // 2
    headings = len(re.findall(r"^#{1,6}\s+", text, flags=re.MULTILINE))
    references = len(re.findall(r"\b(reference|citation|source|docs?)\b", text, flags=re.IGNORECASE))
    examples = len(re.findall(r"\b(example|for instance|e\.g\.)\b", text, flags=re.IGNORECASE))
    return {
        "word_count": len(words),
        "line_count": len(lines),
        "code_blocks": code_blocks,
        "headings": headings,
        "references": references,
        "examples": examples,
    }

def deterministic_anchor_score(criteria: List[Dict[str, int]], submission_text: str) -> int:
    signals = summarize_submission_signal(submission_text)
    quality = 0
    quality += 25 if signals["word_count"] >= 250 else 12 if signals["word_count"] >= 120 else 5
    quality += 20 if signals["code_blocks"] >= 2 else 10 if signals["code_blocks"] == 1 else 6
    quality += 15 if signals["headings"] >= 2 else 8 if signals["headings"] == 1 else 5
    quality += 20 if signals["references"] >= 2 else 10 if signals["references"] == 1 else 4
    quality += 20 if signals["examples"] >= 2 else 10 if signals["examples"] == 1 else 5
    return max(35, min(95, quality))

def fallback_eval(criteria: List[Dict[str, int]], submission_text: str) -> EvalResponse:
    anchor = deterministic_anchor_score(criteria, submission_text)
    breakdown = []
    for c in criteria:
        breakdown.append(CriterionResult(
            criterion=c["criterion"],
            weight=c["weight"],
            score=anchor,
            evidence="Fallback heuristic based on submission structure and content density.",
            rationale="LLM unavailable, score anchored by deterministic rubric heuristic.",
        ))

    return EvalResponse(
        score=f"{anchor}/100",
        strengths=["Submission has usable structure for rubric-based review."],
        weaknesses=["Detailed criterion-level semantic analysis is unavailable in fallback mode."],
        suggestions=["Add more explicit evidence per rubric criterion."],
        explanation="Deterministic fallback evaluation generated without model randomness.",
        criterion_breakdown=breakdown,
    )

def coerce_score_0_100(value: object, default: int = 70) -> int:
    s = str(value or "").strip()
    frac = re.match(r"(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)", s)
    if frac:
        num = float(frac.group(1))
        den = float(frac.group(2))
        if den > 0:
            return max(0, min(100, int(round((num / den) * 100))))
    pct = re.match(r"(\d+(?:\.\d+)?)\s*%", s)
    if pct:
        return max(0, min(100, int(round(float(pct.group(1))))))
    try:
        n = int(round(float(s)))
        return max(0, min(100, n))
    except Exception:
        return max(0, min(100, int(default)))

def evaluate_submission_core(submission_text: str, rubric: str) -> EvalResponse:
    criteria = parse_rubric_criteria(rubric)

    if not LLM_AVAILABLE or os.environ.get("GROQ_API_KEY") == "gsk-placeholder":
        return fallback_eval(criteria, submission_text)

    llm = ChatGroq(model_name="llama-3.1-8b-instant", temperature=0.0)
    parser = JsonOutputParser(pydantic_object=EvalResponse)
    anchor = deterministic_anchor_score(criteria, submission_text)

    prompt = ChatPromptTemplate.from_messages([
        ("system", (
            "You are an expert professor evaluating a student submission against a rubric.\n"
            "Your evaluation must be explainable, evidence-based, and deterministic in style.\n"
            "Do not use random scoring. Use the rubric weights exactly and provide criterion-wise reasoning.\n\n"
            "Rubric text:\n{rubric}\n\n"
            "Parsed weighted criteria (must follow):\n{criteria_json}\n\n"
            "Deterministic anchor score (structure-only baseline): {anchor}/100\n"
            "Your final weighted score may differ from the anchor by at most +/-10 unless there is explicit strong evidence.\n\n"
            "Return ONLY valid JSON for schema:\n"
            "{format_instructions}\n\n"
            "Scoring rules:\n"
            "1) Include criterion_breakdown entries for every criterion with criterion, weight, score, evidence, rationale.\n"
            "2) score in each criterion is 0-100 integer and must reflect rubric evidence.\n"
            "3) Overall score must equal weighted average of criterion scores.\n"
            "4) explanation should justify score with concrete submission evidence."
        )),
        ("human", "Submission to evaluate:\n{submission}")
    ])

    chain = prompt | llm | parser
    result = chain.invoke({
        "rubric": rubric,
        "criteria_json": json.dumps(criteria),
        "anchor": anchor,
        "submission": submission_text,
        "format_instructions": parser.get_format_instructions(),
    })

    eval_obj = EvalResponse(**result)

    if not eval_obj.criterion_breakdown:
        return fallback_eval(criteria, submission_text)

    # Normalize criterion weights and recompute final score deterministically.
    weighted_total = 0.0
    total_weight = 0
    cleaned_breakdown = []
    for idx, c in enumerate(eval_obj.criterion_breakdown):
        weight = c.weight if c.weight and c.weight > 0 else (criteria[idx]["weight"] if idx < len(criteria) else 1)
        score = coerce_score_0_100(c.score, default=anchor)
        weighted_total += score * weight
        total_weight += weight
        cleaned_breakdown.append(CriterionResult(
            criterion=c.criterion,
            weight=weight,
            score=score,
            evidence=c.evidence,
            rationale=c.rationale,
        ))

    if total_weight <= 0:
        final_score = anchor
    else:
        final_score = int(round(weighted_total / total_weight))

    return EvalResponse(
        score=f"{final_score}/100",
        strengths=eval_obj.strengths or ["Clear attempt to address rubric criteria."],
        weaknesses=eval_obj.weaknesses or ["Some rubric areas need stronger supporting evidence."],
        suggestions=eval_obj.suggestions or ["Revise based on criterion-level feedback before resubmitting."],
        explanation=eval_obj.explanation or "Evaluation computed from rubric-weighted criterion analysis.",
        criterion_breakdown=cleaned_breakdown,
    )

@app.post("/course/upload")
async def upload_course_materials(
    course_key: str = Form(...),
    teaching_style: str = Form(""),
    files: List[UploadFile] = File(...),
):
    course_key = normalize_course_key(course_key)

    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    # Store teaching style so the assistant can mimic the professor.
    save_course_style(course_key, teaching_style)

    supported_exts = {".pdf", ".docx", ".pptx", ".mp3", ".wav", ".m4a"}
    for f in files:
        ext = os.path.splitext((f.filename or "").lower())[1]
        if ext not in supported_exts:
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {f.filename}")

    processed_files = 0
    total_chunks = 0

    # Use a temp directory per request to avoid collisions.
    temp_dir = f"temp_course_upload_{course_key}"
    os.makedirs(temp_dir, exist_ok=True)

    try:
        for uploaded in files:
            filename = uploaded.filename or "file"
            safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", filename)
            file_location = os.path.join(temp_dir, safe_name)

            with open(file_location, "wb") as buffer:
                shutil.copyfileobj(uploaded.file, buffer)

            text = extract_text_from_file(file_location, filename)
            if not text or len(text) < 30:
                raise HTTPException(status_code=400, detail=f"Could not extract enough text from {filename}")

            chunks = split_text_into_chunks(text)
            if not chunks:
                raise HTTPException(status_code=400, detail=f"No chunks produced for {filename}")

            metadatas = [
                {"source": filename, "course_key": course_key}
                for _ in range(len(chunks))
            ]

            append_chunks_offline(course_key, [{"text": c, "metadata": m} for c, m in zip(chunks, metadatas)])
            add_chunks_to_course_faiss(course_key, chunks, metadatas)

            processed_files += 1
            total_chunks += len(chunks)

    finally:
        # Best-effort cleanup.
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass

    return {
        "message": "Course materials processed and stored successfully.",
        "course_key": course_key,
        "processed_files": processed_files,
        "chunks_added": total_chunks,
        "faiss_enabled": huggingface_embeddings_enabled(),
    }

@app.get("/course/list")
async def list_courses():
    try:
        keys = []
        if os.path.exists(COURSE_STYLE_ROOT):
            for name in os.listdir(COURSE_STYLE_ROOT):
                if name.endswith(".json"):
                    keys.append(os.path.splitext(name)[0])
        keys = sorted(list(set(keys)))
        return {"courses": keys}
    except Exception:
        return {"courses": []}

@app.post("/course/weekly-update")
async def ingest_weekly_update(req: WeeklyUpdateRequest):
    course_key = normalize_course_key(req.course_key)

    new_topics = [str(x).strip() for x in (req.new_topics or []) if str(x).strip()]
    announcements = [str(x).strip() for x in (req.announcements or []) if str(x).strip()]
    revised_expectations = [str(x).strip() for x in (req.revised_expectations or []) if str(x).strip()]
    update_text = str(req.update_text or "").strip()

    if not new_topics and not announcements and not revised_expectations and not update_text:
        raise HTTPException(status_code=400, detail="Weekly update content is required")

    blocks = [f"{req.week_label or 'Weekly Update'} - {course_key}"]
    if new_topics:
        blocks.append("New Topics:\n" + "\n".join([f"- {item}" for item in new_topics]))
    if announcements:
        blocks.append("Announcements:\n" + "\n".join([f"- {item}" for item in announcements]))
    if revised_expectations:
        blocks.append("Revised Expectations:\n" + "\n".join([f"- {item}" for item in revised_expectations]))
    if update_text:
        blocks.append("Additional Notes:\n" + update_text)

    merged_text = "\n\n".join(blocks).strip()
    chunks = split_text_into_chunks(merged_text, chunk_size=800, chunk_overlap=100)
    if not chunks:
        raise HTTPException(status_code=400, detail="No chunks produced from weekly update")

    ts = datetime.utcnow().isoformat() + "Z"
    metadatas = [
        {
            "source": "weekly-update",
            "type": "weekly_update",
            "course_key": course_key,
            "week_label": str(req.week_label or "Weekly Update"),
            "timestamp": ts,
        }
        for _ in range(len(chunks))
    ]

    append_chunks_offline(course_key, [{"text": c, "metadata": m} for c, m in zip(chunks, metadatas)])
    add_chunks_to_course_faiss(course_key, chunks, metadatas)

    return {
        "message": "Weekly update ingested successfully.",
        "course_key": course_key,
        "chunks_added": len(chunks),
        "faiss_enabled": huggingface_embeddings_enabled(),
    }

@app.post("/course/chat", response_model=ChatResponse)
async def course_chat(req: CourseChatRequest):
    course_key = normalize_course_key(req.course_key)

    style_from_store = load_course_style(course_key)
    teaching_style = str(req.professor_style or "").strip() or style_from_store or ""

    context_chunks = retrieve_course_context(course_key, req.message, k=4)
    context_text = "\\n\\n---\\n\\n".join(context_chunks).strip()

    if not context_text:
        return ChatResponse(
            reply="I can help, but I don't see any course materials for this course yet. Ask your professor to upload materials first."
        )

    # If we can't use the LLM, generate a structured response from the course context
    if not groq_llm_enabled():
        # Extract key concepts from the top chunk
        top_chunk = context_chunks[0] if context_chunks else ""
        
        # Build a contextual response without needing an API key
        response_parts = [
            f"📚 **Course Material Response**\\n",
            f"Your question: \"{req.message}\"\\n"
        ]
        
        # Add the most relevant course material
        if top_chunk:
            response_parts.append(
                f"**Relevant Course Material:**\\n{top_chunk[:600]}...\\n"
            )
        
        # Add teaching guidance if available
        if teaching_style:
            response_parts.append(
                f"**Professor's Teaching Approach:**\\n{teaching_style[:300]}\\n"
            )
        
        # Add level-specific guidance
        level_guidance = {
            "beginner": "Focus on understanding the basic concepts and definitions first before diving into implementation details.",
            "intermediate": "Look at how these concepts apply in practical scenarios and explore the connections between different topics.",
            "advanced": "Consider edge cases, performance implications, and how this concept integrates with the broader system design."
        }
        
        response_parts.append(
            f"**For Your Level ({req.student_level}):**\\n{level_guidance.get(req.student_level, 'Study this material carefully.')}\\n"
        )
        
        # Add suggestions for deeper learning
        if len(context_chunks) > 1:
            response_parts.append(
                f"**Additional Course Materials Available:**\\n"
                f"- {context_chunks[1][:100]}...\\n"
                f"- {context_chunks[2][:100] if len(context_chunks) > 2 else 'More resources in your course'}\\n"
            )
        
        response_parts.append(
            "\\n💡 **Tip:** For the most advanced AI analysis, configure a GROQ API key in your .env file."
        )
        
        return ChatResponse(reply="".join(response_parts))

    # Real RAG + LLM mode.
    retriever = None
    if huggingface_embeddings_enabled() and course_faiss_exists(course_key):
        embeddings = HuggingFaceEmbeddings()
        vector_store = FAISS.load_local(course_faiss_path(course_key), embeddings, allow_dangerous_deserialization=True)
        retriever = vector_store.as_retriever(search_kwargs={"k": 4})

    # Build prompt with stored teaching style.
    system_prompt = (
        "You are an expert AI teaching assistant. Answer the student's question using the provided course context. "
        "Mimic the professor's teaching style as closely as possible.\\n\\n"
        f"Professor teaching style guidelines:\\n{teaching_style or 'Not provided.'}\\n\\n"
        "Course material context:\\n{context}\\n\\n"
        "Rules:\\n"
        "1) Explain step-by-step.\\n"
        "2) Include practical examples and analogies when helpful.\\n"
        "3) Adapt depth to the student level. If beginner, keep definitions simple; "
        "if intermediate/advanced, go deeper into technical specifics.\\n"
        "4) If the answer is not in the context, say so and suggest where in the materials to look.\\n"
        f"5) Student level: '{req.student_level}'."
    )

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        MessagesPlaceholder(variable_name="chat_history"),
        ("human", "{input}"),
    ])

    llm = ChatGroq(model_name="llama-3.1-8b-instant", temperature=0.7)

    # Generate LangChain memory messages (if any).
    chat_history_messages = []
    for msg in req.history or []:
        if VECTORS_AVAILABLE:
            if msg.get("sender") == "user":
                chat_history_messages.append(HumanMessage(content=msg.get("text", "")))
            elif msg.get("sender") == "agent":
                chat_history_messages.append(AIMessage(content=msg.get("text", "")))

    if not retriever:
        # Embeddings are disabled; fall back to stuffing the retrieved context directly.
        rag_docs = [{"page_content": c} for c in context_chunks[:4]]
        # Stuff chain expects Document objects; fallback to a simpler template reply using the first chunk.
        return ChatResponse(
            reply=(
                "I found the relevant course context, but I can't run FAISS retrieval in this environment. "
                "I'll still answer using the retrieved snippet.\\n\\n"
                f"Snippet: {context_chunks[0][:600]}..."
            )
        )

    rag_chain = (
        {
            "context": retriever, 
            "input": RunnablePassthrough(),
            "chat_history": lambda _: chat_history_messages
        }
        | prompt
        | llm
        | StrOutputParser()
    )

    response = rag_chain.invoke(req.message)
    return ChatResponse(reply=response)

@app.post("/personalize", response_model=PersonalizeResponse)
async def generate_personalization(req: PersonalizeRequest):
    if not LLM_AVAILABLE or os.environ.get("GROQ_API_KEY") == "gsk-placeholder":
        # Mock logic if AI isn't connected
        return PersonalizeResponse(
            next_best_topic="Advanced React Hooks",
            topics_to_revise=req.weak_topics if req.weak_topics else ["State Management"],
            practice_questions=[
                "How does useEffect handle dependencies?",
                "What is the difference between useMemo and useCallback?"
            ],
            adaptive_message=f"Agent Notice: Based on your recent quizzes averaging {sum(req.quiz_scores.values())/max(len(req.quiz_scores), 1)}%, let's focus on foundational concepts before moving fast."
        )

    llm = ChatGroq(model_name="llama-3.1-8b-instant", temperature=0.7)
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", (
            "You are an intelligent Course Agent that generates personalized learning paths.\n\n"
            "Given the student's data:\n"
            "Quiz Scores: {quiz_scores}\n"
            "Weak Topics: {weak_topics}\n"
            "Recent Interactions: {recent_interactions}\n\n"
            "Determine exactly:\n"
            "1. The absolute best 'Next Topic' to learn right now.\n"
            "2. A list of 2-3 topics they must revise.\n"
            "3. 2 practice questions tailored to their weak areas.\n"
            "4. A short, encouraging message outlining their adaptive difficulty scale.\n\n"
            "Return the data directly in this precise format (NO MARKDOWN OR OTHER TEXT):\n"
            "Next Best Topic: [Topic]\n"
            "Revise: [Topic 1, Topic 2]\n"
            "Questions: [Q1|Q2]\n"
            "Message: [Message]"
        ))
    ])
    
    try:
        chain = prompt | llm
        response = chain.invoke({
            "quiz_scores": str(req.quiz_scores),
            "weak_topics": ", ".join(req.weak_topics),
            "recent_interactions": ", ".join(req.recent_interactions)
        })
        
        # Simple text parsing since JSON format can be fragile with 8b models without strict structured output
        text = response.content
        lines = text.split("\n")
        
        next_topic = "React Context API" 
        revise = ["Props passing"]
        questions = ["How do you avoid prop drilling?"]
        msg = "Keep practicing, you're doing great!"
        
        for line in lines:
            if line.startswith("Next Best Topic: "): next_topic = line.replace("Next Best Topic: ", "").strip()
            elif line.startswith("Revise: "): revise = [t.strip() for t in line.replace("Revise: ", "").strip("[]").split(",")]
            elif line.startswith("Questions: "): questions = [q.strip() for q in line.replace("Questions: ", "").strip("[]").split("|")]
            elif line.startswith("Message: "): msg = line.replace("Message: ", "").strip()

        return PersonalizeResponse(
            next_best_topic=next_topic,
            topics_to_revise=revise,
            practice_questions=questions,
            adaptive_message=msg
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/evaluate", response_model=EvalResponse)
async def evaluate_submission(req: EvalRequest):
    try:
        return evaluate_submission_core(req.submission_text, req.rubric)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM parsing failed: {str(e)}")

@app.post("/evaluate/files", response_model=EvalResponse)
async def evaluate_submission_files(
    rubric: str = Form(...),
    files: List[UploadFile] = File(...),
):
    if not files:
        raise HTTPException(status_code=400, detail="No submission files provided")

    temp_dir = "temp_eval_upload"
    os.makedirs(temp_dir, exist_ok=True)
    parts = []

    try:
        for uploaded in files:
            filename = uploaded.filename or "submission-file"
            safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", filename)
            file_location = os.path.join(temp_dir, safe_name)

            with open(file_location, "wb") as buffer:
                shutil.copyfileobj(uploaded.file, buffer)

            text = extract_text_from_file(file_location, filename)
            if not text:
                # Fallback for plain text/code documents.
                try:
                    with open(file_location, "r", encoding="utf-8", errors="ignore") as f:
                        text = f.read()
                except Exception:
                    text = ""

            if text:
                parts.append(f"### File: {filename}\n{text[:20000]}")

        if not parts:
            raise HTTPException(status_code=400, detail="Could not parse readable content from submission files")

        combined = "\n\n".join(parts)
        return evaluate_submission_core(combined, rubric)
    finally:
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
