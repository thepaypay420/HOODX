import type { CSSProperties } from "react";

const PLANETS = [
  { name: "Mercury", track: "a", angle: 18 },
  { name: "Venus", track: "b", angle: 54 },
  { name: "Earth", track: "a", angle: 108 },
  { name: "Mars", track: "b", angle: 144 },
  { name: "Jupiter", track: "a", angle: 198 },
  { name: "Saturn", track: "b", angle: 234 },
  { name: "Uranus", track: "a", angle: 288 },
  { name: "Neptune", track: "b", angle: 324 },
] as const;

type PlanetName = (typeof PLANETS)[number]["name"];

function positionAt(angle: number) {
  const radians = angle * Math.PI / 180;
  return {
    "--planet-x": `${50 + Math.cos(radians) * 50}%`,
    "--planet-y": `${50 + Math.sin(radians) * 50}%`,
  } as CSSProperties;
}

function PlanetArt({ name }: { name: PlanetName }) {
  const id = name.toLowerCase();
  const viewBox = name === "Saturn" ? "-11 -7 22 14" : name === "Uranus" ? "-7 -7 14 14" : name === "Jupiter" ? "-6 -6 12 12" : "-5 -5 10 10";
  return (
    <svg viewBox={viewBox} aria-hidden>
      <defs>
        <radialGradient id={`${id}-shade`} cx="28%" cy="20%">
          <stop stopColor={name === "Earth" ? "#a8e8ff" : name === "Mars" ? "#ffc093" : name === "Neptune" ? "#8fc5ff" : name === "Uranus" ? "#e5ffff" : name === "Mercury" ? "#dad6cb" : "#fff0c2"}/>
          <stop offset=".52" stopColor={name === "Earth" ? "#2d8bc0" : name === "Mars" ? "#c95a3c" : name === "Neptune" ? "#3267d2" : name === "Uranus" ? "#72d9d5" : name === "Mercury" ? "#878984" : name === "Jupiter" ? "#c99662" : "#d1a65d"}/>
          <stop offset="1" stopColor={name === "Earth" ? "#123360" : name === "Mars" ? "#67271e" : name === "Neptune" ? "#172d78" : name === "Uranus" ? "#277e88" : name === "Mercury" ? "#3f4544" : "#75452a"}/>
        </radialGradient>
        <filter id={`${id}-glow`} x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#70dcca" floodOpacity=".3"/></filter>
      </defs>
      <g filter={`url(#${id}-glow)`}>
        {name === "Saturn" && <><ellipse rx="9" ry="2.6" fill="none" stroke="#ddc47d" strokeWidth="1.15" transform="rotate(-13)"/><ellipse rx="7.2" ry="1.8" fill="none" stroke="#967341" strokeWidth=".45" transform="rotate(-13)"/></>}
        {name === "Uranus" && <ellipse rx="6.4" ry="1.6" fill="none" stroke="#b8f4ec" strokeWidth=".55" transform="rotate(70)" opacity=".75"/>}
        <circle r={name === "Jupiter" ? 5.2 : name === "Saturn" ? 4.4 : name === "Mercury" ? 2.8 : 3.7} fill={`url(#${id}-shade)`}/>
        {name === "Mercury" && <><circle cx="-.8" cy="-.7" r=".45" fill="#555955"/><circle cx="1" cy=".8" r=".35" fill="#646763"/></>}
        {name === "Venus" && <path d="M-3-1c2 1 4-1 6 .2M-3 1c2-1 4 1 6-.2" stroke="#fff1bc" strokeWidth=".45" opacity=".55" fill="none"/>}
        {name === "Earth" && <><path d="M-2.5-1.6l1.5-.7 1.1.8-.6 1.4-1.4.3zm2.1 2.3 1.5-.5 1.1 1.2-1.6.8z" fill="#75bd79"/><path d="M-3 .9c2-.7 4 .5 6-.4" stroke="#ddffff" strokeWidth=".35" opacity=".7" fill="none"/></>}
        {name === "Mars" && <><circle cx="1" cy=".7" r=".65" fill="#6e261c" opacity=".75"/><path d="M-1.8-2.1h2.3" stroke="#f7dfd0" strokeWidth=".55" strokeLinecap="round"/></>}
        {name === "Jupiter" && <><path d="M-4.8-2.2h9.6M-5-.1h10M-4.6 2.2h9.2" stroke="#8e5940" strokeWidth=".75" opacity=".9"/><ellipse cx="2.5" cy="1.5" rx="1.25" ry=".65" fill="#a94631"/></>}
        {name === "Saturn" && <path d="M-4.1-.8h8.2M-3.7 1.2h7.4" stroke="#ae8148" strokeWidth=".55" opacity=".8"/>}
        {name === "Neptune" && <path d="M-3.7.4c2-1 5 .6 7.4-.5" stroke="#a9cfff" strokeWidth=".55" opacity=".75" fill="none"/>}
      </g>
    </svg>
  );
}

export function OrbitPlanets({ track }: { track: "a" | "b" }) {
  return PLANETS.filter((planet) => planet.track === track).map((planet) => (
    <span key={planet.name} className={`studio-line-planet studio-line-${planet.name.toLowerCase()}`} style={positionAt(planet.angle)}>
      <PlanetArt name={planet.name}/>
    </span>
  ));
}
