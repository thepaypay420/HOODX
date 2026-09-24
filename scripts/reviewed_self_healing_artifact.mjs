import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {encodeAbiParameters, getAddress, keccak256, pad} from 'viem';

const project = fileURLToPath(new URL('..', import.meta.url));
const artifact = JSON.parse(fs.readFileSync(`${project}/out/HoodxSelfHealingControllerV2.sol/HoodxSelfHealingControllerV2.json`, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(`${project}/deployments/self-healing-v2-reviewed.json`, 'utf8'));
const vaultSymbols = new Map([
  [getAddress('0x531832cD20d33Ee974AFEE7BA5720b8f3F2C9292'), '696X'],
  [getAddress('0xCb40b8D79ff6f4c5db15bD8A9692B934b52cB0b0'), 'FAANGX'],
]);

function assertReviewedCreationCode() {
  const creationCodeHash = keccak256(artifact.bytecode.object);
  if (creationCodeHash.toLowerCase() !== manifest.creationCodeHash.toLowerCase()) {
    throw Error('Controller creation code does not match the reviewed manifest');
  }
  const fingerprint = keccak256(encodeAbiParameters(
    [
      {type: 'bytes32'}, {type: 'address'}, {type: 'address'}, {type: 'address'},
      {type: 'address'}, {type: 'address'}, {type: 'address'},
    ],
    [
      creationCodeHash,
      '0x134D468B0bcaeA6DF127916f951F7938c06A37C6',
      '0x8e36fB11545Fc1683f35a079d3F9f1A715DbEC70',
      '0x531832cD20d33Ee974AFEE7BA5720b8f3F2C9292',
      '0xCb40b8D79ff6f4c5db15bD8A9692B934b52cB0b0',
      '0x5A732854bD6A4EEa6e5bA9ED9D897bC089f58767',
      '0xB5bCe75EB8761BF084F1abC71650b88311C9f4fb',
    ],
  ));
  if (fingerprint.toLowerCase() !== manifest.reviewedBuild.toLowerCase()) {
    throw Error('Controller build fingerprint does not match the reviewed manifest');
  }
}

export function reviewedRuntimeHash(vault) {
  assertReviewedCreationCode();
  const normalizedVault = getAddress(vault);
  const symbol = vaultSymbols.get(normalizedVault);
  if (!symbol) throw Error('Vault is not in the reviewed manifest');
  let runtime = artifact.deployedBytecode.object;
  const references = Object.values(artifact.deployedBytecode.immutableReferences).flat();
  if (references.length === 0) throw Error('Reviewed runtime has no immutable references');
  const encodedVault = pad(normalizedVault, {size: 32}).slice(2);
  for (const reference of references) {
    if (reference.length !== 32) throw Error('Unexpected immutable reference length');
    const start = 2 + reference.start * 2;
    runtime = `${runtime.slice(0, start)}${encodedVault}${runtime.slice(start + reference.length * 2)}`;
  }
  const runtimeHash = keccak256(runtime);
  if (runtimeHash.toLowerCase() !== manifest.runtimeCodeHashes[symbol].toLowerCase()) {
    throw Error(`${symbol} runtime does not match the reviewed manifest`);
  }
  return runtimeHash;
}

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({
    '696X': reviewedRuntimeHash('0x531832cD20d33Ee974AFEE7BA5720b8f3F2C9292'),
    FAANGX: reviewedRuntimeHash('0xCb40b8D79ff6f4c5db15bD8A9692B934b52cB0b0'),
    reviewedBuild: manifest.reviewedBuild,
  })}\n`);
}
