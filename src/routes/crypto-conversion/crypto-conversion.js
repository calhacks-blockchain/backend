import express from 'express';
const router = express.Router();
import { cryptoPriceService } from './crypto-price-service.js';

// Function to format crypto amount based on the crypto type
function formatCryptoAmount(amount, symbol) {
  const decimals = symbol === 'BTC' ? 8 : symbol === 'ETH' ? 6 : 4;
  return amount.toFixed(decimals);
}

// POST /api/crypto-conversion - Convert USD to crypto
router.post('/', async (req, res) => {
  try {
    const { amount, from_currency, to_crypto } = req.body;

    // Validate request
    if (!amount || !from_currency || !to_crypto) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: amount, from_currency, to_crypto'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be greater than 0'
      });
    }

    // Validate supported cryptocurrencies
    const supportedCryptos = ['BTC', 'ETH', 'SOL'];
    if (!supportedCryptos.includes(to_crypto.toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: `Unsupported cryptocurrency: ${to_crypto}. Supported: ${supportedCryptos.join(', ')}`
      });
    }

    // Convert amount to USD first if needed
    let usdAmount = amount;
    if (from_currency.toUpperCase() !== 'USD') {
      // For now, assume the input is already in USD equivalent
      // In production, you'd want to convert from the base currency to USD first
      usdAmount = amount;
    }

    console.log(`Converting $${usdAmount} USD to ${to_crypto.toUpperCase()}`);

    // Check if prices are stale and warn
    if (cryptoPriceService.arePricesStale()) {
      console.warn('Warning: Crypto prices may be stale');
    }

    // Get crypto price from service (no API call!)
    const cryptoPriceUSD = cryptoPriceService.getPrice(to_crypto);
    
    if (cryptoPriceUSD === 0) {
      return res.status(503).json({
        success: false,
        error: `Price data not available for ${to_crypto.toUpperCase()}. Please try again later.`
      });
    }
    
    console.log(`${to_crypto.toUpperCase()} price: $${cryptoPriceUSD} USD (cached)`);
    
    // Calculate crypto amount using cached price
    const cryptoAmount = usdAmount / cryptoPriceUSD;

    console.log(`Product costs ${cryptoAmount} ${to_crypto.toUpperCase()}`);

    // Get price info for response
    const priceInfo = cryptoPriceService.getPriceInfo();

    // Format the response
    const response = {
      success: true,
      data: {
        original_amount: amount,
        original_currency: from_currency.toUpperCase(),
        crypto_amount: cryptoAmount,
        crypto_symbol: to_crypto.toUpperCase(),
        crypto_price_usd: cryptoPriceUSD,
        formatted_crypto_amount: formatCryptoAmount(cryptoAmount, to_crypto.toUpperCase()),
        price_last_updated: priceInfo.lastUpdatedFormatted
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Crypto conversion error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

// GET /api/crypto-conversion - Get current crypto prices
router.get('/', async (req, res) => {
  try {
    // Get current prices and metadata from service
    const priceInfo = cryptoPriceService.getPriceInfo();
    const supportedCryptos = ['BTC', 'ETH', 'SOL'];

    res.status(200).json({
      success: true,
      data: {
        supported_currencies: supportedCryptos,
        prices: priceInfo.prices,
        last_updated: priceInfo.lastUpdatedFormatted,
        next_update_in_ms: priceInfo.nextUpdateIn,
        is_updating: priceInfo.isUpdating,
        prices_are_stale: cryptoPriceService.arePricesStale()
      }
    });
  } catch (error) {
    console.error('Error fetching crypto prices:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cryptocurrency prices'
    });
  }
});

// PATCH /api/crypto-conversion - Force update crypto prices
router.patch('/', async (req, res) => {
  try {
    console.log('Force updating crypto prices...');
    await cryptoPriceService.forceUpdate();
    
    const priceInfo = cryptoPriceService.getPriceInfo();
    
    res.status(200).json({
      success: true,
      message: 'Prices updated successfully',
      data: priceInfo
    });
  } catch (error) {
    console.error('Error force updating prices:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update prices'
    });
  }
});

export default router;
