"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function LandingMotion({children}:{children:ReactNode}) {
  const root=useRef<HTMLDivElement>(null);
  const [paused,setPaused]=useState(false);
  const [visible,setVisible]=useState(true);
  const [reduced,setReduced]=useState(true);
  useEffect(()=>{
    const media=window.matchMedia("(prefers-reduced-motion: reduce)");
    const preference=()=>setReduced(media.matches);
    const visibility=()=>setVisible(document.visibilityState==="visible");
    preference();visibility();media.addEventListener("change",preference);document.addEventListener("visibilitychange",visibility);
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>entry.target.setAttribute("data-visible",String(entry.isIntersecting))),{threshold:0.12});
    root.current?.querySelectorAll("[data-motion]").forEach(el=>observer.observe(el));
    return()=>{observer.disconnect();media.removeEventListener("change",preference);document.removeEventListener("visibilitychange",visibility);};
  },[]);
  return <div ref={root} className="landing studio-home" data-motion-running={!paused&&visible&&!reduced}>
    <div className="studio-motion-bar"><button type="button" aria-pressed={paused} onClick={()=>setPaused(p=>!p)} disabled={reduced}>{reduced?"Reduced motion":paused?"Play motion":"Pause motion"}<span aria-hidden>{paused?" ▷":" Ⅱ"}</span></button></div>
    {children}
  </div>;
}
