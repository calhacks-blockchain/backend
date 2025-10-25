  import express, { type Request, type Response } from "express";
  import { getBytesEncoder, getAddressEncoder, getProgramDerivedAddress, Address } from "@solana/kit";
  import { PublicKey } from "@solana/web3.js";
  import {
    LAUNCHPAD_PROGRAM_ADDRESS,
    getInitializeInstructionDataEncoder,
    getCreateTokenInstructionDataEncoder,
  } from "../../../dist/js-client";

  const router = express.Router();

  const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
  const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const SYSVAR_RENT_ID = "SysvarRent111111111111111111111111111111111";
  const METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
  const PLATFORM_AUTHORITY = "5FQZcz1ja7ohFxBgjfbhnSCg9Juxvqj6TNAaDuzjF2XX" as Address;


  function toBigInt(value: string | number | bigint): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(Math.trunc(value));
    return BigInt(value);
  }

  function toBase64(data: unknown): string {
    const view = data instanceof Uint8Array ? data : Uint8Array.from(data as ArrayLike<number>);
    return Buffer.from(view).toString("base64");
  }

  async function getMetadataPDA(mint: string): Promise<string> {
    const [metadataPDA] = await getProgramDerivedAddress({
      programAddress: METADATA_PROGRAM_ID as any,
      seeds: [
        getBytesEncoder().encode(new Uint8Array([109, 101, 116, 97, 100, 97, 116, 97])), // "metadata"
        getAddressEncoder().encode(METADATA_PROGRAM_ID as any),
        getAddressEncoder().encode(mint as any),
      ],
    });
    return metadataPDA;
  }

  type BuildRequestBody = Readonly<{
    authority: string; // wallet pubkey
    launchpadState: string; // state account pubkey
    mint: string; // mint pubkey
    tokenVault: string; // token vault pubkey
    raiseTokenName: string;
    raiseTokenSymbol: string;
    raiseTokenUri: string;
    totalSupply: string | number | bigint;
    tokensForSale: string | number | bigint;
    initialPriceLamportsPerToken: string | number | bigint;
    solRaiseTarget: string | number | bigint;
  }>;

  router.post("/build", async (req: Request, res: Response) => {
    try {
      const body = req.body as BuildRequestBody;

      const required = [
        "authority",
        "launchpadState",
        "mint",
        "tokenVault",
        "raiseTokenName",
        "raiseTokenSymbol",
        "raiseTokenUri",
        "totalSupply",
        "tokensForSale",
        "initialPriceLamportsPerToken",
        "solRaiseTarget",
      ];
      for (const k of required) {
        if (!(k in body) || (body as any)[k] === undefined) {
          return res.status(400).json({ error: `Missing field: ${k}` });
        }
      }

      const {
        authority,
        launchpadState,
        mint,
        tokenVault,
        raiseTokenName,
        raiseTokenSymbol,
        raiseTokenUri,
        totalSupply,
        tokensForSale,
        initialPriceLamportsPerToken,
        solRaiseTarget,
      } = body;

      // Build initialize instruction data
      const initializeData = getInitializeInstructionDataEncoder().encode({
        raiseTokenName,
        raiseTokenSymbol,
        uri: raiseTokenUri,
        totalSupply: toBigInt(totalSupply),
        tokensForSale: toBigInt(tokensForSale),
        initialPriceLamportsPerToken: toBigInt(initialPriceLamportsPerToken),
        solRaiseTarget: toBigInt(solRaiseTarget),
        platformAuthority: PLATFORM_AUTHORITY,
      });

      const initializeKeys = [
        { pubkey: launchpadState, isSigner: true, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: true },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      ];

      // Derive launchpadAuthority PDA the same way as the generated client
      const launchpadAuthority = await getProgramDerivedAddress({
        programAddress: LAUNCHPAD_PROGRAM_ADDRESS,
        seeds: [
          getBytesEncoder().encode(
            new Uint8Array([
              108, 97, 117, 110, 99, 104, 112, 97, 100, 95, 97, 117, 116, 104,
              111, 114, 105, 116, 121,
            ])
          ),
          getAddressEncoder().encode(launchpadState as any),
        ],
      });

      // Calculate metadata PDA
      const metadataAccount = await getMetadataPDA(mint);

      // Build createToken instruction data (discriminator only)
      const createTokenData = getCreateTokenInstructionDataEncoder().encode({});

      const createTokenKeys = [
        { pubkey: launchpadState, isSigner: false, isWritable: true },
        { pubkey: launchpadAuthority[0], isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: true, isWritable: true },
        { pubkey: metadataAccount, isSigner: false, isWritable: true },
        { pubkey: tokenVault, isSigner: true, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: true },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_ID, isSigner: false, isWritable: false },
        { pubkey: METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
      ];

      return res.json({
        programId: LAUNCHPAD_PROGRAM_ADDRESS,
        initialize: {
          programId: LAUNCHPAD_PROGRAM_ADDRESS,
          keys: initializeKeys,
          dataBase64: toBase64(initializeData),
        },
        createToken: {
          programId: LAUNCHPAD_PROGRAM_ADDRESS,
          keys: createTokenKeys,
          dataBase64: toBase64(createTokenData),
        },
      });
    } catch (e) {
      const err = e as Error;
      return res.status(500).json({ error: err.message });
    }
  });

  export default router;

