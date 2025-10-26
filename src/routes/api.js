import express from 'express';
const router = express.Router();
import exampleController from '../controllers/exampleController.js';
import cryptoConversionRoutes from './crypto-conversion/crypto-conversion.js';
import initializeCampaignRoutes from './initialize-campaign/initialize-campaign.ts';
import ohlcvRoutes from './ohlcv.js';
import currentPriceRoutes from './current-price.js';
import buyTokenRoutes from './buy-token/buy-token.ts';
import sellTokenRoutes from './sell-token/sell-token.ts';
import graduateRoutes from './graduate/route.ts';
import generateSafeRoutes from './generate-safe/route.ts';
import checkAndGenerateSafeRoutes from './check-and-generate-safe/route.ts';


router.use('/graduate', graduateRoutes);
router.use('/generate-safe', generateSafeRoutes);
router.use('/check-and-generate-safe', checkAndGenerateSafeRoutes);
router.use('/buy-token', buyTokenRoutes);
router.use('/sell-token', sellTokenRoutes);

// Crypto conversion routes
router.use('/crypto-conversion', cryptoConversionRoutes);

// Campaign initialization routes
router.use('/initialize-campaign', initializeCampaignRoutes);
router.use('/ohlcv', ohlcvRoutes);
router.use('/current-price', currentPriceRoutes);

export default router;