import { createAppKit } from "@reown/appkit/react";
import { SolanaAdapter } from "@reown/appkit-adapter-solana/react";
import { solana, solanaDevnet } from "@reown/appkit/networks";

// 0. Set up Solana Adapter
const solanaWeb3JsAdapter = new SolanaAdapter();

// 1. Get projectId from environment or use a placeholder
const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "YOUR_PROJECT_ID";

// 2. Create a metadata object
const metadata = {
  name: "CBAY",
  description: "The Crypto Bay - Purchase anything with crypto",
  url: process.env.NEXT_PUBLIC_BASE_URL || "https://thecbay.com",
  icons: ["/logo.png"],
};

// 3. Create modal (initialize only once) - Mainnet only
let appKitInstance = null;

export const initializeAppKit = () => {
  if (typeof window !== 'undefined' && !appKitInstance) {
    appKitInstance = createAppKit({
      adapters: [solanaWeb3JsAdapter],
      networks: [solana, solanaDevnet], // Include both mainnet and devnet
      metadata: metadata,
      projectId,
      features: {
        analytics: true,
        email: false,           // Disable email
        socials: false,         // Disable social logins
        emailShowWallets: true, // Show wallets when email disabled
        onramp: false,          // Disable on-ramp features
      },
      themeMode: 'dark',        // Optional: set theme
      themeVariables: {
        '--w3m-z-index': 1000
      }
    });
    return appKitInstance;
  }
  return appKitInstance;
};

export const getAppKit = () => appKitInstance;
