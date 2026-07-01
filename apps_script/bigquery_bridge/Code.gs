/* global BigQuery, SpreadsheetApp */

const TZ = "America/Sao_Paulo";
const DEFAULT_LOOKBACK_DAYS = 760;
const DEFAULT_MAX_BYTES_BILLED = "1073741824";
const DEFAULT_BQ_EXPORT_ENABLED = "1";
const MANUAL_EVENTS_OUTPUT_PATH = "data/eventos_manuais.json";
const EVENTS_SHEET_NAME = "eventos_manuais";
const EVENTS_HEADER = [
  "event_id",
  "data_inicio",
  "data_fim",
  "titulo",
  "tipo",
  "categoria",
  "produto_relacionado",
  "campanha_relacionada",
  "prioridade",
  "responsavel",
  "observacao",
  "status",
  "created_by",
  "created_at",
  "updated_by",
  "updated_at",
  "deleted_at",
];

const EXPORTS = [
  {
    name: "kpis_dia",
    outputPath: "data/kpis_dia.json",
    filterByDate: true,
    location: "US",
    sql: [
      "SELECT",
      "  data,",
      "  receita_total,",
      "  pedidos_aprovados,",
      "  ticket_medio,",
      "  sessoes,",
      "  taxa_conversao,",
      "  investimento_total_mkt,",
      "  roas_mkt,",
      "  cps_mkt,",
      "  clientes_novos,",
      "  clientes_recorrentes",
      "FROM `reise-ssot.mart_growth_us.api_marketing_daily`",
      "ORDER BY data",
    ].join("\n"),
  },
  {
    name: "funil_dia",
    outputPath: "data/funil_dia.json",
    filterByDate: true,
    location: "US",
    sql: [
      "SELECT",
      "  data,",
      "  SUM(sessoes) AS sessions,",
      "  SUM(visitantes) AS view_item,",
      "  SUM(sessoes_com_carrinho) AS add_to_cart,",
      "  SUM(sessoes_chegaram_checkout) AS begin_checkout,",
      "  SUM(pedidos_aprovados_validos) AS purchase,",
      "  SAFE_DIVIDE(SUM(pedidos_aprovados_validos), NULLIF(SUM(sessoes), 0)) AS conversion_rate",
      "FROM `reise-ssot.mart_growth_us.shopify_funnel_daily_final_v`",
      "GROUP BY 1",
      "ORDER BY data",
    ].join("\n"),
  },
  {
    name: "produtos_dia",
    outputPath: "data/produtos_dia.json",
    filterByDate: true,
    location: "southamerica-east1",
    sql: [
      "WITH produtos AS (",
      "  SELECT",
      "    order_partition_date_brt AS data,",
      "    sku,",
      "    REGEXP_REPLACE(LOWER(COALESCE(item_name, sku)), r'[^a-z0-9]+', '-') AS product_key,",
      "    COALESCE(item_name, sku) AS product_name,",
      "    CAST(NULL AS STRING) AS variant_title,",
      "    SUM(quantity) AS itens_vendidos,",
      "    SUM(line_net_amount) AS receita_produto",
      "  FROM `reise-ssot.mart_shared.fct_order_item`",
      "  WHERE is_valid_order = TRUE",
      "  GROUP BY 1, 2, 3, 4, 5",
      "),",
      "ranked AS (",
      "  SELECT",
      "    *,",
      "    ROW_NUMBER() OVER (PARTITION BY data ORDER BY receita_produto DESC) AS rank_receita_desc,",
      "    ROW_NUMBER() OVER (PARTITION BY data ORDER BY receita_produto ASC) AS rank_receita_asc",
      "  FROM produtos",
      ")",
      "SELECT",
      "  data,",
      "  sku,",
      "  product_key,",
      "  product_name,",
      "  variant_title,",
      "  itens_vendidos,",
      "  receita_produto,",
      "  CASE",
      "    WHEN rank_receita_desc <= 5 THEN 'destaque'",
      "    WHEN rank_receita_asc <= 5 THEN 'queda'",
      "  END AS classificacao",
      "FROM ranked",
      "WHERE rank_receita_desc <= 5 OR rank_receita_asc <= 5",
      "ORDER BY data, classificacao, receita_produto DESC",
    ].join("\n"),
  },
  {
    name: "campanhas_dia",
    outputPath: "data/campanhas_dia.json",
    filterByDate: true,
    location: "US",
    sql: [
      "SELECT",
      "  data,",
      "  CASE",
      "    WHEN origem = 'meta_ads' THEN 'Meta Ads'",
      "    WHEN origem = 'google_ads' THEN 'Google Ads'",
      "    ELSE INITCAP(REPLACE(origem, '_', ' '))",
      "  END AS platform,",
      "  campanha_id AS campaign_id,",
      "  campanha_nome AS campaign_name,",
      "  SUM(investimento) AS investimento,",
      "  SUM(impressoes) AS impressoes,",
      "  SUM(cliques) AS cliques,",
      "  CAST(0 AS NUMERIC) AS receita_atribuida,",
      "  CAST(0 AS INT64) AS pedidos_atribuidos,",
      "  CAST(NULL AS FLOAT64) AS roas",
      "FROM `reise-ssot.mart_growth_us.marketing_spend_campaign_daily_dedup`",
      "GROUP BY 1, 2, 3, 4",
      "ORDER BY data, investimento DESC",
    ].join("\n"),
  },
  {
    name: "utms_dia",
    outputPath: "data/utms_dia.json",
    filterByDate: true,
    location: "US",
    sql: [
      "WITH orders AS (",
      "  SELECT",
      "    paid_date_brt AS data,",
      "    order_name,",
      "    source_order_id,",
      "    total_amount",
      "  FROM `reise-ssot.mart_growth_us.bridge_orders_customers`",
      "),",
      "journey AS (",
      "  SELECT",
      "    order_id,",
      "    last_source,",
      "    last_source_description,",
      "    last_source_type,",
      "    last_utm_source,",
      "    last_utm_medium,",
      "    last_utm_campaign",
      "  FROM `reise-ssot.mart_growth_us.shopify__orders_journey_latest_v`",
      ")",
      "SELECT",
      "  o.data,",
      "  COALESCE(j.last_utm_source, j.last_source, 'unknown') AS utm_source,",
      "  COALESCE(j.last_utm_medium, j.last_source_type, 'unknown') AS utm_medium,",
      "  COALESCE(j.last_utm_campaign, 'sem-campanha') AS utm_campaign,",
      "  COALESCE(j.last_source_description, j.last_source, 'Unattributed') AS channel,",
      "  SUM(o.total_amount) AS receita,",
      "  COUNT(DISTINCT o.order_name) AS pedidos",
      "FROM orders o",
      "LEFT JOIN journey j",
      "  ON j.order_id = o.source_order_id",
      "GROUP BY 1, 2, 3, 4, 5",
      "ORDER BY data, receita DESC",
    ].join("\n"),
  },
  {
    name: "estoque",
    outputPath: "data/estoque.json",
    filterByDate: false,
    location: "southamerica-east1",
    sql: [
      "WITH vendas_30d AS (",
      "  SELECT",
      "    sku,",
      "    SUM(quantity) AS sales_last_30d",
      "  FROM `reise-ssot.mart_shared.fct_order_item`",
      "  WHERE",
      "    is_valid_order = TRUE",
      "    AND order_partition_date_brt BETWEEN DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY)",
      "      AND DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 1 DAY)",
      "  GROUP BY 1",
      ")",
      "SELECT",
      "  i.sku,",
      "  COALESCE(i.product_title, i.sku) AS product_name,",
      "  i.available_total AS stock_available,",
      "  COALESCE(v.sales_last_30d, 0) AS sales_last_30d,",
      "  SAFE_DIVIDE(i.available_total, SAFE_DIVIDE(v.sales_last_30d, 30)) AS coverage_days,",
      "  CASE",
      "    WHEN COALESCE(v.sales_last_30d, 0) = 0 THEN 'Sem giro'",
      "    WHEN SAFE_DIVIDE(i.available_total, SAFE_DIVIDE(v.sales_last_30d, 30)) < 25 THEN 'Critico'",
      "    WHEN SAFE_DIVIDE(i.available_total, SAFE_DIVIDE(v.sales_last_30d, 30)) < 45 THEN 'Atencao'",
      "    ELSE 'Saudavel'",
      "  END AS risk_status",
      "FROM `reise-ssot.mart_shared.inventory_sku_current` i",
      "LEFT JOIN vendas_30d v USING (sku)",
      "ORDER BY coverage_days ASC",
    ].join("\n"),
  },
];

