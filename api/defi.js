// api/defi.js — Vercel Serverless Function
// DeFiLlama CORS 프록시 + 스테이블코인 렌딩 풀 필터링

// ── DeFiLlama 실제 project slug 전체 목록 ──
// yields.llama.fi/pools 에서 확인한 실제 값들
const TARGET_PROTOCOLS = new Set([
  // Aave
  "aave-v3", "aave-v2",
  // Morpho (slug 변형 모두 포함)
  "morpho", "morpho-blue", "morpho-v1", "morpho-aave", "morpho-compound",
  // Compound
  "compound-v3", "compound-v2", "compound-finance",
  // Spark / SparkLend (MakerDAO 계열)
  "spark", "sparklend", "spark-lend",
  // Fluid
  "fluid", "fluid-lending", "fluid-protocol",
  // Euler
  "euler-v2", "euler", "euler-v1",
  // Kamino (Solana)
  "kamino", "kamino-lending", "kamino-finance",
  // Sky / Maker
  "sky", "sky-money", "makerdao", "sky-protocol",
  // 기타
  "venus", "benqi", "radiant-v2",
]);

// 화면에 표시할 이름 매핑 (slug → label)
const PROTOCOL_LABELS = {
  "aave-v3": "Aave V3",
  "aave-v2": "Aave V2",
  "morpho": "Morpho",
  "morpho-blue": "Morpho",
  "morpho-v1": "Morpho",
  "morpho-aave": "Morpho",
  "morpho-compound": "Morpho",
  "compound-v3": "Compound V3",
  "compound-v2": "Compound V2",
  "compound-finance": "Compound",
  "spark": "Spark",
  "sparklend": "Spark",
  "spark-lend": "Spark",
  "fluid": "Fluid",
  "fluid-lending": "Fluid",
  "fluid-protocol": "Fluid",
  "euler-v2": "Euler V2",
  "euler": "Euler",
  "kamino": "Kamino",
  "kamino-lending": "Kamino",
  "kamino-finance": "Kamino",
  "sky": "Sky",
  "sky-money": "Sky",
  "makerdao": "Sky",
  "sky-protocol": "Sky",
};

const TARGET_SYMBOLS = new Set([
  "USDC", "USDT", "USDS", "USDe", "PYUSD", "RLUSD", "DAI", "GHO", "crvUSD"
]);
const TARGET_CHAINS = new Set([
  "Ethereum", "Base", "Arbitrum", "Solana", "Mantle", "Optimism", "Polygon"
]);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");

  try {
    const r = await fetch("https://yields.llama.fi/pools", {
      headers: { "User-Agent": "EnhancerDashboard/1.0" },
    });
    if (!r.ok) throw new Error(`DeFiLlama ${r.status}`);

    const json = await r.json();
    const all = json.data || [];

    // ── 전체 slug 목록을 먼저 로깅 (디버그용) ──
    const uniqueSlugs = [...new Set(all
      .filter(p => TARGET_SYMBOLS.has(p.symbol) && TARGET_CHAINS.has(p.chain))
      .map(p => p.project)
    )].sort();

    // ── 필터링 ──
    const pools = all
      .filter(p =>
        TARGET_PROTOCOLS.has(p.project) &&
        TARGET_SYMBOLS.has(p.symbol) &&
        TARGET_CHAINS.has(p.chain) &&
        (p.tvlUsd || 0) >= 100_000   // 10만달러 이상 (필터 완화)
      )
      .map(p => {
        const borrowRate  = p.apyBaseBorrow || p.borrowApy || 0;
        const borrowTvl   = p.totalBorrowUsd || p.borrowedUsd || 0;
        const supplyTvl   = p.tvlUsd || p.totalSupplyUsd || 0;
        const label       = PROTOCOL_LABELS[p.project] || p.project;

        return {
          pool:           p.pool || "",
          project:        p.project,
          projectLabel:   label,           // ← 프론트에서 바로 사용
          chain:          p.chain,
          symbol:         p.symbol,
          tvlUsd:         Math.round(supplyTvl),
          apyBase:        +(p.apyBase || 0).toFixed(4),
          apyBase7d:      +(p.apyBase7d || 0).toFixed(4),
          apyReward:      +(p.apyReward || 0).toFixed(4),
          apyBaseBorrow:  +(borrowRate).toFixed(4),
          totalBorrowUsd: Math.round(borrowTvl),
          ltv:            p.ltv || null,
          utilization:    +(borrowTvl / (supplyTvl + borrowTvl + 1)).toFixed(4),
        };
      });

    // ── 벤치마크 계산 ──
    const stv = pools.reduce((s, p) => s + p.tvlUsd, 0);
    const sbv = pools.reduce((s, p) => s + p.totalBorrowUsd, 0);
    const sw  = pools.reduce((s, p) => s + p.apyBase * p.tvlUsd, 0);
    const bw  = pools.reduce((s, p) => s + p.apyBaseBorrow * p.totalBorrowUsd, 0);

    res.status(200).json({
      status:     "ok",
      updated_at: new Date().toISOString(),
      pool_count: pools.length,
      // 디버그: 실제로 어떤 slug들이 스테이블/타겟체인에 있는지
      debug_all_slugs: uniqueSlugs,
      benchmark: {
        supply:           stv > 0 ? +(sw / stv).toFixed(4) : 0,
        borrow:           sbv > 0 ? +(bw / sbv).toFixed(4) : 0,
        spread:           (stv > 0 && sbv > 0) ? +((bw/sbv)-(sw/stv)).toFixed(4) : 0,
        utilization:      stv > 0 ? +(sbv / (stv + 1)).toFixed(4) : 0,
        total_supply_usd: stv,
        total_borrow_usd: sbv,
        market_count:     pools.length,
      },
      pools,
    });
  } catch (e) {
    res.status(500).json({ status: "error", error: e.message });
  }
}
