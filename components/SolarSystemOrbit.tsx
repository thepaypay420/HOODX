const ORBITS = [
  { name: "Mercury", rx: 74, ry: 40, tilt: -22, seconds: 10, begin: -2.1 },
  { name: "Venus", rx: 93, ry: 50, tilt: -21, seconds: 14, begin: -9.2 },
  { name: "Earth", rx: 112, ry: 60, tilt: -20, seconds: 18, begin: -5.4 },
  { name: "Mars", rx: 132, ry: 71, tilt: -19, seconds: 24, begin: -17.8 },
  { name: "Jupiter", rx: 157, ry: 84, tilt: -18, seconds: 36, begin: -29.3 },
  { name: "Saturn", rx: 181, ry: 97, tilt: -17, seconds: 48, begin: -12.7 },
  { name: "Uranus", rx: 205, ry: 110, tilt: -16, seconds: 64, begin: -45.1 },
  { name: "Neptune", rx: 228, ry: 122, tilt: -15, seconds: 78, begin: -61.4 },
] as const;

const CX = 270;
const CY = 215;

function orbitPath(rx: number, ry: number) {
  return `M ${CX - rx} ${CY} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
}

function Planet({ name }: { name: (typeof ORBITS)[number]["name"] }) {
  if (name === "Mercury") return <g><circle r="2.6" fill="url(#planet-mercury)"/><circle cx="-.8" cy="-.7" r=".45" fill="#555955"/><circle cx="1" cy=".8" r=".35" fill="#646763"/></g>;
  if (name === "Venus") return <g><circle r="3.5" fill="url(#planet-venus)"/><path d="M-3-1c2 1 4-1 6 .2M-3 1c2-1 4 1 6-.2" stroke="#fff1bc" strokeWidth=".45" opacity=".55" fill="none"/></g>;
  if (name === "Earth") return <g><circle r="3.7" fill="url(#planet-earth)"/><path d="M-2.5-1.6l1.5-.7 1.1.8-.6 1.4-1.4.3zm2.1 2.3 1.5-.5 1.1 1.2-1.6.8z" fill="#75bd79"/><path d="M-3 .9c2-.7 4 .5 6-.4" stroke="#ddffff" strokeWidth=".35" opacity=".7" fill="none"/></g>;
  if (name === "Mars") return <g><circle r="3" fill="url(#planet-mars)"/><circle cx="1" cy=".7" r=".65" fill="#6e261c" opacity=".75"/><path d="M-1.8-2.1h2.3" stroke="#f7dfd0" strokeWidth=".55" strokeLinecap="round"/></g>;
  if (name === "Jupiter") return <g><circle r="5.2" fill="url(#planet-jupiter)"/><path d="M-4.8-2.2h9.6M-5-.1h10M-4.6 2.2h9.2" stroke="#8e5940" strokeWidth=".75" opacity=".9"/><ellipse cx="2.5" cy="1.5" rx="1.25" ry=".65" fill="#a94631"/></g>;
  if (name === "Saturn") return <g><ellipse rx="9" ry="2.6" fill="none" stroke="#ddc47d" strokeWidth="1.15" transform="rotate(-13)"/><ellipse rx="7.2" ry="1.8" fill="none" stroke="#967341" strokeWidth=".45" transform="rotate(-13)"/><circle r="4.4" fill="url(#planet-saturn)"/><path d="M-4.1-.8h8.2M-3.7 1.2h7.4" stroke="#ae8148" strokeWidth=".55" opacity=".8"/></g>;
  if (name === "Uranus") return <g><ellipse rx="6.4" ry="1.6" fill="none" stroke="#b8f4ec" strokeWidth=".55" transform="rotate(70)" opacity=".75"/><circle r="3.8" fill="url(#planet-uranus)"/></g>;
  return <g><circle r="4" fill="url(#planet-neptune)"/><path d="M-3.7.4c2-1 5 .6 7.4-.5" stroke="#a9cfff" strokeWidth=".55" opacity=".75" fill="none"/></g>;
}

export function SolarSystemOrbit() {
  return (
    <svg className="studio-solar-system" viewBox="0 0 500 420" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <defs>
        <radialGradient id="planet-mercury" cx="30%" cy="22%"><stop stopColor="#dad6cb"/><stop offset=".58" stopColor="#878984"/><stop offset="1" stopColor="#3f4544"/></radialGradient>
        <radialGradient id="planet-venus" cx="28%" cy="20%"><stop stopColor="#fff0b4"/><stop offset=".48" stopColor="#d69a54"/><stop offset="1" stopColor="#7d4328"/></radialGradient>
        <radialGradient id="planet-earth" cx="28%" cy="20%"><stop stopColor="#a8e8ff"/><stop offset=".5" stopColor="#2d8bc0"/><stop offset="1" stopColor="#123360"/></radialGradient>
        <radialGradient id="planet-mars" cx="28%" cy="20%"><stop stopColor="#ffc093"/><stop offset=".5" stopColor="#c95a3c"/><stop offset="1" stopColor="#67271e"/></radialGradient>
        <radialGradient id="planet-jupiter" cx="30%" cy="20%"><stop stopColor="#fff0cf"/><stop offset=".52" stopColor="#c99662"/><stop offset="1" stopColor="#704331"/></radialGradient>
        <radialGradient id="planet-saturn" cx="30%" cy="20%"><stop stopColor="#fff0bd"/><stop offset=".55" stopColor="#d1a65d"/><stop offset="1" stopColor="#755027"/></radialGradient>
        <radialGradient id="planet-uranus" cx="28%" cy="20%"><stop stopColor="#e5ffff"/><stop offset=".52" stopColor="#72d9d5"/><stop offset="1" stopColor="#277e88"/></radialGradient>
        <radialGradient id="planet-neptune" cx="28%" cy="20%"><stop stopColor="#8fc5ff"/><stop offset=".5" stopColor="#3267d2"/><stop offset="1" stopColor="#172d78"/></radialGradient>
        <filter id="planet-glow" x="-100%" y="-100%" width="300%" height="300%"><feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#70dcca" floodOpacity=".28"/></filter>
      </defs>
      <g className="studio-solar-rings">
        {ORBITS.map((orbit, index) => (
          <ellipse key={orbit.name} cx={CX} cy={CY} rx={orbit.rx} ry={orbit.ry} transform={`rotate(${orbit.tilt} ${CX} ${CY})`} style={{ opacity: .16 + index * .012 }} />
        ))}
      </g>
      {ORBITS.map((orbit) => (
        <g key={orbit.name} transform={`rotate(${orbit.tilt} ${CX} ${CY})`} className={`studio-svg-planet studio-svg-${orbit.name.toLowerCase()}`}>
          <g filter="url(#planet-glow)">
            <Planet name={orbit.name}/>
            <animateMotion dur={`${orbit.seconds}s`} begin={`${orbit.begin}s`} repeatCount="indefinite" rotate="0" path={orbitPath(orbit.rx, orbit.ry)} />
          </g>
        </g>
      ))}
    </svg>
  );
}
