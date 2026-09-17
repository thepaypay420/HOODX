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


VIRTUAL_ASSETS = 10**12
DEAD = "0x000000000000000000000000000000000000dead"
ZERO = "0x0000000000000000000000000000000000000000"


def _addr(who: str) -> str:
    a = str(who or "").strip().lower()
    if len(a) != 42 or not a.startswith("0x"):
        raise ValueError("bad address")
    return a


def ok_pay_to(
    who: str,
    *,
    vault: str,
    weth: str,
    factory: str,
    router: str,
    v4_manager: str,
    v4_state: str,
    v4_posm: str,
    owner: str | None = None,
) -> bool:
    """Mirrors HoodxIndex._assertPayTo. owner=None → fee recipient (owner allowed)."""
    try:
        a = _addr(who)
    except ValueError:
        return False
    if a == ZERO:
        return False
    blocked = {
        _addr(vault),
        _addr(weth),
        DEAD,
        _addr(factory),
        _addr(router),
        _addr(v4_manager),
        _addr(v4_state),
        _addr(v4_posm),
    }
    if owner is not None:
        blocked.add(_addr(owner))
    return a not in blocked


def ok_curator(
    who: str,
    *,
    owner: str,
    vault: str,
    weth: str,
    factory: str,
    router: str,
    v4_manager: str,
    v4_state: str,
    v4_posm: str,
) -> bool:
    return ok_pay_to(
        who,
        owner=owner,
        vault=vault,
        weth=weth,
        factory=factory,
        router=router,
        v4_manager=v4_manager,
        v4_state=v4_state,
        v4_posm=v4_posm,
    )


def can_set_creator_cut(sender: str, creator: str) -> bool:
    """Fee recipient / bps stay with the immutable creator after the book moves."""
    try:
        return _addr(sender) == _addr(creator)
    except ValueError:
        return False


def can_accept_ownership(sender: str, pending: str) -> bool:
    try:
        p = _addr(pending)
    except ValueError:
        return False
    if p == ZERO:
        return False
    try:
        return _addr(sender) == p
    except ValueError:
        return False


def virtual_shares(genesis: int) -> int:
    g = int(genesis)
    if g <= 0:
        return 1
    vs = (VIRTUAL_ASSETS * 10**18) // g
    return vs if vs > 0 else 1


def v4_mint_px(spot: int, last: int) -> int:
    """Same-block dump cannot cheapen mint: max(spot, last). V3 is already TWAP."""
    if int(last) <= 0:
        return int(spot)
    return int(spot) if int(spot) > int(last) else int(last)


def mint_nav(weth: int, sleeves: list[tuple[int, int]]) -> int:
    """NAV is the sum of WETH + every sleeve. Never one token as a proxy (Indexed)."""
    acc = int(weth)
    for bal, px in sleeves:
        acc += (int(bal) * int(px)) // 10**18
    return acc


def min_shares_floor(preview: int, slip_bps: int = 300) -> int:
    if preview <= 0:
        return 1
    floor = (int(preview) * (10_000 - int(slip_bps))) // 10_000
    return floor if floor > 0 else 1


USD_PER_SHARE = 100
DEFAULT_GENESIS_ETH = 4 * 10**16  # 0.04 ETH ≈ $100 at $2500
GENESIS_PX_SCALE = 10**8
MIN_GENESIS_ETH = 10**16  # 0.01 ETH — matches HoodxIndex.setGenesisEthPerShare
MAX_GENESIS_ETH = 25 * 10**16  # 0.25 ETH


def genesis_eth_per_share(eth_usd: float, usd_per_share: int = USD_PER_SHARE) -> int:
    """$100 of ETH in wei. Integer tape (8 dp) — never a HUD fallback like 2400."""
    if eth_usd <= 0:
        raise ValueError("eth usd")
    px = int(round(float(eth_usd) * GENESIS_PX_SCALE))
    if px <= 0:
        raise ValueError("eth usd")
    return (int(usd_per_share) * 10**18 * GENESIS_PX_SCALE) // px


def ok_genesis(wei: int) -> bool:
    return MIN_GENESIS_ETH <= int(wei) <= MAX_GENESIS_ETH


def mint_from_credited(credited: int, price: int, net: int) -> int:
    """On-chain mint: min(credited NAV, net ETH) / price. Mark-up cannot dilute LPs."""
    if credited <= 0 or price <= 0 or net <= 0:
        return 0
    return mint_at_price(min(int(credited), int(net)), price)


def mint_shares(net_wei: int, assets_before: int, supply: int, genesis: int = DEFAULT_GENESIS_ETH) -> int:
    """Shares at live NAV. Empty book uses genesis ($100 of ETH)."""
    if net_wei <= 0:
        return 0
    if supply == 0:
        return mint_at_price(net_wei, genesis)
    if assets_before <= 0:
        raise ValueError("empty nav")
    return (net_wei * supply) // assets_before


def share_price(assets: int, supply: int, genesis: int = DEFAULT_GENESIS_ETH) -> int:
    """WETH wad per share. Empty book is genesis ($100 of ETH)."""
    if supply <= 0:
        return int(genesis)
    return (int(assets) * 10**18) // int(supply)


def mint_at_price(net_wei: int, price_wad: int) -> int:
    if net_wei <= 0 or price_wad <= 0:
        return 0
    return (int(net_wei) * 10**18) // int(price_wad)


def shift_cost(cost: int, shares: int, bal: int) -> tuple[int, int]:
    """Pro-rata cost basis taken with `shares` of `bal`. Returns (cut, remaining)."""
    if shares <= 0 or bal <= 0:
        return 0, int(cost)
    cut = (int(cost) * int(shares)) // int(bal)
    return cut, int(cost) - cut


def roi(value: int, cost: int) -> float:
    if int(cost) <= 0:
        return 0.0
    return (int(value) - int(cost)) / int(cost)


def redeem_value(shares: int, assets: int, supply: int) -> int:
    if shares <= 0 or supply <= 0:
        return 0
    if shares > supply:
        raise ValueError("shares > supply")
    return (shares * assets) // supply


def deploy_sleeves(net_wei: int, n: int, cash_bps: int = 2500, min_sleeve_wei: int = 4 * 10**15) -> tuple[int, int]:
    """How many names a first mint can buy at equal weight. Dust stays cash."""
    if net_wei <= 0 or n <= 0:
        return 0, net_wei
    each = (10_000 - int(cash_bps)) // int(n)
    spent = 0
    names = 0
    for _ in range(n):
        sleeve = (net_wei * each) // 10_000
        if sleeve < min_sleeve_wei:
            continue
        spent += sleeve
        names += 1
    return names, net_wei - spent


def vault_perf(price: int, genesis: int) -> float | None:
    """Share price vs genesis peg. Independent of a joiner's fee/slip."""
    g = int(genesis)
    if g <= 0:
        return None
    return (int(price) - g) / g


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
