from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
import json
import os
from pathlib import Path
import re
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
QUERIES_DIR = ROOT / "queries"
VALIDATION_DIR = ROOT / "docs" / "validacao"


@dataclass(frozen=True)
class Metric:
    key: str
    label: str
    kind: str
    sql: str
    tolerance_abs: Decimal = Decimal("0")
    tolerance_pct: Decimal = Decimal("0")
    local: Callable[[list[dict[str, Any]]], Any] | None = None


@dataclass(frozen=True)
class ValidationSource:
    name: str
    label: str
    query_file: str
    output_file: str
    location: str
    filter_by_date: bool
    date_field: str | None
    metrics: tuple[Metric, ...]
    note: str = ""


def count_rows(rows: list[dict[str, Any]]) -> int:
    return len(rows)


def distinct_dates(field: str = "data") -> Callable[[list[dict[str, Any]]], int]:
    return lambda rows: len({str(row.get(field) or "") for row in rows if row.get(field)})


def min_date(field: str = "data") -> Callable[[list[dict[str, Any]]], str | None]:
    def calculate(rows: list[dict[str, Any]]) -> str | None:
        dates = sorted({str(row.get(field) or "")[:10] for row in rows if row.get(field)})
        return dates[0] if dates else None

    return calculate


def max_date(field: str = "data") -> Callable[[list[dict[str, Any]]], str | None]:
    def calculate(rows: list[dict[str, Any]]) -> str | None:
        dates = sorted({str(row.get(field) or "")[:10] for row in rows if row.get(field)})
        return dates[-1] if dates else None

    return calculate


def sum_field(field: str) -> Callable[[list[dict[str, Any]]], Decimal]:
    return lambda rows: sum(decimal_value(row.get(field)) for row in rows)


def count_distinct(field: str) -> Callable[[list[dict[str, Any]]], int]:
    return lambda rows: len({str(row.get(field) or "") for row in rows if row.get(field)})


def safe_divide_fields(numerator: str, denominator: str) -> Callable[[list[dict[str, Any]]], Decimal | None]:
    def calculate(rows: list[dict[str, Any]]) -> Decimal | None:
        denominator_value = sum_field(denominator)(rows)
        if denominator_value == 0:
            return None
        return sum_field(numerator)(rows) / denominator_value

    return calculate


COMMON_DAILY_METRICS = (
    Metric("rows", "Linhas", "count", "COUNT(1)", local=count_rows),
    Metric("dias", "Dias distintos", "count", "COUNT(DISTINCT data)", local=distinct_dates()),
    Metric("data_min", "Data inicial", "date", "MIN(data)", local=min_date()),
    Metric("data_max", "Data final", "date", "MAX(data)", local=max_date()),
)


