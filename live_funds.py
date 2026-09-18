"""Live 696x has user capital. Never trap it.

Redeem stays open when paused. Do not pause, hand the book, change floors,
unwind, or redeem other people's shares on the live vault unless the user
named that exact call. Later joins copy the live mix — do not redeploy.
"""

from __future__ import annotations

LIVE_696X = "0x6350f9e8e630785abf09fd1127366998ad821e33"
DEAD = "0x000000000000000000000000000000000000dEaD"

# Owner calls that can cut off users or the curator on the live clone.
LOCKOUT_FNS = frozenset(
    {
        "setPaused",
        "transferOwnership",
        "acceptOwnership",
        "setFloors",
        "setCreatorRecipient",
        "setCreatorFee",
        "removeToken",
        "removeTokens",
        "withdraw",  # agent must not burn user shares as a "test"
    }
)

# Allowed on live 696x when the user asked to rebalance / retarget.
LIVE_OK_FNS = frozenset(
    {
        "swapV3",
        "setTargets",
        "restoreCash",
        "warmOracle",
        "warmOracles",
        "addToken",
        "addTokens",
        "cancelOwnershipTransfer",
    }
)

_MSG = (
    "refusing {fn} on live 696x — user funds must stay reachable "
    "(redeem open, curator key intact, no unwind)"
)


def is_live_696x(addr: str | None) -> bool:
    return str(addr or "").strip().lower() == LIVE_696X


def lockout_fn(label: str | None) -> str | None:
    raw = str(label or "").strip()
    if not raw:
        return None
    if raw in LOCKOUT_FNS:
        return raw
    for fn in sorted(LOCKOUT_FNS, key=len, reverse=True):
        if raw.startswith(fn) and (len(raw) == len(fn) or raw[len(fn)] in "_(["):
            return fn
    return None


def refuse_lockout(vault: str | None, fn: str | None) -> None:
    """Hard stop for harnesses. Agents still need an explicit user ask in chat."""
    name = lockout_fn(fn) or str(fn or "")
    if is_live_696x(vault) and name in LOCKOUT_FNS:
        raise SystemExit(_MSG.format(fn=name))


def refuse_fn(fn) -> None:
    """web3 ContractFunction — catch before estimate_gas."""
    addr = getattr(fn, "address", None)
    name = getattr(fn, "fn_name", None) or getattr(fn, "function_identifier", None)
    refuse_lockout(addr, name)


def refuse_tx(to: str | None, label: str | None) -> None:
    refuse_lockout(to, label)


def refuse_unwind_live(vault: str | None) -> None:
    refuse_lockout(vault, "withdraw")


def refuse_execute_on_live(vault: str | None) -> None:
    if is_live_696x(vault):
        raise SystemExit(
            "refusing harness --execute on live 696x — user funds must stay "
            "reachable (no unwind, pause, floors, or ownership handoff)"
        )


def refuse_retarget(new_vault: str | None) -> None:
    if new_vault and not is_live_696x(new_vault):
        raise SystemExit(
            f"refusing to point HUD/deployed.json off live 696x ({LIVE_696X})"
        )


def refuse_redeploy() -> None:
    raise SystemExit(
        "refusing a second 696x factory/clone — live vault still holds user funds"
    )


def live_supply(total_supply: int, dead_shares: int) -> int:
    live = int(total_supply) - int(dead_shares)
    return live if live > 0 else 0


def exit_open(*, can_withdraw: bool, min_eth_out: int, held_priced: bool) -> bool:
    """True when a share holder can sell the book back to ETH."""
    return bool(can_withdraw) and int(min_eth_out) > 0 and bool(held_priced)


def pause_traps_exits() -> bool:
    """HoodxIndex.withdraw ignores `paused`. Do not change that."""
    return False


def _pending(vault) -> str:
    try:
        return str(vault.functions.pendingOwner().call())
    except Exception:
        return "0x0000000000000000000000000000000000000000"


def snapshot_exit(vault, who: str | None = None) -> dict:
    supply = int(vault.functions.totalSupply().call())
    dead_addr = DEAD
    try:
        from eth_utils import to_checksum_address

        dead_addr = to_checksum_address(DEAD)
        if who:
            who = to_checksum_address(who)
    except Exception:
        pass
    dead = int(vault.functions.balanceOf(dead_addr).call())
    live = live_supply(supply, dead)
    shares = int(vault.functions.balanceOf(who).call()) if who else live
    can = False
    min_out = 0
    names = 0
    if shares > 0:
        try:
            can = bool(vault.functions.canWithdraw(shares).call())
        except Exception:
            can = False
        try:
            preview = vault.functions.previewSell(shares).call()
            min_out = int(preview[0])
            names = int(preview[1]) if len(preview) > 1 else 0
        except Exception:
            min_out, names = 0, 0
    priced = min_out > 0
    return {
        "paused": bool(vault.functions.paused().call()),
        "liveShares": live,
        "shares": shares,
        "canWithdraw": can,
        "minEthOut": min_out,
        "sellNames": names,
        "heldPriced": priced,
        "open": exit_open(can_withdraw=can, min_eth_out=min_out, held_priced=priced),
        "pendingOwner": _pending(vault),
        "owner": vault.functions.owner().call(),
        "creator": vault.functions.creator().call(),
    }


def assert_exit_open(vault, who: str | None = None) -> dict:
    snap = snapshot_exit(vault, who)
    if snap["liveShares"] > 0 and not snap["open"]:
        raise SystemExit(
            "live 696x exit closed — held unpriced name or buffer short; "
            "do not continue (users must stay able to redeem)"
        )
    return snap
