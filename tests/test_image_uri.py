"""On-chain token image URI for wallets / Blockscout."""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "contracts" / "HoodxIndex.sol").read_text()
SWAP = (ROOT / "contracts" / "HoodxSwap.sol").read_text()
STORAGE = (ROOT / "contracts" / "HoodxStorage.sol").read_text()
SOL = INDEX + SWAP + STORAGE
FACTORY = (ROOT / "contracts" / "HoodxFactory.sol").read_text()
FORGE = (ROOT / "components" / "Forge.tsx").read_text()
CARD = (ROOT / "components" / "IndexCard.tsx").read_text()
IMG = (ROOT / "lib" / "tokenImage.ts").read_text()


class ImageUriTest(unittest.TestCase):
    def test_contract_stores_and_sets_image(self):
        self.assertIn("string public imageURI", SOL)
        self.assertIn("function setImageURI(string calldata uri)", INDEX)
        self.assertIn("function contractURI()", INDEX)
        self.assertIn("event ImageURISet(string uri)", SOL)
        self.assertIn("ERC-7572", INDEX)
        self.assertIn("p.imageURI", INDEX)

    def test_factory_passes_image_at_create(self):
        self.assertIn("string calldata imageURI_", FACTORY)
        self.assertIn("imageURI: imageURI_", FACTORY)

    def test_hud_can_push_wallet_image(self):
        self.assertIn("walletImageUri", IMG)
        self.assertIn("GEN0_WALLET_IMAGE", IMG)
        self.assertIn("setImageURI", CARD)
        self.assertIn("Push to wallets", CARD)
        self.assertIn("onChainImage", FORGE)
        self.assertNotIn("wallets wait for a later factory", FORGE)
        self.assertNotIn("wallets wait on a later factory", CARD)

    def test_oracle_split_keeps_clones_under_limit(self):
        self.assertIn("constructor(address twapOracle_, address swapLogic_)", INDEX)
        self.assertIn("address public immutable twapOracle", INDEX)
        self.assertIn("address public immutable swapLogic", INDEX)
        self.assertIn("address public immutable implementation", FACTORY)
        self.assertIn("implementation_", FACTORY)
        self.assertIn("function warmOracleRaw(address token) external payable", SWAP)
