// src/hooks/useConfetti.ts
import confetti from "canvas-confetti";
import { useCallback } from "react";

export function useConfetti() {
  const trigger = useCallback(() => {
    // A nice "fireworks" effect from the sides
    const duration = 3000;
    const end = Date.now() + duration;

    const frame = () => {
      // Launch a few confetti from the left edge
      confetti({
        particleCount: 2,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ["#4A0F2B", "#EAB308", "#ffffff"] // Your brand colors
      });
      
      // And from the right edge
      confetti({
        particleCount: 2,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ["#4A0F2B", "#EAB308", "#ffffff"]
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };

    frame();
  }, []);

  return { fireConfetti: trigger };
}
