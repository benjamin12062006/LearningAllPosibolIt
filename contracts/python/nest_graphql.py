"""Cliente mínimo de la API GraphQL de Nest, solo con la biblioteca estándar.

Prueba el contrato que usará el agente (FastAPI): ejecuta las operaciones
predefinidas de ``contracts/graphql/agent`` con la sesión Bearer de una
persona y convierte los errores de la API en ``NestGraphQLError`` con el mismo
código, mensaje y ``requestId`` que da REST.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

AGENT_OPERATIONS = Path(__file__).resolve().parent.parent / "graphql" / "agent"
_OPERATION_NAME = re.compile(r"^\s*(query|mutation)\s+([A-Za-z_]\w*)", re.MULTILINE)


@dataclass
class NestGraphQLError(Exception):
    """Un error de la API con su contrato público: ``code``, ``message`` y ``requestId``."""

    status: int
    code: str
    message: str
    request_id: str | None = None
    issues: list[dict[str, Any]] = field(default_factory=list)
    extensions: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        return f"{self.code} ({self.status}): {self.message}"


def load_operations(folder: Path = AGENT_OPERATIONS) -> dict[str, str]:
    """Cada operación con nombre y el documento (archivo) en el que está."""
    operations: dict[str, str] = {}
    for path in sorted(folder.glob("*.graphql")):
        document = path.read_text(encoding="utf-8")
        for _kind, name in _OPERATION_NAME.findall(document):
            if name in operations:
                raise ValueError(f"La operación {name} está repetida")
            operations[name] = document
    return operations


class NestGraphQL:
    """Llama a ``/api/graphql`` con una sesión y las operaciones predefinidas."""

    def __init__(self, base_url: str, token: str | None, timeout: float = 15.0) -> None:
        self.endpoint = base_url.rstrip("/") + "/api/graphql"
        self.token = token
        self.timeout = timeout
        self.operations = load_operations()

    def run(self, operation: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        """Ejecuta una operación predefinida por su nombre."""
        document = self.operations.get(operation)
        if document is None:
            raise KeyError(f"No hay ninguna operación predefinida llamada {operation}")
        return self.execute(document, variables, operation_name=operation)

    def execute(
        self,
        document: str,
        variables: dict[str, Any] | None = None,
        operation_name: str | None = None,
    ) -> dict[str, Any]:
        """Envía un documento y devuelve ``data``; un error de la API lanza ``NestGraphQLError``."""
        payload = {"query": document, "variables": variables or {}}
        if operation_name:
            payload["operationName"] = operation_name
        status, body = self._post(payload)
        errors = body.get("errors")
        if errors:
            raise _error_from(status, errors[0])
        return body["data"]

    def _post(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        headers = {"content-type": "application/json", "accept": "application/json"}
        if self.token:
            headers["authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            # Apollo responde 400 a lo que rechaza antes de ejecutar (coste,
            # validación del documento); el cuerpo sigue siendo GraphQL.
            return error.code, json.loads(error.read() or b"{}")


def _error_from(status: int, error: dict[str, Any]) -> NestGraphQLError:
    extensions = error.get("extensions") or {}
    return NestGraphQLError(
        status=status,
        code=extensions.get("code", "UNKNOWN"),
        message=error.get("message", ""),
        request_id=extensions.get("requestId"),
        issues=extensions.get("issues") or [],
        extensions=extensions,
    )
