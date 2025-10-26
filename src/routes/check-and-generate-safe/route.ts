import express, { type Request, type Response } from "express";
import {
  fetchMaybeLaunchpadState,
  LaunchpadStatus,
} from "../../../dist/js-client";
import { createSolanaRpc } from '@solana/rpc';
import { address } from '@solana/addresses';

const router = express.Router();

const SAFE_AGENT_BRIDGE_URL = 'http://localhost:8000';

// Track which launchpads have already had SAFE generated to avoid duplicates
// Store both the address and the document info
const safeGeneratedCache = new Map<string, { pdfUrl: string, filename: string }>();

type CheckAndGenerateRequestBody = Readonly<{
    launchpadStateAddress: string;
}>;

router.post("/", async (req: Request, res: Response) => {
    try {
        const body = req.body as CheckAndGenerateRequestBody;

        if (!body || !body.launchpadStateAddress) {
            return res.status(400).json({ 
                error: "Missing field: launchpadStateAddress"
            });
        }

        const { launchpadStateAddress } = body;
        const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';

        // Check if we already generated SAFE for this launchpad
        const cachedDoc = safeGeneratedCache.get(launchpadStateAddress);
        if (cachedDoc) {
            console.log('📋 Returning cached SAFE document:', cachedDoc);
            return res.json({
                success: true,
                message: "SAFE document already generated for this launchpad",
                alreadyGenerated: true,
                safeDocument: cachedDoc
            });
        }

        // Fetch current launchpad state
        const rpc = createSolanaRpc(rpcUrl);
        const maybeAccount = await fetchMaybeLaunchpadState(rpc, address(launchpadStateAddress));
        
        if (!maybeAccount.exists) {
            return res.status(404).json({ error: 'Launchpad state account not found' });
        }

        const launchpadData = maybeAccount.data;
        const statusName = LaunchpadStatus[launchpadData.status];

        console.log(`[check-and-generate-safe] Status for ${launchpadStateAddress}: ${statusName}`);

        // If status is Transition or Safe, generate/return SAFE document
        // Always generate for Safe status too (in case cache was cleared)
        if (launchpadData.status === LaunchpadStatus.Transition || launchpadData.status === LaunchpadStatus.Safe) {
            console.log(`🎉 Status is ${statusName}! Generating SAFE document...`);

            try {
                // Call SAFE generation endpoint
                const safeResponse = await fetch(`${SAFE_AGENT_BRIDGE_URL}/generate-safe`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        campaign: {
                            name: "Sample Company", // This should come from database
                            symbol: "SMPL",
                            elevator_pitch: "Building amazing technology",
                            website_url: "",
                            team_members: [],
                            traction_metrics: [],
                            fundraising_goal: 100,
                            equity_offered: 10,
                            target_raise_sol: parseFloat(launchpadData.solRaiseTarget.toString()) / 1_000_000_000,
                            initial_valuation_sol: 1000,
                        },
                        blockchainData: {
                            solRaised: launchpadData.solRaised.toString(),
                            tokensSold: launchpadData.tokensSold.toString(),
                            solTarget: launchpadData.solRaiseTarget.toString(),
                            tokensForSale: launchpadData.tokensForSale.toString(),
                        },
                        launchpadAddress: launchpadStateAddress,
                    }),
                });

                if (!safeResponse.ok) {
                    const errorText = await safeResponse.text();
                    console.error('SAFE generation error:', errorText);
                    throw new Error(`Failed to generate SAFE: ${errorText}`);
                }

                const safeData = await safeResponse.json();
                
                console.log('[check-and-generate-safe] SAFE generation response:', safeData);

                // Store document info in cache
                const docInfo = {
                    pdfUrl: safeData.pdfUrl,
                    filename: safeData.filename
                };
                
                if (docInfo.pdfUrl && docInfo.filename) {
                    safeGeneratedCache.set(launchpadStateAddress, docInfo);
                    console.log('💾 Cached document info:', docInfo);
                }

                console.log('✅ SAFE document generated successfully!');
                console.log('📄 Document URL:', safeData.pdfUrl);

                return res.json({
                    success: true,
                    message: `SAFE document generated for ${statusName} status`,
                    statusChanged: launchpadData.status === LaunchpadStatus.Transition,
                    newStatus: statusName,
                    safeDocument: safeData,
                });

            } catch (safeError) {
                console.error('Error generating SAFE:', safeError);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to generate SAFE document',
                    details: safeError instanceof Error ? safeError.message : 'Unknown error'
                });
            }
        }

        // Status is not Transition yet
        return res.json({
            success: true,
            message: `Status is ${statusName}, no action needed`,
            statusChanged: false,
            currentStatus: statusName
        });

    } catch (e) {
        const err = e as Error;
        console.error("Error in /check-and-generate-safe endpoint:", err);
        return res.status(500).json({ 
            success: false,
            error: err.message
        });
    }
});

export default router;