function atualizarDadosD1() {
  return executarExportacaoD1_({ dryRun: false });
}

function testarDadosD1() {
  return executarExportacaoD1_({ dryRun: true });
}

function pausarBigQuery() {
  PropertiesService.getScriptProperties().setProperty("BQ_EXPORT_ENABLED", "0");
  console.log("BigQuery pausado. atualizarDadosD1 nao fara consultas BQ enquanto BQ_EXPORT_ENABLED=0.");
  return statusBigQuery();
}

function ativarBigQuery() {
  PropertiesService.getScriptProperties().setProperty("BQ_EXPORT_ENABLED", "1");
  console.log("BigQuery ativado. atualizarDadosD1 voltara a consultar BQ enquanto BQ_EXPORT_ENABLED=1.");
  return statusBigQuery();
}

function statusBigQuery() {
  const config = getConfig_();
  const status = {
    bq_export_enabled: config.bqExportEnabled,
    bq_project_id: config.bqProjectId,
    max_bytes_billed: Number(config.maxBytesBilled),
    lookback_days: config.lookbackDays,
  };
  console.log(JSON.stringify(status, null, 2));
  return status;
}

function instalarBaseEventosManuais() {
  const sheet = getManualEventsSheet_();
  console.log(`Base pronta: ${sheet.getParent().getUrl()} / aba ${EVENTS_SHEET_NAME}`);
  return {
    spreadsheet_url: sheet.getParent().getUrl(),
    sheet_name: EVENTS_SHEET_NAME,
    columns: EVENTS_HEADER,
  };
}

