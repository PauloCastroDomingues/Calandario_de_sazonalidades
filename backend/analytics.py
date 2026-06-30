from __future__ import annotations

from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from statistics import mean
from typing import Any


MONTH_NAMES = [
    "Janeiro",
    "Fevereiro",
    "Marco",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
]


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def build_analytics(payload: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    """Builds a zero-cost executive intelligence snapshot from the current cache."""
    kpis = sorted(
        [row for row in payload.get("kpis", []) if parse_date(row.get("data"))],
        key=lambda row: str(row.get("data")),
    )
    cutoff = resolve_data_cutoff(kpis, today=today)
    if not cutoff:
        return empty_analytics()

    usable_kpis = [row for row in kpis if parse_date(row.get("data")) <= cutoff]
    calendario = payload.get("calendario", []) or []
    produtos = [row for row in payload.get("produtos", []) or [] if date_in_window(row.get("data"), None, cutoff)]
    campanhas = [row for row in payload.get("campanhas", []) or [] if date_in_window(row.get("data"), None, cutoff)]
    estoque = payload.get("estoque", []) or []
    eventos_manuais = payload.get("eventos_manuais") or payload.get("eventosManuais") or []

    month_start = cutoff.replace(day=1)
    month_end = cutoff.replace(day=monthrange(cutoff.year, cutoff.month)[1])
    month_rows = filter_rows(usable_kpis, month_start, cutoff)
    last_7 = filter_rows(usable_kpis, cutoff - timedelta(days=6), cutoff)
    previous_7 = filter_rows(usable_kpis, cutoff - timedelta(days=13), cutoff - timedelta(days=7))
    last_14_campaigns = [row for row in campanhas if date_in_window(row.get("data"), cutoff - timedelta(days=13), cutoff)]
    last_30_products = [row for row in produtos if date_in_window(row.get("data"), cutoff - timedelta(days=29), cutoff)]

    forecast = build_revenue_forecast(
        usable_kpis=usable_kpis,
        month_rows=month_rows,
        calendario=calendario,
        cutoff=cutoff,
        month_start=month_start,
        month_end=month_end,
    )
    trends = build_trends(last_7, previous_7)
    upcoming_events = build_upcoming_events(calendario, eventos_manuais, cutoff)
    stock_signals = build_stock_signals(last_30_products, estoque)
    campaign_signals = build_campaign_signals(last_14_campaigns)
    readiness_playbook = build_readiness_playbook(upcoming_events, forecast, stock_signals, campaign_signals)
    signals = build_signals(trends, forecast, upcoming_events, stock_signals, campaign_signals)
    recommendations = build_recommendations(forecast, upcoming_events, stock_signals, campaign_signals)

    return {
        "generated_at": iso_now(),
        "data_cutoff": cutoff.isoformat(),
        "input_mode": {
            "mode": "D-1",
            "source": "json_cache_ready_for_bigquery",
            "message": "Snapshot fechado ate D-1. O frontend nao consulta BigQuery.",
        },
        "forecast": forecast,
        "trends": trends,
        "signals": signals[:6],
        "upcoming_events": upcoming_events[:6],
        "readiness_playbook": readiness_playbook[:4],
        "recommendations": recommendations[:6],
        "diagnostic": build_diagnostic(forecast, trends, upcoming_events),
    }


def empty_analytics() -> dict[str, Any]:
    return {
        "generated_at": iso_now(),
        "data_cutoff": None,
        "input_mode": {"mode": "sem_dados", "source": "empty"},
        "forecast": {},
        "trends": {},
        "signals": [],
        "upcoming_events": [],
        "readiness_playbook": [],
        "recommendations": [],
        "diagnostic": "Sem dados suficientes para gerar previsao.",
    }


def resolve_data_cutoff(kpis: list[dict[str, Any]], today: date | None = None) -> date | None:
    today = today or datetime.now(timezone.utc).date()
    desired_cutoff = today - timedelta(days=1)
    available_dates = sorted({parse_date(row.get("data")) for row in kpis if parse_date(row.get("data"))})
    eligible = [item for item in available_dates if item <= desired_cutoff]
    if eligible:
        return eligible[-1]
    return available_dates[-1] if available_dates else None


def build_revenue_forecast(
    usable_kpis: list[dict[str, Any]],
    month_rows: list[dict[str, Any]],
    calendario: list[dict[str, Any]],
    cutoff: date,
    month_start: date,
    month_end: date,
) -> dict[str, Any]:
    realized_revenue = sum_number(month_rows, "receita_total")
    realized_orders = sum_number(month_rows, "pedidos_aprovados")
    elapsed_days = max(len({row.get("data") for row in month_rows}), 1)
    total_days = month_end.day
    remaining_dates = list(iter_dates(cutoff + timedelta(days=1), month_end))
    remaining_days = len(remaining_dates)

    daily_pace = realized_revenue / elapsed_days
    recent_rows = filter_rows(usable_kpis, cutoff - timedelta(days=6), cutoff)
    recent_average = safe_mean([number(row.get("receita_total")) for row in recent_rows]) or daily_pace

    remaining_estimate = 0.0
    for target_day in remaining_dates:
        historical = historical_daily_revenue(usable_kpis, target_day)
        base = (historical * 0.35) + (recent_average * 0.45) + (daily_pace * 0.20)
        remaining_estimate += base * seasonality_multiplier(calendario, target_day)

    forecast_revenue = realized_revenue + remaining_estimate
    previous_month_revenue = revenue_for_month(usable_kpis, shift_month(month_start, -1))
    previous_year_revenue = revenue_for_month(usable_kpis, month_start.replace(year=month_start.year - 1))
    suggested_target = max(
        value
        for value in (
            previous_month_revenue * 1.03 if previous_month_revenue else 0,
            previous_year_revenue * 1.08 if previous_year_revenue else 0,
            realized_revenue,
        )
    )
    target_coverage = safe_divide(forecast_revenue, suggested_target)

    if target_coverage is None or target_coverage >= 1:
        risk_level = "baixo"
    elif target_coverage >= 0.9:
        risk_level = "medio"
    else:
        risk_level = "alto"

    if elapsed_days / total_days >= 0.72:
        confidence = "alta"
    elif elapsed_days / total_days >= 0.35:
        confidence = "media"
    else:
        confidence = "baixa"

    daily_required = safe_divide(max(suggested_target - realized_revenue, 0), remaining_days) if remaining_days else 0

    return {
        "month_label": f"{MONTH_NAMES[cutoff.month - 1]} {cutoff.year}",
        "cutoff": cutoff.isoformat(),
        "realized_revenue": round(realized_revenue, 2),
        "forecast_revenue": round(forecast_revenue, 2),
        "remaining_revenue": round(max(forecast_revenue - realized_revenue, 0), 2),
        "suggested_target": round(suggested_target, 2),
        "target_coverage": round(target_coverage or 0, 4),
        "daily_pace": round(daily_pace, 2),
        "daily_required": round(daily_required or 0, 2),
        "realized_orders": round(realized_orders),
        "elapsed_days": elapsed_days,
        "remaining_days": remaining_days,
        "total_days": total_days,
        "risk_level": risk_level,
        "confidence": confidence,
    }


def build_trends(last_rows: list[dict[str, Any]], previous_rows: list[dict[str, Any]]) -> dict[str, Any]:
    last_revenue = sum_number(last_rows, "receita_total")
    previous_revenue = sum_number(previous_rows, "receita_total")
    last_orders = sum_number(last_rows, "pedidos_aprovados")
    previous_orders = sum_number(previous_rows, "pedidos_aprovados")
    last_sessions = sum_number(last_rows, "sessoes")
    previous_sessions = sum_number(previous_rows, "sessoes")
    last_investment = sum_number(last_rows, "investimento_total_mkt")
    previous_investment = sum_number(previous_rows, "investimento_total_mkt")

    last_conversion = safe_divide(last_orders, last_sessions) or 0
    previous_conversion = safe_divide(previous_orders, previous_sessions) or 0
    last_roas = safe_divide(last_revenue, last_investment) or 0
    previous_roas = safe_divide(previous_revenue, previous_investment) or 0

    return {
        "revenue_7d": round(last_revenue, 2),
        "previous_revenue_7d": round(previous_revenue, 2),
        "revenue_change": variation(last_revenue, previous_revenue),
        "orders_change": variation(last_orders, previous_orders),
        "conversion_change": variation(last_conversion, previous_conversion),
        "roas_change": variation(last_roas, previous_roas),
        "conversion_7d": round(last_conversion, 4),
        "roas_7d": round(last_roas, 2),
    }


def build_upcoming_events(
    calendario: list[dict[str, Any]],
    eventos_manuais: list[dict[str, Any]],
    cutoff: date,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for event in calendario:
        event_date = parse_date(event.get("data") or event.get("janela_inicio"))
        if not event_date:
            continue
        days_until = (event_date - cutoff).days
        if days_until < 0 or days_until > 90:
            continue
        rows.append(
            {
                "date": event_date.isoformat(),
                "name": event.get("nome_evento") or "Evento sazonal",
                "type": event.get("tipo_evento") or event.get("grupo_evento") or "Calendario",
                "priority": int(number(event.get("prioridade")) or 50),
                "days_until": days_until,
                "window_start": event.get("janela_inicio") or event_date.isoformat(),
                "window_end": event.get("janela_fim") or event_date.isoformat(),
                "action": recommended_event_action(days_until, int(number(event.get("prioridade")) or 50)),
            }
        )

    for event in eventos_manuais:
        event_date = parse_date(event.get("data_inicio") or event.get("data"))
        if not event_date:
            continue
        days_until = (event_date - cutoff).days
        if days_until < 0 or days_until > 90:
            continue
        rows.append(
            {
                "date": event_date.isoformat(),
                "name": event.get("titulo") or event.get("nome_evento") or "Evento manual",
                "type": event.get("tipo") or "Evento manual",
                "priority": priority_weight(event.get("prioridade")),
                "days_until": days_until,
                "window_start": event.get("data_inicio") or event_date.isoformat(),
                "window_end": event.get("data_fim") or event.get("data_inicio") or event_date.isoformat(),
                "action": recommended_event_action(days_until, priority_weight(event.get("prioridade"))),
            }
        )

    return sorted(rows, key=lambda item: (item["days_until"], -item["priority"], item["name"]))


def build_stock_signals(products: list[dict[str, Any]], stock_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    stock_by_sku = {str(row.get("sku") or ""): row for row in stock_rows}
    revenue_by_sku: dict[str, dict[str, Any]] = defaultdict(lambda: {"revenue": 0.0, "items": 0.0, "name": ""})
    for row in products:
        sku = str(row.get("sku") or "")
        if not sku:
            continue
        revenue_by_sku[sku]["revenue"] += number(row.get("receita_produto"))
        revenue_by_sku[sku]["items"] += number(row.get("itens_vendidos"))
        revenue_by_sku[sku]["name"] = row.get("product_name") or sku

    signals = []
    for sku, summary in revenue_by_sku.items():
        stock = stock_by_sku.get(sku, {})
        risk = str(stock.get("risk_status") or "")
        coverage = number(stock.get("coverage_days"))
        if not risk or normalize(risk) == "saudavel":
            continue
        signals.append(
            {
                "sku": sku,
                "name": summary["name"],
                "revenue": round(summary["revenue"], 2),
                "items": round(summary["items"]),
                "coverage_days": round(coverage, 1),
                "risk_status": risk,
            }
        )
    return sorted(signals, key=lambda item: (item["coverage_days"], -item["revenue"]))[:4]


def build_campaign_signals(campaigns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"name": "", "platform": "", "investment": 0.0, "revenue": 0.0, "orders": 0.0}
    )
    for row in campaigns:
        key = str(row.get("campaign_id") or row.get("campaign_name") or "sem-campanha")
        grouped[key]["name"] = row.get("campaign_name") or key
        grouped[key]["platform"] = row.get("platform") or "Midia"
        grouped[key]["investment"] += number(row.get("investimento"))
        grouped[key]["revenue"] += number(row.get("receita_atribuida"))
        grouped[key]["orders"] += number(row.get("pedidos_atribuidos"))

    signals = []
    for item in grouped.values():
        if item["investment"] <= 0:
            continue
        roas = safe_divide(item["revenue"], item["investment"]) or 0
        if roas >= 3.5:
            continue
        signals.append(
            {
                "name": item["name"],
                "platform": item["platform"],
                "investment": round(item["investment"], 2),
                "revenue": round(item["revenue"], 2),
                "orders": round(item["orders"]),
                "roas": round(roas, 2),
            }
        )
    return sorted(signals, key=lambda item: (-item["investment"], item["roas"]))[:4]


def build_readiness_playbook(
    upcoming_events: list[dict[str, Any]],
    forecast: dict[str, Any],
    stock_signals: list[dict[str, Any]],
    campaign_signals: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for event in upcoming_events[:6]:
        days_until = int(number(event.get("days_until")))
        priority = int(number(event.get("priority")) or 50)
        risk_level = str(forecast.get("risk_level") or "indefinido")
        revenue_gap = max(number(forecast.get("suggested_target")) - number(forecast.get("forecast_revenue")), 0)

        score = 100
        if days_until <= 7:
            score -= 28
        elif days_until <= 21:
            score -= 16
        elif days_until <= 45:
            score -= 8

        if risk_level == "alto":
            score -= 24
        elif risk_level == "medio":
            score -= 12

        if stock_signals:
            score -= min(24, 8 * len(stock_signals))
        if campaign_signals:
            score -= min(18, 6 * len(campaign_signals))
        if priority >= 90:
            score -= 5

        score = max(0, min(100, score))
        blockers = build_readiness_blockers(risk_level, stock_signals, campaign_signals, days_until)
        rows.append(
            {
                "name": event.get("name") or "Data sazonal",
                "date": event.get("date"),
                "type": event.get("type") or "Calendario",
                "days_until": days_until,
                "priority": priority,
                "score": score,
                "status": readiness_status(score),
                "risk_level": risk_level,
                "revenue_gap": round(revenue_gap, 2),
                "daily_required": forecast.get("daily_required", 0),
                "main_action": event.get("action") or recommended_event_action(days_until, priority),
                "blockers": blockers[:4],
                "checklist": build_readiness_checklist(risk_level, stock_signals, campaign_signals, days_until),
            }
        )

    return sorted(rows, key=lambda item: (item["score"], item["days_until"], -item["priority"]))


def build_readiness_blockers(
    risk_level: str,
    stock_signals: list[dict[str, Any]],
    campaign_signals: list[dict[str, Any]],
    days_until: int,
) -> list[str]:
    blockers: list[str] = []
    if risk_level in {"alto", "medio"}:
        blockers.append("Lacuna de receita contra a referencia do mes")
    if stock_signals:
        blockers.append(f"Estoque em risco: {stock_signals[0]['name']}")
    if campaign_signals:
        blockers.append(f"Midia com eficiencia baixa: {campaign_signals[0]['name']}")
    if days_until <= 7:
        blockers.append("Janela curta para ajustar oferta, criativo e CRM")
    return blockers


def build_readiness_checklist(
    risk_level: str,
    stock_signals: list[dict[str, Any]],
    campaign_signals: list[dict[str, Any]],
    days_until: int,
) -> list[dict[str, str]]:
    return [
        {
            "area": "Meta e oferta",
            "owner": "Comercial",
            "status": "revisar" if risk_level in {"alto", "medio"} else "ok",
        },
        {
            "area": "Estoque",
            "owner": "Operacao",
            "status": "revisar" if stock_signals else "ok",
        },
        {
            "area": "Midia e CRM",
            "owner": "Growth",
            "status": "revisar" if campaign_signals or days_until <= 21 else "planejar",
        },
        {
            "area": "Criativos e calendario",
            "owner": "Marketing",
            "status": "acao imediata" if days_until <= 7 else "planejar",
        },
    ]


def readiness_status(score: int) -> str:
    if score < 55:
        return "critico"
    if score < 75:
        return "atencao"
    if score < 90:
        return "em preparo"
    return "monitorar"


def build_signals(
    trends: dict[str, Any],
    forecast: dict[str, Any],
    upcoming_events: list[dict[str, Any]],
    stock_signals: list[dict[str, Any]],
    campaign_signals: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    signals: list[dict[str, Any]] = []
    revenue_change = trends.get("revenue_change")
    conversion_change = trends.get("conversion_change")
    roas_change = trends.get("roas_change")

    if revenue_change is not None and revenue_change <= -0.10:
        signals.append(
            {
                "kind": "alerta",
                "severity": "alta",
                "title": "Receita perdeu ritmo nos ultimos 7 dias",
                "detail": f"Variacao de {format_percent(revenue_change)} versus os 7 dias anteriores.",
            }
        )
    elif revenue_change is not None and revenue_change >= 0.10:
        signals.append(
            {
                "kind": "oportunidade",
                "severity": "media",
                "title": "Receita ganhou tracao recente",
                "detail": f"Alta de {format_percent(revenue_change)} nos ultimos 7 dias.",
            }
        )

    if conversion_change is not None and conversion_change <= -0.08:
        signals.append(
            {
                "kind": "alerta",
                "severity": "media",
                "title": "Conversao abaixo do ritmo anterior",
                "detail": f"Queda de {format_percent(conversion_change)} na conversao semanal.",
            }
        )

    if roas_change is not None and roas_change <= -0.15:
        signals.append(
            {
                "kind": "atencao",
                "severity": "media",
                "title": "Eficiencia de midia pressionada",
                "detail": f"ROAS semanal variou {format_percent(roas_change)}.",
            }
        )

    if forecast.get("risk_level") == "alto":
        signals.append(
            {
                "kind": "alerta",
                "severity": "alta",
                "title": "Fechamento projetado abaixo da referencia",
                "detail": f"Cobertura projetada de {format_percent(forecast.get('target_coverage', 0))}.",
            }
        )

    if upcoming_events and upcoming_events[0]["days_until"] <= 21:
        event = upcoming_events[0]
        signals.append(
            {
                "kind": "calendario",
                "severity": "media",
                "title": f"{event['name']} esta perto",
                "detail": f"Faltam {event['days_until']} dia(s). {event['action']}.",
            }
        )

    if stock_signals:
        item = stock_signals[0]
        signals.append(
            {
                "kind": "estoque",
                "severity": "media",
                "title": f"Risco de estoque em {item['name']}",
                "detail": f"Cobertura estimada de {item['coverage_days']} dia(s) e status {item['risk_status']}.",
            }
        )

    if campaign_signals:
        campaign = campaign_signals[0]
        signals.append(
            {
                "kind": "midia",
                "severity": "media",
                "title": "Campanha com eficiencia baixa",
                "detail": f"{campaign['name']} esta com ROAS {campaign['roas']}x nos ultimos 14 dias.",
            }
        )

    return signals


def build_recommendations(
    forecast: dict[str, Any],
    upcoming_events: list[dict[str, Any]],
    stock_signals: list[dict[str, Any]],
    campaign_signals: list[dict[str, Any]],
) -> list[str]:
    recommendations: list[str] = []
    if forecast.get("risk_level") in {"alto", "medio"}:
        recommendations.append(
            f"Revisar plano de receita: faltam {format_currency(forecast.get('daily_required', 0))} por dia para bater a referencia sugerida."
        )
    else:
        recommendations.append("Manter ritmo atual e proteger margem nas campanhas que sustentam o fechamento previsto.")

    if upcoming_events:
        event = upcoming_events[0]
        recommendations.append(
            f"Preparar {event['name']}: validar campanha, estoque e criativos com antecedencia de {event['days_until']} dia(s)."
        )

    if stock_signals:
        recommendations.append(
            f"Priorizar abastecimento/redistribuicao de {stock_signals[0]['name']} antes de acelerar midia."
        )

    if campaign_signals:
        recommendations.append(
            f"Auditar investimento de {campaign_signals[0]['name']} antes de escalar verba."
        )

    recommendations.append("Manter atualizacao diaria D-1 e congelar a leitura executiva antes da reuniao comercial.")
    return recommendations


def build_diagnostic(
    forecast: dict[str, Any],
    trends: dict[str, Any],
    upcoming_events: list[dict[str, Any]],
) -> str:
    risk = forecast.get("risk_level", "indefinido")
    coverage = format_percent(forecast.get("target_coverage", 0))
    trend = trends.get("revenue_change")
    trend_text = "sem base semanal comparavel" if trend is None else f"ritmo semanal em {format_percent(trend)}"
    event_text = (
        f"Proxima data critica: {upcoming_events[0]['name']} em {upcoming_events[0]['days_until']} dia(s)."
        if upcoming_events
        else "Sem data sazonal critica nos proximos 90 dias."
    )
    return (
        f"Previsao de {forecast.get('month_label', '-')}: {format_currency(forecast.get('forecast_revenue', 0))}, "
        f"com risco {risk} e cobertura projetada de {coverage}; {trend_text}. {event_text}"
    )


def historical_daily_revenue(rows: list[dict[str, Any]], target_day: date) -> float:
    same_month_day = [
        number(row.get("receita_total"))
        for row in rows
        if (row_date := parse_date(row.get("data")))
        and row_date.year < target_day.year
        and row_date.month == target_day.month
        and row_date.day == target_day.day
    ]
    if same_month_day:
        return mean(same_month_day)

    same_weekday_month = [
        number(row.get("receita_total"))
        for row in rows
        if (row_date := parse_date(row.get("data")))
        and row_date.year < target_day.year
        and row_date.month == target_day.month
        and row_date.weekday() == target_day.weekday()
    ]
    if same_weekday_month:
        return mean(same_weekday_month)
    return 0.0


def seasonality_multiplier(calendario: list[dict[str, Any]], target_day: date) -> float:
    multiplier = 1.0
    for event in calendario:
        start = parse_date(event.get("janela_inicio") or event.get("data"))
        end = parse_date(event.get("janela_fim") or event.get("data"))
        if not start or not end or not (start <= target_day <= end):
            continue
        priority = min(max(number(event.get("prioridade")), 0), 100)
        event_type = normalize(event.get("tipo_evento") or event.get("grupo_evento"))
        if "data-comercial" in event_type or "campanha" in event_type:
            multiplier += min(0.25, priority / 100 * 0.16)
        elif "sazonalidade" in event_type:
            multiplier += min(0.12, priority / 100 * 0.08)
    return multiplier


def revenue_for_month(rows: list[dict[str, Any]], month_start: date) -> float:
    month_end = month_start.replace(day=monthrange(month_start.year, month_start.month)[1])
    return sum_number(filter_rows(rows, month_start, month_end), "receita_total")


def filter_rows(rows: list[dict[str, Any]], start: date, end: date) -> list[dict[str, Any]]:
    return [row for row in rows if date_in_window(row.get("data"), start, end)]


def date_in_window(value: Any, start: date | None, end: date | None) -> bool:
    current = parse_date(value)
    if not current:
        return False
    if start and current < start:
        return False
    if end and current > end:
        return False
    return True


def iter_dates(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def shift_month(month_start: date, delta: int) -> date:
    month_index = month_start.month - 1 + delta
    year = month_start.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, 1)


def parse_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def sum_number(rows: list[dict[str, Any]], key: str) -> float:
    return sum(number(row.get(key)) for row in rows)


def number(value: Any) -> float:
    try:
        if value is None or value == "":
            return 0.0
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def safe_mean(values: list[float]) -> float | None:
    clean = [value for value in values if value is not None]
    return mean(clean) if clean else None


def safe_divide(numerator: float, denominator: float) -> float | None:
    if not denominator:
        return None
    return numerator / denominator


def variation(current: float, previous: float) -> float | None:
    if not previous:
        return None
    return (current - previous) / previous


def priority_weight(value: Any) -> int:
    text = normalize(value)
    if text in {"alta", "alto"}:
        return 85
    if text in {"baixa", "baixo"}:
        return 45
    return 65


def recommended_event_action(days_until: int, priority: int) -> str:
    if days_until <= 7:
        return "Acao imediata: conferir estoque, oferta e campanha"
    if days_until <= 21 or priority >= 90:
        return "Preparar plano comercial, midia e CRM"
    if days_until <= 45:
        return "Planejar abastecimento, criativos e metas"
    return "Monitorar e reservar pauta comercial"


def format_currency(value: Any) -> str:
    number_value = round(number(value))
    formatted = f"{number_value:,}".replace(",", ".")
    return f"R$ {formatted}"


def format_percent(value: Any) -> str:
    return f"{number(value) * 100:.1f}%".replace(".", ",")


def normalize(value: Any) -> str:
    text = str(value or "").strip().lower()
    replacements = {
        "á": "a",
        "à": "a",
        "ã": "a",
        "â": "a",
        "é": "e",
        "ê": "e",
        "í": "i",
        "ó": "o",
        "ô": "o",
        "õ": "o",
        "ú": "u",
        "ç": "c",
    }
    for source, target in replacements.items():
        text = text.replace(source, target)
    return "-".join(part for part in text.replace("_", "-").split() if part)
