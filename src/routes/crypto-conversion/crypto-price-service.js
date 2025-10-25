// crypto-price-service.js
class CryptoPriceService {
  constructor() {
    this.priceData = {
      prices: { BTC: 0, ETH: 0, SOL: 0 },
      lastUpdated: 0,
      isUpdating: false
    }
    
    this.updateInterval = null
    this.UPDATE_INTERVAL = 5 * 60 * 1000 // 5 minutes
    this.COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || ''
    
    this.initializeService()
  }

  async initializeService() {
    // Fetch initial prices
    await this.updatePrices()
    
    // Set up recurring updates every 5 minutes
    this.updateInterval = setInterval(() => {
      this.updatePrices()
    }, this.UPDATE_INTERVAL)
    
    console.log('Crypto price service initialized with 5-minute updates')
  }

  async updatePrices() {
    if (this.priceData.isUpdating) {
      console.log('Price update already in progress, skipping...')
      return
    }

    this.priceData.isUpdating = true
    console.log('Updating crypto prices...')

    try {
      // Single API call to get all prices at once
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd',
        {
          headers: {
            'Accept': 'application/json',
            'x-cg-demo-api-key': this.COINGECKO_API_KEY
          }
        }
      )

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      
      // Update prices
      this.priceData.prices = {
        BTC: data.bitcoin?.usd || 0,
        ETH: data.ethereum?.usd || 0,
        SOL: data.solana?.usd || 0
      }
      
      this.priceData.lastUpdated = Date.now()
      
      console.log('Crypto prices updated:', {
        BTC: `$${this.priceData.prices.BTC}`,
        ETH: `$${this.priceData.prices.ETH}`,
        SOL: `$${this.priceData.prices.SOL}`,
        timestamp: new Date().toISOString()
      })

    } catch (error) {
      console.error('Failed to update crypto prices:', error)
      // Keep using existing prices if update fails
    } finally {
      this.priceData.isUpdating = false
    }
  }

  // Get current prices (no API call, uses cached data)
  getPrices() {
    return { ...this.priceData.prices }
  }

  // Get specific crypto price
  getPrice(symbol) {
    const upperSymbol = symbol.toUpperCase()
    return this.priceData.prices[upperSymbol] || 0
  }

  // Calculate conversion from USD to crypto
  convertUSDToCrypto(usdAmount, cryptoSymbol) {
    const cryptoPrice = this.getPrice(cryptoSymbol)
    
    if (cryptoPrice === 0) {
      throw new Error(`Price not available for ${cryptoSymbol}`)
    }
    
    return usdAmount / cryptoPrice
  }

  // Get price metadata
  getPriceInfo() {
    return {
      prices: this.getPrices(),
      lastUpdated: this.priceData.lastUpdated,
      lastUpdatedFormatted: new Date(this.priceData.lastUpdated).toISOString(),
      nextUpdateIn: this.UPDATE_INTERVAL - (Date.now() - this.priceData.lastUpdated),
      isUpdating: this.priceData.isUpdating
    }
  }

  // Force price update (useful for testing or manual refresh)
  async forceUpdate() {
    await this.updatePrices()
  }

  // Check if prices are stale (older than 6 minutes as safety buffer)
  arePricesStale() {
    const STALE_THRESHOLD = 6 * 60 * 1000 // 6 minutes
    return Date.now() - this.priceData.lastUpdated > STALE_THRESHOLD
  }

  // Cleanup method
  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval)
      this.updateInterval = null
    }
    console.log('Crypto price service destroyed')
  }
}

// Create singleton instance
const cryptoPriceService = new CryptoPriceService()

export { cryptoPriceService }