function exportarEventosManuais() {
  return commitEventosManuaisToGithub_("Update manual events");
}

function instalarTriggerDiario() {
  removerTriggers_("atualizarDadosD1");
  ScriptApp.newTrigger("atualizarDadosD1").timeBased().everyDays(1).atHour(7).create();
}

function removerTriggerDiario() {
  removerTriggers_("atualizarDadosD1");
}

function executarExportacaoD1_(options) {
  const config = getConfig_();
  const dryRun = Boolean(options && options.dryRun);
  const endDate = config.endDate || getYesterdayBrt_();
  const startDate = config.startDate || addDaysIso_(endDate, -config.lookbackDays);
  const payloads = {};
  const manifest = {
    generated_at: new Date().toISOString(),
    mode: "apps_script_bigquery_d1",
    project_id: config.bqProjectId,
    start_date: startDate,
    end_date: endDate,
    dry_run: dryRun,
    bq_export_enabled: config.bqExportEnabled,
    max_bytes_billed: Number(config.maxBytesBilled),
    files: {},
  };

  if (config.bqExportEnabled) {
    EXPORTS.forEach((item) => {
      const result = runBigQuery_(config.bqProjectId, item, startDate, endDate, config.maxBytesBilled, dryRun);
      const fileName = item.outputPath.split("/").pop();
      manifest.files[fileName] = {
        rows: result.rows.length,
        bytes_processed: result.bytesProcessed,
        location: item.location,
        updated: !dryRun,
      };
      if (!dryRun) {
        payloads[item.outputPath] = toPrettyJson_(result.rows);
      }
      console.log(`${item.name} (${item.location}): ${result.rows.length} linha(s), ${result.bytesProcessed} bytes`);
    });
  } else {
    EXPORTS.forEach((item) => {
      const fileName = item.outputPath.split("/").pop();
      manifest.files[fileName] = {
        rows: 0,
        bytes_processed: 0,
        location: item.location,
        updated: false,
        skipped: true,
      };
    });
    console.log("BigQuery pausado por BQ_EXPORT_ENABLED=0. Nenhuma query BQ foi executada.");
  }

  const manualEvents = getManualEventsForExport_();
  manifest.files["eventos_manuais.json"] = {
    rows: manualEvents.rows.length,
    bytes_processed: 0,
    location: manualEvents.enabled ? "google_sheets" : "not_configured",
    updated: !dryRun && manualEvents.enabled,
  };
  if (manualEvents.enabled) {
    console.log(`eventos_manuais (google_sheets): ${manualEvents.rows.length} linha(s)`);
    if (!dryRun) {
      payloads[MANUAL_EVENTS_OUTPUT_PATH] = toPrettyJson_(manualEvents.rows);
    }
  } else {
    console.log("eventos_manuais: EVENTS_SPREADSHEET_ID nao configurado; JSON atual mantido.");
  }

  if (dryRun) {
    console.log("Dry run concluido. Nenhum arquivo foi enviado ao GitHub.");
    return manifest;
  }

  if (config.bqExportEnabled) {
    payloads["data/manifest.json"] = toPrettyJson_(manifest);
  }
  if (Object.keys(payloads).length === 0) {
    console.log("Nenhum arquivo para enviar ao GitHub. BigQuery pausado e eventos manuais nao configurados.");
    return manifest;
  }
  const message = config.bqExportEnabled
    ? `Update D-1 commercial data (${endDate})`
    : `Update manual events (BQ paused ${endDate})`;
  const commit = commitFilesToGithub_(config, payloads, message);
  console.log(`Commit criado: ${commit.html_url || commit.sha}`);
  return manifest;
}

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.action === "health") {
      return jsonResponse_({
        success: true,
        storage: "google_sheets",
        sheet_configured: hasEventsSpreadsheet_(),
      });
    }
    return jsonResponse_({
      success: true,
      events: readManualEvents_({ includeDeleted: params.includeDeleted === "1" }),
    });
  } catch (error) {
    return jsonResponse_({ success: false, error: String(error) });
  }
}

