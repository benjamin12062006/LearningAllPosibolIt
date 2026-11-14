"""Comprueba el contrato GraphQL contra una API Nest arrancada.

Lo lanza la prueba ``test/features/graphql/python-contract.e2e-spec.ts`` con
dos organizaciones ya preparadas. Lee la configuración del entorno y escribe
un JSON con cada comprobación; termina con código 1 si alguna falla.

Variables: NEST_URL, ALICE_TOKEN, BOB_TOKEN, ORGANIZATION_ID, PROJECT_ID,
BOB_PROJECT_ID, SNAPSHOT_ID, WORKSHEET_ID y SKU_COLUMN_ID.
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from typing import Any, Callable

from nest_graphql import NestGraphQL, NestGraphQLError

MAPPING = [
    {"attribute": "title", "column": "Nombre"},
    {"attribute": "description", "column": "Descripción"},
    {"attribute": "link", "column": "URL"},
    {"attribute": "image_link", "column": "Imagen"},
    {"attribute": "price", "column": "Precio"},
    {"attribute": "availability", "column": "Stock"},
    {"attribute": "brand", "column": "Marca"},
]
RULES = [
    {"cleanText": {"attributes": ["title", "brand"]}},
    {"buildTitle": {"template": "{brand} {title}"}},
    {"excludeWhen": {"attribute": "brand", "operator": "is_empty"}},
]
COSTLY = """
query Costly($projectId: ID!) {
  project(id: $projectId) {
    a: evaluations(limit: 100) { items { attention { affectedProducts } } }
    b: evaluations(limit: 100) { items { attention { affectedProducts } } }
  }
}
"""


class Report:
    def __init__(self) -> None:
        self.checks: list[dict[str, Any]] = []

    def check(self, name: str, step: Callable[[], str | None]) -> None:
        """Ejecuta un paso; una excepción o un ``AssertionError`` lo marcan como fallido."""
        try:
            detail = step() or ""
            self.checks.append({"name": name, "ok": True, "detail": detail})
        except Exception as error:  # noqa: BLE001 - el informe recoge cualquier fallo
            self.checks.append({"name": name, "ok": False, "detail": repr(error)[:400]})

    @property
    def ok(self) -> bool:
        return all(check["ok"] for check in self.checks)


def expect_error(code: str, call: Callable[[], Any], status: int | None = None) -> NestGraphQLError:
    try:
        call()
    except NestGraphQLError as error:
        assert error.code == code, f"se esperaba {code} y llegó {error.code}"
        assert error.request_id, "el error no lleva requestId"
        if status is not None:
            assert error.status == status, f"se esperaba HTTP {status} y llegó {error.status}"
        return error
    raise AssertionError(f"se esperaba el error {code} y la llamada funcionó")


def main() -> int:
    env = os.environ
    base_url = env["NEST_URL"]
    alice = NestGraphQL(base_url, env["ALICE_TOKEN"])
    bob = NestGraphQL(base_url, env["BOB_TOKEN"])
    project_id = env["PROJECT_ID"]
    scope = {"organizationId": env["ORGANIZATION_ID"], "projectId": project_id}
    report = Report()
    state: dict[str, Any] = {}

    def me() -> str:
        data = alice.run("Me")
        assert data["me"]["id"], "sin id"
        return data["me"]["id"]

    def summary() -> str:
        project = alice.run("ProjectSummary", {"projectId": project_id})["project"]
        assert project["id"] == project_id
        assert project["access"]["role"] == "owner", project["access"]
        assert project["access"]["organizationId"] == scope["organizationId"]
        return f"{len(project['imports']['items'])} importaciones"

    def create_ruleset() -> str:
        data = alice.run(
            "CreateRuleset",
            {"projectId": project_id, "input": {"mapping": MAPPING, "rules": RULES}},
        )
        assert data["createRuleset"]["revision"] == 1, data
        return "revisión 1"

    def preview() -> str:
        rules = RULES[:2]
        data = alice.run(
            "PreviewRules",
            {
                "projectId": project_id,
                "input": {"mapping": MAPPING, "rules": rules, "snapshotId": env["SNAPSHOT_ID"]},
            },
        )
        result = data["rulesPreview"]
        assert result["baseRevision"] == 1, result
        return f"{result['changedProducts']} productos cambian"

    def evaluate() -> str:
        data = alice.run(
            "RequestEvaluation",
            {"projectId": project_id, "input": {"snapshotId": env["SNAPSHOT_ID"], "rulesetRevision": 1}},
        )
        assert data["requestEvaluation"]["status"] == "queued", data
        return data["requestEvaluation"]["id"]

    def propose_change() -> str:
        sheet = alice.run("WorksheetWithRows", {**scope, "worksheetId": env["WORKSHEET_ID"], "limit": 10})
        assert sheet["worksheet"]["capabilities"]["write"] is True
        created = alice.run(
            "CreateChangeset",
            {**scope, "worksheetId": env["WORKSHEET_ID"], "title": "Propuesta del agente"},
        )["createChangeset"]
        operation = {
            "type": "insert_row",
            "rowId": str(uuid.uuid4()),
            "sortKey": "a",
            "values": {env["SKU_COLUMN_ID"]: "AG-1"},
        }
        saved = alice.run(
            "SaveChangesetOperations",
            {
                **scope,
                "changesetId": created["id"],
                "input": {"draftVersion": created["draftVersion"], "operations": [operation]},
            },
        )["saveChangesetOperations"]
        assert saved["diff"]["resultingRowCount"] == 1, saved["diff"]
        submitted = alice.run(
            "SubmitChangeset",
            {**scope, "changesetId": created["id"], "draftVersion": saved["draftVersion"]},
        )["submitChangeset"]
        assert submitted["status"] == "pending_review", submitted
        state["changeset"] = created["id"]
        return "borrador enviado a revisión"

    def suggest_view() -> str:
        view = alice.run(
            "SuggestView",
            {
                **scope,
                "worksheetId": env["WORKSHEET_ID"],
                "input": {"name": "Sugerida", "visibility": "personal", "query": {"columns": [env["SKU_COLUMN_ID"]]}},
            },
        )["saveView"]
        assert view["visibility"] == "personal"
        return view["id"]

    def validation_like_rest() -> str:
        error = expect_error(
            "VALIDATION_FAILED",
            lambda: alice.run(
                "CreateRuleset",
                {"projectId": project_id, "input": {"mapping": MAPPING, "rules": [{"buildTitle": {"template": ""}}]}},
            ),
        )
        fields = [issue["field"] for issue in error.issues]
        assert "rules.0.template" in fields, fields
        return ", ".join(fields)

    def isolation() -> str:
        expect_error("PROJECT_NOT_FOUND", lambda: bob.run("ProjectSummary", {"projectId": project_id}))
        own = bob.run("ProjectSummary", {"projectId": env["BOB_PROJECT_ID"]})["project"]
        assert own["access"]["role"] == "owner"
        expect_error(
            "PROJECT_NOT_FOUND",
            lambda: bob.run("WorksheetWithRows", {**scope, "worksheetId": env["WORKSHEET_ID"]}),
        )
        return "Bob no ve el proyecto ni la hoja de Alice"

    def bad_credentials() -> str:
        invalid = NestGraphQL(base_url, "credencial-que-no-existe")
        expect_error("AUTH_SESSION_INVALID", lambda: invalid.run("Me"))
        anonymous = NestGraphQL(base_url, None)
        expect_error("AUTH_SESSION_REQUIRED", lambda: anonymous.run("Me"))
        return "401 de REST en las dos"

    def cost_limit() -> str:
        error = expect_error(
            "GRAPHQL_QUERY_TOO_COSTLY",
            lambda: alice.execute(COSTLY, {"projectId": project_id}),
            status=400,
        )
        return f"coste {error.extensions.get('cost')} > {error.extensions.get('maxCost')}"

    report.check("me con la sesión de Alice", me)
    report.check("resumen del proyecto en una llamada", summary)
    report.check("createRuleset con @oneOf", create_ruleset)
    report.check("rulesPreview sin guardar", preview)
    report.check("requestEvaluation en cola", evaluate)
    report.check("proponer un cambio en una hoja", propose_change)
    report.check("suggest_view como vista personal", suggest_view)
    report.check("errores de validación como en REST", validation_like_rest)
    report.check("aislamiento entre dos organizaciones", isolation)
    report.check("credencial inválida y sin credencial", bad_credentials)
    report.check("límite de coste", cost_limit)

    print(json.dumps({"ok": report.ok, "checks": report.checks}, ensure_ascii=False))
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
