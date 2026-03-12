import fs from 'node:fs';
import path from 'node:path';
import { makeAddress, makeSignature, makeValue } from '@helios-lang/ledger';
import { makeBlockfrostV0Client, makeTxBuilder, NetworkName } from '@helios-lang/tx-utils';
import { calculateTxHash, csl } from '@meshsdk/core-csl';
import { bech32 } from 'bech32';
import { buildTransaction as buildUpdateSubSettingsTx } from '../../handle.me/bff/handlers/updateSubSettings/buildTransaction';
import { meshUtxoToCbor } from '../../handle.me/bff/lib/mesh/converters';
import { getBlockfrostApiKey, getHandlecontractPaymentAddress } from '../../minting.handle.me/src/helpers/constants';
import { getPolicyWalletDetails } from '../../minting.handle.me/src/helpers/getWalletDetails';
import { submitTransaction } from '../../minting.handle.me/src/helpers/blockfrost';

type BlockfrostAmount = { unit: string; quantity: string };
type BlockfrostUtxo = {
  tx_hash: string;
  output_index: number;
  address: string;
  amount: BlockfrostAmount[];
  data_hash: string | null;
  inline_datum: string | null;
  reference_script_hash: string | null;
};

type HandleRecord = {
  utxo: string;
  resolved_addresses?: { ada?: string };
};

const NETWORK = 'PREPROD';
process.env.NETWORK = NETWORK;
process.env.NODE_ENV = 'local';

const ROOT_HANDLE = 'handlecontract';
const ROOT_ADDRESS = getHandlecontractPaymentAddress();
const OUT_DIR = path.resolve(process.cwd(), 'tasks/tmp/preprod-handlecontract-root-setup');
const FUNDING_LOVELACE = 30_000_000n;

const SETTINGS = {
  nft: {
    public_minting_enabled: false,
    pz_enabled: false,
    tier_pricing: [[1, 0]],
    default_styles: {},
    save_original_address: false,
  },
  virtual: {
    public_minting_enabled: false,
    pz_enabled: false,
    tier_pricing: [[1, 0]],
    default_styles: {},
    save_original_address: false,
  },
  buy_down_price: 0,
  buy_down_paid: 0,
  buy_down_percent: 0,
  payment_address: ROOT_ADDRESS,
  migrate_sig_required: false,
};

const patchPolicyKeyParser = () => {
  const original = csl.Bip32PrivateKey.from_bech32;
  csl.Bip32PrivateKey.from_bech32 = ((value: string) => {
    const { words } = bech32.decode(String(value).trim(), 1000);
    return csl.Bip32PrivateKey.from_bytes(Buffer.from(bech32.fromWords(words)));
  }) as typeof csl.Bip32PrivateKey.from_bech32;
  return () => {
    csl.Bip32PrivateKey.from_bech32 = original;
  };
};

const ensureDir = () => fs.mkdirSync(OUT_DIR, { recursive: true });
const writeJson = (name: string, data: unknown) => fs.writeFileSync(path.join(OUT_DIR, name), `${JSON.stringify(data, null, 2)}\n`);
const writeHex = (name: string, hex: string) => fs.writeFileSync(path.join(OUT_DIR, name), `${hex}\n`);
const writeBytes = (name: string, bytes: Uint8Array) => fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(bytes));

const toMeshAmount = (amount: BlockfrostAmount[]) => amount.map((entry) => ({ unit: entry.unit, quantity: entry.quantity }));
const utxoToCbor = (utxo: BlockfrostUtxo) => meshUtxoToCbor({
  input: { txHash: utxo.tx_hash, outputIndex: utxo.output_index },
  output: {
    address: utxo.address,
    amount: toMeshAmount(utxo.amount),
    dataHash: utxo.data_hash ?? undefined,
    plutusData: utxo.inline_datum ?? undefined,
  },
});

