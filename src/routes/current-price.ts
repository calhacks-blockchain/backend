import express from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js'; // Using BN.js for 128-bit integer support

const router = express.Router();
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

const LAMPORTS_PER_SOL = 1_000_000_000;

// Token decimals constant
const TOKEN_DECIMALS = 6; // Your frontend uses 9 decimals.
const TOKEN_MULTIPLIER = new BN(10).pow(new BN(TOKEN_DECIMALS));

/**
 * Decodes the buffer from the launchpad state account.
 * NOTE: This layout is assumed based on standard bonding curve implementations.
 * You MUST verify this matches your on-chain program's struct layout.
 * @param {Buffer} data The raw account data buffer.
 * @returns An object with the decoded state.
 */
/**
 * Decodes the buffer from the launchpad state account.
 * This layout is based on the program data you provided.
 * @param {Buffer} data The raw account data buffer.
 * @returns An object with the decoded state.
 */
function decodeLaunchpadState(data: Buffer) {
  let offset = 8; // Skip Anchor discriminator

  // Skip authority
  offset += 32; 

  // Skip raiseTokenName
  let len = data.readUInt32LE(offset);
  offset += 4 + len;

  // Skip raiseTokenSymbol
  len = data.readUInt32LE(offset);
  offset += 4 + len;

  // Skip uri
  len = data.readUInt32LE(offset);
  offset += 4 + len;

  // Skip totalSupply
  offset += 8;

  // Skip tokensForSale
  offset += 8;

  // --- READ VALUES IN THE CORRECT ORDER ---
  
  // 1. Read initialPrice
  const initialPriceLamports = new BN(data.slice(offset, offset + 8), 'le');
  offset += 8; // Move past initialPrice

  // 2. Read slope
  const slope = new BN(data.slice(offset, offset + 16), 'le');
  
  // --- THIS IS THE FIX ---
  // We must skip BOTH slope (16 bytes) and solRaised (8 bytes)
  // to get to the real tokensSold field.
  offset += 16; // Move past slope
  offset += 8;  // Move past solRaised
  // --- END OF FIX ---

  // 3. Read tokensSold
  const tokensSoldRaw = new BN(data.slice(offset, offset + 8), 'le');
  // offset += 8; // No more fields to read
  
  return { tokensSoldRaw, initialPriceLamports, slope };
}

router.get('/:launchpadPubkey', async (req, res) => {
  try {
    const { launchpadPubkey } = req.params;
    if (!launchpadPubkey) {
      return res.status(400).json({ error: 'launchpadPubkey is required' });
    }

    // --- Step 1: Fetch the live account data from Solana ---
    const accountInfo = await connection.getAccountInfo(new PublicKey(launchpadPubkey));

    if (!accountInfo) {
      return res.status(404).json({ error: 'Launchpad account not found on-chain.' });
    }

    // --- Step 2: Decode the state from the buffer ---
    const { 
        tokensSoldRaw, 
        initialPriceLamports, 
        slope 
    } = decodeLaunchpadState(accountInfo.data);

    // --- Step 3: Calculate the current price ---
    // Formula: P(s) = P_0 + (m * s)
    // where P_0 is initial price per atomic token, m is slope, s is tokens sold (all in atomic units)
    
    // Step 3a: Calculate price for 1 ATOMIC token in lamports
    const priceIncrease = slope.mul(tokensSoldRaw);
    const currentPriceAtomicLamports = initialPriceLamports.add(priceIncrease);
    
    // Step 3b: Convert to price for 1 FULL token in lamports
    const currentPriceFullTokenLamports = currentPriceAtomicLamports.mul(TOKEN_MULTIPLIER);
    
    // --- Step 4: Convert to a user-friendly format (SOL) ---
    const currentPriceSol = parseFloat(currentPriceFullTokenLamports.toString()) / LAMPORTS_PER_SOL;

    console.log(`Returning live price for ${launchpadPubkey}: ${currentPriceSol} SOL`);

    return res.json({ 
      currentPrice: currentPriceSol,
      currentPriceSol,
      currentPriceLamports: currentPriceFullTokenLamports.toString(), // Price in lamports per FULL token
      debug: {
        atomic: {
          initialPriceLamports: initialPriceLamports.toString(),
          tokensSoldRaw: tokensSoldRaw.toString(),
          slope: slope.toString(),
          priceIncreaseLamports: priceIncrease.toString(),
          currentPriceAtomicLamports: currentPriceAtomicLamports.toString()
        },
        constants: {
          tokenDecimals: TOKEN_DECIMALS,
          tokenMultiplier: TOKEN_MULTIPLIER.toString(),
          lamportsPerSol: LAMPORTS_PER_SOL
        }
      }
    });

  } catch (e) {
    console.error('Failed to fetch live price:', e);
    return res.status(500).json({ error: 'Failed to fetch live price from the blockchain.' });
  }
});

export default router;