function doPost(e) {
  try {
    const body = parseRequestBody_(e);
    const action = String(body.action || "create").toLowerCase();
    const user = body.user || body.responsavel || body.updated_by || "apps-script";
    let event = null;

    if (action === "create") {
      event = createManualEvent_(body.event || body, user);
    } else if (action === "update") {
      event = updateManualEvent_(body.event_id || body.id, body.event || body, user);
      if (!event) throw new Error("Evento manual nao encontrado.");
    } else if (action === "delete") {
      event = deleteManualEvent_(body.event_id || body.id, user);
      if (!event) throw new Error("Evento manual nao encontrado.");
    } else if (action === "export") {
      return jsonResponse_({ success: true, action: action, export: commitEventosManuaisToGithub_("Update manual events") });
    } else {
      throw new Error(`Acao invalida: ${action}`);
    }

    const exportResult = body.sync_github === false ? null : commitEventosManuaisToGithub_(`Update manual events (${action})`);
    return jsonResponse_({
      success: true,
      action: action,
      event: event,
      export: exportResult,
    });
  } catch (error) {
    return jsonResponse_({ success: false, error: String(error) });
  }
}

function runBigQuery_(projectId, item, startDate, endDate, maxBytesBilled, dryRun) {
  const request = {
    query: buildQuery_(item.sql, item.filterByDate),
    useLegacySql: false,
    useQueryCache: true,
    dryRun: dryRun,
    location: item.location,
    maximumBytesBilled: String(maxBytesBilled),
    parameterMode: "NAMED",
    queryParameters: [
      {
        name: "start_date",
        parameterType: { type: "DATE" },
        parameterValue: { value: startDate },
      },
      {
        name: "end_date",
        parameterType: { type: "DATE" },
        parameterValue: { value: endDate },
      },
    ],
  };
  let response = BigQuery.Jobs.query(request, projectId);
  const bytesProcessed = Number(response.totalBytesProcessed || 0);

  if (dryRun) {
    return { rows: [], bytesProcessed };
  }

  const jobId = response.jobReference.jobId;
  const jobProjectId = response.jobReference.projectId || projectId;
  while (!response.jobComplete) {
    Utilities.sleep(1000);
    response = BigQuery.Jobs.getQueryResults(jobProjectId, jobId, { location: item.location });
  }

  const rows = [];
  const fields = response.schema ? response.schema.fields : [];
  appendRows_(rows, fields, response.rows || []);

  let pageToken = response.pageToken;
  while (pageToken) {
    const page = BigQuery.Jobs.getQueryResults(jobProjectId, jobId, {
      location: item.location,
      pageToken: pageToken,
      maxResults: 10000,
    });
    appendRows_(rows, fields, page.rows || []);
    pageToken = page.pageToken;
  }

  return { rows, bytesProcessed };
}

