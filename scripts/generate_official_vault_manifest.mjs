import fs from "node:fs";
const catalog = JSON.parse(fs.readFileSync("deployments/official-vault-catalog-2026-09-24.json"));
const q = (value) => `address(bytes20(hex"${value.slice(2).toLowerCase()}"))`;
const lines = [];
lines.push(`// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\nimport {V2Hop, V2PoolKey} from "../contracts/v2/Types.sol";\n\nlibrary OfficialVaultCatalogV3 {\n    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;\n    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;\n    bytes32 internal constant EVIDENCE = keccak256("HOODX_OFFICIAL_VAULT_ROUTES_V1_BLOCK_${catalog.block}");\n\n    function count() internal pure returns (uint256) { return ${catalog.assets.length}; }\n    function evidence() internal pure returns (bytes32) { return EVIDENCE; }\n`);
lines.push(`    function fingerprint() internal pure returns (bytes32 digest) {\n        digest = keccak256(abi.encode(EVIDENCE, count()));\n        for (uint256 i; i < count(); ++i) { (address token, bytes memory buy, bytes memory sell) = routeFor(i); digest = keccak256(abi.encode(digest, token, keccak256(buy), keccak256(sell))); }\n    }\n    function bridge() internal pure returns (V2Hop memory h) { h.kind = 3; h.tokenIn = WETH; h.tokenOut = USDG; h.fee = 100; }\n`);
lines.push(`    function routeFor(uint256 i) internal pure returns (address token, bytes memory buy, bytes memory sell) {\n        V2Hop memory asset;\n`);
catalog.assets.forEach((asset, index) => {
  const r = asset.route;
  lines.push(`        if (i == ${index}) { // ${asset.symbol}\n            token = ${q(asset.token)}; asset.kind = ${r.version}; asset.tokenIn = ${q(r.quote)}; asset.tokenOut = token;`);
  if (r.version === 3) lines.push(` asset.fee = ${r.fee};`);
  else lines.push(` asset.key = V2PoolKey(${q(r.key.currency0)}, ${q(r.key.currency1)}, ${r.key.fee}, ${r.key.tickSpacing}, ${q(r.key.hooks)});`);
  lines.push(`\n        }\n`);
  });
lines.push(`        require(token != address(0), "asset index");\n        bool multi = asset.tokenIn == USDG;\n        V2Hop[] memory b = new V2Hop[](multi ? 2 : 1);\n        b[b.length - 1] = asset;\n        if (multi) b[0] = bridge();\n        buy = abi.encode(b);\n        V2Hop[] memory s = new V2Hop[](b.length);\n        for (uint256 j; j < b.length; ++j) { s[j] = b[b.length - 1 - j]; (s[j].tokenIn, s[j].tokenOut) = (s[j].tokenOut, s[j].tokenIn); }\n        sell = abi.encode(s);\n    }\n`);
lines.push(`    function vaultCount() internal pure returns (uint256) { return ${catalog.vaults.length}; }\n    function vault(uint256 i) internal pure returns (string memory slug, string memory symbol, uint16 cashBps, uint256[] memory indexes, uint16[] memory weights) {\n`);
catalog.vaults.forEach((vault, i) => {
  const indexes = vault.assets.map((symbol) => catalog.assets.findIndex((asset) => asset.symbol === symbol));
  lines.push(`        if (i == ${i}) { slug = "${vault.slug}"; symbol = "${vault.symbol}"; cashBps = ${vault.cashTargetBps}; indexes = new uint256[](${indexes.length}); weights = new uint16[](${indexes.length});`);
  indexes.forEach((idx, j) => lines.push(` indexes[${j}] = ${idx}; weights[${j}] = ${vault.weightsBps[j]};`));
  lines.push(` return (slug, symbol, cashBps, indexes, weights); }\n`);
});
lines.push(`        revert("vault index");\n    }\n}\n`);
fs.writeFileSync("script/OfficialVaultCatalogV3.sol", lines.join(""));
console.log(`generated ${catalog.assets.length} routes and ${catalog.vaults.length} vaults`);
