"use client";

export default function HoneycombBackground() {
  return (
    <div
      id="hex-bg"
      className="fixed -inset-[25%] pointer-events-none z-0 opacity-[0.28]"
      aria-hidden
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='104' viewBox='0 0 120 104'%3E%3Cg fill='none' stroke='%23C9A84C' stroke-opacity='0.28' stroke-width='1'%3E%3Cpath d='M30 2 L60 19 L60 49 L30 66 L0 49 L0 19 Z'/%3E%3Cpath d='M90 2 L120 19 L120 49 L90 66 L60 49 L60 19 Z'/%3E%3Cpath d='M60 49 L90 66 L90 96 L60 113 L30 96 L30 66 Z'/%3E%3Cpath d='M0 49 L30 66 L30 96 L0 113 L-30 96 L-30 66 Z'/%3E%3C/g%3E%3C/svg%3E")`,
        backgroundSize: "120px 104px",
        transform: "rotate(-6deg)",
      }}
    />
  );
}
