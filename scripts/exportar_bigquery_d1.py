from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta
from decimal import Decimal
import json
import os
from pathlib import Path
import re
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
QUERIES_DIR = ROOT / "queries"

EXPORTS = {
    "kpis_dia": {"query": "kpis_dia.sql", "output": "kpis_dia.json", "filter_by_date": True, "location": "US"},
    "funil_dia": {"query": "funil_dia.sql", "output": "funil_dia.json", "filter_by_date": True, "location": "US"},
    "produtos_dia": {
        "query": "produtos_dia.sql",
        "output": "produtos_dia.json",
        "filter_by_date": True,
        "location": "southamerica-east1",
    },
    "campanhas_dia": {
        "query": "campanhas_dia.sql",
        "output": "campanhas_dia.json",
        "filter_by_date": True,
        "location": "US",
    },
    "utms_dia": {"query": "utms_dia.sql", "output": "utms_dia.json", "filter_by_date": True, "location": "US"},
    "estoque": {
        "query": "estoque.sql",
        "output": "estoque.json",
        "filter_by_date": False,
        "location": "southamerica-east1",
    },
}


def main() -> None:
    args = parse_args()
    if not bq_export_enabled():
        print("BigQuery pausado por BQ_EXPORT_ENABLED=0. Nenhuma query foi executada.")
        return

    cutoff = parse_date_arg(args.end_date) or (date.today() - timedelta(days=1))
    start = parse_date_arg(args.start_date) or (cutoff - timedelta(days=args.lookback_days))
    if start > cutoff:
        raise SystemExit("start-date nao pode ser maior que end-date.")

    credentials_path = resolve_credentials_path(args.credentials_path)
    project_id = args.project_id or os.getenv("BQ_PROJECT_ID") or "reise-ssot"
    max_bytes = int(args.max_bytes_billed or os.getenv("BQ_MAX_BYTES_BILLED") or 1_073_741_824)

    bigquery, service_account = load_bigquery_modules()
    client = build_client(project_id, credentials_path, bigquery, service_account)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, Any] = {
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "mode": "bigquery_d1",
        "project_id": project_id,
        "start_date": start.isoformat(),
        "end_date": cutoff.isoformat(),
        "dry_run": args.dry_run,
        "max_bytes_billed": max_bytes,
        "files": {},
    }

    for name, config in EXPORTS.items():
        query = build_query(config["query"], config["filter_by_date"])
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("start_date", "DATE", start),
                bigquery.ScalarQueryParameter("end_date", "DATE", cutoff),
            ],
            maximum_bytes_billed=max_bytes,
            dry_run=args.dry_run,
            use_query_cache=True,
        )
        rows, bytes_processed = run_query(
            client,
            query,
            job_config,
            location=config["location"],
            dry_run=args.dry_run,
        )
        output_path = DATA_DIR / config["output"]
        if not args.dry_run:
            write_json(output_path, rows)
        manifest["files"][config["output"]] = {
            "rows": len(rows),
            "bytes_processed": bytes_processed,
            "location": config["location"],
            "updated": not args.dry_run,
        }
        print(f"{name} ({config['location']}): {len(rows)} linha(s), {bytes_processed} bytes processados")

    if not args.dry_run:
        write_json(DATA_DIR / "manifest.json", manifest)
        print("Atualizado: data/manifest.json")
    else:
        print("Dry run concluido. Nenhum JSON foi alterado.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Exporta snapshots D-1 do BigQuery para data/*.json.")
    parser.add_argument("--project-id", default=None)
    parser.add_argument("--credentials-path", default=None)
    parser.add_argument("--start-date", default=None, help="YYYY-MM-DD. Padrao: end-date - lookback-days.")
    parser.add_argument("--end-date", default=None, help="YYYY-MM-DD. Padrao: ontem.")
    parser.add_argument("--lookback-days", type=int, default=760)
    parser.add_argument("--max-bytes-billed", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def bq_export_enabled() -> bool:
    value = os.getenv("BQ_EXPORT_ENABLED", "1").strip().lower()
    return value not in {"0", "false", "nao", "não", "off"}


def resolve_credentials_path(value: str | None) -> Path:
    raw = value or os.getenv("BQ_CREDENTIALS_PATH") or "credentials/reise-bigquery-sa.json"
    path = Path(raw)
    if not path.is_absolute():
        path = ROOT / path
    if not path.exists():
        raise SystemExit(
            "Credencial BigQuery nao encontrada. Configure BQ_CREDENTIALS_PATH ou passe --credentials-path."
        )
    return path


def load_bigquery_modules():
    try:
        from google.cloud import bigquery
        from google.oauth2 import service_account
    except ModuleNotFoundError as error:
        raise SystemExit(
            "Dependencia google-cloud-bigquery nao instalada. Rode: python -m pip install -r requirements.txt"
        ) from error
    return bigquery, service_account


def build_client(project_id: str, credentials_path: Path, bigquery, service_account):
    credentials = service_account.Credentials.from_service_account_file(credentials_path)
    return bigquery.Client(project=project_id, credentials=credentials)


def build_query(query_file: str, filter_by_date: bool) -> str:
    sql = (QUERIES_DIR / query_file).read_text(encoding="utf-8").strip().rstrip(";")
    sql = remove_final_order_by(sql)
    if not filter_by_date:
        return sql
    return f"""
SELECT *
FROM (
{sql}
)
WHERE data BETWEEN @start_date AND @end_date
ORDER BY data
""".strip()


def remove_final_order_by(sql: str) -> str:
    return re.sub(r"\nORDER\s+BY\s+[\s\S]*$", "", sql, flags=re.IGNORECASE).strip()


def run_query(
    client: Any,
    query: str,
    job_config: Any,
    location: str,
    dry_run: bool,
) -> tuple[list[dict[str, Any]], int]:
    job = client.query(query, job_config=job_config, location=location)
    bytes_processed = int(job.total_bytes_processed or 0)
    if dry_run:
        return [], bytes_processed
    return [json_ready(dict(row)) for row in job.result()], bytes_processed


def json_ready(row: dict[str, Any]) -> dict[str, Any]:
    output = {}
    for key, value in row.items():
        if isinstance(value, (date, datetime)):
            output[key] = value.isoformat()
        elif isinstance(value, Decimal):
            output[key] = float(value)
        else:
            output[key] = value
    return output


def parse_date_arg(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value)


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
