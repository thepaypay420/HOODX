"""Share math for HoodxIndex. Mirrors contracts/HoodxIndex.sol. No RPC, no swaps."""

from __future__ import annotations

from config import CREATOR_FEE_BPS, FEE_BPS_DENOM, ISSUE_FEE_BPS, PROTOCOL_FEE_BPS, REDEEM_FEE_BPS


def issue_split(
    gross_wei: int,
    issue_fee_bps: int = ISSUE_FEE_BPS,
) -> tuple[int, int]:
    if gross_wei < 0 or issue_fee_bps < 0:
        raise ValueError("negative")
    fee = (gross_wei * int(issue_fee_bps)) // FEE_BPS_DENOM
    return gross_wei - fee, fee


def issue_split_parts(
    gross_wei: int,
    protocol_bps: int = PROTOCOL_FEE_BPS,
    creator_bps: int = CREATOR_FEE_BPS,
) -> tuple[int, int, int]:
    """Returns (net, protocol_fee, creator_fee)."""
    if gross_wei < 0 or protocol_bps < 0 or creator_bps < 0:
        raise ValueError("negative")
    proto = (gross_wei * int(protocol_bps)) // FEE_BPS_DENOM
    creat = (gross_wei * int(creator_bps)) // FEE_BPS_DENOM
    return gross_wei - proto - creat, proto, creat


def redeem_split(value_wei: int, redeem_fee_bps: int = REDEEM_FEE_BPS) -> tuple[int, int]:
    if value_wei < 0 or redeem_fee_bps < 0:
        raise ValueError("negative")
    fee = (value_wei * int(redeem_fee_bps)) // FEE_BPS_DENOM
    return value_wei - fee, fee


def mint_shares(net_wei: int, assets_before: int, supply: int) -> int:
    """Shares minted for `net_wei` after fee. First depositor is 1:1 with WETH."""
    if net_wei <= 0:
        return 0
    if supply == 0:
        return net_wei
    if assets_before <= 0:
        raise ValueError("empty nav")
    return (net_wei * supply) // assets_before


def redeem_value(shares: int, assets: int, supply: int) -> int:
    if shares <= 0 or supply <= 0:
        return 0
    if shares > supply:
        raise ValueError("shares > supply")
    return (shares * assets) // supply


def can_exit(net_plus_fee: int, weth_buffer: int) -> bool:
    return int(weth_buffer) >= int(net_plus_fee)


RESERVED_SLUGS = {"create", "factory", "admin", "index"}
GEN0_SLUGS = {"696x", "hoodx"}


def ok_slug(slug: str) -> bool:
    if not 3 <= len(slug) <= 16:
        return False
    if slug in RESERVED_SLUGS:
        return False
    return slug.islower() and slug.isalnum()


def ok_user_slug(slug: str) -> bool:
    """Anyone-create slugs. 696x / hoodx are reserved for Gen-0."""
    return ok_slug(slug) and slug not in GEN0_SLUGS
