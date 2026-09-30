"""Read-only Robinhood Chain V4 helpers for the HUNTX edge study (2026-09-30).

Only eth_call / eth_getLogs / block reads. No signing, no broadcast. The RPC
endpoint is loaded by feex_next_day_check and must never be printed.
"""

from __future__ import annotations

from functools import lru_cache

from eth_abi import decode, encode
from web3 import Web3

from feex_next_day_check import rpc

MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
STATE_VIEW = "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b"
POSM = "0x58daec3116aae6D93017bAAea7749052E8a04fA7"
V4_QUOTER = "0x8dc178efb8111bb0973dd9d722ebeff267c98f94"
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
Q96 = 2**96
Q128 = 2**128
SWAP_TOPIC = "0x" + Web3.keccak(text="Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)").hex().removeprefix("0x")
INIT_TOPIC = "0x" + Web3.keccak(
    text="Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)").hex().removeprefix("0x")
MODIFY_TOPIC = "0x" + Web3.keccak(
    text="ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)").hex().removeprefix("0x")


def _block(block):
    return block if isinstance(block, str) else hex(block)


def eth_call(to: str, sig: str, types: list, args: list, out: list, block="latest"):
    selector = Web3.keccak(text=sig)[:4].hex().removeprefix("0x")
    data = "0x" + selector + encode(types, args).hex()
    raw = rpc("eth_call", [{"to": to, "data": data}, _block(block)])
    return decode(out, bytes.fromhex(raw[2:]))


def pid_bytes(pool_id: str) -> bytes:
    return bytes.fromhex(pool_id.removeprefix("0x"))


def slot0(pool_id: str, block="latest"):
    sqrt, tick, protocol_fee, lp_fee = eth_call(
        STATE_VIEW, "getSlot0(bytes32)", ["bytes32"], [pid_bytes(pool_id)],
        ["uint160", "int24", "uint24", "uint24"], block)
    return {"sqrt": sqrt, "tick": tick, "protocol_fee": protocol_fee, "lp_fee": lp_fee,
            "protocol_fee_0for1": protocol_fee & 0xFFF, "protocol_fee_1for0": protocol_fee >> 12}


def liquidity(pool_id: str, block="latest") -> int:
    return eth_call(STATE_VIEW, "getLiquidity(bytes32)", ["bytes32"], [pid_bytes(pool_id)], ["uint128"], block)[0]


def fee_growth_globals(pool_id: str, block="latest"):
    return eth_call(STATE_VIEW, "getFeeGrowthGlobals(bytes32)", ["bytes32"], [pid_bytes(pool_id)],
                    ["uint256", "uint256"], block)


def tick_info(pool_id: str, tick: int, block="latest"):
    gross, net, out0, out1 = eth_call(
        STATE_VIEW, "getTickInfo(bytes32,int24)", ["bytes32", "int24"], [pid_bytes(pool_id), tick],
        ["uint128", "int128", "uint256", "uint256"], block)
    return {"gross": gross, "net": net, "out0": out0, "out1": out1}


def tick_bitmap(pool_id: str, word: int, block="latest") -> int:
    return eth_call(STATE_VIEW, "getTickBitmap(bytes32,int16)", ["bytes32", "int16"],
                    [pid_bytes(pool_id), word], ["uint256"], block)[0]


@lru_cache(maxsize=None)
def pool_key(pool_id: str):
    """PositionManager.poolKeys(bytes25). Empty if never minted via POSM."""
    c0, c1, fee, spacing, hooks = eth_call(
        POSM, "poolKeys(bytes25)", ["bytes25"], [pid_bytes(pool_id)[:25]],
        ["address", "address", "uint24", "int24", "address"])
    return {"currency0": c0.lower(), "currency1": c1.lower(), "fee": fee,
            "tick_spacing": spacing, "hooks": hooks.lower()}


def block_timestamp(number: int) -> int:
    return int(rpc("eth_getBlockByNumber", [hex(number), False])["timestamp"], 16)


def block_at(ts: int, latest: int | None = None, low: int = 1) -> int:
    """First block whose timestamp >= ts (binary search)."""
    latest = latest or int(rpc("eth_blockNumber", []), 16)
    high = latest
    while low < high:
        mid = (low + high) // 2
        if block_timestamp(mid) < ts:
            low = mid + 1
        else:
            high = mid
    if block_timestamp(low) < ts:
        raise RuntimeError("timestamp beyond chain head")
    return low


def signed(word: bytes, bits: int) -> int:
    value = int.from_bytes(word, "big") & (2**bits - 1)
    return value - 2**bits if value >= 2 ** (bits - 1) else value


def decode_swap(row: dict) -> dict:
    data = bytes.fromhex(row["data"][2:])
    return {
        "pool_id": row["topics"][1].lower(),
        "sender": "0x" + row["topics"][2][-40:].lower(),
        "block": int(row["blockNumber"], 16),
        "log_index": int(row["logIndex"], 16),
        "tx": row["transactionHash"],
        "amount0": signed(data[0:32], 128),
        "amount1": signed(data[32:64], 128),
        "sqrt_price_x96": int.from_bytes(data[64:96], "big"),
        "liquidity": int.from_bytes(data[96:128], "big"),
        "tick": signed(data[128:160], 24),
        "fee_ppm": int.from_bytes(data[160:192], "big"),
    }


def tick_to_sqrt(tick: int) -> float:
    return 1.0001 ** (tick / 2)
