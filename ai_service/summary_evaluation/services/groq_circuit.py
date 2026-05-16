import threading


def is_request_too_large_error(exc: BaseException) -> bool:
    """Single request exceeds model/org TPM or payload size (e.g. Groq 413)."""
    message = str(exc).lower()
    if "413" in message or "request too large" in message:
        return True
    if "tokens per minute" in message and "requested" in message:
        return True
    status = getattr(exc, "status_code", None)
    if status == 413:
        return True
    return False


def is_rate_limit_error(exc: BaseException) -> bool:
    """Detect Groq HTTP 429 and quota errors (TPD/RPM)."""
    message = str(exc).lower()
    if "429" in message or "rate_limit" in message or "rate limit" in message:
        return True
    if "tokens per day" in message or "tpd" in message:
        return True
    status = getattr(exc, "status_code", None)
    if status == 429:
        return True
    body = getattr(exc, "body", None)
    if body is not None:
        body_text = str(body).lower()
        if "429" in body_text or "rate_limit" in body_text:
            return True
    return False


def should_trip_circuit(exc: BaseException) -> bool:
    """
    Open session circuit only for org/day/minute quota exhaustion.
    Do NOT trip on 413 / per-request TPM — smaller prompts can succeed.
    """
    if is_request_too_large_error(exc):
        return False
    return is_rate_limit_error(exc)


class GroqCircuitBreaker:
    """
    Session-scoped circuit breaker: first rate-limit opens the circuit;
    subsequent Groq calls in the same batch are skipped (deterministic only).
    """

    def __init__(self, session_id: str = ""):
        self.session_id = session_id
        self._open = False
        self._reason: str = ""
        self._lock = threading.Lock()
        self._skipped_calls = 0

    @property
    def is_open(self) -> bool:
        with self._lock:
            return self._open

    @property
    def reason(self) -> str:
        with self._lock:
            return self._reason

    @property
    def skipped_calls(self) -> int:
        with self._lock:
            return self._skipped_calls

    def trip(self, reason: str) -> None:
        with self._lock:
            if self._open:
                return
            self._open = True
            self._reason = (reason or "rate_limit")[:500]
            prefix = f"[GROQ_CIRCUIT] session={self.session_id}" if self.session_id else "[GROQ_CIRCUIT]"
            print(f"{prefix} OPEN — remaining evaluations will skip Groq. {self._reason}")

    def record_skip(self) -> None:
        with self._lock:
            self._skipped_calls += 1

    def should_skip_groq(self) -> bool:
        with self._lock:
            if self._open:
                self._skipped_calls += 1
                return True
            return False

    def status(self) -> dict:
        with self._lock:
            return {
                "open": self._open,
                "reason": self._reason,
                "skippedCalls": self._skipped_calls,
            }
