// src/components/LotteryCardSkeleton.tsx

import "./LotteryCardSkeleton.css";

export function LotteryCardSkeleton() {
  return (
    <div className="rc-skeleton">
      {/* Notches */}
      <div className="rc-sk-notch left" />
      <div className="rc-sk-notch right" />

      {/* Header */}
      <div className="rc-sk-header">
        <div className="rc-bone rc-sk-chip" />
        <div className="rc-bone rc-sk-actions" />
      </div>

      {/* Title Area */}
      <div className="rc-bone rc-sk-host" />
      <div className="rc-bone rc-sk-title" />
      <div className="rc-bone rc-sk-title-2" />

      {/* Prize Area */}
      <div className="rc-bone rc-sk-prize-lbl" />
      <div className="rc-bone rc-sk-prize-val" />

      <div className="rc-sk-tear" />

      {/* Stats Grid */}
      <div className="rc-sk-grid">
        <div className="rc-bone rc-sk-stat" />
        <div className="rc-bone rc-sk-stat" />
      </div>

      {/* Progress Bars */}
      <div className="rc-bone rc-sk-bar" />
      <div className="rc-bone rc-sk-bar" />

      {/* Footer */}
      <div className="rc-sk-footer" />
    </div>
  );
}