function buildQuery_(sql, filterByDate) {
  const cleanSql = removeFinalOrderBy_(String(sql).trim().replace(/;\s*$/, ""));
  if (!filterByDate) return cleanSql;
  return [
    "SELECT *",
    "FROM (",
    cleanSql,
    ")",
    "WHERE data BETWEEN @start_date AND @end_date",
    "ORDER BY data",
  ].join("\n");
}

function removeFinalOrderBy_(sql) {
  return sql.replace(/\nORDER\s+BY\s+[\s\S]*$/i, "").trim();
}

function appendRows_(target, fields, rows) {
  rows.forEach((row) => {
    const output = {};
    fields.forEach((field, index) => {
      output[field.name] = castBigQueryValue_(row.f[index] ? row.f[index].v : null, field);
    });
    target.push(output);
  });
}

function castBigQueryValue_(value, field) {
  if (value === null || value === undefined) return null;
  switch (field.type) {
    case "INTEGER":
    case "INT64":
      return Number(value);
    case "FLOAT":
    case "FLOAT64":
    case "NUMERIC":
    case "BIGNUMERIC":
      return Number(value);
    case "BOOLEAN":
    case "BOOL":
      return value === true || value === "true";
    case "RECORD":
    case "STRUCT":
      return value;
    default:
      return value;
  }
}

function getManualEventsForExport_() {
  if (!hasEventsSpreadsheet_()) {
    return { enabled: false, rows: [] };
  }
  return { enabled: true, rows: readManualEvents_({ includeDeleted: false }) };
}

function commitEventosManuaisToGithub_(message) {
  const events = readManualEvents_({ includeDeleted: false });
  const payloads = {};
  payloads[MANUAL_EVENTS_OUTPUT_PATH] = toPrettyJson_(events);
  const commit = commitFilesToGithub_(getConfig_(), payloads, message || "Update manual events");
  console.log(`Eventos manuais exportados: ${events.length} linha(s)`);
  return {
    rows: events.length,
    commit: commit.sha || "",
    url: commit.html_url || "",
  };
}

function readManualEvents_(options) {
  const includeDeleted = Boolean(options && options.includeDeleted);
  const sheet = getManualEventsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const rows = sheet.getRange(2, 1, lastRow - 1, EVENTS_HEADER.length).getValues();
  return rows
    .map(eventRowToObject_)
    .filter((event) => event.event_id)
    .filter((event) => includeDeleted || isActiveManualEvent_(event))
    .sort((a, b) => String(a.data_inicio || "").localeCompare(String(b.data_inicio || "")));
}

function createManualEvent_(payload, user) {
  const sheet = getManualEventsSheet_();
  const event = normalizeManualEventPayload_(payload, null, user);
  const existingRow = findManualEventRow_(sheet, event.event_id);
  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, EVENTS_HEADER.length).setValues([eventObjectToRow_(event)]);
  } else {
    sheet.appendRow(eventObjectToRow_(event));
  }
  return event;
}

function updateManualEvent_(eventId, payload, user) {
  if (!eventId) throw new Error("Informe event_id para atualizar.");
  const sheet = getManualEventsSheet_();
  const row = findManualEventRow_(sheet, eventId);
  if (row < 1) return null;

  const existing = eventRowToObject_(sheet.getRange(row, 1, 1, EVENTS_HEADER.length).getValues()[0]);
  const event = normalizeManualEventPayload_({ ...payload, event_id: eventId }, existing, user);
  sheet.getRange(row, 1, 1, EVENTS_HEADER.length).setValues([eventObjectToRow_(event)]);
  return event;
}

function deleteManualEvent_(eventId, user) {
  if (!eventId) throw new Error("Informe event_id para excluir.");
  const sheet = getManualEventsSheet_();
  const row = findManualEventRow_(sheet, eventId);
  if (row < 1) return null;

  const now = new Date().toISOString();
  const existing = eventRowToObject_(sheet.getRange(row, 1, 1, EVENTS_HEADER.length).getValues()[0]);
  const event = {
    ...existing,
    event_id: eventId,
    status: "Excluido",
    updated_by: user,
    updated_at: now,
    deleted_at: existing.deleted_at || now,
  };
  sheet.getRange(row, 1, 1, EVENTS_HEADER.length).setValues([eventObjectToRow_(event)]);
  return event;
}

