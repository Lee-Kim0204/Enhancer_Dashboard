// api/funding.js
// Vercel Serverless Function - 펀딩 레이트 프록시
// Binance FAPI + Bybit API 를 서버 사이드에서 호출

const BINANCE_SYMBOLS = [
  "BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT",
  "DOGEUSDT","BNBUSDT","PEPEUSDT"
];
const BYBIT_SYMBOLS = [
  "BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","DOGEUSDT"
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  try {
    // Binance + Bybit 병렬 호출
    const [binanceResults, bybitResults] = await Promise.all([
      fetchBinance(),
      fetchBybit(),
    ]);

    const allRates = [...binanceResults, ...bybitResults];

    // 자산별 평균 계산
    const byAsset = {};
    for (const r of allRates) {
      if (!byAsset[r.symbol]) byAsset[r.symbol] = { exchanges: [] };
      byAsset[r.symbol].exchanges.push(r);
    }
    for (const [asset, d] of Object.entries(byAsset)) {
      const avg = d.exchanges.reduce((s, r) => s + r.funding_ann, 0) / d.exchanges.length;
      byAsset[asset].avg_ann = +avg.toFixed(3);
    }

    res.status(200).json({
      status:     "ok",
      updated_at: new Date().toISOString(),
      rates:      allRates,
      by_asset:   byAsset,
    });
  } catch (e) {
    res.status(500).json({ status: "error", error: e.message });
  }
}

async function fetchBinance() {
  const results = await Promise.allSettled(
    BINANCE_SYMBOLS.map(s =>
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${s}`, {
        headers: { "User-Agent": "EnhancerDashboard/1.0" }
      }).then(r => r.json())
    )
  );

  return results
    .filter(r => r.status === "fulfilled" && !r.value.code)
    .map(r => {
      const d = r.value;
      const rate = parseFloat(d.lastFundingRate || 0);
      return {
        symbol:          d.symbol.replace("USDT", ""),
        exchange:        "Binance",
        funding_rate_8h: +(rate * 100).toFixed(6),
        funding_ann:     +(rate * 3 * 365 * 100).toFixed(3),
        mark_price:      parseFloat(d.markPrice || 0),
        next_funding_ts: d.nextFundingTime || 0,
      };
    });
}

async function fetchBybit() {
  const results = await Promise.allSettled(
    BYBIT_SYMBOLS.map(s =>
      fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${s}`, {
        headers: { "User-Agent": "EnhancerDashboard/1.0" }
      }).then(r => r.json())
    )
  );

  return results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => {
      const items = r.value?.result?.list || [];
      return items.map(d => {
        const rate = parseFloat(d.fundingRate || 0);
        return {
          symbol:          d.symbol.replace("USDT", ""),
          exchange:        "Bybit",
          funding_rate_8h: +(rate * 100).toFixed(6),
          funding_ann:     +(rate * 3 * 365 * 100).toFixed(3),
          mark_price:      parseFloat(d.markPrice || 0),
          open_interest:   parseFloat(d.openInterest || 0),
          next_funding_ts: 0,
        };
      });
    });
}
