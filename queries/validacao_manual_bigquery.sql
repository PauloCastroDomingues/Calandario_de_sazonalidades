-- Validacao manual BigQuery x Dashboard
-- Ajuste o periodo abaixo e rode cada bloco separadamente no BigQuery.
-- Use o mesmo periodo no dashboard antes de comparar.

DECLARE data_inicio DATE DEFAULT DATE '2026-06-01';
DECLARE data_fim DATE DEFAULT DATE '2026-06-30';

-- ============================================================
-- 1) KPIs principais
-- Compare com os cards/resumo do dashboard no mesmo periodo.
-- ============================================================
SELECT
  data_inicio AS periodo_inicio,
  data_fim AS periodo_fim,
  COUNT(DISTINCT data) AS dias_com_kpi,
  MIN(data) AS primeira_data,
  MAX(data) AS ultima_data,
  SUM(receita_total) AS receita_total,
  SUM(pedidos_aprovados) AS pedidos_aprovados,
  SAFE_DIVIDE(SUM(receita_total), NULLIF(SUM(pedidos_aprovados), 0)) AS ticket_medio_recalculado,
  SUM(sessoes) AS sessoes,
  SAFE_DIVIDE(SUM(pedidos_aprovados), NULLIF(SUM(sessoes), 0)) AS taxa_conversao_recalculada,
  SUM(investimento_total_mkt) AS investimento_total_mkt,
  SAFE_DIVIDE(SUM(receita_total), NULLIF(SUM(investimento_total_mkt), 0)) AS roas_mkt_recalculado,
  SUM(clientes_novos) AS clientes_novos,
  SUM(clientes_recorrentes) AS clientes_recorrentes
FROM `reise-ssot.mart_growth_us.api_marketing_daily`
WHERE data BETWEEN data_inicio AND data_fim;

-- ============================================================
-- 2) Funil
-- Compare com os indicadores de sessoes, carrinho, checkout,
-- purchase e conversao do funil no dashboard.
-- ============================================================
SELECT
  data_inicio AS periodo_inicio,
  data_fim AS periodo_fim,
  COUNT(DISTINCT data) AS dias_com_funil,
  MIN(data) AS primeira_data,
  MAX(data) AS ultima_data,
  SUM(sessoes) AS sessions,
  SUM(visitantes) AS view_item,
  SUM(sessoes_com_carrinho) AS add_to_cart,
  SUM(sessoes_chegaram_checkout) AS begin_checkout,
  SUM(pedidos_aprovados_validos) AS purchase,
  SAFE_DIVIDE(SUM(pedidos_aprovados_validos), NULLIF(SUM(sessoes), 0)) AS conversion_rate
FROM `reise-ssot.mart_growth_us.shopify_funnel_daily_final_v`
WHERE data BETWEEN data_inicio AND data_fim;

-- ============================================================
-- 3) Midia / campanhas
-- Compare com investimento, impressoes, cliques e quantidade
-- de campanhas no periodo.
-- ============================================================
SELECT
  data_inicio AS periodo_inicio,
  data_fim AS periodo_fim,
  COUNT(*) AS linhas_campanha_dia,
  COUNT(DISTINCT data) AS dias_com_campanha,
  COUNT(DISTINCT campanha_id) AS campanhas_distintas,
  SUM(investimento) AS investimento,
  SUM(impressoes) AS impressoes,
  SUM(cliques) AS cliques,
  SAFE_DIVIDE(SUM(cliques), NULLIF(SUM(impressoes), 0)) AS ctr_recalculado,
  SAFE_DIVIDE(SUM(investimento), NULLIF(SUM(cliques), 0)) AS cpc_recalculado
FROM `reise-ssot.mart_growth_us.marketing_spend_campaign_daily_dedup`
WHERE data BETWEEN data_inicio AND data_fim;

-- Campanhas com maior investimento para validar nomes/ranking no dashboard.
SELECT
  CASE
    WHEN origem = 'meta_ads' THEN 'Meta Ads'
    WHEN origem = 'google_ads' THEN 'Google Ads'
    ELSE INITCAP(REPLACE(origem, '_', ' '))
  END AS platform,
  campanha_id AS campaign_id,
  campanha_nome AS campaign_name,
  SUM(investimento) AS investimento,
  SUM(impressoes) AS impressoes,
  SUM(cliques) AS cliques
FROM `reise-ssot.mart_growth_us.marketing_spend_campaign_daily_dedup`
WHERE data BETWEEN data_inicio AND data_fim
GROUP BY 1, 2, 3
ORDER BY investimento DESC
LIMIT 20;

