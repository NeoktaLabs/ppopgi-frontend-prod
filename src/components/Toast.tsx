import React from "react";

type Props = {
  text: string | null;
};

export function Toast({ text }: Props) {
  if (!text) return null;

  const wrap: React.CSSProperties = {
    position: "fixed",
    left: "50%",
    bottom: 18,
    transform: "translateX(-50%)",
    zIndex: 20000,
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid rgba(0,0,0,0.18)",
    background: "rgba(255,255,255,0.92)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
    fontSize: 13,
    fontWeight: 800,
    color: "#2B2B33",
    maxWidth: "min(520px, calc(100vw - 32px))",
    textAlign: "center",
  };

  return <div style={wrap}>{text}</div>;
}