function normalizeManualEventPayload_(payload, existing, user) {
  payload = payload || {};
  const now = new Date().toISOString();
  const base = existing || {};
  const eventId = pickManualEventValue_(payload, base, ["event_id", "id"], `manual_${Utilities.getUuid().replace(/-/g, "").slice(0, 16)}`);
  const startDate = normalizeDateValue_(pickManualEventValue_(payload, base, ["data_inicio", "data"], ""));
  if (!startDate) throw new Error("data_inicio e obrigatoria.");

  const endDate = normalizeDateValue_(pickManualEventValue_(payload, base, ["data_fim", "janela_fim"], "")) || startDate;
  const title = cleanText_(pickManualEventValue_(payload, base, ["titulo", "nome_evento"], ""));
  if (!title) throw new Error("titulo e obrigatorio.");

  return {
    event_id: eventId,
    data_inicio: startDate,
    data_fim: endDate < startDate ? startDate : endDate,
    titulo: title,
    tipo: cleanText_(pickManualEventValue_(payload, base, ["tipo", "tipo_evento"], "Campanha")),
    categoria: cleanText_(pickManualEventValue_(payload, base, ["categoria"], "")),
    produto_relacionado: cleanText_(pickManualEventValue_(payload, base, ["produto_relacionado"], "")),
    campanha_relacionada: cleanText_(pickManualEventValue_(payload, base, ["campanha_relacionada"], "")),
    prioridade: cleanText_(pickManualEventValue_(payload, base, ["prioridade"], "Media")),
    responsavel: cleanText_(pickManualEventValue_(payload, base, ["responsavel"], user)),
    observacao: cleanText_(pickManualEventValue_(payload, base, ["observacao"], "")),
    status: cleanText_(pickManualEventValue_(payload, base, ["status"], "Ativo")),
    created_by: cleanText_(base.created_by || pickManualEventValue_(payload, base, ["created_by"], user)),
    created_at: cleanText_(base.created_at || pickManualEventValue_(payload, base, ["created_at"], now)),
    updated_by: cleanText_(user || pickManualEventValue_(payload, base, ["updated_by"], "")),
    updated_at: now,
    deleted_at: cleanText_(pickManualEventValue_(payload, base, ["deleted_at"], "")),
  };
}

function getManualEventsSheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("EVENTS_SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("Configure a propriedade do script: EVENTS_SPREADSHEET_ID");
  }

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  let sheet = spreadsheet.getSheetByName(EVENTS_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(EVENTS_SHEET_NAME);
  }
  ensureManualEventsHeader_(sheet);
  return sheet;
}

function ensureManualEventsHeader_(sheet) {
  sheet.getRange(1, 1, 1, EVENTS_HEADER.length).setValues([EVENTS_HEADER]);
  sheet.setFrozenRows(1);
}

function findManualEventRow_(sheet, eventId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let index = 0; index < ids.length; index += 1) {
    if (String(ids[index][0]) === String(eventId)) {
      return index + 2;
    }
  }
  return -1;
}

function eventRowToObject_(row) {
  const event = {};
  EVENTS_HEADER.forEach((field, index) => {
    event[field] = normalizeSheetValue_(row[index], field);
  });
  event.id = event.event_id;
  return event;
}

function eventObjectToRow_(event) {
  return EVENTS_HEADER.map((field) => event[field] || "");
}

function normalizeSheetValue_(value, field) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    if (field === "data_inicio" || field === "data_fim") {
      return Utilities.formatDate(value, TZ, "yyyy-MM-dd");
    }
    return Utilities.formatDate(value, "UTC", "yyyy-MM-dd'T'HH:mm:ss'Z'");
  }
  return String(value).trim();
}

function normalizeDateValue_(value) {
  if (!value) return "";
  if (value instanceof Date) return Utilities.formatDate(value, TZ, "yyyy-MM-dd");
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return Utilities.formatDate(parsed, TZ, "yyyy-MM-dd");
}

