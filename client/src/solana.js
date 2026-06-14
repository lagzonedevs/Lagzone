/* Real USDC (SPL) payment on Solana mainnet via Phantom.
   Built manually so we only need @solana/web3.js. Robust against flaky RPCs:
   - uses CreateIdempotent for the recipient ATA (no getAccountInfo read needed)
   - tries a list of browser-friendly RPCs for the blockhash, and falls back to
     letting Phantom populate it. */
import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";

const RPCS = [
  import.meta.env.VITE_SOLANA_RPC,
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
].filter(Boolean);

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // mainnet USDC
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const TREASURY = new PublicKey("5vMwJm6KbrCa22CvFdsqvkwynBQX3QkYJufbXJLBPJDB");

const ata = (owner) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), USDC_MINT.toBuffer()], ATA_PROGRAM)[0];
const u64le = (n) => { const b = new Uint8Array(8); let v = BigInt(n); for (let i = 0; i < 8; i++) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; };

export function getProvider() { return window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null); }

export async function connectWallet() {
  const p = getProvider();
  if (!p) { window.open("https://phantom.app/", "_blank"); throw new Error("Phantom wallet not found — install it to continue."); }
  const res = await p.connect();
  return res.publicKey.toString();
}

async function getBlockhash() {
  for (const url of RPCS) {
    try { const conn = new Connection(url, "confirmed"); const bh = (await conn.getLatestBlockhash("finalized")).blockhash; return { blockhash: bh, conn }; } catch { /* try next */ }
  }
  return null;
}

/** Send `amountUsdc` USDC from the connected wallet to the treasury. Returns the tx signature. */
export async function payUSDC(amountUsdc) {
  const p = getProvider();
  if (!p) throw new Error("Phantom wallet not found.");
  const { publicKey: payer } = await p.connect();
  const srcAta = ata(payer), dstAta = ata(TREASURY);

  // ensure the treasury USDC account exists (idempotent — no-op if it already does)
  const createDst = new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: dstAta, isSigner: false, isWritable: true },
      { pubkey: TREASURY, isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ], programId: ATA_PROGRAM, data: new Uint8Array([1]), // 1 = CreateIdempotent
  });

  const amount = Math.round(amountUsdc * 1e6); // USDC = 6 decimals
  const data = new Uint8Array(9); data[0] = 3; data.set(u64le(amount), 1); // 3 = Transfer
  const transfer = new TransactionInstruction({
    keys: [
      { pubkey: srcAta, isSigner: false, isWritable: true },
      { pubkey: dstAta, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: false },
    ], programId: TOKEN_PROGRAM, data,
  });

  const tx = new Transaction().add(createDst, transfer);
  tx.feePayer = payer;
  const bh = await getBlockhash();
  if (bh) tx.recentBlockhash = bh.blockhash; // else Phantom will populate it on send

  const res = await p.signAndSendTransaction(tx);
  const signature = res.signature || res;
  if (bh?.conn) { try { await bh.conn.confirmTransaction(signature, "confirmed"); } catch { /* best-effort */ } }
  return signature;
}
