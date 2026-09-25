import fs from "node:fs";
import { createPublicClient, getAddress, http, parseAbi, zeroAddress } from "viem";

const ADMIN = getAddress("0x134D468B0bcaeA6DF127916f951F7938c06A37C6");
const POLICY = getAddress("0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21");
const rpcUrl = fs.readFileSync("C:/Users/lukey/Desktop/RH RPC.txt", "utf8").trim();
const state = JSON.parse(fs.readFileSync("deployments/official-vault-launch-state.json", "utf8"));
const catalog = JSON.parse(fs.readFileSync("deployments/official-vault-catalog-2026-09-24.json", "utf8"));
const client = createPublicClient({ transport: http(rpcUrl, { timeout: 30_000, retryCount: 2 }) });

const policyAbi = parseAbi(["function owner() view returns(address)"]);
const factoryAbi = parseAbi([
  "function owner() view returns(address)",
  "function treasury() view returns(address)",
  "function bySlug(string) view returns(address)",
]);
const vaultAbi = parseAbi([
  "function owner() view returns(address)",
  "function creator() view returns(address)",
  "function creatorRecipient() view returns(address)",
  "function treasury() view returns(address)",
  "function symbol() view returns(string)",
  "function imageURI() view returns(string)",
  "function totalSupply() view returns(uint256)",
  "function cashTargetBps() view returns(uint16)",
  "function constituents() view returns(address[])",
  "function targetBps(address) view returns(uint16)",
]);
const controllerAbi = parseAbi([
  "function vault() view returns(address)",
  "function curator() view returns(address)",
]);

function equalAddress(actual, expected, label) {
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`${label}: ${actual}`);
}

equalAddress(await client.readContract({ address: POLICY, abi: policyAbi, functionName: "owner" }), state.routeAdmin, "policy owner");
equalAddress(await client.readContract({ address: state.factory, abi: factoryAbi, functionName: "owner" }), ADMIN, "factory owner");
equalAddress(await client.readContract({ address: state.factory, abi: factoryAbi, functionName: "treasury" }), ADMIN, "factory treasury");

const verified = [];
for (const definition of catalog.vaults) {
  const vault = getAddress(state.vaults[definition.slug]);
  equalAddress(await client.readContract({ address: state.factory, abi: factoryAbi, functionName: "bySlug", args: [definition.slug] }), vault, `${definition.slug} factory mapping`);
  const [controller, creator, recipient, treasury, symbol, image, supply, cash, constituents] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, functionName: "owner" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "creator" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "creatorRecipient" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "treasury" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "symbol" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "imageURI" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "totalSupply" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "cashTargetBps" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "constituents" }),
  ]);
  if (controller === zeroAddress) throw new Error(`${definition.slug} controller missing`);
  equalAddress(await client.readContract({ address: controller, abi: controllerAbi, functionName: "vault" }), vault, `${definition.slug} controller vault`);
  equalAddress(await client.readContract({ address: controller, abi: controllerAbi, functionName: "curator" }), ADMIN, `${definition.slug} curator`);
  equalAddress(creator, ADMIN, `${definition.slug} creator`);
  equalAddress(recipient, ADMIN, `${definition.slug} recipient`);
  equalAddress(treasury, ADMIN, `${definition.slug} treasury`);
  if (symbol !== definition.symbol) throw new Error(`${definition.slug} symbol: ${symbol}`);
  if (image !== `https://www.xhoodindex.com/vaults/${definition.symbol.toLowerCase()}.png`) throw new Error(`${definition.slug} image: ${image}`);
  if (supply !== 0n) throw new Error(`${definition.slug} is not empty`);
  if (Number(cash) !== definition.cashTargetBps) throw new Error(`${definition.slug} cash target: ${cash}`);
  if (constituents.length !== definition.assets.length) throw new Error(`${definition.slug} constituent count`);
  const weights = await Promise.all(constituents.map((token) => client.readContract({ address: vault, abi: vaultAbi, functionName: "targetBps", args: [token] })));
  if (weights.some((weight, index) => Number(weight) !== definition.weightsBps[index])) throw new Error(`${definition.slug} target weights`);
  verified.push({ slug: definition.slug, symbol, vault, controller, image, empty: true });
}

console.log(JSON.stringify({ policyOwner: state.routeAdmin, factory: state.factory, vaults: verified }, null, 2));