SOURCES: dict[str, ValidationSource] = {
    "kpis_dia": ValidationSource(
        name="kpis_dia",
        label="KPIs diarios",
        query_file="kpis_dia.sql",
        output_file="kpis_dia.json",
        location="US",
        filter_by_date=True,
        date_field="data",
        metrics=COMMON_DAILY_METRICS
        + (
            Metric("receita_total", "Receita", "money", "SUM(receita_total)", Decimal("1"), Decimal("0.005"), sum_field("receita_total")),
            Metric("pedidos_aprovados", "Pedidos", "count", "SUM(pedidos_aprovados)", Decimal("0"), Decimal("0"), sum_field("pedidos_aprovados")),
            Metric("sessoes", "Sessoes", "count", "SUM(sessoes)", Decimal("0"), Decimal("0.01"), sum_field("sessoes")),
            Metric(
                "ticket_medio",
                "Ticket medio recalculado",
                "decimal",
                "SAFE_DIVIDE(SUM(receita_total), NULLIF(SUM(pedidos_aprovados), 0))",
                Decimal("0.01"),
                Decimal("0.005"),
                safe_divide_fields("receita_total", "pedidos_aprovados"),
            ),
            Metric(
                "taxa_conversao",
                "Conversao recalculada",
                "rate",
                "SAFE_DIVIDE(SUM(pedidos_aprovados), NULLIF(SUM(sessoes), 0))",
                Decimal("0.0001"),
                Decimal("0"),
                safe_divide_fields("pedidos_aprovados", "sessoes"),
            ),
            Metric("investimento_total_mkt", "Investimento", "money", "SUM(investimento_total_mkt)", Decimal("1"), Decimal("0.005"), sum_field("investimento_total_mkt")),
            Metric(
                "roas_mkt",
                "ROAS recalculado",
                "decimal",
                "SAFE_DIVIDE(SUM(receita_total), NULLIF(SUM(investimento_total_mkt), 0))",
                Decimal("0.01"),
                Decimal("0.005"),
                safe_divide_fields("receita_total", "investimento_total_mkt"),
            ),
        ),
    ),
    "funil_dia": ValidationSource(
        name="funil_dia",
        label="Funil diario",
        query_file="funil_dia.sql",
        output_file="funil_dia.json",
        location="US",
        filter_by_date=True,
        date_field="data",
        metrics=COMMON_DAILY_METRICS
        + (
            Metric("sessions", "Sessoes", "count", "SUM(sessions)", Decimal("0"), Decimal("0.01"), sum_field("sessions")),
            Metric("view_item", "View item", "count", "SUM(view_item)", Decimal("0"), Decimal("0.01"), sum_field("view_item")),
            Metric("add_to_cart", "Add to cart", "count", "SUM(add_to_cart)", Decimal("0"), Decimal("0.01"), sum_field("add_to_cart")),
            Metric("begin_checkout", "Begin checkout", "count", "SUM(begin_checkout)", Decimal("0"), Decimal("0.01"), sum_field("begin_checkout")),
            Metric("purchase", "Purchase", "count", "SUM(purchase)", Decimal("0"), Decimal("0"), sum_field("purchase")),
            Metric(
                "conversion_rate",
                "Conversao recalculada",
                "rate",
                "SAFE_DIVIDE(SUM(purchase), NULLIF(SUM(sessions), 0))",
                Decimal("0.0001"),
                Decimal("0"),
                safe_divide_fields("purchase", "sessions"),
            ),
        ),
    ),
    "produtos_dia": ValidationSource(
        name="produtos_dia",
        label="Produtos diarios",
        query_file="produtos_dia.sql",
        output_file="produtos_dia.json",
        location="southamerica-east1",
        filter_by_date=True,
        date_field="data",
        metrics=COMMON_DAILY_METRICS
        + (
            Metric("skus", "SKUs distintos", "count", "COUNT(DISTINCT sku)", Decimal("0"), Decimal("0"), count_distinct("sku")),
            Metric("itens_vendidos", "Itens vendidos", "count", "SUM(itens_vendidos)", Decimal("0"), Decimal("0"), sum_field("itens_vendidos")),
            Metric("receita_produto", "Receita produto", "money", "SUM(receita_produto)", Decimal("1"), Decimal("0.005"), sum_field("receita_produto")),
        ),
        note="Produtos valida apenas o recorte top/bottom 5 exportado, nao o catalogo inteiro.",
    ),
    "campanhas_dia": ValidationSource(
        name="campanhas_dia",
        label="Campanhas diarias",
        query_file="campanhas_dia.sql",
        output_file="campanhas_dia.json",
        location="US",
        filter_by_date=True,
        date_field="data",
        metrics=COMMON_DAILY_METRICS
        + (
            Metric("campaigns", "Campanhas distintas", "count", "COUNT(DISTINCT campaign_id)", Decimal("0"), Decimal("0"), count_distinct("campaign_id")),
            Metric("investimento", "Investimento", "money", "SUM(investimento)", Decimal("1"), Decimal("0.005"), sum_field("investimento")),
            Metric("impressoes", "Impressoes", "count", "SUM(impressoes)", Decimal("0"), Decimal("0.01"), sum_field("impressoes")),
            Metric("cliques", "Cliques", "count", "SUM(cliques)", Decimal("0"), Decimal("0.01"), sum_field("cliques")),
        ),
    ),
    "utms_dia": ValidationSource(
        name="utms_dia",
        label="UTMs diarios",
        query_file="utms_dia.sql",
        output_file="utms_dia.json",
        location="US",
        filter_by_date=True,
        date_field="data",
        metrics=COMMON_DAILY_METRICS
        + (
            Metric("utm_campaigns", "UTM campaigns distintas", "count", "COUNT(DISTINCT utm_campaign)", Decimal("0"), Decimal("0"), count_distinct("utm_campaign")),
            Metric("receita", "Receita atribuida", "money", "SUM(receita)", Decimal("1"), Decimal("0.005"), sum_field("receita")),
            Metric("pedidos", "Pedidos atribuidos", "count", "SUM(pedidos)", Decimal("0"), Decimal("0"), sum_field("pedidos")),
        ),
    ),
    "estoque": ValidationSource(
        name="estoque",
        label="Estoque atual",
        query_file="estoque.sql",
        output_file="estoque.json",
        location="southamerica-east1",
        filter_by_date=False,
        date_field=None,
        metrics=(
            Metric("rows", "Linhas", "count", "COUNT(1)", local=count_rows),
            Metric("skus", "SKUs distintos", "count", "COUNT(DISTINCT sku)", Decimal("0"), Decimal("0"), count_distinct("sku")),
            Metric("stock_available", "Estoque disponivel", "decimal", "SUM(stock_available)", Decimal("1"), Decimal("0.005"), sum_field("stock_available")),
            Metric("sales_last_30d", "Vendas ultimos 30 dias", "decimal", "SUM(sales_last_30d)", Decimal("1"), Decimal("0.005"), sum_field("sales_last_30d")),
        ),
        note="Estoque e uma foto do momento atual; valide no mesmo dia da carga para evitar divergencia natural.",
    ),
}