const fetchAddressUtxos = async (address: string): Promise<BlockfrostUtxo[]> => {
  const response = await fetch(`https://cardano-preprod.blockfrost.io/api/v0/addresses/${address}/utxos`, {
    headers: { project_id: getBlockfrostApiKey() },
  });
  if (!response.ok) throw new Error(`Blockfrost address utxos failed: ${response.status} ${response.statusText} ${await response.text()}`);
  return (await response.json()) as BlockfrostUtxo[];
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { headers: { 'User-Agent': 'kora-backend-request/1.0' } });
  if (!response.ok) throw new Error(`fetch failed ${response.status} ${response.statusText}: ${url}`);
  return (await response.json()) as T;
};

const fetchTxStatus = async (txHash: string) => {
  const response = await fetch(`https://cardano-preprod.blockfrost.io/api/v0/txs/${txHash}`, {
    headers: { project_id: getBlockfrostApiKey() },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Blockfrost tx lookup failed: ${response.status} ${response.statusText}`);
  return await response.json();
};

const getNonHandleLovelace = (utxos: BlockfrostUtxo[]) =>
  utxos
    .filter((utxo) => !utxo.amount.some((a) => a.unit === `${process.env.POLICY_ID}${'000de140'}${Buffer.from(ROOT_HANDLE).toString('hex')}`))
    .reduce((total, utxo) => total + BigInt(utxo.amount.find((a) => a.unit === 'lovelace')?.quantity ?? '0'), 0n);

const waitForTx = async (txHash: string, label: string) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const found = await fetchTxStatus(txHash);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`${label} tx ${txHash} not confirmed in time`);
};

const submitFundingTx = async () => {
  const feeWallet = await getPolicyWalletDetails(5);
  const feeWalletAddress = feeWallet.address.toBech32();
  const cardanoClient = makeBlockfrostV0Client('preprod' as NetworkName, getBlockfrostApiKey());
  const txBuilder = makeTxBuilder({ isMainnet: false });
  const feeUtxos = await cardanoClient.getUtxos(makeAddress(feeWalletAddress));
  if (feeUtxos.length === 0) throw new Error('No fee wallet UTxOs for derivation 5');
  for (const utxo of feeUtxos) txBuilder.spendUnsafe(utxo);
  txBuilder.payUnsafe(makeAddress(ROOT_ADDRESS), makeValue(FUNDING_LOVELACE));
  const builtTx = await txBuilder.buildUnsafe({
    networkParams: await cardanoClient.parameters,
    changeAddress: makeAddress(feeWalletAddress),
    spareUtxos: feeUtxos,
  });
  if (builtTx.hasValidationError) throw new Error(`Funding validation error: ${builtTx.hasValidationError}`);
  const bodyHash = Buffer.from(builtTx.body.hash());
  builtTx.addSignature(makeSignature([...feeWallet.publicKey], [...feeWallet.privateKey.sign(bodyHash)]));
  const txHash = builtTx.id().toHex();
  writeBytes('01-fund-root.full.tx.cbor', builtTx.toCbor());
  writeHex('01-fund-root.full.tx.cbor.hex', Buffer.from(builtTx.toCbor()).toString('hex'));
  writeJson('01-fund-root.summary.json', { txHash, feeWalletAddress, rootAddress: ROOT_ADDRESS, fundingLovelace: FUNDING_LOVELACE.toString() });
  await submitTransaction(builtTx.toCbor());
  return txHash;
};

const signWithRootWallet = async (txCborHex: string) => {
  const rootWallet = await getPolicyWalletDetails(12);
  const tx = csl.Transaction.from_hex(txCborHex);
  const txHash = csl.TransactionHash.from_hex(calculateTxHash(txCborHex));
  const witness = csl.make_vkey_witness(txHash, csl.PrivateKey.from_extended_bytes(rootWallet.privateKey.toBytes()));
  const witnessSet = tx.witness_set();
  const vkeys = witnessSet.vkeys() ?? csl.Vkeywitnesses.new();
  vkeys.add(witness);
  witnessSet.set_vkeys(vkeys);
  const signedTx = csl.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());
  signedTx.set_is_valid(tx.is_valid());
  return signedTx;
};

const buildAndSubmitRootSettings = async () => {
  const utxos = await fetchAddressUtxos(ROOT_ADDRESS);
  const owner = utxos.find((utxo) => utxo.amount.some((a) => a.unit.endsWith(Buffer.from(ROOT_HANDLE).toString('hex'))));
  if (!owner) throw new Error('handlecontract owner UTxO not found');
  const funding = utxos.filter((utxo) => utxo.tx_hash !== owner.tx_hash || utxo.output_index !== owner.output_index);
  if (funding.length === 0) throw new Error('No funding UTxO at handlecontract address');
  const restore = patchPolicyKeyParser();
  const liveContract = await fetchJson<HandleRecord>('https://preprod.api.handle.me/handles/subhsetcont_003');
  const liveContractScript = await fetchJson<{ cbor: string }>('https://preprod.api.handle.me/handles/subhsetcont_003/script');
  const build = await buildUpdateSubSettingsTx({
    handleHex: Buffer.from(ROOT_HANDLE).toString('hex'),
    changeAddress: ROOT_ADDRESS,
    cborUtxos: [utxoToCbor(owner), ...funding.map(utxoToCbor)],
    cborUnusedUtxos: [],
    collateralUtxo: null,
    settingsDatum: SETTINGS as any,
  }, {
    fetchAdminSubHandleSettings: async () => ({
      ...(await fetchJson<any>('https://preprod.api.handle.me/handles/sh_settings')),
      utxo: '5a86b49175043ec496e3b993a29bb5825ad205ca41ec22156ed6ac3109fbd927#2',
    }),
    fetchLatestSubHandleSettingsScript: async () => ({
      ...(await fetchJson<any>('https://preprod.api.handle.me/handles/subhsetcont_003')),
      utxo: liveContract.utxo,
      scriptAddress: liveContract.resolved_addresses?.ada ?? ROOT_ADDRESS,
      cbor: liveContractScript.cbor,
    }),
  }).finally(restore);
  writeJson('02-root-settings.build.json', build);
  const signedTx = await signWithRootWallet(build.cbor);
  const txHash = calculateTxHash(signedTx.to_hex());
  writeBytes('02-root-settings.full.tx.cbor', signedTx.to_bytes());
  writeHex('02-root-settings.full.tx.cbor.hex', signedTx.to_hex());
  writeJson('02-root-settings.summary.json', { txHash, rootAddress: ROOT_ADDRESS, ownerUtxo: `${owner.tx_hash}#${owner.output_index}`, fundingUtxos: funding.map((utxo) => `${utxo.tx_hash}#${utxo.output_index}`), settings: SETTINGS });
  await submitTransaction([...signedTx.to_bytes()]);
  return txHash;
};

const main = async () => {
  ensureDir();
  const existing = await fetch(`https://preprod.api.handle.me/handles/${ROOT_HANDLE}/subhandle_settings`, { headers: { 'User-Agent': 'kora-backend-request/1.0' } });
  if (existing.status === 200) {
    writeJson('status.json', { status: 'already_exists' });
    console.log(JSON.stringify({ status: 'already_exists' }));
    return;
  }
  const currentUtxos = await fetchAddressUtxos(ROOT_ADDRESS);
  let fundingTxHash: string | null = null;
  if (getNonHandleLovelace(currentUtxos) < FUNDING_LOVELACE) {
    fundingTxHash = await submitFundingTx();
    await waitForTx(fundingTxHash, 'funding');
  }
  const rootSettingsTxHash = await buildAndSubmitRootSettings();
  await waitForTx(rootSettingsTxHash, 'root_settings');
  writeJson('status.json', { status: 'submitted', fundingTxHash, rootSettingsTxHash });
  console.log(JSON.stringify({ status: 'submitted', fundingTxHash, rootSettingsTxHash }));
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  writeJson('error.json', { message, stack: error instanceof Error ? error.stack : null });
  console.error(message);
  process.exit(1);
});
