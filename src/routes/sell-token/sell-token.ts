import express, { type Request, type Response } from "express";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import {
  LAUNCHPAD_PROGRAM_ADDRESS,
  getSellTokenInstructionDataEncoder,
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

/**
 * Calculates the integer square root of a BigInt (Newton's method).
 * This is required for the quadratic formula.
 */
function bigIntSqrt(n: bigint): bigint {
    if (n < 0n) {
        throw new Error("Cannot calculate square root of a negative number");
    }
    if (n === 0n) {
        return 0n;
    }

    let x0 = n;
    let x1 = (n / 2n) + 1n; // Initial guess
    
    // This loop will correctly iterate until it finds the root
    while (x1 < x0) {
        x0 = x1;
        x1 = (n / x0 + x0) / 2n;
    }
    
    return x0;
}

type SellRequestBody = Readonly<{
    launchpadStateAddress: string; // The public key of the launchpad state account
    tokenAmount?: string | number | bigint; // The amount of tokens to sell (optional if solAmount is provided)
    solAmount?: string | number | bigint; // The amount of SOL to receive (optional if tokenAmount is provided)
    seller: string; // The public key of the user selling the tokens
}>;

router.post("/sell", async (req: Request, res: Response) => {
    try {
        const body = req.body as SellRequestBody;

        const required = ["launchpadStateAddress", "seller"];
        for (const k of required) {
            if (!(k in body) || (body as any)[k] === undefined) {
                return res.status(400).json({ error: `Missing field: ${k}` });
            }
        }

        // Validate that either tokenAmount or solAmount is provided, but not both
        if (!body.tokenAmount && !body.solAmount) {
            return res.status(400).json({ error: "Either tokenAmount or solAmount must be provided" });
        }
        if (body.tokenAmount && body.solAmount) {
            return res.status(400).json({ error: "Provide either tokenAmount or solAmount, not both" });
        }

        const { launchpadStateAddress, tokenAmount, solAmount, seller } = body;

        // 1. Set up RPC connection to fetch the launchpad state account.
        const rpc = createSolanaRpc(process.env.RPC_URL || 'https://api.devnet.solana.com');

        // 2. Fetch the launchpad state account from the blockchain.
        const maybeAccount = await fetchMaybeLaunchpadState(rpc, launchpadStateAddress as any);
        if (!maybeAccount.exists) {
            return res.status(404).json({ error: 'Launchpad state account not found' });
        }

        const launchpadData = maybeAccount.data;

        // 3. Extract the mint and tokenVault addresses from the fetched data.
        if (launchpadData.mint.__option !== 'Some' || launchpadData.tokenVault.__option !== 'Some') {
            return res.status(400).json({ error: 'Token mint or vault not initialized in launchpad data' });
        }
        const mintAddress = launchpadData.mint.value;
        const tokenVaultAddress = launchpadData.tokenVault.value;

        // 4. Calculate token amount if solAmount is provided, or validate tokenAmount
        let finalTokenAmount: bigint;
        
        if (solAmount !== undefined) {
            // --- Calculate token amount from SOL amount using AMM constant product formula ---
            // Define our AMM parameters from the contract
            const virtualSolReserves = toBigInt(launchpadData.virtualSolReserves);
            const virtualTokenReserves = toBigInt(launchpadData.virtualTokenReserves);
            const k = toBigInt(launchpadData.k);
            const solAmountLamports = toBigInt(solAmount) * LAMPORTS_PER_SOL; // SOL amount user wants to receive in lamports

            // For selling: x * y = k (constant product)
            // After selling: (x - Δx) * (y + Δy) = k
            // Where: x = virtualSolReserves, y = virtualTokenReserves
            //        Δx = solAmountLamports (SOL going out)
            //        Δy = tokenAmount (tokens going in)
            //
            // Solving: (x - Δx) * (y + Δy) = k
            //          (x - Δx) * y + (x - Δx) * Δy = k
            //          (x - Δx) * y - k = -(x - Δx) * Δy
            //          k - (x - Δx) * y = (x - Δx) * Δy
            //          Δy = [k - (x - Δx) * y] / (x - Δx)
            //          Δy = [k - x*y + Δx*y] / (x - Δx)
            //          Δy = [k - k + Δx*y] / (x - Δx)  (since x*y = k)
            //          Δy = Δx*y / (x - Δx)
            
            if (virtualSolReserves === 0n || virtualTokenReserves === 0n) {
                return res.status(400).json({ error: 'Invalid launchpad state: Virtual reserves are zero.' });
            }

            if (solAmountLamports >= virtualSolReserves) {
                return res.status(400).json({ error: 'SOL amount exceeds available reserves.' });
            }

            // Calculate token amount WITH decimals (as stored in virtual reserves)
            const tokenAmountWithDecimals = (solAmountLamports * virtualTokenReserves) / (virtualSolReserves - solAmountLamports);

            if (tokenAmountWithDecimals <= 0n) {
                 return res.status(400).json({ error: 'SOL amount is too low to sell any tokens.' });
            }

            // Convert to raw token amount (remove 6 decimals) for the contract
            // The contract expects raw tokens and will add decimals internally
            finalTokenAmount = tokenAmountWithDecimals / 1_000_000n;

            console.log('Sell instruction calculation:', {
                solAmount: solAmount.toString(),
                solAmountLamports: solAmountLamports.toString(),
                virtualSolReserves: virtualSolReserves.toString(),
                virtualTokenReserves: virtualTokenReserves.toString(),
                k: k.toString(),
                tokenAmountWithDecimals: tokenAmountWithDecimals.toString(),
                calculatedTokenAmount: finalTokenAmount.toString(),
                calculatedTokenAmountReadable: `${finalTokenAmount.toString()} tokens`,
            });
        } else {
            // Use provided tokenAmount
            finalTokenAmount = toBigInt(tokenAmount!);
        }

        // 5. Derive the SOL vault PDA (where SOL is stored and will be sent from).
        const [solVault] = await getProgramDerivedAddress({
            programAddress: LAUNCHPAD_PROGRAM_ADDRESS,
            seeds: [
                Buffer.from("sol_vault"),
                getAddressEncoder().encode(launchpadStateAddress as any),
            ],
        });

        // 6. Derive the seller's Associated Token Account (ATA).
        // This account must already exist and contain tokens to sell.
        const sellerTokenAccountAddress = await getAssociatedTokenAddress(
            new PublicKey(mintAddress),
            new PublicKey(seller),
            false
        );

        // 7. Encode the instruction data.
        const sellTokenData = getSellTokenInstructionDataEncoder().encode({
            tokenAmount: finalTokenAmount,
        });

        // 8. Define the accounts for the instruction.
        // CRITICAL: The order MUST match the Rust program's SellToken struct exactly!
        const sellTokenKeys = [
            // launchpad_state (mutable, tracking tokens_sold and sol_raised)
            { pubkey: launchpadStateAddress, isSigner: false, isWritable: true },
            // sol_vault (PDA, mutable because SOL is transferred out to seller)
            { pubkey: solVault, isSigner: false, isWritable: true },
            // token_vault (mutable because receiving tokens back)
            { pubkey: tokenVaultAddress, isSigner: false, isWritable: true },
            // mint (mutable for validation)
            { pubkey: mintAddress, isSigner: false, isWritable: true },
            // seller (signer, mutable because receiving SOL)
            { pubkey: seller, isSigner: true, isWritable: true },
            // seller_token_account (the ATA, mutable because tokens are transferred out)
            { pubkey: sellerTokenAccountAddress.toBase58(), isSigner: false, isWritable: true },
            // system_program (required for SOL transfers)
            { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
            // token_program (required for token transfers)
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            // associated_token_program (for ATA validation)
            { pubkey: ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false },
        ];

        // 9. Return the complete, serialized instruction.
        return res.json({
            programId: LAUNCHPAD_PROGRAM_ADDRESS,
            instruction: {
                programId: LAUNCHPAD_PROGRAM_ADDRESS,
                keys: sellTokenKeys,
                data: toBase64(sellTokenData),
            },
        });

    } catch (e) {
        const err = e as Error;
        console.error("Error in /sell endpoint:", err);
        return res.status(500).json({ error: err.message });
    }
});

export default router;