-- ============================================================
-- 4) Produtos
-- Este bloco valida o universo de itens vendidos no BQ.
-- O dashboard de produtos usa recortes/rankings, entao compare:
-- receita, itens vendidos e top produtos principais.
-- ============================================================
SELECT
  data_inicio AS periodo_inicio,
  data_fim AS periodo_fim,
  COUNT(*) AS linhas_item,
  COUNT(DISTINCT order_partition_date_brt) AS dias_com_venda,
  COUNT(DISTINCT sku) AS skus_distintos,
  SUM(quantity) AS itens_vendidos,
  SUM(line_net_amount) AS receita_produto
FROM `reise-ssot.mart_shared.fct_order_item`
WHERE
  is_valid_order = TRUE
  AND order_partition_date_brt BETWEEN data_inicio AND data_fim;

-- Top produtos por receita no periodo.
SELECT
  sku,
  COALESCE(item_name, sku) AS product_name,
  SUM(quantity) AS itens_vendidos,
  SUM(line_net_amount) AS receita_produto
FROM `reise-ssot.mart_shared.fct_order_item`
WHERE
  is_valid_order = TRUE
  AND order_partition_date_brt BETWEEN data_inicio AND data_fim
GROUP BY 1, 2
ORDER BY receita_produto DESC
LIMIT 20;

-- ============================================================
-- 5) UTMs / aquisicao
-- Compare pedidos e receita atribuidos por origem/campanha.
-- ============================================================
WITH orders AS (
  SELECT
    paid_date_brt AS data,
    order_name,
    source_order_id,
    total_amount
  FROM `reise-ssot.mart_growth_us.bridge_orders_customers`
  WHERE paid_date_brt BETWEEN data_inicio AND data_fim
),
journey AS (
  SELECT
    order_id,
    last_source,
    last_source_description,
    last_source_type,
    last_utm_source,
    last_utm_medium,
    last_utm_campaign
  FROM `reise-ssot.mart_growth_us.shopify__orders_journey_latest_v`
)
SELECT
  COUNT(*) AS linhas_utm,
  COUNT(DISTINCT o.data) AS dias_com_pedido,
  COUNT(DISTINCT o.order_name) AS pedidos,
  SUM(o.total_amount) AS receita,
  COUNT(DISTINCT COALESCE(j.last_utm_campaign, 'sem-campanha')) AS campanhas_utm_distintas
FROM orders o
LEFT JOIN journey j
  ON j.order_id = o.source_order_id;

-- Top UTMs por receita.
WITH orders AS (
  SELECT
    paid_date_brt AS data,
    order_name,
    source_order_id,
    total_amount
  FROM `reise-ssot.mart_growth_us.bridge_orders_customers`
  WHERE paid_date_brt BETWEEN data_inicio AND data_fim
),
journey AS (
  SELECT
    order_id,
    last_source,
    last_source_description,
    last_source_type,
    last_utm_source,
    last_utm_medium,
    last_utm_campaign
  FROM `reise-ssot.mart_growth_us.shopify__orders_journey_latest_v`
)
SELECT
  COALESCE(j.last_utm_source, j.last_source, 'unknown') AS utm_source,
  COALESCE(j.last_utm_medium, j.last_source_type, 'unknown') AS utm_medium,
  COALESCE(j.last_utm_campaign, 'sem-campanha') AS utm_campaign,
  COALESCE(j.last_source_description, j.last_source, 'Unattributed') AS channel,
  SUM(o.total_amount) AS receita,
  COUNT(DISTINCT o.order_name) AS pedidos
FROM orders o
LEFT JOIN journey j
  ON j.order_id = o.source_order_id
GROUP BY 1, 2, 3, 4
ORDER BY receita DESC
LIMIT 30;

-- ============================================================
-- 6) Estoque
-- Estoque muda ao longo do tempo. Valide apenas se a consulta for
-- executada no mesmo dia da carga, ou use como checagem direcional.
-- ============================================================
WITH vendas_30d AS (
  SELECT
    sku,
    SUM(quantity) AS sales_last_30d
  FROM `reise-ssot.mart_shared.fct_order_item`
  WHERE
    is_valid_order = TRUE
    AND order_partition_date_brt BETWEEN DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY)
      AND DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 1 DAY)
  GROUP BY 1
)
SELECT
  COUNT(*) AS linhas_estoque,
  COUNT(DISTINCT i.sku) AS skus_distintos,
  SUM(i.available_total) AS stock_available,
  SUM(COALESCE(v.sales_last_30d, 0)) AS sales_last_30d
FROM `reise-ssot.mart_shared.inventory_sku_current` i
LEFT JOIN vendas_30d v USING (sku);
