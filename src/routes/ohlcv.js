import express from 'express';
import pg from 'pg';

const router = express.Router();
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

router.get('/:launchpadPubkey', async (req, res) => {
  console.log('Backend received OHLCV request:', { 
    launchpadPubkey: req.params.launchpadPubkey, 
    query: req.query 
  });
  
  try {
    const { launchpadPubkey } = req.params;
    const { from, to, interval = '1m' } = req.query;

    if (!launchpadPubkey) {
      return res.status(400).json({ error: 'launchpadPubkey is required' });
    }

    const bucketMap = {
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '1h': 3600,
      '4h': 14400,
      '1d': 86400,
    };
    const bucket = bucketMap[interval] || 60;

    const params = [launchpadPubkey, bucket];
    let whereClause = '';
    let paramIndex = 3;
    
    if (from && typeof from === 'string') {
      params.push(new Date(parseInt(from, 10)));
      whereClause += ` AND timestamp >= $${paramIndex++}`;
    }
    if (to && typeof to === 'string') {
      params.push(new Date(parseInt(to, 10)));
      whereClause += ` AND timestamp <= $${paramIndex++}`;
    }

    // Standard OHLCV calculation with proper time bucketing
    const sql = `
      SELECT 
        date_trunc('hour', timestamp) + 
        (floor(extract(minute from timestamp) / ($2 / 60)) * ($2 / 60)) * interval '1 minute' as time_bucket,
        MIN(price) as low,
        MAX(price) as high,
        (array_agg(price ORDER BY timestamp ASC))[1] as open,
        (array_agg(price ORDER BY timestamp DESC))[1] as close,
        SUM(volume) as volume,
        COUNT(*) as trade_count,
        COUNT(CASE WHEN type = 'BUY' THEN 1 END) as buy_count,
        COUNT(CASE WHEN type = 'SELL' THEN 1 END) as sell_count
      FROM trades
      WHERE launchpad_pubkey = $1
      ${whereClause}
      GROUP BY time_bucket
      ORDER BY time_bucket ASC
    `;

    const { rows } = await pool.query(sql, params);
    
    const candles = rows.map(r => ({
      time: new Date(r.time_bucket).toISOString(),
      open: parseFloat(r.open),
      high: parseFloat(r.high),
      low: parseFloat(r.low),
      close: parseFloat(r.close),
      volume: parseFloat(r.volume),
      tradeCount: parseInt(r.trade_count, 10),
      buyCount: parseInt(r.buy_count, 10),
      sellCount: parseInt(r.sell_count, 10)
    }));
    
    console.log(`Returning ${candles.length} candles for ${launchpadPubkey}`);
    
    // Debug: Log first few candles to see the data
    if (candles.length > 0) {
      console.log('Sample candle data:', JSON.stringify(candles.slice(0, 3), null, 2));
    }
    
    return res.json({ candles });
    
  } catch (e) {
    console.error('OHLCV query error:', e);
    return res.status(500).json({ error: 'Failed to fetch candles' });
  }
});

export default router;