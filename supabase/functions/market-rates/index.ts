// market-rates: returns trailing CAGRs (1y/5y/10y/20y) for a given symbol
// using Yahoo Finance v8 chart endpoint (no API key required).
// Symbols supported: ^GSPC, BTC-USD, ETH-USD, SOL-USD, etc.
// Also accepts a weighted basket via ?basket=BTC-USD:0.6,ETH-USD:0.3,SOL-USD:0.1

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const YF = "https://query1.finance.yahoo.com/v8/finance/chart";

type Bar = { ts: number; close: number };

async function fetchSeries(symbol: string): Promise<Bar[]> {
  const url = `${YF}/${encodeURIComponent(symbol)}?range=20y&interval=1mo`;
  const res = await fetch(url, {
    headers: {
      // Yahoo blocks default Deno UA in some regions.
      "User-Agent":
        "Mozilla/5.0 (compatible; LovableMarketRates/1.0; +https://lovable.dev)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Yahoo ${symbol} ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${symbol}`);
  const ts: number[] = result.timestamp || [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c != null && Number.isFinite(c)) bars.push({ ts: ts[i], close: c });
  }
  return bars;
}

// Trailing CAGR over the last `years` years of monthly bars.
function trailingCagr(bars: Bar[], years: number): number | null {
  if (bars.length < 2) return null;
  const nowMs = bars[bars.length - 1].ts * 1000;
  const cutoffMs = nowMs - years * 365.25 * 24 * 3600 * 1000;
  const startBar =
    bars.find((b) => b.ts * 1000 >= cutoffMs) ?? bars[0];
  const endBar = bars[bars.length - 1];
  const elapsedYears = (endBar.ts - startBar.ts) / (365.25 * 24 * 3600);
  if (elapsedYears <= 0) return null;
  const ratio = endBar.close / startBar.close;
  if (ratio <= 0) return null;
  const cagr = Math.pow(ratio, 1 / elapsedYears) - 1;
  return cagr * 100; // as percent
}

function buildPayload(symbol: string, bars: Bar[]) {
  return {
    symbol,
    as_of: new Date(bars[bars.length - 1].ts * 1000).toISOString(),
    last_close: bars[bars.length - 1].close,
    cagr_1y: trailingCagr(bars, 1),
    cagr_5y: trailingCagr(bars, 5),
    cagr_10y: trailingCagr(bars, 10),
    cagr_20y: trailingCagr(bars, 20),
    // Light sparkline: monthly closes over last 5y, normalized.
    sparkline_5y: bars
      .slice(-60)
      .map((b) => Math.round(b.close * 100) / 100),
  };
}

// Combine multiple symbols into a single weighted CAGR set by averaging
// their CAGRs proportionally. Simpler than rebasing series and accurate enough
// for projection-rate seeding.
function weighted(payloads: Array<{ payload: any; weight: number }>) {
  const sumW = payloads.reduce((s, p) => s + p.weight, 0) || 1;
  const wAvg = (key: string) => {
    let total = 0;
    let usedW = 0;
    for (const { payload, weight } of payloads) {
      const v = payload[key];
      if (v != null && Number.isFinite(v)) {
        total += v * weight;
        usedW += weight;
      }
    }
    return usedW > 0 ? total / usedW : null;
  };
  return {
    symbol: payloads.map((p) => `${p.payload.symbol}@${(p.weight / sumW * 100).toFixed(0)}%`).join(" + "),
    as_of: payloads[0]?.payload?.as_of,
    last_close: null,
    cagr_1y: wAvg("cagr_1y"),
    cagr_5y: wAvg("cagr_5y"),
    cagr_10y: wAvg("cagr_10y"),
    cagr_20y: wAvg("cagr_20y"),
    sparkline_5y: payloads[0]?.payload?.sparkline_5y || [],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol");
    const basket = url.searchParams.get("basket"); // e.g. "BTC-USD:0.6,ETH-USD:0.4"

    let payload: any;

    if (basket) {
      const parts = basket.split(",").map((p) => {
        const [s, w] = p.split(":");
        return { symbol: s.trim(), weight: Number(w) || 0 };
      }).filter((p) => p.symbol && p.weight > 0);
      // Each symbol is an outbound fetch — cap the fan-out.
      if (parts.length === 0 || parts.length > 20) {
        return new Response(JSON.stringify({ error: "invalid basket" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const fetched = await Promise.all(
        parts.map(async (p) => ({ payload: buildPayload(p.symbol, await fetchSeries(p.symbol)), weight: p.weight }))
      );
      payload = weighted(fetched);
    } else {
      if (!symbol) {
        return new Response(JSON.stringify({ error: "symbol required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const bars = await fetchSeries(symbol);
      payload = buildPayload(symbol, bars);
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        // Browser-side cache, gateway also memoizes via React Query.
        "Cache-Control": "public, max-age=21600",
      },
    });
  } catch (e: any) {
    // Log the detail server-side; never echo upstream response bodies to callers.
    console.error("market-rates error:", e?.message || e);
    return new Response(
      JSON.stringify({ error: "Market data is temporarily unavailable" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
