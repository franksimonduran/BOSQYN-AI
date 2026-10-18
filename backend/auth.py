"""Small fail-closed administrator authentication for BOSQYN AI.

One administrator password comes exclusively from Railway environment variables.
Secure, HttpOnly SameSite cookies represent short-lived in-memory sessions.
"""

from __future__ import annotations

import hmac
import os
import secrets
import threading
import time
from http.cookies import SimpleCookie

SESSION_COOKIE = "__Host-bosqyn_admin"
LOCAL_COOKIE = "bosqyn_admin_local"
SESSION_SECONDS = 8 * 60 * 60


class AdminAuth:
    def __init__(self, host: str):
        self.password = os.environ.get("BOSQYN_ADMIN_PASSWORD", "")
        self.local_mode = (
            host in ("127.0.0.1", "localhost", "::1") and not self.password
        )
        self.enabled = len(self.password) >= 16
        self.sessions: dict[str, float] = {}
        self.failures: dict[str, list[float]] = {}
        self.roles: dict[str, str] = {}
        self.lock = threading.RLock()

    @property
    def login_required(self):
        return not self.local_mode

    def configured(self):
        return self.enabled or self.local_mode

    def cookie_name(self, secure: bool) -> str:
        return SESSION_COOKIE if secure else LOCAL_COOKIE

    def session(self, headers, secure=True) -> str | None:
        if self.local_mode:
            return "local"
        if not self.enabled:
            return None
        jar = SimpleCookie()
        try:
            jar.load(headers.get("Cookie", ""))
        except Exception:
            return None
        cookie = jar.get(self.cookie_name(secure))
        if not cookie:
            return None
        token = cookie.value
        with self.lock:
            expires = self.sessions.get(token)
            if expires is None or expires <= time.time():
                self.sessions.pop(token, None)
                return None
        return token

    def check_login(self, password: str, identity: str) -> tuple[bool, str | None]:
        if not self.enabled:
            return False, "Acceso de administrador no configurado en Railway."
        now = time.monotonic()
        with self.lock:
            attempts = [t for t in self.failures.get(identity, []) if now - t < 900]
            if len(attempts) >= 8:
                self.failures[identity] = attempts
                return False, "Demasiados intentos; espera 15 minutos."
            ok = isinstance(password, str) and hmac.compare_digest(
                password.encode("utf-8"), self.password.encode("utf-8")
            )
            if not ok:
                attempts.append(now)
                self.failures[identity] = attempts
                return False, "Contraseña incorrecta."
            self.failures.pop(identity, None)
            token = secrets.token_urlsafe(32)
            self.sessions[token] = time.time() + SESSION_SECONDS
            if len(self.sessions) > 2000:
                self.sessions = {
                    k: v for k, v in self.sessions.items() if v > time.time()
                }
            return True, token

    def role(self, headers, secure=True):
        token = self.session(headers, secure)
        if not token:
            return None
        return "admin" if token == "local" else self.roles.get(token, "admin")

    def create_guest(self):
        now = time.time()
        with self.lock:
            self.sessions = {
                key: expiry for key, expiry in self.sessions.items() if expiry > now
            }
            self.roles = {
                key: role for key, role in self.roles.items() if key in self.sessions
            }
            if len(self.sessions) >= 2000:
                raise ValueError("Demasiadas sesiones activas; vuelve a intentar")
            token = secrets.token_urlsafe(32)
            self.sessions[token] = now + SESSION_SECONDS
            self.roles[token] = "guest"
        return token

    def revoke(self, token: str | None):
        if token and token != "local":
            with self.lock:
                self.sessions.pop(token, None)
                self.roles.pop(token, None)

    def cookie_header(self, token: str, secure: bool) -> str:
        opts = [
            f"{self.cookie_name(secure)}={token}",
            "Path=/",
            "HttpOnly",
            "SameSite=Strict",
            f"Max-Age={SESSION_SECONDS}",
        ]
        if secure:
            opts.append("Secure")
        return "; ".join(opts)

    def clear_cookie_header(self, secure: bool) -> str:
        return "; ".join(
            [
                f"{self.cookie_name(secure)}=",
                "Path=/",
                "HttpOnly",
                "SameSite=Strict",
                "Max-Age=0",
                "Secure" if secure else "",
            ]
        ).rstrip("; ")
