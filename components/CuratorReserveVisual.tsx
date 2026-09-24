/** A snapshot of the reserve, not a price chart or an execution forecast. */
export function CuratorReserveVisual({ current, target, active }: { current?: number; target: number; active: boolean }) {
  const fraction = Math.max(0, Math.min(100, current ?? 0));
  const targetAngle = Math.max(0, Math.min(100, target)) * 3.6;
  return <div className={`curator-reserve-visual${active ? " active" : ""}`}>
    <div className="curator-reserve-dial">
      <svg viewBox="0 0 240 240" aria-hidden="true">
        <circle className="reserve-guide" cx="120" cy="120" r="111" />
        {Array.from({ length: 60 }, (_, i) => <line key={i} className="reserve-tick" x1="120" y1="13" x2="120" y2={i % 5 === 0 ? "22" : "17"} transform={`rotate(${i * 6} 120 120)`} />)}
        <circle className="reserve-track" cx="120" cy="120" r="89" />
        {current !== undefined && <circle className="reserve-arc" cx="120" cy="120" r="89" pathLength="100" strokeDasharray={`${fraction} ${100 - fraction}`} transform="rotate(-90 120 120)" />}
        <g transform={`rotate(${targetAngle} 120 120)`}><line className="reserve-target" x1="120" y1="23" x2="120" y2="40" /><circle className="reserve-target-dot" cx="120" cy="23" r="3" /></g>
        <circle className="reserve-inner" cx="120" cy="120" r="72" />
      </svg>
      <div className="reserve-reading"><span>WETH RESERVE</span><strong>{current === undefined ? "—" : current.toFixed(2)}{current !== undefined && <em>%</em>}</strong><small>of the basket now</small></div>
    </div>
    <div className="reserve-legend"><i />Planned target <b>{target.toFixed(2)}%</b></div>
  </div>;
}
