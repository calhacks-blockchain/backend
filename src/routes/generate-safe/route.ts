import express, { type Request, type Response } from "express";
import {
  LAUNCHPAD_PROGRAM_ADDRESS,
  fetchMaybeLaunchpadState,
  LaunchpadStatus,
} from "../../../dist/js-client";
import { createSolanaRpc } from '@solana/rpc';
import { address } from '@solana/addresses';

const router = express.Router();

// AI Agent Bridge URL (Fetch.ai SAFE Agent)
const SAFE_AGENT_BRIDGE_URL = 'http://localhost:8000';

type GenerateSafeRequestBody = Readonly<{
    launchpadStateAddress: string;
}>;

router.post("/", async (req: Request, res: Response) => {
    try {
        console.log('Generate SAFE endpoint called');
        console.log('Body:', req.body);
        
        const body = req.body as GenerateSafeRequestBody;

        if (!body || !body.launchpadStateAddress) {
            return res.status(400).json({ 
                error: "Missing field: launchpadStateAddress"
            });
        }

        const { launchpadStateAddress } = body;
        const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';

        // --- 1. Fetch current launchpad state to verify it's in Transition ---
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
                error: `Launchpad must be in Transition state to generate SAFE. Current state: ${statusName}` 
            });
        }

        console.log('Launchpad is in Transition state, proceeding with SAFE generation');

        // --- 2. Fetch campaign data from database ---
        // Note: You'll need to set up a database client (Supabase, etc.)
        // For now, we'll use a placeholder or you can implement this
        
        // TODO: Implement database query
        // Example with Supabase (pseudo-code):
        // const { data: campaign } = await supabase
        //   .from('token_campaigns')
        //   .select('*')
        //   .eq('launchpad_pubkey', launchpadStateAddress)
        //   .single();

        // For now, create a mock campaign object
        // In production, this should come from your database
        const campaign = {
            name: "Sample Company",
            symbol: "SMPL",
            tagline: "Making the world better",
            elevator_pitch: "We are building amazing technology",
            team_members: [
                { name: "John Doe", role: "CEO" }
            ],
            fundraising_goal: 100,
            equity_offered: 10,
            target_raise_sol: parseFloat(launchpadData.solRaiseTarget.toString()) / 1_000_000_000,
            initial_valuation_sol: 1000,
            website_url: "https://example.com",
        };

        // --- 3. Prepare blockchain data ---
        const blockchainData = {
            solRaised: launchpadData.solRaised.toString(),
            tokensSold: launchpadData.tokensSold.toString(),
            solTarget: launchpadData.solRaiseTarget.toString(),
            tokensForSale: launchpadData.tokensForSale.toString(),
        };

        console.log('Calling Fetch.ai SAFE agent via bridge...');
        console.log('SAFE Agent Bridge URL:', `${SAFE_AGENT_BRIDGE_URL}/generate-safe`);

        // --- 4. Call Fetch.ai SAFE agent via bridge to generate SAFE document ---
        const agentResponse = await fetch(`${SAFE_AGENT_BRIDGE_URL}/generate-safe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                campaign,
                blockchainData,
                launchpadAddress: launchpadStateAddress,
            }),
        });

        if (!agentResponse.ok) {
            const errorText = await agentResponse.text();
            console.error('AI Agent error:', errorText);
            return res.status(500).json({ 
                error: 'Failed to generate SAFE document via AI agent',
                details: errorText
            });
        }

        const agentData = await agentResponse.json();

        console.log('SAFE document generated successfully!');

        return res.json({
            success: true,
            launchpadState: launchpadStateAddress,
            status: 'Transition',
            safeDocument: {
                pdfUrl: agentData.pdfUrl,
                filename: agentData.filename,
            },
            info: {
                solRaised: launchpadData.solRaised.toString(),
                solTarget: launchpadData.solRaiseTarget.toString(),
                tokensSold: launchpadData.tokensSold.toString(),
                tokensForSale: launchpadData.tokensForSale.toString(),
            }
        });

    } catch (e) {
        const err = e as Error;
        console.error("Error in /generate-safe endpoint:", err);
        return res.status(500).json({ 
            success: false,
            error: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

export default router;

