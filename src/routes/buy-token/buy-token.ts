import express, { type Request, type Response } from "express";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import {
  LAUNCHPAD_PROGRAM_ADDRESS,
  getBuyTokenInstructionDataEncoder,
  fetchMaybeLaunchpadState,
} from "../../../dist/js-client";
import { createSolanaRpc } from '@solana/rpc';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID as SPL_TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

const router = express.Router();

const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const TOKEN_PROGRAM_ID = SPL_TOKEN_PROGRAM_ID.toBase58();
const ASSOCIATED_TOKEN_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
const LAMPORTS_PER_SOL = 1_000_000_000n; // Use BigInt for lamports

function toBigInt(value: string | number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  return BigInt(value);
}

function toBase64(data: unknown): string {
  const view = data instanceof Uint8Array ? data : Uint8Array.from(data as ArrayLike<number>);
  return Buffer.from(view).toString("base64");
}

type BuyRequestBody = Readonly<{
    launchpadStateAddress: string;
    solAmount: string | number | bigint; // User wants to spend this much SOL
    buyer: string;
}>;

router.post("/buy", async (req: Request, res: Response) => {
    try {
        const body = req.body as BuyRequestBody;

        const required = ["launchpadStateAddress", "solAmount", "buyer"];
        for (const k of required) {
            if (!(k in body) || (body as any)[k] === undefined) {
                return res.status(400).json({ error: `Missing field: ${k}` });
            }
        }

        const { launchpadStateAddress, solAmount, buyer } = body;

        // --- 1. Fetch current launchpad state ---
        const rpc = createSolanaRpc(process.env.RPC_URL || 'https://api.devnet.solana.com');

        const maybeAccount = await fetchMaybeLaunchpadState(rpc, launchpadStateAddress as any);
        if (!maybeAccount.exists) {
            return res.status(404).json({ error: 'Launchpad state account not found' });
        }

        const launchpadData = maybeAccount.data;

        if (launchpadData.mint.__option !== 'Some' || launchpadData.tokenVault.__option !== 'Some') {
            return res.status(400).json({ error: 'Token mint or vault not initialized in launchpad data' });
        }
        const mintAddress = launchpadData.mint.value;
        const tokenVaultAddress = launchpadData.tokenVault.value;

        // --- 2. Define our AMM parameters from the contract ---
        const virtualSolReserves = toBigInt(launchpadData.virtualSolReserves);
        const virtualTokenReserves = toBigInt(launchpadData.virtualTokenReserves);
        const k = toBigInt(launchpadData.k);
        const solAmountLamports = toBigInt(solAmount) * LAMPORTS_PER_SOL; // SOL amount in lamports

        // --- 3. Calculate token amount using AMM constant product formula ---
        // For buying: x * y = k (constant product)
        // After buying: (x + Δx) * (y - Δy) = k
        // Where: x = virtualSolReserves, y = virtualTokenReserves
        //        Δx = solAmountLamports (SOL going in)
        //        Δy = tokenAmount (tokens coming out)
        //
        // Solving: (x + Δx) * (y - Δy) = k
        //          Δy = y - (k / (x + Δx))
        
        if (virtualSolReserves === 0n || virtualTokenReserves === 0n) {
            return res.status(400).json({ error: 'Invalid launchpad state: Virtual reserves are zero.' });
        }

        // Calculate token amount WITH decimals (as stored in virtual reserves)
        const tokenAmountWithDecimals = (solAmountLamports * virtualTokenReserves) / (virtualSolReserves + solAmountLamports);

        if (tokenAmountWithDecimals <= 0n) {
             return res.status(400).json({ error: 'SOL amount is too low to purchase any tokens.' });
        }

        // Convert to raw token amount (remove 6 decimals) for the contract
        // The contract expects raw tokens and will add decimals internally
        const tokenAmount = tokenAmountWithDecimals / 1_000_000n;

        console.log('Buy instruction calculation:', {
            solAmount: solAmount.toString(),
            solAmountLamports: solAmountLamports.toString(),
            virtualSolReserves: virtualSolReserves.toString(),
            virtualTokenReserves: virtualTokenReserves.toString(),
            k: k.toString(),
            tokenAmountWithDecimals: tokenAmountWithDecimals.toString(),
            calculatedTokenAmount: tokenAmount.toString(),
            calculatedTokenAmountReadable: `${tokenAmount.toString()} tokens`,
        });

        // --- 4. Get all required PDAs and accounts ---
        const [launchpadAuthority] = await getProgramDerivedAddress({
            programAddress: LAUNCHPAD_PROGRAM_ADDRESS,
            seeds: [
                Buffer.from("launchpad_authority"),
                getAddressEncoder().encode(launchpadStateAddress as any),
            ],
        });

        const [solVault] = await getProgramDerivedAddress({
            programAddress: LAUNCHPAD_PROGRAM_ADDRESS,
            seeds: [
                Buffer.from("sol_vault"),
                getAddressEncoder().encode(launchpadStateAddress as any),
            ],
        });

        const buyerTokenAccountAddress = await getAssociatedTokenAddress(
            new PublicKey(mintAddress),
            new PublicKey(buyer),
            false
        );
        
        // --- 5. Build the instruction ---
        const buyTokenData = getBuyTokenInstructionDataEncoder().encode({
            tokenAmount: tokenAmount, // Pass raw token amount (without decimals)
        });

        const buyTokenKeys = [
            { pubkey: launchpadStateAddress, isSigner: false, isWritable: true },
            { pubkey: launchpadAuthority, isSigner: false, isWritable: false },
            { pubkey: solVault, isSigner: false, isWritable: true },
            { pubkey: tokenVaultAddress, isSigner: false, isWritable: true },
            { pubkey: mintAddress, isSigner: false, isWritable: true },
            { pubkey: buyer, isSigner: true, isWritable: true },
            { pubkey: buyerTokenAccountAddress.toBase58(), isSigner: false, isWritable: true },
            { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false },
        ];

        return res.json({
            programId: LAUNCHPAD_PROGRAM_ADDRESS,
            instruction: {
                programId: LAUNCHPAD_PROGRAM_ADDRESS,
                keys: buyTokenKeys,
                data: toBase64(buyTokenData),
            },
            // Include debug info for verification
            debug: {
                tokenAmountWithDecimals: tokenAmountWithDecimals.toString(),
                tokenAmountRaw: tokenAmount.toString(),
                estimatedTokens: `${tokenAmount.toString()} tokens`,
            }
        });

    } catch (e) {
        const err = e as Error;
        console.error("Error in /buy endpoint:", err);
        return res.status(500).json({ error: err.message });
    }
});

export default router;