function isActiveManualEvent_(event) {
  return !event.deleted_at && String(event.status || "").toLowerCase() !== "excluido";
}

function cleanText_(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function pickManualEventValue_(payload, existing, keys, fallback) {
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (Object.prototype.hasOwnProperty.call(payload, key)) return payload[key];
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (existing && Object.prototype.hasOwnProperty.call(existing, key)) return existing[key];
  }
  return fallback;
}

function hasEventsSpreadsheet_() {
  return Boolean(PropertiesService.getScriptProperties().getProperty("EVENTS_SPREADSHEET_ID"));
}

function parseRequestBody_(e) {
  const contents = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
  return JSON.parse(contents || "{}");
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function commitFilesToGithub_(config, payloads, message) {
  const baseUrl = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}`;
  const ref = githubRequest_(config.githubToken, "GET", `${baseUrl}/git/ref/heads/${config.githubBranch}`);
  const baseCommitSha = ref.object.sha;
  const baseCommit = githubRequest_(config.githubToken, "GET", `${baseUrl}/git/commits/${baseCommitSha}`);
  const baseTreeSha = baseCommit.tree.sha;

  const tree = Object.keys(payloads).map((path) => {
    const blob = githubRequest_(config.githubToken, "POST", `${baseUrl}/git/blobs`, {
      content: Utilities.base64Encode(payloads[path], Utilities.Charset.UTF_8),
      encoding: "base64",
    });
    return { path: path, mode: "100644", type: "blob", sha: blob.sha };
  });

  const newTree = githubRequest_(config.githubToken, "POST", `${baseUrl}/git/trees`, {
    base_tree: baseTreeSha,
    tree: tree,
  });

  if (newTree.sha === baseTreeSha) {
    console.log("Nenhuma mudanca nos JSONs. Commit nao criado.");
    return { sha: baseCommitSha };
  }

  const newCommit = githubRequest_(config.githubToken, "POST", `${baseUrl}/git/commits`, {
    message: message,
    tree: newTree.sha,
    parents: [baseCommitSha],
  });

  githubRequest_(config.githubToken, "PATCH", `${baseUrl}/git/refs/heads/${config.githubBranch}`, {
    sha: newCommit.sha,
    force: false,
  });
  return newCommit;
}

function githubRequest_(token, method, url, payload) {
  const options = {
    method: method,
    muteHttpExceptions: true,
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "calendario-reise-apps-script",
    },
  };
  if (payload !== undefined) {
    options.payload = JSON.stringify(payload);
  }
  const response = UrlFetchApp.fetch(url, options);
  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error(`GitHub API falhou (${status}): ${body}`);
  }
  return body ? JSON.parse(body) : {};
}

function getConfig_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const required = ["GITHUB_OWNER", "GITHUB_REPO", "GITHUB_BRANCH", "GITHUB_TOKEN"];
  required.forEach((key) => {
    if (!props[key]) throw new Error(`Configure a propriedade do script: ${key}`);
  });
  return {
    bqProjectId: props.BQ_PROJECT_ID || "reise-ssot",
    githubOwner: props.GITHUB_OWNER,
    githubRepo: props.GITHUB_REPO,
    githubBranch: props.GITHUB_BRANCH,
    githubToken: props.GITHUB_TOKEN,
    bqExportEnabled: parseBooleanConfig_(props.BQ_EXPORT_ENABLED || DEFAULT_BQ_EXPORT_ENABLED),
    lookbackDays: Number(props.LOOKBACK_DAYS || DEFAULT_LOOKBACK_DAYS),
    maxBytesBilled: props.BQ_MAX_BYTES_BILLED || DEFAULT_MAX_BYTES_BILLED,
    startDate: props.START_DATE || "",
    endDate: props.END_DATE || "",
  };
}

function parseBooleanConfig_(value) {
  return !["0", "false", "nao", "não", "off"].includes(String(value || "").trim().toLowerCase());
}

function getYesterdayBrt_() {
  const todayBrt = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
  return addDaysIso_(todayBrt, -1);
}

function addDaysIso_(isoDate, days) {
  const parts = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  date.setUTCDate(date.getUTCDate() + days);
  return Utilities.formatDate(date, "UTC", "yyyy-MM-dd");
}

function toPrettyJson_(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function removerTriggers_(handlerName) {
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
