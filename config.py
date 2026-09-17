"""RH 696 watchlist index — isolated from the LP desk / CEO cycle.

Never imports buy-desk, never touches the Krystal vault, never starts tmux.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent
UNIVERSE_PATH = ROOT / "universe.json"

CHAIN_ID = 4663
WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"
USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
NATIVE = "0x0000000000000000000000000000000000000000"
UNIVERSAL_ROUTER = "0x8876789976dEcBfCbBbe364623C63652db8C0904"

# Weight policy. 696's post is a niche watchlist, not a mega-cap fund:
# PONS+AI+CASHCAT are ~83% of raw mcap, so plain mcap weight is three coins.
CAP = 0.10
FLOOR = 0.03
MIN_BUY_TVL_USD = 25_000.0
MIN_VOL24_USD = 1_000.0
LIQ_REF_USD = 250_000.0
HOP2_HAIRCUT = 0.55
DEAD_VOL24_USD = 100.0

# 696X platform: 50 bps total on ape-in. 10 protocol + 40 creator.
# Streaming AUM fee on $200 is ~$1/year — skip. Redeem is free.
PROTOCOL_FEE_BPS = 10
CREATOR_FEE_BPS = 40
ISSUE_FEE_BPS = PROTOCOL_FEE_BPS + CREATOR_FEE_BPS
REDEEM_FEE_BPS = 0
FEE_BPS_DENOM = 10_000
MIN_SLEEVE_USD = 10.0
CASH_TARGET = 0.25
MIN_DEPOSIT_ETH = 0.02
MIN_FIRST_ETH = 0.08  # ≈ $200 seed at live ETH — $100 / share genesis
MIN_SLEEVE_ETH = 0.004  # on-chain dust floor (~$10)
SWAP_ROUTER = "0xCaf681a66D020601342297493863E78C959E5cb2"
RPC_URL = "https://rpc.mainnet.chain.robinhood.com"
EXPLORER = "https://robinhoodchain.blockscout.com"

QUOTE_ETH = {"WETH", "ETH"}