def main() -> None:
    args = parse_args()
    manifest = read_json(DATA_DIR / "manifest.json", fallback={})
    end_date = parse_date_arg(args.end_date) or parse_date_arg(manifest.get("end_date")) or (date.today() - timedelta(days=1))
    start_date = parse_date_arg(args.start_date) or end_date.replace(day=1)
    if start_date > end_date:
        raise SystemExit("start-date nao pode ser maior que end-date.")

    selected_sources = resolve_sources(args.sources, args.skip_estoque)
    max_bytes = int(args.max_bytes_billed or os.getenv("BQ_MAX_BYTES_BILLED") or manifest.get("max_bytes_billed") or 1_073_741_824)
    project_id = args.project_id or os.getenv("BQ_PROJECT_ID") or manifest.get("project_id") or "reise-ssot"
    output_path = resolve_output_path(args.output, end_date)

    bigquery, service_account = load_bigquery_modules()
    client = build_client(project_id, args.credentials_path, bigquery, service_account)

    results = []
    total_bytes = 0
    for source_name in selected_sources:
        source = SOURCES[source_name]
        local_rows = load_local_rows(source, start_date, end_date)
        local_metrics = calculate_local_metrics(source, local_rows)
        bq_metrics, bytes_processed = run_bigquery_validation(
            client=client,
            bigquery=bigquery,
            source=source,
            start_date=start_date,
            end_date=end_date,
            max_bytes=max_bytes,
            dry_run=args.dry_run,
        )
        total_bytes += bytes_processed
        results.append(
            {
                "source": source,
                "local_metrics": local_metrics,
                "bq_metrics": bq_metrics,
                "bytes_processed": bytes_processed,
                "comparisons": [] if args.dry_run else compare_metrics(source, local_metrics, bq_metrics),
            }
        )
        print(f"{source.name}: {bytes_processed} bytes estimados/processados")

    report = build_report(
        results=results,
        start_date=start_date,
        end_date=end_date,
        project_id=project_id,
        dry_run=args.dry_run,
        total_bytes=total_bytes,
        max_bytes=max_bytes,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report, encoding="utf-8")
    print(f"Relatorio gerado: {output_path.relative_to(ROOT)}")

    if args.fail_on_divergence and not args.dry_run:
        statuses = [comparison["status"] for result in results for comparison in result["comparisons"]]
        if any(status == "revisar" for status in statuses):
            raise SystemExit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Valida snapshots data/*.json contra BigQuery.")
    parser.add_argument("--project-id", default=None)
    parser.add_argument("--credentials-path", default=None)
    parser.add_argument("--start-date", default=None, help="YYYY-MM-DD. Padrao: primeiro dia do mes de end-date.")
    parser.add_argument("--end-date", default=None, help="YYYY-MM-DD. Padrao: manifest.end_date ou ontem.")
    parser.add_argument("--sources", nargs="*", choices=sorted(SOURCES), default=None)
    parser.add_argument("--skip-estoque", action="store_true", help="Ignora estoque, que e uma foto volatel.")
    parser.add_argument("--max-bytes-billed", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true", help="Estima bytes no BigQuery sem comparar valores.")
    parser.add_argument("--output", default=None, help="Caminho do relatorio Markdown.")
    parser.add_argument("--fail-on-divergence", action="store_true")
    return parser.parse_args()


def resolve_sources(values: list[str] | None, skip_estoque: bool) -> list[str]:
    sources = values or list(SOURCES)
    if skip_estoque:
        sources = [source for source in sources if source != "estoque"]
    return sources


def resolve_output_path(value: str | None, end_date: date) -> Path:
    if value:
        path = Path(value)
        return path if path.is_absolute() else ROOT / path
    return VALIDATION_DIR / f"VALIDACAO_DADOS_{end_date.isoformat()}.md"


def load_bigquery_modules():
    try:
        from google.cloud import bigquery
        from google.oauth2 import service_account
    except ModuleNotFoundError as error:
        raise SystemExit("Dependencia google-cloud-bigquery nao instalada. Rode: python -m pip install -r requirements.txt") from error
    return bigquery, service_account


def build_client(project_id: str, credentials_path: str | None, bigquery: Any, service_account: Any):
    path = resolve_credentials_path(credentials_path)
    if path:
        credentials = service_account.Credentials.from_service_account_file(path)
        return bigquery.Client(project=project_id, credentials=credentials)
    return bigquery.Client(project=project_id)


def resolve_credentials_path(value: str | None) -> Path | None:
    raw = value or os.getenv("BQ_CREDENTIALS_PATH") or "credentials/reise-bigquery-sa.json"
    path = Path(raw)
    if not path.is_absolute():
        path = ROOT / path
    return path if path.exists() else None


def load_local_rows(source: ValidationSource, start_date: date, end_date: date) -> list[dict[str, Any]]:
    rows = read_json(DATA_DIR / source.output_file, fallback=[])
    if not isinstance(rows, list):
        return []
    normalized = [row for row in rows if isinstance(row, dict)]
    if not source.date_field:
        return normalized
    return [
        row
        for row in normalized
        if (parsed := parse_date_arg(row.get(source.date_field))) and start_date <= parsed <= end_date
    ]


def calculate_local_metrics(source: ValidationSource, rows: list[dict[str, Any]]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for metric in source.metrics:
        if not metric.local:
            continue
        output[metric.key] = metric.local(rows)
    return output


def run_bigquery_validation(
    client: Any,
    bigquery: Any,
    source: ValidationSource,
    start_date: date,
    end_date: date,
    max_bytes: int,
    dry_run: bool,
) -> tuple[dict[str, Any], int]:
    query = build_validation_query(source)
    parameters = []
    if source.filter_by_date:
        parameters = [
            bigquery.ScalarQueryParameter("start_date", "DATE", start_date),
            bigquery.ScalarQueryParameter("end_date", "DATE", end_date),
        ]
    job_config = bigquery.QueryJobConfig(
        query_parameters=parameters,
        maximum_bytes_billed=max_bytes,
        dry_run=dry_run,
        use_query_cache=True,
    )
    job = client.query(query, job_config=job_config, location=source.location)
    bytes_processed = int(job.total_bytes_processed or 0)
    if dry_run:
        return {}, bytes_processed
    rows = list(job.result())
    return dict(rows[0]) if rows else {}, bytes_processed


def build_validation_query(source: ValidationSource) -> str:
    base_sql = (QUERIES_DIR / source.query_file).read_text(encoding="utf-8").strip().rstrip(";")
    base_sql = remove_final_order_by(base_sql)
    source_sql = f"SELECT * FROM (\n{base_sql}\n)"
    if source.filter_by_date:
        source_sql = f"{source_sql}\nWHERE data BETWEEN @start_date AND @end_date"
    metric_sql = ",\n  ".join(f"{metric.sql} AS {metric.key}" for metric in source.metrics)
    return f"""
WITH validation_source AS (
  {source_sql}
)
SELECT
  {metric_sql}
FROM validation_source
""".strip()


def remove_final_order_by(sql: str) -> str:
    return re.sub(r"\nORDER\s+BY\s+[\s\S]*$", "", sql, flags=re.IGNORECASE).strip()


def compare_metrics(
    source: ValidationSource,
    local_metrics: dict[str, Any],
    bq_metrics: dict[str, Any],
) -> list[dict[str, Any]]:
    comparisons = []
    for metric in source.metrics:
        local_value = normalize_value(local_metrics.get(metric.key), metric.kind)
        bq_value = normalize_value(bq_metrics.get(metric.key), metric.kind)
        difference = calculate_difference(local_value, bq_value, metric.kind)
        pct_difference = calculate_pct_difference(difference, bq_value, metric.kind)
        status = metric_status(metric, difference, pct_difference, local_value, bq_value)
        comparisons.append(
            {
                "metric": metric,
                "local": local_value,
                "bigquery": bq_value,
                "difference": difference,
                "pct_difference": pct_difference,
                "status": status,
            }
        )
    return comparisons


def metric_status(
    metric: Metric,
    difference: Decimal | str | None,
    pct_difference: Decimal | None,
    local_value: Any,
    bq_value: Any,
) -> str:
    if metric.kind == "date":
        return "ok" if local_value == bq_value else "revisar"
    if local_value is None and bq_value is None:
        return "ok"
    if local_value is None or bq_value is None:
        return "revisar"
    if not isinstance(difference, Decimal):
        return "revisar"
    if abs(difference) <= metric.tolerance_abs:
        return "ok"
    if pct_difference is not None and abs(pct_difference) <= metric.tolerance_pct:
        return "ok"
    return "revisar"


def normalize_value(value: Any, kind: str) -> Any:
    if value is None or value == "":
        return None
    if kind == "date":
        parsed = parse_date_arg(value)
        return parsed.isoformat() if parsed else str(value)
    if kind in {"count", "money", "decimal", "rate"}:
        return decimal_value(value)
    return value


def calculate_difference(local_value: Any, bq_value: Any, kind: str) -> Decimal | str | None:
    if kind == "date":
        return "" if local_value == bq_value else f"{local_value} vs {bq_value}"
    if local_value is None or bq_value is None:
        return None
    return decimal_value(local_value) - decimal_value(bq_value)


def calculate_pct_difference(difference: Decimal | str | None, bq_value: Any, kind: str) -> Decimal | None:
    if kind == "date" or not isinstance(difference, Decimal):
        return None
    denominator = decimal_value(bq_value)
    if denominator == 0:
        return Decimal("0") if difference == 0 else None
    return difference / denominator


def build_report(
    results: list[dict[str, Any]],
    start_date: date,
    end_date: date,
    project_id: str,
    dry_run: bool,
    total_bytes: int,
    max_bytes: int,
) -> str:
    generated_at = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    lines = [
        f"# Validacao BigQuery x JSON - {end_date.isoformat()}",
        "",
        f"- Gerado em: `{generated_at}`",
        f"- Projeto BigQuery: `{project_id}`",
        f"- Periodo: `{start_date.isoformat()}` a `{end_date.isoformat()}`",
        f"- Modo: `{'dry-run' if dry_run else 'comparacao'}`",
        f"- Bytes estimados/processados: `{format_integer(total_bytes)}`",
        f"- Limite por query: `{format_integer(max_bytes)}`",
        "",
    ]
    if dry_run:
        lines.extend(
            [
                "## Resultado",
                "",
                "Dry-run concluido. Nenhum valor foi comparado; use sem `--dry-run` para homologar os numeros.",
                "",
            ]
        )
    else:
        status = overall_status(results)
        lines.extend(["## Resultado", "", f"Status geral: **{status.upper()}**", ""])

    lines.extend(["## Fontes", ""])
    lines.append("| Fonte | Local | BigQuery | Bytes | Status |")
    lines.append("|---|---:|---:|---:|---|")
    for result in results:
        source = result["source"]
        local_rows = result["local_metrics"].get("rows", 0)
        bq_rows = result["bq_metrics"].get("rows", "-") if not dry_run else "-"
        status = source_status(result) if not dry_run else "dry-run"
        lines.append(
            f"| {source.label} | {format_report_value(local_rows)} | {format_report_value(bq_rows)} | {format_integer(result['bytes_processed'])} | {status} |"
        )
    lines.append("")

    for result in results:
        source = result["source"]
        lines.extend([f"## {source.label}", ""])
        if source.note:
            lines.extend([f"> {source.note}", ""])
        if dry_run:
            lines.extend([f"- Bytes estimados: `{format_integer(result['bytes_processed'])}`", ""])
            continue
        lines.append("| Metrica | JSON | BigQuery | Diferenca | Dif. % | Status |")
        lines.append("|---|---:|---:|---:|---:|---|")
        for comparison in result["comparisons"]:
            metric = comparison["metric"]
            lines.append(
                "| "
                f"{metric.label} | "
                f"{format_report_value(comparison['local'])} | "
                f"{format_report_value(comparison['bigquery'])} | "
                f"{format_report_value(comparison['difference'])} | "
                f"{format_percent(comparison['pct_difference'])} | "
                f"{comparison['status']} |"
            )
        lines.append("")

    lines.extend(
        [
            "## Regra de leitura",
            "",
            "- `ok`: diferenca dentro da tolerancia definida no script.",
            "- `revisar`: divergencia fora da tolerancia ou valor nulo em apenas um lado.",
            "- Para apresentar o MVP, valide pelo menos um mes fechado, uma semana fechada e um dia especifico.",
            "",
        ]
    )
    return "\n".join(lines)


def overall_status(results: list[dict[str, Any]]) -> str:
    statuses = [comparison["status"] for result in results for comparison in result["comparisons"]]
    return "revisar" if any(status == "revisar" for status in statuses) else "ok"


def source_status(result: dict[str, Any]) -> str:
    statuses = [comparison["status"] for comparison in result["comparisons"]]
    return "revisar" if any(status == "revisar" for status in statuses) else "ok"


def read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def parse_date_arg(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def decimal_value(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def format_integer(value: Any) -> str:
    return f"{int(decimal_value(value)):,}".replace(",", ".")


def format_percent(value: Any) -> str:
    if value is None or value == "":
        return "-"
    return f"{(decimal_value(value) * Decimal('100')).quantize(Decimal('0.01'))}%"


def format_report_value(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, Decimal):
        return str(value.quantize(Decimal("0.0001")).normalize())
    return str(value)


if __name__ == "__main__":
    main()
