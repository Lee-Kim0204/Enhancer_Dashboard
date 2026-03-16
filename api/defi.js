// api/defi.js
// Vercel Serverless Function - DeFiLlama CORS 프록시
// 서버 사이드에서 yields.llama.fi 호출 → CORS 문제 없음

const TARGET_PROTOCOLS = new Set([
  "aave-v3","morpho","compound-v3","spark",
  "fluid","euler-v2","kamino","sky","compound-finance"
]);
const TARGET_SYMBOLS = new Set([
  "USDC","USDT","USDS","USDe","PYUSD","RLUSD","DAI"
]);
const TARGET_CHAINS = new Set([
  "Ethereum","Base","Arbitrum","Solana","Mantle"
]);

export default async function handler(req, res) {
  // CORS 헤더
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");

  try {
    const r = await fetch("https://yields.llama.fi/pools", {
      headers: { "User-Agent": "EnhancerDashboard/1.0" }
    });
    if (!r.ok) throw new Error(`DeFiLlama returned ${r.status}`);
    
    const json = await r.json();
    const all  = json.data || [];

    // 필터링
    const pools = all.filter(p =>
      TARGET_PROTOCOLS.has(p.project) &&
      TARGET_SYMBOLS.has(p.symbol) &&
      TARGET_CHAINS.has(p.chain) &&
      (p.tvlUsd || 0) >= 500_000
    ).map(p => ({
      pool:           p.pool || "",
      project:        p.project || "",
      chain:          p.chain || "",
      symbol:         p.symbol || "",
      tvlUsd:         Math.round(p.tvlUsd || 0),
      apyBase:        +(p.apyBase || 0).toFixed(4),
      apyBase7d:      +(p.apyBase7d || 0).toFixed(4),
      apyReward:      +(p.apyReward || 0).toFixed(4),
      apyBaseBorrow:  +(p.apyBaseBorrow || 0).toFixed(4),
      totalBorrowUsd: Math.round(p.totalBorrowUsd || 0),
      ltv:            p.ltv || null,
      utilization:    +((p.totalBorrowUsd || 0) /
                       ((p.tvlUsd || 0) + (p.totalBorrowUsd || 1))).toFixed(4),
    }));

    // 벤치마크 계산
    const stv = pools.reduce((s, p) => s + p.tvlUsd, 0);
    const sbv = pools.reduce((s, p) => s + p.totalBorrowUsd, 0);
    const sw  = pools.reduce((s, p) => s + p.apyBase * p.tvlUsd, 0);
    const bw  = pools.reduce((s, p) => s + p.apyBaseBorrow * p.totalBorrowUsd, 0);

    const benchmark = {
      supply:          stv > 0 ? +(sw / stv).toFixed(4) : 0,
      borrow:          sbv > 0 ? +(bw / sbv).toFixed(4) : 0,
      spread:          stv > 0 && sbv > 0 ? +((bw/sbv) - (sw/stv)).toFixed(4) : 0,
      utilization:     stv > 0 ? +(sbv / (stv + 1)).toFixed(4) : 0,
      total_supply_usd: stv,
      total_borrow_usd: sbv,
      market_count:    pools.length,
    };

    res.status(200).json({
      status:     "ok",
      updated_at: new Date().toISOString(),
      pool_count: pools.length,
      benchmark,
      pools,
    });
  } catch (e) {
    res.status(500).json({ status: "error", error: e.message });
  }
}
