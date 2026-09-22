/** Read-only artifact/source verification. No RPC, signing, or deployment capability. */
import fs from 'node:fs';
import path from 'node:path';
import {keccak256, toHex} from 'viem';

const root = process.cwd();
const contracts = ['HoodxProportionalV3', 'HoodxProportionalPolicyV3', 'HoodxProportionalFactoryV3'];
const builds = [];
for (const name of contracts) {
  const artifact = JSON.parse(fs.readFileSync(path.join(root, 'out', `${name}.sol`, `${name}.json`), 'utf8'));
  const metadata = artifact.metadata;
  if (!metadata.compiler.version.startsWith('0.8.24+') || metadata.settings.optimizer.runs !== 1 || !metadata.settings.optimizer.enabled || !metadata.settings.viaIR || metadata.settings.evmVersion !== 'cancun') throw new Error(`Unexpected compiler settings: ${name}`);
  for (const [source, details] of Object.entries(metadata.sources)) {
    const resolved = path.resolve(root, source);
    if (!resolved.startsWith(root + path.sep)) throw new Error('Source outside repository');
    // Foundry normalizes Windows CRLF sources before compiling.
    const contents = fs.readFileSync(resolved, 'utf8');
    if (keccak256(toHex(contents)) !== details.keccak256 && keccak256(toHex(contents.replaceAll('\r\n', '\n'))) !== details.keccak256) throw new Error(`Stale artifact: ${source}`);
  }
  const runtime = artifact.deployedBytecode.object;
  const runtimeBytes = (runtime.length - 2) / 2;
  if (runtimeBytes <= 0 || runtimeBytes > 24576) throw new Error(`Invalid runtime size: ${name}`);
  builds.push({name, runtimeBytes, creationTemplateHash: keccak256(artifact.bytecode.object), runtimeTemplateHash: keccak256(runtime), sourceHashes: Object.fromEntries(Object.entries(metadata.sources).map(([source, details]) => [source, details.keccak256]))});
}
console.log(JSON.stringify({status:'source-matched-build-only', productionReady:false, note:'Template hashes precede constructor immutable substitutions. This check does not authorize deployment or replace receipt/runtime verification.', builds}, null, 2));
