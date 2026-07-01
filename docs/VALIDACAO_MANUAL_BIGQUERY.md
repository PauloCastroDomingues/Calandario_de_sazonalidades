# Validacao manual BigQuery x dashboard

Este e o caminho mais simples para homologar o MVP antes de apresentar.

## Onde esta a query

```text
queries/validacao_manual_bigquery.sql
```

Abra esse arquivo, copie os blocos para o BigQuery e ajuste:

```sql
DECLARE data_inicio DATE DEFAULT DATE '2026-06-01';
DECLARE data_fim DATE DEFAULT DATE '2026-06-30';
```

Use o mesmo periodo no dashboard.

## Como validar

1. Abra o dashboard.
2. Selecione o mesmo periodo da query.
3. Rode um bloco SQL por vez no BigQuery.
4. Compare os indicadores.
5. Registre `OK`, `Revisar` ou `Nao se aplica`.

## Checklist minimo

| Frente | Indicador | Onde comparar | Regra |
|---|---|---|---|
| KPIs | Receita total | Resumo/periodo do dashboard | Deve bater ou divergir apenas por arredondamento |
| KPIs | Pedidos aprovados | Resumo/periodo do dashboard | Deve bater |
| KPIs | Ticket medio | Card de ticket medio | Recalcular receita / pedidos |
| KPIs | Sessoes | Evidencias/funil | Pode ter pequena diferenca se origem for atualizada |
| KPIs | Conversao | Card/tabela do dashboard | Recalcular pedidos / sessoes |
| KPIs | Investimento | Campanhas/midia | Deve bater ou divergir apenas por arredondamento |
| KPIs | ROAS | Card/tabela do dashboard | Recalcular receita / investimento |
| Funil | Sessions | Funil | Deve bater com a fonte exportada |
| Funil | Add to cart | Funil | Deve bater com a fonte exportada |
| Funil | Begin checkout | Funil | Deve bater com a fonte exportada |
| Funil | Purchase | Funil | Deve bater |
| Campanhas | Investimento | Tabela de campanhas | Deve bater por periodo |
| Campanhas | Cliques | Tabela de campanhas | Pequena diferenca pode indicar janela/fonte |
| Campanhas | Impressoes | Tabela de campanhas | Pequena diferenca pode indicar janela/fonte |
| Produtos | Top produtos | Tabela de produtos | Validar top 10 por receita |
| Produtos | Itens vendidos | Tabela de produtos | Validar no mesmo periodo |
| UTMs | Pedidos | Tabela de aquisicao | Validar regra de atribuicao |
| UTMs | Receita | Tabela de aquisicao | Validar regra de atribuicao |
| Estoque | SKUs | Tabela de estoque | Validar no mesmo dia da carga |

## Regua de aceite

Use esta regua para primeira homologacao:

| Indicador | Aceite |
|---|---|
| Pedidos | 0% de diferenca |
| Receita | ate 0,5% se for arredondamento/regra conhecida |
| Investimento | ate 0,5% se for arredondamento/regra conhecida |
| Sessoes | ate 1% se a fonte tiver atualizacao tardia |
| Cliques/impressoes | ate 1% se a fonte tiver atualizacao tardia |
| Ticket medio | recalculado, nao validado como campo isolado |
| Conversao | recalculada, nao validada como campo isolado |
| ROAS | recalculado, nao validado como campo isolado |
| Estoque | validar como foto do dia |

## Registro da validacao

Use um registro simples:

| Data validacao | Periodo | Frente | Indicador | Dashboard | BigQuery | Diferenca | Status | Observacao |
|---|---|---|---|---:|---:|---:|---|---|
| 2026-07-01 | 2026-06-01 a 2026-06-30 | KPIs | Receita |  |  |  |  |  |
| 2026-07-01 | 2026-06-01 a 2026-06-30 | KPIs | Pedidos |  |  |  |  |  |
| 2026-07-01 | 2026-06-01 a 2026-06-30 | Campanhas | Investimento |  |  |  |  |  |

## Como apresentar se ainda nao validou tudo

Use este texto:

```text
MVP de prontidao comercial sazonal com dados D-1 em processo de validacao cruzada com BigQuery.
```

Depois da validacao:

```text
MVP de prontidao comercial sazonal com indicadores principais homologados contra BigQuery.
```

## Observacoes importantes

- Valide sempre periodo fechado.
- Evite validar `hoje`; use D-1 ou mes fechado.
- Estoque pode divergir se a consulta for feita em outro momento.
- UTM depende da regra de atribuicao; divergencia aqui pode ser conceito, nao erro.
- Produtos no dashboard podem usar recorte/ranking, entao valide top produtos e totais com cuidado.
