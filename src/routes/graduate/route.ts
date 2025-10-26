import express, { type Request, type Response } from "express";
import {
  LAUNCHPAD_PROGRAM_ADDRESS,
  getGraduateToSafeInstructionDataEncoder,
  fetchMaybeLaunchpadState,
  LaunchpadStatus,
} from "../../../dist/js-client";
import { createSolanaRpc } from '@solana/rpc';
import { address } from '@solana/addresses';
import {
  Keypair,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import bs58 from 'bs58';

const router = express.Router();

// Platform authority keypair loaded from environment
const PLATFORM_AUTHORITY_SECRET_KEY = process.env.PLATFORM_AUTHORITY_SECRET_KEY || '4eNHsPkW12JmTZFUGuft9gTYLb1jJkoncJuP94AJu1kRHQ6chQ21qM7n3g8grojhco4JiLjKHRGdU2HfdjFJeYqj';
if (!PLATFORM_AUTHORITY_SECRET_KEY) {
    throw new Error("PLATFORM_AUTHORITY_SECRET_KEY environment variable not set");
}

const PLATFORM_AUTHORITY_KEYPAIR = Keypair.fromSecretKey(
    bs58.decode(PLATFORM_AUTHORITY_SECRET_KEY)
);

type GraduateRequestBody = Readonly<{
    launchpadStateAddress: string;
}>;

router.post("/", async (req: Request, res: Response) => {
    try {
        // Debug logging
        console.log('Graduate endpoint called');
        console.log('Headers:', req.headers);
        console.log('Body:', req.body);
        console.log('Query:', req.query);
        
        const body = req.body as GraduateRequestBody;

        if (!body || !body.launchpadStateAddress) {
            return res.status(400).json({ 
                error: "Missing field: launchpadStateAddress",
                received: {
                    body: req.body,
                    query: req.query,
                    contentType: req.headers['content-type']
                }
            });
        }

        const { launchpadStateAddress } = body;
        const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';

        // --- 1. Fetch current launchpad state to verify it exists and check status ---
        const rpc = createSolanaRpc(rpcUrl);

        const maybeAccount = await fetchMaybeLaunchpadState(rpc, address(launchpadStateAddress));
        if (!maybeAccount.exists) {
            return res.status(404).json({ error: 'Launchpad state account not found' });
        }

        const launchpadData = maybeAccount.data;

        // Verify the launchpad is in Transition state
        if (launchpadData.status !== LaunchpadStatus.Transition) {
            const statusName = LaunchpadStatus[launchpadData.status];
            return res.status(400).json({ 
                error: `Launchpad must be in Transition state to graduate. Current state: ${statusName}` 
            });
        }

        // Verify the platform authority matches
        const platformAuthorityAddress = PLATFORM_AUTHORITY_KEYPAIR.publicKey.toBase58();
        const launchpadPlatformAuthority = launchpadData.platformAuthority;
            
        if (launchpadPlatformAuthority !== platformAuthorityAddress) {
            return res.status(403).json({ 
                error: 'Platform authority keypair does not match the launchpad platform authority',
                expected: launchpadPlatformAuthority,
                actual: platformAuthorityAddress
            });
        }

        // --- 2. Build the graduate instruction ---
        const graduateData = getGraduateToSafeInstructionDataEncoder().encode({});

        const instruction = new TransactionInstruction({
            programId: new PublicKey(LAUNCHPAD_PROGRAM_ADDRESS),
            keys: [
                { pubkey: new PublicKey(launchpadStateAddress), isSigner: false, isWritable: true },
                { pubkey: PLATFORM_AUTHORITY_KEYPAIR.publicKey, isSigner: true, isWritable: true },
            ],
            data: Buffer.from(graduateData),
        });

        // --- 3. Create and sign the transaction ---
        const connection = new Connection(rpcUrl, 'confirmed');
        const transaction = new Transaction().add(instruction);

        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = blockhash;
        transaction.lastValidBlockHeight = lastValidBlockHeight;
        transaction.feePayer = PLATFORM_AUTHORITY_KEYPAIR.publicKey;

        // Sign the transaction with platform authority
        transaction.sign(PLATFORM_AUTHORITY_KEYPAIR);

        console.log('Graduating launchpad:', {
            launchpadState: launchpadStateAddress,
            platformAuthority: platformAuthorityAddress,
            currentStatus: LaunchpadStatus[launchpadData.status],
            solRaised: launchpadData.solRaised.toString(),
            tokensSold: launchpadData.tokensSold.toString(),
        });

        // --- 4. Send and confirm the transaction ---
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [PLATFORM_AUTHORITY_KEYPAIR],
            {
                commitment: 'confirmed',
                skipPreflight: false,
            }
        );

        console.log('Graduation successful! Signature:', signature);

        return res.json({
            success: true,
            signature,
            launchpadState: launchpadStateAddress,
            previousStatus: 'Transition',
            newStatus: 'Safe',
            info: {
                solRaised: launchpadData.solRaised.toString(),
                solTarget: launchpadData.solRaiseTarget.toString(),
                tokensSold: launchpadData.tokensSold.toString(),
                tokensForSale: launchpadData.tokensForSale.toString(),
            }
        });

    } catch (e) {
        const err = e as Error;
        console.error("Error in /graduate endpoint:", err);
        return res.status(500).json({ 
            success: false,
            error: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

export default router;